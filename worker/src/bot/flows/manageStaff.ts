// "Staff manage" (admin only): add a user, remove (deactivate) one, or list everyone.

import { BRANCHES, branchName, type BranchId, type Role, type User } from "../../domain/types";
import { endFlow, replyValue, setStep, type BotContext, type Flow, type Inbound } from "../flow";
import type { Outgoing } from "../outgoing";
import { branchList, buttons, confirmButtons, list, text, userList } from "../ui";
import { normalizePhone } from "../../numbers";

const ID = "manage_staff";
const ADMINS = "ADMINS";
const NAME_MIN = 2;
const NAME_MAX = 40;

type Data = Record<string, string>;

const TAP_HINT = "Neeche diye option mein se chuniye 👇";
const NAME_PROMPT = "Naye staff ka naam likhiye ✍️";
const PHONE_PROMPT = "10 digit mobile number likhiye";
const ROLE_PROMPT = "Role kya hoga?";
const ADD_BRANCH_PROMPT = "Kis branch mein add karna hai?";
const REMOVE_BRANCH_PROMPT = "Kis branch se hatana hai?";
const BROKEN = "Kuch gadbad hui, dobara *Hi* bhejiye.";

export const manageStaffFlow: Flow = {
  id: ID,

  async start(ctx) {
    if (ctx.user.role !== "admin") return blocked(ctx);
    await setStep(ctx, ID, "choose");
    return [menu(ctx.user.phone, "Staff manage ⚙️ Kya karna hai?")];
  },

  async handle(ctx, session, input) {
    if (ctx.user.role !== "admin") return blocked(ctx);
    const data = session.data;
    switch (session.step) {
      case "choose":
        return choose(ctx, input);
      case "add_name":
        return addName(ctx, input);
      case "add_phone":
        return addPhone(ctx, data, input);
      case "add_role":
        return addRole(ctx, data, input);
      case "add_branch":
        return addBranch(ctx, data, input);
      case "add_confirm":
        return addConfirm(ctx, data, input);
      case "remove_branch":
        return removeBranch(ctx, input);
      case "remove_user":
        return removeUser(ctx, data, input);
      case "remove_confirm":
        return removeConfirm(ctx, data, input);
      default:
        return broken(ctx);
    }
  },
};

async function blocked(ctx: BotContext): Promise<Outgoing[]> {
  await endFlow(ctx);
  return [text(ctx.user.phone, "Ye option sirf admin ke liye hai.")];
}

async function broken(ctx: BotContext): Promise<Outgoing[]> {
  await endFlow(ctx);
  return [text(ctx.user.phone, BROKEN)];
}

function withHint(hint: string, body: string): string {
  return `${hint}\n\n${body}`;
}

function menu(to: string, body: string): Outgoing {
  return list(to, body, "Option chuno", [
    { id: `${ID}:action:add`, title: "➕ Staff add karo" },
    { id: `${ID}:action:remove`, title: "➖ Staff hatao" },
    { id: `${ID}:action:list`, title: "📃 Sabka list" },
  ], "Staff manage");
}

function roleButtons(to: string, body: string): Outgoing {
  return buttons(to, body, [
    { id: `${ID}:role:staff`, title: "Staff" },
    { id: `${ID}:role:admin`, title: "Admin" },
  ]);
}

function roleLabel(role: string, branch: string | undefined): string {
  return role === "admin" ? "Admin" : `Staff (${branchName((branch || null) as BranchId | null)})`;
}

function lastFour(phone: string): string {
  return `…${phone.slice(-4)}`;
}

/** Digits with country code, or null when it isn't an Indian mobile number. */
function isBranch(key: string): key is BranchId {
  return BRANCHES.some((b) => b.id === key);
}

async function choose(ctx: BotContext, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  switch (replyValue(input, ID, "action")) {
    case "add":
      await setStep(ctx, ID, "add_name");
      return [text(to, NAME_PROMPT)];
    case "remove":
      await setStep(ctx, ID, "remove_branch");
      return [branchList(to, ID, REMOVE_BRANCH_PROMPT, { includeAdmins: true })];
    case "list":
      await endFlow(ctx);
      return [text(to, await everyone(ctx))];
    default:
      return [menu(to, withHint(TAP_HINT, "Staff manage ⚙️ Kya karna hai?"))];
  }
}

// ---- add ----

async function addName(ctx: BotContext, input: Inbound): Promise<Outgoing[]> {
  const name = input.text.trim();
  if (input.reply || name.length < NAME_MIN || name.length > NAME_MAX) {
    return [text(ctx.user.phone, withHint(`Naam ${NAME_MIN} se ${NAME_MAX} akshar ka likhiye.`, NAME_PROMPT))];
  }
  await setStep(ctx, ID, "add_phone", { name });
  return [text(ctx.user.phone, `*${name}* ka ${PHONE_PROMPT}`)];
}

async function addPhone(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  if (!data.name) return broken(ctx);
  const phone = input.reply ? null : normalizePhone(input.text);
  if (!phone) return [text(to, withHint("Ye number sahi nahi laga.", `${PHONE_PROMPT}, jaise *9876543210*`))];

  const existing = await ctx.store.getUser(phone);
  if (existing?.active) {
    await endFlow(ctx);
    return [text(to, `Ye number pehle se *${existing.name}* ke naam se registered hai.`)];
  }
  await setStep(ctx, ID, "add_role", { ...data, phone });
  return [roleButtons(to, ROLE_PROMPT)];
}

async function addRole(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  if (!data.name || !data.phone) return broken(ctx);
  const role = replyValue(input, ID, "role");
  if (role === "admin") return toAddConfirm(ctx, { ...data, role, branch: "" });
  if (role === "staff") {
    await setStep(ctx, ID, "add_branch", { ...data, role });
    return [branchList(to, ID, ADD_BRANCH_PROMPT)];
  }
  return [roleButtons(to, withHint(TAP_HINT, ROLE_PROMPT))];
}

async function addBranch(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  if (!data.name || !data.phone) return broken(ctx);
  const branch = replyValue(input, ID, "branch");
  if (!branch || !isBranch(branch)) return [branchList(ctx.user.phone, ID, withHint(TAP_HINT, ADD_BRANCH_PROMPT))];
  return toAddConfirm(ctx, { ...data, branch });
}

function addSummary(data: Data): string {
  return [`👤 Naam: *${data.name}*`, `📱 Number: *+${data.phone}*`, `🏷️ Role: *${roleLabel(data.role, data.branch)}*`].join("\n");
}

async function toAddConfirm(ctx: BotContext, data: Data): Promise<Outgoing[]> {
  await setStep(ctx, ID, "add_confirm", data);
  return [confirmButtons(ctx.user.phone, ID, `${addSummary(data)}\n\nAdd kar du?`)];
}

async function addConfirm(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const { user, now } = ctx;
  if (!data.name || !data.phone || (data.role !== "staff" && data.role !== "admin")) return broken(ctx);
  if (data.role === "staff" && !isBranch(data.branch ?? "")) return broken(ctx);

  const answer = replyValue(input, ID, "confirm");
  if (answer === "no") {
    await endFlow(ctx);
    return [text(user.phone, "Theek hai, add nahi kiya.")];
  }
  if (answer !== "yes") return [confirmButtons(user.phone, ID, withHint(TAP_HINT, `${addSummary(data)}\n\nAdd kar du?`))];

  const role = data.role as Role;
  await ctx.store.saveUser({
    phone: data.phone,
    name: data.name,
    role,
    branch: role === "admin" ? null : (data.branch as BranchId),
    active: true,
    createdAt: now.toISOString(),
  });
  await endFlow(ctx);

  const label = roleLabel(role, data.branch);
  return [
    text(user.phone, `✅ *${data.name}* add ho gaya (${label}).\nUnko WhatsApp pe welcome message bhej diya hai.`),
    {
      to: data.phone,
      kind: "template",
      template: "welcome_user_v1",
      bodyValues: [data.name, user.name, label],
      fallbackText: [
        `Namaste ${data.name} ji,`,
        `${user.name} ne aapko Radhe Task Bot par *${label}* ke roop mein add kiya hai.`,
        "",
        "Ab aap WhatsApp par hi apne tasks dekh aur update kar sakte hain. Shuru karne ke liye *Hi* bhejiye.",
      ].join("\n"),
    },
  ];
}

// ---- remove ----

async function removable(ctx: BotContext, key: string): Promise<User[] | null> {
  let users: User[];
  if (key === ADMINS) users = await ctx.store.listUsers({ role: "admin" });
  else if (isBranch(key)) users = await ctx.store.listUsers({ branch: key, role: "staff" });
  else return null;
  return users.filter((u) => u.phone !== ctx.user.phone);
}

function groupLabel(key: string): string {
  return key === ADMINS ? "Admins" : branchName(key as BranchId);
}

function removePrompt(key: string): string {
  return `*${groupLabel(key)}* mein se kisko hatana hai?`;
}

async function removeBranch(ctx: BotContext, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const key = replyValue(input, ID, "branch");
  const users = key ? await removable(ctx, key) : null;
  if (!key || !users) return [branchList(to, ID, withHint(TAP_HINT, REMOVE_BRANCH_PROMPT), { includeAdmins: true })];
  if (users.length === 0) {
    return [branchList(to, ID, `*${groupLabel(key)}* mein hatane ke liye koi nahi hai. Dusri branch chuniye.`, { includeAdmins: true })];
  }
  await setStep(ctx, ID, "remove_user", { branch: key });
  return [userList(to, ID, users, removePrompt(key))];
}

async function removeUser(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const key = data.branch;
  const users = key ? await removable(ctx, key) : null;
  if (!key || !users) return broken(ctx);

  const page = replyValue(input, ID, "page");
  if (page !== null) return [userList(to, ID, users, removePrompt(key), { page: Number(page) || 0 })];

  const phone = replyValue(input, ID, "user");
  const target = phone ? users.find((u) => u.phone === phone) : undefined;
  if (!target) {
    const hint = phone ? "Ye naam is list mein nahi hai." : TAP_HINT;
    return [userList(to, ID, users, withHint(hint, removePrompt(key)))];
  }
  const pending = await ctx.store.listTasks({ assigneePhone: target.phone, status: "pending" });
  await setStep(ctx, ID, "remove_confirm", { ...data, phone: target.phone });
  return [confirmButtons(to, ID, removeQuestion(target, pending.length), "Haan, hatao", "Nahi ❌")];
}

function removeQuestion(u: User, pending: number): string {
  return `*${u.name}* ko hatana hai? Unke *${pending}* pending tasks waise hi rahenge.`;
}

async function removeConfirm(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const target = data.phone ? await ctx.store.getUser(data.phone) : null;
  if (!target || !target.active || target.phone === ctx.user.phone) return broken(ctx);

  const answer = replyValue(input, ID, "confirm");
  if (answer === "no") {
    await endFlow(ctx);
    return [text(to, "Theek hai, kisi ko nahi hataya.")];
  }
  if (answer !== "yes") {
    const pending = await ctx.store.listTasks({ assigneePhone: target.phone, status: "pending" });
    return [confirmButtons(to, ID, withHint(TAP_HINT, removeQuestion(target, pending.length)), "Haan, hatao", "Nahi ❌")];
  }
  await ctx.store.saveUser({ ...target, active: false });
  await endFlow(ctx);
  return [text(to, `✅ *${target.name}* ko hata diya. Ab wo bot use nahi kar payenge.`)];
}

// ---- list ----

async function everyone(ctx: BotContext): Promise<string> {
  const users = await ctx.store.listUsers();
  const line = (u: User) => `• ${u.name} (number ending ${lastFour(u.phone)})`;
  const section = (title: string, members: User[]) =>
    [`*${title}* (${members.length})`, ...(members.length ? members.map(line) : ["• Koi nahi"])].join("\n");

  const parts = BRANCHES.map((b) => section(b.name, users.filter((u) => u.role === "staff" && u.branch === b.id)));
  parts.push(section("Admins", users.filter((u) => u.role === "admin")));
  return [`📃 Sabka list: kul *${users.length}* log`, ...parts].join("\n\n");
}
