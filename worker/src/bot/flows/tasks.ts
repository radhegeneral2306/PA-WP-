// "Mere tasks" / "Staff ke tasks": browse pending tasks, open one, and act on
// it (Done / Update remark / Date badlo).

import type { BranchId, DateRequest, Remark, Task, TaskRepeat, User } from "../../domain/types";
import { BRANCHES, branchName } from "../../domain/types";
import {
  addDays,
  dueOnDay,
  formatDateTime,
  formatDue,
  isBeyondDays,
  isOverdue,
  istDay,
  parseDue,
  type ISTDay,
  type ParsedDue,
} from "../../domain/dates";
import { afterResponse, nextMonthlyTask } from "../../domain/schedule";
import { endFlow, isReply, replyValue, setStep, type BotContext, type Flow, type Inbound } from "../flow";
import type { Outgoing } from "../outgoing";
import { branchList, buttons, clip, dueDateButtons, taskList, text, timeButtons, userList } from "../ui";

const ID = "tasks";
const ADMINS = "ADMINS";
const MAX_STAFF_DAYS = 25;
const REMARK_MAX = 500;
const UPDATE_CLIP = 200;

const REPEAT_LABEL: Record<TaskRepeat, string> = { none: "Ek baar", every90: "Har 90 min", monthly: "Har mahine" };

type Data = Record<string, string>;
type View = "mine" | "user" | "group";

const MSG = {
  oops: "Kuch gadbad hui, dobara *Hi* bhejiye.",
  notFound: "Ye task nahi mila 🤔 Menu ke liye *Hi* bhejiye.",
  notYours: "Ye task aapka nahi hai.",
  adminOnly: "Ye option sirf admin ke liye hai.",
  pickBranch: "Kis branch ke tasks dekhne hain?",
  askRemark: "Update / remark likhiye (jaise customer ne kya bola):",
  askDue: "Nayi due date kab ki hai?",
  askTime: "Time bhi dena hai? Likhiye jaise *4pm*. Nahi toh Skip dabaiye (10 AM).",
  askCustomDue: "Date likhiye, jaise *28/10* ya *28/10 4pm*",
  askDateRemark: "Date kyun badal rahe hain? Remark likhiye (jaise customer ne kya bola):",
  askApprovalRemark: `⚠️ ${MAX_STAFF_DAYS} din se aage ki date ke liye admin approval chahiye. Remark likhiye, request admin ko jayegi.`,
  useList: "👆 Upar wali list se chuniye.",
  useButtons: "👆 Upar wale buttons se chuniye.",
};

export const tasksFlow: Flow = {
  id: ID,

  async start(ctx, arg) {
    if (arg === "staff") return startStaff(ctx);
    return renderList(ctx, { view: "mine", page: "0" });
  },

  async handle(ctx, session, input) {
    const data = session.data;
    switch (session.step) {
      case "pick_branch":
        return onPickBranch(ctx, input);
      case "pick_user":
        return onPickUser(ctx, data, input);
      case "list":
        return onList(ctx, data, input);
      case "detail":
        return onDetail(ctx, data, input);
      case "ask_remark":
        return onRemark(ctx, data, input);
      case "ask_due":
        return onAskDue(ctx, data, input);
      case "ask_time":
        return onAskTime(ctx, data, input);
      case "ask_custom_due":
        return onCustomDue(ctx, data, input);
      case "ask_date_remark":
        return onDateRemark(ctx, data, input);
      default:
        return oops(ctx);
    }
  },
};

// ---------- helpers ----------

function say(ctx: BotContext, body: string): Outgoing {
  return text(ctx.user.phone, body);
}

async function finish(ctx: BotContext, body: string): Promise<Outgoing[]> {
  await endFlow(ctx);
  return [say(ctx, body)];
}

const oops = (ctx: BotContext) => finish(ctx, MSG.oops);

function isTyped(input: Inbound): boolean {
  return input.reply === null && input.text.trim().length > 0;
}

function canAct(user: User, t: Task): boolean {
  return user.role === "admin" || t.assigneePhone === user.phone || t.createdByPhone === user.phone;
}

function isBranch(v: string): v is BranchId {
  return BRANCHES.some((b) => b.id === v);
}

function pageOf(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/** Drops the per-task keys so only the view info is carried back. */
function viewData(data: Data): Data {
  const keep = ["view", "page", "branch", "phone"];
  return Object.fromEntries(Object.entries(data).filter(([k]) => keep.includes(k)));
}

function dayKey(d: ISTDay): string {
  return `${d.year}-${d.month}-${d.day}`;
}

function parseDayKey(s: string | undefined): ISTDay | null {
  const m = s?.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

// ---------- staff picker ----------

async function startStaff(ctx: BotContext): Promise<Outgoing[]> {
  if (ctx.user.role !== "admin") return finish(ctx, MSG.adminOnly);
  await setStep(ctx, ID, "pick_branch");
  return [branchList(ctx.user.phone, ID, MSG.pickBranch, { includeAdmins: true })];
}

async function usersFor(ctx: BotContext, branch: string): Promise<User[]> {
  if (branch === ADMINS) return ctx.store.listUsers({ role: "admin" });
  return isBranch(branch) ? ctx.store.listUsers({ branch, role: "staff" }) : [];
}

function groupLabel(branch: string): string {
  return branch === ADMINS ? "Admins" : isBranch(branch) ? branchName(branch) : "—";
}

async function onPickBranch(ctx: BotContext, input: Inbound): Promise<Outgoing[]> {
  const branch = replyValue(input, ID, "branch");
  if (!branch || (branch !== ADMINS && !isBranch(branch))) {
    return [say(ctx, MSG.useList), branchList(ctx.user.phone, ID, MSG.pickBranch, { includeAdmins: true })];
  }
  const users = await usersFor(ctx, branch);
  if (users.length === 0) {
    return [
      say(ctx, `*${groupLabel(branch)}* mein abhi koi staff nahi hai.`),
      branchList(ctx.user.phone, ID, MSG.pickBranch, { includeAdmins: true }),
    ];
  }
  return renderUsers(ctx, branch, 0, users);
}

async function renderUsers(ctx: BotContext, branch: string, page: number, users?: User[]): Promise<Outgoing[]> {
  const list = users ?? (await usersFor(ctx, branch));
  await setStep(ctx, ID, "pick_user", { branch, upage: String(page) });
  const body = `*${groupLabel(branch)}* — kiske tasks dekhne hain?`;
  return [userList(ctx.user.phone, ID, list, body, { page, allLabel: "📋 Sabhi ke pending tasks" })];
}

async function onPickUser(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const branch = data.branch;
  if (!branch) return oops(ctx);
  const page = replyValue(input, ID, "page");
  if (page !== null) return renderUsers(ctx, branch, pageOf(page));

  const phone = replyValue(input, ID, "user");
  const view: Data | null = phone
    ? { view: "user", phone, branch, page: "0" }
    : isReply(input, ID, "all")
      ? { view: "group", branch, page: "0" }
      : null;
  if (!view) return [say(ctx, MSG.useList), ...(await renderUsers(ctx, branch, pageOf(data.upage)))];

  const tasks = await loadView(ctx, view);
  if (tasks === null) return oops(ctx);
  if (tasks.length === 0) {
    const who = view.view === "user" ? await nameOf(ctx, view.phone) : `${groupLabel(branch)} mein kisi`;
    return [say(ctx, `*${who}* ke koi pending task nahi hain.`), ...(await renderUsers(ctx, branch, pageOf(data.upage)))];
  }
  return renderList(ctx, view, tasks);
}

async function nameOf(ctx: BotContext, phone: string | undefined): Promise<string> {
  const u = phone ? await ctx.store.getUser(phone) : null;
  return u?.name ?? "Is user";
}

// ---------- task list ----------

async function loadView(ctx: BotContext, data: Data): Promise<Task[] | null> {
  const status = "pending" as const;
  const view = data.view as View | undefined;
  if (view === "mine") return ctx.store.listTasks({ assigneePhone: ctx.user.phone, status });
  if (view === "user" && data.phone) return ctx.store.listTasks({ assigneePhone: data.phone, status });
  if (view === "group" && data.branch) {
    if (isBranch(data.branch)) return ctx.store.listTasks({ branch: data.branch, status });
    if (data.branch === ADMINS) return adminTasks(ctx);
  }
  return null;
}

async function adminTasks(ctx: BotContext): Promise<Task[]> {
  const admins = await ctx.store.listUsers({ role: "admin" });
  const lists = await Promise.all(admins.map((a) => ctx.store.listTasks({ assigneePhone: a.phone, status: "pending" })));
  return lists.flat().sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

async function listBody(ctx: BotContext, data: Data, n: number): Promise<string> {
  const suffix = "👇 (⚠️ = overdue)";
  if (data.view === "mine") return `Aapke *${n}* pending tasks hain ${suffix}`;
  if (data.view === "user") return `*${await nameOf(ctx, data.phone)}* ke *${n}* pending tasks hain ${suffix}`;
  return `*${groupLabel(data.branch ?? "")}* ke *${n}* pending tasks hain ${suffix}`;
}

async function renderList(ctx: BotContext, data: Data, loaded?: Task[]): Promise<Outgoing[]> {
  const tasks = loaded ?? (await loadView(ctx, data));
  if (tasks === null) return oops(ctx);
  if (tasks.length === 0) {
    return finish(ctx, data.view === "mine" ? "🎉 Aapke koi pending task nahi hain!" : "🎉 Koi pending task nahi bacha!");
  }
  const vd = viewData(data);
  await setStep(ctx, ID, "list", vd);
  const body = await listBody(ctx, vd, tasks.length);
  const opts = { page: pageOf(vd.page), now: ctx.now, showAssignee: vd.view === "group" };
  return [taskList(ctx.user.phone, ID, tasks, body, opts)];
}

async function onList(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const page = replyValue(input, ID, "page");
  if (page !== null) return renderList(ctx, { ...data, page: String(pageOf(page)) });
  const taskId = replyValue(input, ID, "task");
  if (taskId) return openDetail(ctx, data, taskId);
  return [say(ctx, MSG.useList), ...(await renderList(ctx, data))];
}

// ---------- detail ----------

function detailBody(t: Task, now: Date): string {
  const overdue = t.status === "pending" && isOverdue(t.dueAt, now) ? " ⚠️ Overdue" : "";
  const lines = [
    `*${t.title}*`,
    `Kisko: ${t.assigneeName}`,
    `Diya: ${t.createdByName}`,
    `Due: ${formatDue(t.dueAt, t.dueHasTime, now)}${overdue}`,
    `Reminder: ${REPEAT_LABEL[t.repeat] ?? REPEAT_LABEL.none}`,
  ];
  if (t.dateRequest) lines.push(`⏳ Date request: ${formatDue(t.dateRequest.dueAt, t.dateRequest.hasTime, now)} (approval pending)`);
  lines.push(`Status: ${STATUS_LABEL[t.status] ?? STATUS_LABEL.pending}`);
  const last = t.remarks[t.remarks.length - 1];
  if (last) lines.push(`Last remark: ${last.text} (${formatDateTime(last.at, now)})`);
  return lines.join("\n");
}

function detailMessage(ctx: BotContext, t: Task): Outgoing {
  return buttons(ctx.user.phone, detailBody(t, ctx.now), [
    { id: `${ID}:act:done`, title: "Done ✅" },
    { id: `${ID}:act:update`, title: "Update ✏️" },
    { id: `${ID}:act:date`, title: "Date badlo 🕒" },
  ]);
}

const STATUS_LABEL: Record<Task["status"], string> = { pending: "Pending", done: "Done ✅", cancelled: "Cancelled ❌" };

/** Loads the task and checks the actor may touch it; returns a reply on failure. */
async function loadOwned(ctx: BotContext, taskId: string | undefined): Promise<Task | Outgoing[]> {
  const t = taskId ? await ctx.store.getTask(taskId) : null;
  if (!t) return finish(ctx, MSG.notFound);
  if (!canAct(ctx.user, t)) return finish(ctx, MSG.notYours);
  return t;
}

/** Like loadOwned, but done or cancelled tasks can't be changed any more. */
async function loadOpen(ctx: BotContext, taskId: string | undefined): Promise<Task | Outgoing[]> {
  const t = await loadOwned(ctx, taskId);
  if (Array.isArray(t)) return t;
  if (t.status === "done") return finish(ctx, `*${t.title}* pehle hi done ho chuka hai ✅`);
  if (t.status === "cancelled") return finish(ctx, `*${t.title}* cancel ho chuka hai ❌`);
  return t;
}

async function openDetail(ctx: BotContext, data: Data, taskId: string): Promise<Outgoing[]> {
  const t = await loadOwned(ctx, taskId);
  if (Array.isArray(t)) return t;
  if (t.status !== "pending") {
    await setStep(ctx, ID, "list", viewData(data));
    return [say(ctx, detailBody(t, ctx.now))];
  }
  await setStep(ctx, ID, "detail", { ...viewData(data), taskId });
  return [detailMessage(ctx, t)];
}

async function onDetail(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const act = replyValue(input, ID, "act");
  if (act === "done") return markDone(ctx, data);
  if (act === "update") return goto(ctx, data, "ask_remark", say(ctx, MSG.askRemark));
  if (act === "date") return goto(ctx, data, "ask_due", dueDateButtons(ctx.user.phone, ID, MSG.askDue));
  // The task list is still on screen; let the user jump to another row.
  if (replyValue(input, ID, "task") !== null || replyValue(input, ID, "page") !== null) return onList(ctx, data, input);

  const t = await loadOpen(ctx, data.taskId);
  if (Array.isArray(t)) return t;
  return [say(ctx, MSG.useButtons), detailMessage(ctx, t)];
}

async function goto(ctx: BotContext, data: Data, step: string, prompt: Outgoing): Promise<Outgoing[]> {
  const t = await loadOpen(ctx, data.taskId);
  if (Array.isArray(t)) return t;
  await setStep(ctx, ID, step, data);
  return [prompt];
}

// ---------- done ----------

async function markDone(ctx: BotContext, data: Data): Promise<Outgoing[]> {
  const t = await loadOpen(ctx, data.taskId);
  if (Array.isArray(t)) return t;

  const at = ctx.now.toISOString();
  await ctx.store.updateTask(t.id, { status: "done", doneAt: at, updatedAt: at, nextReminderAt: null, dateRequest: null });
  await endFlow(ctx);
  let body = `✅ *${t.title}* done mark ho gaya. Shabash! 👏`;
  if (t.repeat === "monthly") {
    const next = await ctx.store.createTask(nextMonthlyTask(t, ctx.now));
    body += `\n🔁 Agla task: *${formatDue(next.dueAt, next.dueHasTime, ctx.now)}*`;
  }
  const out = [say(ctx, body)];
  if (t.createdByPhone !== ctx.user.phone) out.push(doneNotice(ctx, t));
  return out;
}

/** task_updated_v1 to the creator, unless the creator made the change. */
function updateNotice(ctx: BotContext, t: Task, update: string): Outgoing[] {
  if (t.createdByPhone === ctx.user.phone) return [];
  const actor = ctx.user.name;
  const body = clip(update, UPDATE_CLIP);
  return [
    {
      to: t.createdByPhone,
      kind: "template",
      template: "task_updated_v1",
      bodyValues: [t.createdByName, actor, t.title, body],
      fallbackText: `Namaste ${t.createdByName} ji,\n${actor} ne ek task par update diya hai.\n\nTask: ${t.title}\nUpdate: ${body}`,
    },
  ];
}

function doneNotice(ctx: BotContext, t: Task): Outgoing {
  const when = formatDateTime(ctx.now, ctx.now);
  const actor = ctx.user.name;
  return {
    to: t.createdByPhone,
    kind: "template",
    template: "task_done_v1",
    bodyValues: [t.createdByName, actor, t.title, when],
    fallbackText: `Namaste ${t.createdByName} ji,\n${actor} ne ek task complete kar diya hai ✅\n\nTask: ${t.title}\nComplete hua: ${when}`,
  };
}

// ---------- remarks ----------

/** Validates a typed remark; returns the text or a re-prompt. */
function readRemark(ctx: BotContext, input: Inbound, prompt: string): string | Outgoing[] {
  if (!isTyped(input)) return [say(ctx, `✍️ Remark type karke bhejiye.\n${prompt}`)];
  const remark = input.text.trim();
  if (remark.length > REMARK_MAX) return [say(ctx, `Remark ${REMARK_MAX} characters se chhota rakhiye.\n${prompt}`)];
  return remark;
}

function remarkOf(ctx: BotContext, body: string): Remark {
  return { at: ctx.now.toISOString(), byPhone: ctx.user.phone, byName: ctx.user.name, text: body };
}

async function onRemark(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const remark = readRemark(ctx, input, MSG.askRemark);
  if (typeof remark !== "string") return remark;
  const t = await loadOpen(ctx, data.taskId);
  if (Array.isArray(t)) return t;
  await ctx.store.updateTask(t.id, {
    remarks: [...t.remarks, remarkOf(ctx, remark)],
    nextReminderAt: afterResponse(t, ctx.now),
    updatedAt: ctx.now.toISOString(),
  });
  return [...(await finish(ctx, "📝 Remark save ho gaya.")), ...updateNotice(ctx, t, remark)];
}

// ---------- date change ----------

async function onAskDue(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const pick = replyValue(input, ID, "due");
  const today = istDay(ctx.now);
  if (pick === "today" || pick === "tomorrow") {
    const day = pick === "today" ? today : addDays(today, 1);
    await setStep(ctx, ID, "ask_time", { ...data, day: dayKey(day) });
    return [timeButtons(ctx.user.phone, ID, MSG.askTime)];
  }
  if (pick === "custom") {
    await setStep(ctx, ID, "ask_custom_due", data);
    return [say(ctx, MSG.askCustomDue)];
  }
  const parsed = isTyped(input) ? parseDue(input.text, ctx.now) : null;
  if (parsed) return applyNewDue(ctx, data, parsed);
  return [say(ctx, `Samajh nahi aaya 🤔 ${MSG.askCustomDue} ya button dabaiye.`), dueDateButtons(ctx.user.phone, ID, MSG.askDue)];
}

async function onAskTime(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const day = parseDayKey(data.day);
  if (!day) return oops(ctx);
  const timeText = isReply(input, ID, "time:skip") ? null : isTyped(input) ? input.text : undefined;
  const parsed = timeText === undefined ? null : dueOnDay(day, timeText);
  if (!parsed) return [say(ctx, "Time samajh nahi aaya. Jaise *4pm* ya *11:30 am* likhiye."), timeButtons(ctx.user.phone, ID, MSG.askTime)];
  return applyNewDue(ctx, data, parsed);
}

async function onCustomDue(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const parsed = isTyped(input) ? parseDue(input.text, ctx.now) : null;
  if (!parsed) return [say(ctx, `Date samajh nahi aayi 🤔 ${MSG.askCustomDue}`)];
  return applyNewDue(ctx, data, parsed);
}

async function applyNewDue(ctx: BotContext, data: Data, due: ParsedDue): Promise<Outgoing[]> {
  const t = await loadOpen(ctx, data.taskId);
  if (Array.isArray(t)) return t;
  if (due.dueAt.getTime() <= ctx.now.getTime()) {
    await setStep(ctx, ID, "ask_due", data);
    return [say(ctx, "⏰ Ye time nikal chuka hai. Aage ki date/time chuniye."), dueDateButtons(ctx.user.phone, ID, MSG.askDue)];
  }
  const rest = { ...data };
  delete rest.day;
  await setStep(ctx, ID, "ask_date_remark", { ...rest, newDue: due.dueAt.toISOString(), newHasTime: String(due.hasTime) });
  return [say(ctx, needsApproval(ctx, due.dueAt) ? MSG.askApprovalRemark : MSG.askDateRemark)];
}

function needsApproval(ctx: BotContext, dueAt: Date | string): boolean {
  return ctx.user.role === "staff" && isBeyondDays(dueAt, ctx.now, MAX_STAFF_DAYS);
}

async function onDateRemark(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const remark = readRemark(ctx, input, MSG.askDateRemark);
  if (typeof remark !== "string") return remark;
  if (!data.newDue || Number.isNaN(Date.parse(data.newDue))) return oops(ctx);
  const t = await loadOpen(ctx, data.taskId);
  if (Array.isArray(t)) return t;

  const hasTime = data.newHasTime === "true";
  if (needsApproval(ctx, data.newDue)) return requestApproval(ctx, t, { dueAt: data.newDue, hasTime, remark });
  const oldText = formatDue(t.dueAt, t.dueHasTime, ctx.now);
  const newText = formatDue(data.newDue, hasTime, ctx.now);
  const update = `Date badli: ${oldText} → ${newText}. ${remark}`;
  await ctx.store.updateTask(t.id, {
    dueAt: data.newDue,
    dueHasTime: hasTime,
    nextReminderAt: data.newDue,
    remarks: [...t.remarks, remarkOf(ctx, update)],
    dateRequest: null,
    updatedAt: ctx.now.toISOString(),
  });
  return [...(await finish(ctx, `🕒 Date badal di: *${newText}*`)), ...updateNotice(ctx, t, update)];
}

// ---------- approval request (staff, beyond 25 days) ----------

async function requestApproval(
  ctx: BotContext,
  t: Task,
  req: Pick<DateRequest, "dueAt" | "hasTime" | "remark">,
): Promise<Outgoing[]> {
  const request: DateRequest = { ...req, byPhone: ctx.user.phone, byName: ctx.user.name, requestedAt: ctx.now.toISOString() };
  await ctx.store.updateTask(t.id, { dateRequest: request, updatedAt: ctx.now.toISOString() });
  const old = formatDue(t.dueAt, t.dueHasTime, ctx.now);
  const replaced = t.dateRequest ? "\n(Pehle wali pending request hata ke ye nayi request bhej di.)" : "";
  const reply = `📨 Request admin ko bhej di. Approve hone tak purani date (*${old}*) rahegi.${replaced}`;
  const approvers = await approversFor(ctx, t);
  return [...(await finish(ctx, reply)), ...approvers.map((a) => approvalNotice(ctx, t, request, a))];
}

/** The creator if they are an active admin, else every active admin; never the requester. */
async function approversFor(ctx: BotContext, t: Task): Promise<User[]> {
  const creator = await ctx.store.getUser(t.createdByPhone);
  const pool = creator?.active && creator.role === "admin" ? [creator] : await ctx.store.listUsers({ role: "admin" });
  return pool.filter((u) => u.phone !== ctx.user.phone);
}

function approvalNotice(ctx: BotContext, t: Task, req: DateRequest, admin: User): Outgoing {
  const current = formatDue(t.dueAt, t.dueHasTime, ctx.now);
  const wanted = formatDue(req.dueAt, req.hasTime, ctx.now);
  return {
    to: admin.phone,
    kind: "template",
    template: "date_approval_request_v1",
    bodyValues: [admin.name, req.byName, t.title, current, wanted],
    fallbackText:
      `Namaste ${admin.name} ji,\n${req.byName} ek task ki due date ${MAX_STAFF_DAYS} din se zyada aage karna chahte hain.\n\n` +
      `Task: ${t.title}\nAbhi ki date: ${current}\nMaangi gayi date: ${wanted}\nRemark: ${req.remark}\n\n` +
      `Approve/Reject ke liye *Hi* bhejiye → Approvals.`,
  };
}
