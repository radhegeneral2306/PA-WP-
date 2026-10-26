// "Naya task" wizard: pick assignee (admins only), title, due date/time,
// confirm, then save and notify the assignee.

import { BRANCHES, branchName, type BranchId, type Role, type User } from "../../domain/types";
import { addDays, dueOnDay, formatDue, istDay, parseDue, type ISTDay, type ParsedDue } from "../../domain/dates";
import { endFlow, isReply, replyValue, setStep, type BotContext, type Flow, type Inbound } from "../flow";
import type { Outgoing } from "../outgoing";
import { branchList, confirmButtons, dueDateButtons, text, timeButtons, userList } from "../ui";

const ID = "create_task";
const TITLE_MAX = 200;
const ADMINS = "ADMINS";

type Data = Record<string, string>;

const TAP_HINT = "Neeche diye option mein se chuniye 👇";
const BRANCH_PROMPT = "Kis branch ko task dena hai?";
const TITLE_PROMPT = "Task kya hai? Likh ke bhejiye 📝";
const DUE_PROMPT = "Task ki due date kab hai?";
const TIME_PROMPT = "Time bhi dena hai? Likhiye jaise *4pm* ya *11:30 am*. Time nahi hai toh Skip dabaiye (10 AM default).";
const CUSTOM_DUE_PROMPT = "Date likhiye, jaise *28/10*, *28/10 4pm* ya *kal 11am*";
const BROKEN = "Kuch gadbad hui, dobara *Hi* bhejiye.";

export const createTaskFlow: Flow = {
  id: ID,

  async start(ctx) {
    const { user } = ctx;
    if (user.role === "admin") {
      await setStep(ctx, ID, "pick_branch");
      return [branchList(user.phone, ID, BRANCH_PROMPT, { includeAdmins: true })];
    }
    await setStep(ctx, ID, "ask_title", assigneeData(user));
    return [text(user.phone, TITLE_PROMPT)];
  },

  async handle(ctx, session, input) {
    const data = session.data;
    switch (session.step) {
      case "pick_branch":
        return pickBranch(ctx, input);
      case "pick_user":
        return pickUser(ctx, data, input);
      case "ask_title":
        return askTitle(ctx, data, input);
      case "ask_due":
        return askDue(ctx, data, input);
      case "ask_time":
        return askTime(ctx, data, input);
      case "ask_custom_due":
        return askCustomDue(ctx, data, input);
      case "confirm":
        return confirm(ctx, data, input);
      default:
        return broken(ctx);
    }
  },
};

function assigneeData(u: User): Data {
  return { assigneePhone: u.phone, assigneeName: u.name, assigneeBranch: u.branch ?? "", assigneeRole: u.role };
}

async function broken(ctx: BotContext): Promise<Outgoing[]> {
  await endFlow(ctx);
  return [text(ctx.user.phone, BROKEN)];
}

function withHint(hint: string | undefined, body: string): string {
  return hint ? `${hint}\n\n${body}` : body;
}

async function usersFor(ctx: BotContext, key: string): Promise<User[] | null> {
  if (key === ADMINS) return ctx.store.listUsers({ role: "admin" });
  if (!BRANCHES.some((b) => b.id === key)) return null;
  return ctx.store.listUsers({ branch: key as BranchId, role: "staff" });
}

function groupLabel(key: string): string {
  return key === ADMINS ? "Admins" : branchName(key as BranchId);
}

async function pickBranch(ctx: BotContext, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const key = replyValue(input, ID, "branch");
  const users = key ? await usersFor(ctx, key) : null;
  if (!key || !users) return [branchList(to, ID, withHint(TAP_HINT, BRANCH_PROMPT), { includeAdmins: true })];
  if (users.length === 0) {
    const msg = `*${groupLabel(key)}* mein abhi koi nahi hai. Dusri branch chuniye.`;
    return [branchList(to, ID, msg, { includeAdmins: true })];
  }
  await setStep(ctx, ID, "pick_user", { branch: key });
  return [userList(to, ID, users, userPrompt(key))];
}

function userPrompt(key: string): string {
  return `*${groupLabel(key)}* mein kisko task dena hai?`;
}

async function pickUser(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const key = data.branch;
  const users = key ? await usersFor(ctx, key) : null;
  if (!key || !users) return broken(ctx);

  const page = replyValue(input, ID, "page");
  if (page !== null) return [userList(to, ID, users, userPrompt(key), { page: Number(page) || 0 })];

  const phone = replyValue(input, ID, "user");
  const picked = phone ? await ctx.store.getUser(phone) : null;
  if (!picked || !picked.active) {
    const hint = phone ? "Ye naam ab list mein nahi hai." : TAP_HINT;
    return [userList(to, ID, users, withHint(hint, userPrompt(key)))];
  }
  await setStep(ctx, ID, "ask_title", assigneeData(picked));
  return [text(to, TITLE_PROMPT)];
}

async function askTitle(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  if (!data.assigneePhone) return broken(ctx);
  const title = input.text.trim();
  if (input.reply || title.length === 0 || title.length > TITLE_MAX) {
    return [text(ctx.user.phone, withHint(`Task likh ke bhejiye (${TITLE_MAX} akshar tak).`, TITLE_PROMPT))];
  }
  await setStep(ctx, ID, "ask_due", { ...data, title });
  return [dueDateButtons(ctx.user.phone, ID, DUE_PROMPT)];
}

function dayKey(d: ISTDay): string {
  return `${d.year}-${d.month}-${d.day}`;
}

function parseDayKey(s: string | undefined): ISTDay | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s ?? "");
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

async function askDue(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  if (!data.title) return broken(ctx);
  const choice = replyValue(input, ID, "due");
  if (choice === "today" || choice === "tomorrow") {
    const today = istDay(ctx.now);
    const day = choice === "today" ? today : addDays(today, 1);
    await setStep(ctx, ID, "ask_time", { ...data, day: dayKey(day) });
    return [timeButtons(to, ID, TIME_PROMPT)];
  }
  if (choice === "custom") {
    await setStep(ctx, ID, "ask_custom_due", data);
    return [text(to, CUSTOM_DUE_PROMPT)];
  }
  const typed = input.reply ? null : parseDue(input.text, ctx.now);
  if (typed) return acceptDue(ctx, data, typed);
  return [dueDateButtons(to, ID, withHint("Button dabaiye ya date likhiye (jaise *28/10*).", DUE_PROMPT))];
}

async function askTime(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const day = parseDayKey(data.day);
  if (!data.title || !day) return broken(ctx);
  let due: ParsedDue | null = null;
  if (isReply(input, ID, "time:skip")) due = dueOnDay(day, null);
  else if (!input.reply && input.text.trim()) due = dueOnDay(day, input.text);
  if (!due) return [timeButtons(ctx.user.phone, ID, "Time samajh nahi aaya. Aise likhiye: 4pm, 11:30 am, shaam 6")];
  return acceptDue(ctx, data, due);
}

async function askCustomDue(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  if (!data.title) return broken(ctx);
  const due = input.reply ? null : parseDue(input.text, ctx.now);
  if (!due) return [text(ctx.user.phone, withHint("Date samajh nahi aayi.", CUSTOM_DUE_PROMPT))];
  return acceptDue(ctx, data, due);
}

async function acceptDue(ctx: BotContext, data: Data, due: ParsedDue): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const { day: _day, ...rest } = data;
  if (due.dueAt.getTime() < ctx.now.getTime()) {
    await setStep(ctx, ID, "ask_due", rest);
    return [dueDateButtons(to, ID, withHint("Ye date/time nikal chuka hai, aage ki date dijiye.", DUE_PROMPT))];
  }
  const next = { ...rest, dueAt: due.dueAt.toISOString(), dueHasTime: String(due.hasTime) };
  await setStep(ctx, ID, "confirm", next);
  return [confirmButtons(to, ID, `${summary(ctx, next)}\n\nTask bana du?`)];
}

function assigneeLabel(data: Data): string {
  const role = data.assigneeRole as Role;
  return role === "admin" ? "Admin" : branchName((data.assigneeBranch || null) as BranchId | null);
}

function dueText(ctx: BotContext, data: Data): string {
  return formatDue(data.dueAt, data.dueHasTime === "true", ctx.now);
}

function summary(ctx: BotContext, data: Data): string {
  const who = data.assigneePhone === ctx.user.phone ? "Aap khud" : `${data.assigneeName} (${assigneeLabel(data)})`;
  return [`📝 Task: *${data.title}*`, `👤 Kisko: *${who}*`, `📅 Due: *${dueText(ctx, data)}*`].join("\n");
}

async function confirm(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  if (!data.title || !data.assigneePhone || !data.assigneeName || !data.dueAt) return broken(ctx);
  const answer = replyValue(input, ID, "confirm");
  if (answer === "no") {
    await endFlow(ctx);
    return [text(to, "Theek hai, task cancel kar diya.")];
  }
  if (answer !== "yes") return [confirmButtons(to, ID, withHint(TAP_HINT, `${summary(ctx, data)}\n\nTask bana du?`))];
  return save(ctx, data);
}

async function save(ctx: BotContext, data: Data): Promise<Outgoing[]> {
  const { user, now } = ctx;
  const nowIso = now.toISOString();
  await ctx.store.createTask({
    title: data.title,
    assigneePhone: data.assigneePhone,
    assigneeName: data.assigneeName,
    branch: (data.assigneeBranch || null) as BranchId | null,
    createdByPhone: user.phone,
    createdByName: user.name,
    dueAt: data.dueAt,
    dueHasTime: data.dueHasTime === "true",
    status: "pending",
    repeat: "none",
    nextReminderAt: data.dueAt,
    remarks: [],
    createdAt: nowIso,
    updatedAt: nowIso,
    doneAt: null,
  });
  await endFlow(ctx);

  const out: Outgoing[] = [text(user.phone, `✅ Task ban gaya!\n\n${summary(ctx, data)}`)];
  if (data.assigneePhone !== user.phone) out.push(assignedTemplate(ctx, data));
  return out;
}

function assignedTemplate(ctx: BotContext, data: Data): Outgoing {
  const due = dueText(ctx, data);
  const creator = ctx.user.name;
  return {
    to: data.assigneePhone,
    kind: "template",
    template: "task_assigned_v1",
    bodyValues: [data.assigneeName, creator, data.title, due, due],
    fallbackText: [
      `Namaste ${data.assigneeName} ji,`,
      `${creator} ne aapko ek naya task diya hai.`,
      "",
      `📝 Task: *${data.title}*`,
      `📅 Due: *${due}*`,
      `⏰ Agla reminder: *${due}*`,
      "",
      "Menu ke liye *Hi* bhejiye.",
    ].join("\n"),
  };
}
