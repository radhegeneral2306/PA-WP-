// "Staff manage" (admin only): add a user, remove (deactivate) one, edit one
// (name / branch / role), or list everyone.

import { BRANCHES, branchName, type BranchId, type Role, type User } from "../../domain/types";
import { endFlow, replyValue, setStep, type BotContext, type Flow, type Inbound } from "../flow";
import type { Outgoing } from "../outgoing";
import { branchList, buttons, confirmButtons, list, text, userList } from "../ui";
import { normalizePhone } from "../../numbers";
import { roleLabel, syncUserTasks, welcomeMessage } from "../userChanges";

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
const EDIT_BRANCH_PROMPT = "Kiski details badalni hain? Branch chuniye.";
const EDIT_NAME_PROMPT = "Naya naam likhiye ✍️";
const EDIT_NEW_BRANCH_PROMPT = "Nayi branch chuniye.";

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
      case "edit_branch":
        return editBranch(ctx, input);
      case "edit_user":
        return editUser(ctx, data, input);
      case "edit_field":
        return editField(ctx, data, input);
      case "edit_name":
        return editName(ctx, data, input);
      case "edit_new_branch":
        return editNewBranch(ctx, data, input);
      case "edit_confirm":
        return editConfirm(ctx, data, input);
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
    { id: `${ID}:action:edit`, title: "✏️ Staff edit karo" },
  ], "Staff manage");
}

function roleButtons(to: string, body: string): Outgoing {
  return buttons(to, body, [
    { id: `${ID}:role:staff`, title: "Staff" },
    { id: `${ID}:role:admin`, title: "Admin" },
  ]);
}

function draftRoleLabel(role: string, branch: string | undefined): string {
  return roleLabel({ role: role as Role, branch: (branch || null) as BranchId | null });
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
    case "edit":
      await setStep(ctx, ID, "edit_branch");
      return [branchList(to, ID, EDIT_BRANCH_PROMPT, { includeAdmins: true })];
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
  return [`👤 Naam: *${data.name}*`, `📱 Number: *+${data.phone}*`, `🏷️ Role: *${draftRoleLabel(data.role, data.branch)}*`].join("\n");
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
  const added: User = {
    phone: data.phone,
    name: data.name,
    role,
    branch: role === "admin" ? null : (data.branch as BranchId),
    active: true,
    createdAt: now.toISOString(),
  };
  await ctx.store.saveUser(added);
  await endFlow(ctx);

  return [
    text(user.phone, `✅ *${data.name}* add ho gaya (${roleLabel(added)}).\nUnko WhatsApp pe welcome message bhej diya hai.`),
    welcomeMessage(added, user.name),
  ];
}

// ---- remove ----

/** Active members of a branch (staff) or of the admins group; null for an unknown key. */
async function groupUsers(ctx: BotContext, key: string): Promise<User[] | null> {
  if (key === ADMINS) return ctx.store.listUsers({ role: "admin" });
  if (isBranch(key)) return ctx.store.listUsers({ branch: key, role: "staff" });
  return null;
}

async function removable(ctx: BotContext, key: string): Promise<User[] | null> {
  const users = await groupUsers(ctx, key);
  return users && users.filter((u) => u.phone !== ctx.user.phone);
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

// ---- edit ----

type Field = "name" | "branch" | "role";

function editPrompt(key: string): string {
  return `*${groupLabel(key)}* mein kiski details badalni hain?`;
}

function fieldButtons(to: string, body: string): Outgoing {
  return buttons(to, body, [
    { id: `${ID}:field:name`, title: "Naam" },
    { id: `${ID}:field:branch`, title: "Branch" },
    { id: `${ID}:field:role`, title: "Role" },
  ]);
}

function fieldPrompt(u: User): string {
  return `*${u.name}* (${roleLabel(u)}): kya badalna hai?`;
}

async function editTarget(ctx: BotContext, data: Data): Promise<User | null> {
  const target = data.phone ? await ctx.store.getUser(data.phone) : null;
  return target?.active ? target : null;
}

async function editBranch(ctx: BotContext, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const key = replyValue(input, ID, "branch");
  const users = key ? await groupUsers(ctx, key) : null;
  if (!key || !users) return [branchList(to, ID, withHint(TAP_HINT, EDIT_BRANCH_PROMPT), { includeAdmins: true })];
  if (users.length === 0) {
    return [branchList(to, ID, `*${groupLabel(key)}* mein abhi koi nahi hai. Dusri branch chuniye.`, { includeAdmins: true })];
  }
  await setStep(ctx, ID, "edit_user", { branch: key });
  return [userList(to, ID, users, editPrompt(key))];
}

async function editUser(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const key = data.branch;
  const users = key ? await groupUsers(ctx, key) : null;
  if (!key || !users) return broken(ctx);

  const page = replyValue(input, ID, "page");
  if (page !== null) return [userList(to, ID, users, editPrompt(key), { page: Number(page) || 0 })];

  const phone = replyValue(input, ID, "user");
  const target = phone ? users.find((u) => u.phone === phone) : undefined;
  if (!target) {
    const hint = phone ? "Ye naam is list mein nahi hai." : TAP_HINT;
    return [userList(to, ID, users, withHint(hint, editPrompt(key)))];
  }
  await setStep(ctx, ID, "edit_field", { ...data, phone: target.phone });
  return [fieldButtons(to, fieldPrompt(target))];
}

async function activeAdminCount(ctx: BotContext): Promise<number> {
  return (await ctx.store.listUsers({ role: "admin" })).length;
}

/** Why this role change is not allowed, or null when it is. */
async function roleBlock(ctx: BotContext, target: User): Promise<string | null> {
  if (target.phone === ctx.user.phone) return "Apna role khud nahi badal sakte.";
  if (target.role === "admin" && (await activeAdminCount(ctx)) <= 1) {
    return "Ye akele admin hain, inhe staff nahi bana sakte.";
  }
  return null;
}

async function editField(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const target = await editTarget(ctx, data);
  if (!target) return broken(ctx);
  const field = replyValue(input, ID, "field");
  const base = { branch: data.branch ?? "", phone: target.phone };

  if (field === "name") {
    await setStep(ctx, ID, "edit_name", { ...base, field });
    return [text(to, `*${target.name}* ka ${EDIT_NAME_PROMPT.toLowerCase()}`)];
  }
  if (field === "branch") {
    if (target.role === "admin") return [fieldButtons(to, withHint("Admin ki branch nahi hoti.", fieldPrompt(target)))];
    await setStep(ctx, ID, "edit_new_branch", { ...base, field });
    return [branchList(to, ID, EDIT_NEW_BRANCH_PROMPT)];
  }
  if (field === "role") {
    const blockedBy = await roleBlock(ctx, target);
    if (blockedBy) return [fieldButtons(to, withHint(blockedBy, fieldPrompt(target)))];
    if (target.role === "staff") return toEditConfirm(ctx, target, { ...base, field, newRole: "admin" });
    await setStep(ctx, ID, "edit_new_branch", { ...base, field, newRole: "staff" });
    return [branchList(to, ID, `*${target.name}* staff banenge. Kis branch mein?`)];
  }
  return [fieldButtons(to, withHint(TAP_HINT, fieldPrompt(target)))];
}

async function editName(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const target = await editTarget(ctx, data);
  if (!target) return broken(ctx);
  const name = input.text.trim();
  if (input.reply || name.length < NAME_MIN || name.length > NAME_MAX) {
    return [text(ctx.user.phone, withHint(`Naam ${NAME_MIN} se ${NAME_MAX} akshar ka likhiye.`, EDIT_NAME_PROMPT))];
  }
  return toEditConfirm(ctx, target, { ...data, newName: name });
}

async function editNewBranch(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const target = await editTarget(ctx, data);
  if (!target) return broken(ctx);
  const branch = replyValue(input, ID, "branch");
  const prompt = data.newRole === "staff" ? `*${target.name}* staff banenge. Kis branch mein?` : EDIT_NEW_BRANCH_PROMPT;
  if (!branch || !isBranch(branch)) return [branchList(to, ID, withHint(TAP_HINT, prompt))];
  if (data.field === "branch" && branch === target.branch) {
    return [branchList(to, ID, withHint(`*${target.name}* pehle se ${branchName(branch)} mein hain.`, prompt))];
  }
  return toEditConfirm(ctx, target, { ...data, newBranch: branch });
}

/** The user as it will be saved, or null when the session data does not describe a valid change. */
function editedUser(target: User, data: Data): User | null {
  const field = data.field as Field;
  if (field === "name" && data.newName) return { ...target, name: data.newName };
  if (field === "branch" && target.role === "staff" && isBranch(data.newBranch ?? "")) {
    return { ...target, branch: data.newBranch as BranchId };
  }
  if (field === "role" && target.role === "staff" && data.newRole === "admin") return { ...target, role: "admin", branch: null };
  if (field === "role" && target.role === "admin" && data.newRole === "staff" && isBranch(data.newBranch ?? "")) {
    return { ...target, role: "staff", branch: data.newBranch as BranchId };
  }
  return null;
}

function editSummary(before: User, after: User): string {
  const lines = [`✏️ *${before.name}* ki details badlengi:`];
  if (before.name !== after.name) lines.push(`👤 Naam: ${before.name} → *${after.name}*`);
  if (before.role !== after.role) {
    lines.push(`🏷️ Role: ${roleLabel(before)} → *${roleLabel(after)}*`);
  } else if (before.branch !== after.branch) {
    lines.push(`🏢 Branch: ${branchName(before.branch)} → *${branchName(after.branch)}*`);
  }
  return lines.join("\n");
}

async function toEditConfirm(ctx: BotContext, target: User, data: Data): Promise<Outgoing[]> {
  const after = editedUser(target, data);
  if (!after) return broken(ctx);
  await setStep(ctx, ID, "edit_confirm", data);
  return [confirmButtons(ctx.user.phone, ID, `${editSummary(target, after)}\n\nUpdate kar du?`)];
}

async function editConfirm(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const target = await editTarget(ctx, data);
  const after = target && editedUser(target, data);
  if (!target || !after) return broken(ctx);

  const answer = replyValue(input, ID, "confirm");
  if (answer === "no") {
    await endFlow(ctx);
    return [text(to, "Theek hai, kuch nahi badla.")];
  }
  if (answer !== "yes") return [confirmButtons(to, ID, withHint(TAP_HINT, `${editSummary(target, after)}\n\nUpdate kar du?`))];

  if (data.field === "role") {
    const blockedBy = await roleBlock(ctx, target);
    if (blockedBy) {
      await endFlow(ctx);
      return [text(to, blockedBy)];
    }
  }
  await ctx.store.saveUser(after);
  const moved = await syncUserTasks(ctx.store, target, after);
  await endFlow(ctx);
  const tasksLine = moved ? `\n\n📋 ${moved} task(s) bhi update ho gaye.` : "";
  return [text(to, `✅ Update ho gaya\n\n${editSummary(target, after).split("\n").slice(1).join("\n")}${tasksLine}`)];
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
