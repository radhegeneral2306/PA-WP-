// "Voice se update" (Round 4, docs/ROUND4-CONTRACT.md): an admin's voice note about an EXISTING task.
// Four actions only (done, remark, change due, reassign), always confirmed, and applied only through the
// shared actions in taskActions.ts (same rules and notifications as the menu and the dashboard). This
// flow never writes to the store itself. Everything is re-checked at the moment of "Haan".

import { BRANCHES, branchName, type BranchId, type Task, type User } from "../../domain/types";
import { formatDue, parseDue } from "../../domain/dates";
import type { VoiceDraft, VoicePerson } from "../../voice/types";
import { addRemark, changeDue, markDone, reassign, REMARK_MAX, type ActionResult, type Actor } from "../taskActions";
import { endFlow, firstTap, replyValue, setStep, withNonce, type BotContext, type Flow, type Inbound } from "../flow";
import type { Outgoing } from "../outgoing";
import { branchList, buttons, clip, list, quickDue, quickDueList, taskRowTitle, text, userList } from "../ui";
import { matchTasks, shortlist } from "../voiceMatch";
import { callVoice, dueOf, failureReply, fromTyped, labelOf, matches, norm, same, validDate, validTime, VOICE_MSG } from "./voiceTask";

const ID = "voice_update";
const ADMINS = "ADMINS";
const BODY_MAX = 1000;
const TRANSCRIPT_KEEP = 450;
const MAX_TASKS = 8;
const MAX_WORDS = 6;

export const UPDATE_MSG = {
  start: "Task update ke liye voice note bhejiye (1 minute ke andar).",
  which: "Kaunsa task?",
  noExact: "Koi exact match nahi mila, inme se chuniye 👇",
  noTask: "Koi task nahi mila 😕 Task ka naam ya kiska hai, saaf bolkar dobara bhejiye.",
  action: "Is task pe kya karna hai?",
  askRemark: "Remark likh ke bhejiye 📝",
  remarkLong: `Remark ${REMARK_MAX} akshar se chhota rakhiye.`,
  askDue: "Nayi date / time kya rakhni hai?",
  customDue: "Date likhiye, jaise *28/10*, *28/10 4pm* ya *kal 11am*",
  whomNew: "Ye task kisko dena hai?",
  tapHint: "Neeche diye option mein se chuniye 👇",
  confirmHint: "Haan ya Rehne do dabaiye 👇",
  noPending: "Ye task ab pending nahi hai.",
  gone: "Ye task ab nahi mila (delete ho gaya).",
  cancelled: "Theek hai, kuch nahi badla.",
  broken: "Kuch gadbad hui, voice note dobara bhejiye ya *Hi* bhejiye.",
  notYours: "Ye task aapka nahi hai.",
  staffLimit: "Aap yahan sirf Done ya remark kar sakte hain. Baaki ke liye *Hi* bhejiye aur menu use kijiye.",
  noOwn: "Aapke koi pending task nahi hain.",
};

/** Session data `src` for a message typed in chat (Round 5): "Aapne likha" instead of "Maine suna", staff allowed. */
export const TYPED = "typed";
const isStaffAction = (a: unknown): boolean => a === "done" || a === "remark";
/** Same rule as the `tasks` flow: an admin, or the assignee / creator. */
const mayAct = (u: User, t: Task): boolean => u.role === "admin" || t.assigneePhone === u.phone || t.createdByPhone === u.phone;

type Action = "done" | "remark" | "due" | "reassign";
const ACTIONS: readonly Action[] = ["done", "remark", "due", "reassign"];
const isAction = (s: unknown): s is Action => typeof s === "string" && (ACTIONS as readonly string[]).includes(s);

/**
 * Session data (strings only): t transcript · mode "free"|"ctx" · taskId · ow assignee phone when the confirm
 * was shown · action · remark · date "YYYY-MM-DD" / time "HH:MM" or "" · words (task words, "|") · owner phone
 * (whose task, free mode) · heard (spoken owner) · cands (task ids or person phones, comma) · for "owner"|"new"
 * · newPhone/newName · nheard (spoken new person) · ntried · branch · nonce.
 */
type Data = Record<string, string>;

// ---------- entry ----------

function baseData(draft: VoiceDraft, mode: "free" | "ctx"): Data {
  const transcript = (draft.transcript ?? "").replace(/\s+/g, " ").trim();
  const remark = typeof draft.remark === "string" ? draft.remark.replace(/\s+/g, " ").trim() : "";
  const words = (Array.isArray(draft.taskWords) ? draft.taskWords : [])
    .filter((w): w is string => typeof w === "string")
    .map((w) => w.trim().toLowerCase().replace(/\|/g, " "))
    .filter(Boolean)
    .slice(0, MAX_WORDS);
  const d: Data = { t: clip(transcript, TRANSCRIPT_KEEP), mode };
  if (isAction(draft.action)) d.action = draft.action;
  if (remark && remark.length <= REMARK_MAX) d.remark = remark;
  if (validDate(draft.date)) {
    d.date = draft.date!;
    d.time = validTime(draft.time) ? draft.time! : "";
  }
  if (words.length) d.words = words.join("|");
  return d;
}

async function withNewPerson(draft: VoiceDraft, data: Data, active: User[]): Promise<Data> {
  if (data.action !== "reassign") return data;
  const picked = draft.newPerson ? active.filter((u) => same(u.name, draft.newPerson!)) : [];
  if (picked.length === 1) return { ...data, newPhone: picked[0].phone, newName: picked[0].name };
  const heard = (draft.newPersonHeard ?? draft.newPerson ?? "").trim();
  return heard ? { ...data, nheard: clip(heard, 40) } : data;
}

/** Free mode: the voice note named a task (words + maybe a person) and an action. Called by voiceTask.handleVoice. */
export async function startUpdateFromDraft(
  ctx: BotContext,
  draft: VoiceDraft,
  active: User[],
  opts: { typed?: boolean } = {},
): Promise<Outgoing[]> {
  // Round 5: the same flow also confirms updates that were typed (src "typed"). Staff only get their own tasks.
  const base = opts.typed ? { ...baseData(draft, "free"), src: TYPED } : baseData(draft, "free");
  if (opts.typed && ctx.user.role !== "admin") {
    return isStaffAction(base.action) ? search(ctx, base) : finish(ctx, UPDATE_MSG.staffLimit);
  }
  let data = await withNewPerson(draft, base, active);

  const picked = draft.person ? active.filter((u) => same(u.name, draft.person!)) : [];
  if (picked.length === 1) return search(ctx, { ...data, owner: picked[0].phone });
  const heard = (draft.personHeard ?? draft.person ?? "").trim();
  if (!heard) return search(ctx, data);
  data = { ...data, heard: clip(heard, 40) };

  const found = await resolvePerson(ctx, heard, active);
  if (found.kind === "one") return search(ctx, { ...data, owner: found.user.phone });
  return askPerson(ctx, data, "owner", found.users, found.msg);
}

/** Context mode (router): a voice note while a task's detail is open. The open session stays untouched until it is understood. */
export async function handleVoiceInContext(ctx: BotContext, mediaUrl: string, taskId: string): Promise<Outgoing[]> {
  const t = await ctx.store.getTask(taskId);
  if (!t || t.status === "deleted") return finish(ctx, UPDATE_MSG.gone);
  if (t.status !== "pending") return finish(ctx, `*${t.title}* ab pending nahi hai.`);

  const active = (await ctx.store.listUsers()).filter((u) => u.active);
  const people: VoicePerson[] = active.map((u) => ({ name: u.name, label: labelOf(u) }));
  const result = await callVoice(ctx, mediaUrl, { now: ctx.now, people, task: { title: t.title, assignee: t.assigneeName } });
  if (!result.ok) return failureReply(ctx, result);

  const data = await withNewPerson(result.draft, { ...baseData(result.draft, "ctx"), taskId: t.id }, active);
  return next(ctx, data);
}

// ---------- flow ----------

export const voiceUpdateFlow: Flow = {
  id: ID,

  async start(ctx) {
    await endFlow(ctx);
    return [text(ctx.user.phone, UPDATE_MSG.start)];
  },

  async handle(ctx, session, input) {
    // Staff only get here through a typed chat message (done / remark on their own tasks).
    if (ctx.user.role !== "admin" && session.data.src !== TYPED) return broken(ctx);
    const data = session.data;
    switch (session.step) {
      case "pick_person":
        return pickPerson(ctx, data, input);
      case "pick_branch":
        return pickBranch(ctx, data, input);
      case "pick_user":
        return pickUser(ctx, data, input);
      case "pick_task":
        return pickTask(ctx, data, input);
      case "pick_action":
        return pickAction(ctx, data, input);
      case "ask_remark":
        return answerRemark(ctx, data, input);
      case "ask_due":
        return answerDue(ctx, data, input);
      case "ask_custom_date":
        return answerCustomDate(ctx, data, input);
      case "confirm":
        return answerConfirm(ctx, data, input);
      default:
        return broken(ctx);
    }
  },
};

async function broken(ctx: BotContext): Promise<Outgoing[]> {
  await endFlow(ctx);
  return [text(ctx.user.phone, UPDATE_MSG.broken)];
}

async function finish(ctx: BotContext, body: string): Promise<Outgoing[]> {
  await endFlow(ctx);
  return [text(ctx.user.phone, body)];
}

function withHint(hint: string | undefined, body: string): string {
  return hint ? `${hint}\n\n${body}` : body;
}

/** The task as it is now, or a plain message (and the flow ends) when it can't be changed any more. */
async function loadPending(ctx: BotContext, taskId: string | undefined): Promise<Task | Outgoing[]> {
  const t = taskId ? await ctx.store.getTask(taskId) : null;
  if (!t || t.status === "deleted") return finish(ctx, UPDATE_MSG.gone);
  if (t.status === "done") return finish(ctx, `*${t.title}* pehle hi done ho chuka hai ✅`);
  if (t.status === "cancelled") return finish(ctx, `*${t.title}* cancel ho chuka hai ❌`);
  if (!mayAct(ctx.user, t)) return finish(ctx, UPDATE_MSG.notYours);
  return t;
}

// ---------- finding the task (free mode) ----------

function dueLine(ctx: BotContext, t: Task): string {
  return `${t.assigneeName} · Due ${formatDue(t.dueAt, t.dueHasTime, ctx.now)}`;
}

/** Staff: only their own pending tasks (assigned to them or created by them). */
async function ownPending(ctx: BotContext): Promise<Task[]> {
  const phone = ctx.user.phone;
  const [mine, made] = await Promise.all([
    ctx.store.listTasks({ assigneePhone: phone, status: "pending" }),
    ctx.store.listTasks({ createdByPhone: phone, status: "pending" }),
  ]);
  const byId = new Map<string, Task>();
  for (const t of [...mine, ...made]) if (t.status === "pending" && mayAct(ctx.user, t)) byId.set(t.id, t);
  return [...byId.values()];
}

async function search(ctx: BotContext, data: Data): Promise<Outgoing[]> {
  const staff = ctx.user.role !== "admin";
  const owner = staff ? undefined : data.owner;
  const cands = staff
    ? await ownPending(ctx)
    : (await ctx.store.listTasks(owner ? { assigneePhone: owner, status: "pending" } : { status: "pending" })).filter((t) => t.status === "pending");
  const words = (data.words ?? "").split("|").filter(Boolean);
  const found = matchTasks(cands, words, { limit: MAX_TASKS }).map((m) => m.task);
  if (found.length > 0) return showTasks(ctx, data, found, UPDATE_MSG.which);
  if (staff) {
    const some = shortlist(cands, MAX_TASKS);
    return some.length > 0 ? showTasks(ctx, data, some, UPDATE_MSG.noExact) : finish(ctx, UPDATE_MSG.noOwn);
  }
  if (owner) {
    const some = shortlist(cands, MAX_TASKS);
    if (some.length > 0) return showTasks(ctx, data, some, UPDATE_MSG.noExact);
    const who = (await ctx.store.getUser(owner))?.name ?? "Is person";
    return finish(ctx, `${who} ke paas koi pending task nahi hai.`);
  }
  return finish(ctx, UPDATE_MSG.noTask);
}

async function showTasks(ctx: BotContext, data: Data, tasks: Task[], body: string): Promise<Outgoing[]> {
  const shown = tasks.slice(0, MAX_TASKS);
  await setStep(ctx, ID, "pick_task", { ...data, cands: shown.map((t) => t.id).join(",") });
  const rows = shown.map((t) => ({ id: `${ID}:task:${t.id}`, title: taskRowTitle(t), description: clip(dueLine(ctx, t), 72) }));
  return [list(ctx.user.phone, body, "Task chuno", rows, "Tasks")];
}

async function pickTask(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const ids = (data.cands ?? "").split(",").filter(Boolean);
  const id = replyValue(input, ID, "task");
  if (id && ids.includes(id)) {
    const t = await loadPending(ctx, id);
    if (Array.isArray(t)) return t;
    const { cands: _c, ...rest } = data;
    return next(ctx, { ...rest, taskId: t.id });
  }
  const tasks: Task[] = [];
  for (const tid of ids) {
    const t = await ctx.store.getTask(tid);
    if (t?.status === "pending") tasks.push(t);
  }
  if (tasks.length === 0) return finish(ctx, UPDATE_MSG.noTask);
  const shown = tasks.slice(0, MAX_TASKS);
  const rows = shown.map((t) => ({ id: `${ID}:task:${t.id}`, title: taskRowTitle(t), description: clip(dueLine(ctx, t), 72) }));
  return [list(ctx.user.phone, withHint(UPDATE_MSG.tapHint, UPDATE_MSG.which), "Task chuno", rows, "Tasks")];
}

// ---------- people ----------

type Found = { kind: "one"; user: User } | { kind: "many" | "unknown"; users: User[]; msg: string };

async function resolvePerson(ctx: BotContext, heard: string, active: User[]): Promise<Found> {
  const scored = matches(heard, active);
  const exact = scored.filter((m) => m.score >= 3);
  if (exact.length === 1) return { kind: "one", user: exact[0].user };
  if (exact.length > 1) return { kind: "many", users: exact.map((m) => m.user), msg: VOICE_MSG.twoPeople };
  const all = await ctx.store.listUsers({ activeOnly: false });
  const gone = all.find((u) => !u.active && same(u.name, heard));
  const msg = gone ? `${gone.name} ab active nahi hai. Kisko dena hai?` : VOICE_MSG.notFound;
  return { kind: "unknown", users: scored.map((m) => m.user), msg };
}

const bodyFor = (who: "owner" | "new", msg: string): string => (who === "owner" ? msg.replace("Kisko dena hai?", "Kiska task hai?") : msg);

/** Short candidate list (+ "Doosra naam"), or the branch picker when there are none. */
async function askPerson(ctx: BotContext, data: Data, who: "owner" | "new", cands: User[], msg: string): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const { cands: _c, branch: _b, ...rest } = data;
  const body = bodyFor(who, msg);
  if (cands.length === 0) {
    await setStep(ctx, ID, "pick_branch", { ...rest, for: who });
    return [branchList(to, ID, body, { includeAdmins: true })];
  }
  const shown = cands.slice(0, 9);
  await setStep(ctx, ID, "pick_person", { ...rest, for: who, cands: shown.map((u) => u.phone).join(",") });
  const rows = shown.map((u) => ({ id: `${ID}:user:${u.phone}`, title: clip(u.name, 24), description: labelOf(u) }));
  rows.push({ id: `${ID}:other`, title: "Doosra naam", description: "Branch se naam chuniye" });
  return [list(to, body, "Naam chuno", rows, "Staff")];
}

async function pickedUser(ctx: BotContext, input: Inbound): Promise<User | null | undefined> {
  const phone = replyValue(input, ID, "user");
  if (!phone) return undefined;
  const u = await ctx.store.getUser(phone);
  return u?.active ? u : null;
}

function forWho(data: Data): "owner" | "new" {
  return data.for === "new" ? "new" : "owner";
}

const whomBody = (who: "owner" | "new") => (who === "owner" ? "Kiska task hai?" : UPDATE_MSG.whomNew);

/** A person was chosen: the owner starts the task search, the new assignee goes on to the confirm. */
async function personChosen(ctx: BotContext, data: Data, u: User): Promise<Outgoing[]> {
  const { cands: _c, branch: _b, for: who, ...rest } = data;
  if (who === "new") return next(ctx, { ...rest, newPhone: u.phone, newName: u.name, ntried: "1" });
  return search(ctx, { ...rest, owner: u.phone });
}

async function pickPerson(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const who = forWho(data);
  if (input.reply?.id === `${ID}:other`) return askPerson(ctx, data, who, [], whomBody(who));
  const u = await pickedUser(ctx, input);
  if (u) return personChosen(ctx, data, u);
  const cands: User[] = [];
  for (const p of (data.cands ?? "").split(",").filter(Boolean)) {
    const c = await ctx.store.getUser(p);
    if (c?.active) cands.push(c);
  }
  const hint = u === null ? "Ye naam ab list mein nahi hai." : UPDATE_MSG.tapHint;
  return askPerson(ctx, data, who, cands, withHint(hint, whomBody(who)));
}

async function usersFor(ctx: BotContext, key: string): Promise<User[] | null> {
  if (key === ADMINS) return ctx.store.listUsers({ role: "admin" });
  if (!BRANCHES.some((b) => b.id === key)) return null;
  return ctx.store.listUsers({ branch: key as BranchId, role: "staff" });
}

const groupLabel = (key: string): string => (key === ADMINS ? "Admins" : branchName(key as BranchId));
const userPrompt = (key: string, who: "owner" | "new"): string =>
  who === "owner" ? `*${groupLabel(key)}* mein kiska task hai?` : `*${groupLabel(key)}* mein kisko dena hai?`;

async function pickBranch(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const who = forWho(data);
  const key = replyValue(input, ID, "branch");
  const users = key ? await usersFor(ctx, key) : null;
  if (!key || !users) return [branchList(to, ID, withHint(UPDATE_MSG.tapHint, whomBody(who)), { includeAdmins: true })];
  if (users.length === 0) return [branchList(to, ID, `*${groupLabel(key)}* mein abhi koi nahi hai. Dusri branch chuniye.`, { includeAdmins: true })];
  await setStep(ctx, ID, "pick_user", { ...data, branch: key });
  return [userList(to, ID, users, userPrompt(key, who))];
}

async function pickUser(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const who = forWho(data);
  const key = data.branch;
  const users = key ? await usersFor(ctx, key) : null;
  if (!key || !users) return broken(ctx);
  const page = replyValue(input, ID, "page");
  if (page !== null) return [userList(to, ID, users, userPrompt(key, who), { page: Number(page) || 0 })];
  const u = await pickedUser(ctx, input);
  if (!u) {
    const hint = u === null ? "Ye naam ab list mein nahi hai." : UPDATE_MSG.tapHint;
    return [userList(to, ID, users, withHint(hint, userPrompt(key, who)))];
  }
  return personChosen(ctx, data, u);
}

// ---------- missing parts ----------

/** Asks for the first missing part, else shows the confirmation. */
async function next(ctx: BotContext, data: Data, hint?: string): Promise<Outgoing[]> {
  const t = await loadPending(ctx, data.taskId);
  if (Array.isArray(t)) return t;
  const action = data.action;
  if (!isAction(action)) return askAction(ctx, data, hint);

  if (action === "remark" && !data.remark) return askRemark(ctx, data, hint);

  if (action === "due") {
    const due = dueOf(data);
    if (!due) return askDue(ctx, clearDue(data), hint);
    if (due.dueAt.getTime() < ctx.now.getTime()) return askDue(ctx, clearDue(data), withHint(hint, `⏰ ${VOICE_MSG.datePast}`));
  }

  if (action === "reassign") {
    const to = data.newPhone ? await ctx.store.getUser(data.newPhone) : null;
    if (!data.newPhone) return askNewPerson(ctx, data, hint);
    if (!to?.active) return askNewPerson(ctx, clearNew(data), `${data.newName ?? "Ye person"} ab active nahi hai.`);
    if (to.phone === t.assigneePhone) return finish(ctx, `*${t.title}* pehle se *${t.assigneeName}* ke naam pe hai.`);
  }
  return showConfirm(ctx, data, t, hint);
}

function clearDue(data: Data): Data {
  const { date: _d, time: _t, ...rest } = data;
  return rest;
}

function clearNew(data: Data): Data {
  const { newPhone: _p, newName: _n, ...rest } = data;
  return { ...rest, ntried: "1" };
}

async function askAction(ctx: BotContext, data: Data, hint?: string): Promise<Outgoing[]> {
  await setStep(ctx, ID, "pick_action", data);
  const all = [
    { id: `${ID}:action:done`, title: "Done ✅", description: "Task complete ho gaya" },
    { id: `${ID}:action:remark`, title: "Remark likho 📝", description: "Task mein update likhna hai" },
    { id: `${ID}:action:due`, title: "Date badlo 🕒", description: "Nayi due date / time" },
    { id: `${ID}:action:reassign`, title: "Kisi aur ko do 👤", description: "Task dusre ko dena hai" },
  ];
  const rows = ctx.user.role === "admin" ? all : all.slice(0, 2);
  return [list(ctx.user.phone, withHint(hint, UPDATE_MSG.action), "Chuniye", rows, "Kya karna hai")];
}

async function pickAction(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const action = replyValue(input, ID, "action");
  if (!isAction(action) || (ctx.user.role !== "admin" && !isStaffAction(action))) return askAction(ctx, data, UPDATE_MSG.tapHint);
  return next(ctx, { ...data, action });
}

async function askRemark(ctx: BotContext, data: Data, hint?: string): Promise<Outgoing[]> {
  await setStep(ctx, ID, "ask_remark", data);
  return [text(ctx.user.phone, withHint(hint, UPDATE_MSG.askRemark))];
}

async function answerRemark(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const remark = input.reply ? "" : input.text.replace(/\s+/g, " ").trim();
  if (!remark) return [text(ctx.user.phone, withHint("Remark likh ke bhejiye.", UPDATE_MSG.askRemark))];
  if (remark.length > REMARK_MAX) return [text(ctx.user.phone, UPDATE_MSG.remarkLong)];
  return next(ctx, { ...data, remark });
}

async function askDue(ctx: BotContext, data: Data, hint?: string): Promise<Outgoing[]> {
  await setStep(ctx, ID, "ask_due", data);
  return [quickDueList(ctx.user.phone, ID, withHint(hint, UPDATE_MSG.askDue), ctx.now)];
}

/** A picked / typed due goes into the session data (a day without a time means 10 AM). */
function withDue(data: Data, due: NonNullable<ReturnType<typeof parseDue>>): Data {
  return fromTyped(due, { ...data, time: "" });
}

async function answerDue(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const quick = replyValue(input, ID, "quick");
  if (quick === "custom") {
    await setStep(ctx, ID, "ask_custom_date", data);
    return [text(ctx.user.phone, UPDATE_MSG.customDue)];
  }
  if (quick !== null) {
    const due = quickDue(quick, ctx.now);
    if (due) return next(ctx, withDue(data, due));
    return askDue(ctx, data, "⏰ Ye time nikal chuka hai. Aage ki date/time chuniye.");
  }
  const typed = input.reply ? null : parseDue(input.text, ctx.now);
  if (typed) return next(ctx, withDue(data, typed));
  return askDue(ctx, data, "Samajh nahi aaya 🤔");
}

async function answerCustomDate(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const typed = input.reply ? null : parseDue(input.text, ctx.now);
  if (!typed) return [text(ctx.user.phone, withHint("Date samajh nahi aayi 🤔", UPDATE_MSG.customDue))];
  return next(ctx, withDue(data, typed));
}

async function askNewPerson(ctx: BotContext, data: Data, hint?: string): Promise<Outgoing[]> {
  const heard = data.nheard;
  if (heard && data.ntried !== "1") {
    const active = (await ctx.store.listUsers()).filter((u) => u.active);
    const found = await resolvePerson(ctx, heard, active);
    const tried = { ...data, ntried: "1" };
    if (found.kind === "one") return next(ctx, { ...tried, newPhone: found.user.phone, newName: found.user.name });
    return askPerson(ctx, tried, "new", found.users, found.msg);
  }
  return askPerson(ctx, { ...data, ntried: "1" }, "new", [], withHint(hint, UPDATE_MSG.whomNew));
}

// ---------- confirm ----------

function confirmLines(ctx: BotContext, data: Data, t: Task): string[] {
  const oldDue = formatDue(t.dueAt, t.dueHasTime, ctx.now);
  switch (data.action) {
    case "done":
      return ["✅ DONE karna hai:", `Task: ${t.title}`, `Kisko: ${t.assigneeName}`, `Due: ${oldDue}`];
    case "remark":
      return ["📝 REMARK likhna hai:", `Task: ${t.title}`, `Remark: "${data.remark}"`];
    case "due": {
      const due = dueOf(data);
      const newDue = due ? formatDue(due.dueAt, due.hasTime, ctx.now) : "—";
      return ["🕒 DATE BADALNI hai:", `Task: ${t.title}`, `Date: ${oldDue} → ${newDue}`];
    }
    default:
      return ["👤 DUSRE KO DENA hai:", `Task: ${t.title}`, `Kisko: ${t.assigneeName} → ${data.newName}`];
  }
}

function confirmBody(ctx: BotContext, data: Data, t: Task, hint?: string): string {
  const task = [...confirmLines(ctx, data, t), "", "Sahi hai?"].join("\n");
  const heard = data.src === TYPED ? "Aapne likha" : "Maine suna";
  const fixed = withHint(hint, `${heard}: ""\n\n${task}`);
  const room = Math.max(40, BODY_MAX - fixed.length);
  return withHint(hint, `${heard}: "${clip(data.t || "—", room)}"\n\n${task}`);
}

async function showConfirm(ctx: BotContext, data: Data, t: Task, hint?: string): Promise<Outgoing[]> {
  const saved = withNonce({ ...data, ow: t.assigneePhone });
  await setStep(ctx, ID, "confirm", saved);
  // Never title a button "Cancel" / "Stop" (an Interakt automation answers those words with a goodbye).
  return [
    buttons(ctx.user.phone, confirmBody(ctx, saved, t, hint), [
      { id: `${ID}:confirm:yes`, title: "Haan ✅" },
      { id: `${ID}:confirm:no`, title: "Rehne do ❌" },
    ]),
  ];
}

const TYPED_YES = new Set(["haan", "han", "ha", "haa", "yes", "ok", "theek", "theek hai"]);
const TYPED_NO = new Set(["nahi", "na", "no", "rehne do"]);

async function answerConfirm(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const typed = input.reply ? "" : norm(input.text);
  let answer = replyValue(input, ID, "confirm");
  if (!answer && TYPED_YES.has(typed)) answer = "yes";
  if (!answer && TYPED_NO.has(typed)) answer = "no";
  if (answer === "no") return finish(ctx, UPDATE_MSG.cancelled);
  if (answer !== "yes") {
    const t = await loadPending(ctx, data.taskId);
    if (Array.isArray(t)) return t;
    return showConfirm(ctx, data, t, UPDATE_MSG.confirmHint);
  }
  return apply(ctx, data);
}

async function apply(ctx: BotContext, data: Data): Promise<Outgoing[]> {
  const { user, now, store } = ctx;
  const t = await loadPending(ctx, data.taskId);
  if (Array.isArray(t)) return t;
  const action = data.action;
  if (!isAction(action)) return broken(ctx);
  if (ctx.user.role !== "admin" && !isStaffAction(action)) return finish(ctx, UPDATE_MSG.staffLimit);
  // Someone gave the task to another person since the admin looked at it: don't act on a stale screen.
  if (data.ow && t.assigneePhone !== data.ow) {
    return finish(ctx, `*${t.title}* ab *${t.assigneeName}* ke paas hai (assign badal gaya). Dobara voice note bhejiye.`);
  }

  let due = null as ReturnType<typeof dueOf>;
  let to: User | null = null;
  if (action === "due") {
    due = dueOf(data);
    if (!due || due.dueAt.getTime() < now.getTime()) return next(ctx, clearDue(data), `⏰ ${VOICE_MSG.datePast}`);
  }
  if (action === "reassign") {
    to = data.newPhone ? await store.getUser(data.newPhone) : null;
    if (!to?.active) return askNewPerson(ctx, clearNew(data), `${data.newName ?? "Ye person"} ab active nahi hai.`);
    if (to.phone === t.assigneePhone) return finish(ctx, `*${t.title}* pehle se *${t.assigneeName}* ke naam pe hai.`);
  }

  // A second tap on the same "Haan" (or a duplicate delivery) must act only once.
  if (!(await firstTap(ctx, ID, data))) return [];

  const actor: Actor = { phone: user.phone, name: user.name, viaVoice: data.src !== TYPED };
  let result: ActionResult;
  switch (action) {
    case "done":
      result = await markDone(store, t, actor, now);
      break;
    case "remark":
      result = await addRemark(store, t, actor, data.remark ?? "", now);
      break;
    case "due":
      result = await changeDue(store, t, actor, due!, null, now, { notifyAssignee: true });
      break;
    default:
      result = await reassign(store, t, actor, to!, now);
  }
  await endFlow(ctx);
  if (!result.ok) return [text(user.phone, `${result.error}.`)];

  const done = result.task;
  const summary: Record<Action, string> = {
    done: `✅ Done ho gaya: *${done.title}*`,
    remark: `📝 Remark likh diya: *${done.title}*`,
    due: `🕒 Date badal di: *${done.title}*\n${formatDue(t.dueAt, t.dueHasTime, now)} → ${formatDue(done.dueAt, done.dueHasTime, now)}`,
    reassign: `👤 Task de diya: *${done.title}*\n${t.assigneeName} → ${done.assigneeName}`,
  };
  return [text(user.phone, summary[action]), ...result.outs];
}
