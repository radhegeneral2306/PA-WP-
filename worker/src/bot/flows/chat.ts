// Round 5 (docs/ROUND5-6-CONTRACT.md): typed free text that nothing else recognised. Courtesy words and
// the rule layer answer for free; the rest costs one AI call (daily limit per person). The AI result is
// only a suggestion: reads go through answerQuery (permissions in code), every change goes through the
// existing confirm flows (voice_update / voice_task / create_task) and the shared taskActions.

import { CHAT_MEMORY_MIN, type ChatContext, type ChatFilter, type ChatMemory, type ChatMemorySummary, type ChatPerson, type ChatRef, type ChatRequest, type ChatResult } from "../../chat/types";
import { ruleFollowup, ruleRequest } from "../../chat/rules";
import { answerQuery, answerQueryDetailed } from "../../chat/answer";
import { refineFilter, resolveRef } from "../../chat/refs";
import { canSeeTask, describeTask } from "../../chat/taskInfo";
import { formatDue, istDay } from "../../domain/dates";
import type { Task, TaskRepeat, User } from "../../domain/types";
import { recordProblems, SUPER_ADMIN_NAME } from "../../scheduler/health";
import type { VoiceDraft } from "../../voice/types";
import { setStep, withNonce, type BotContext } from "../flow";
import type { Outgoing } from "../outgoing";
import { canUseChatMemory, mainMenu, normalizeWords } from "../router";
import { dueFromInput, TITLE_MAX } from "../taskActions";
import { buttons, clip, quickDueList, taskList, text, weekdayHi } from "../ui";
import { matchTasks } from "../voiceMatch";
import { tasksFlow } from "./tasks";
import { startUpdateFromDraft } from "./voiceUpdate";
import { dayKey, labelOf, startFromDraft } from "./voiceTask";

/** AI messages per person and IST day (rules answers and courtesies are free and not counted). */
export const CHAT_LIMIT = { staff: 20, admin: 50 } as const;

export const CHAT_MSG = {
  courtesy: "👍 Menu ke liye *Hi* bhejiye.",
  limit: "Aaj ki limit poori ho gayi, menu use kijiye",
  failed: "Abhi samajh nahi paaya, menu use kijiye",
  other: "Main sirf tasks mein madad kar sakta hoon 🙂",
  unclear:
    "Samajh nahi aaya 🤔 Aise likhiye:\n• *Mere pending tasks*\n• *Sharma ji wala task done kar do*\n• *Kal 5 baje GST file karna hai ka task banao*\n\nYa neeche se menu chuniye.",
  staffReassign: "Task kisi aur ko dene ka option sirf admin ke paas hai. Menu ke liye *Hi* bhejiye.",
  staffOthers: "Aap sirf apne liye task bana sakte hain.",
  dateHint: "Date badalne ke liye Mere tasks → task → Date badlo 🕒 use kijiye.",
  dateOpen: "Date badalne ke liye *Date badlo 🕒* dabaiye 👇",
  pickForDate: "Kis task ki date badalni hai?",
  askTitle: "Task kya hai? Likh ke bhejiye 📝",
  noQuery: "Pehle bataiye kya dekhna hai, jaise *mere pending tasks*.",
  whichTask: "Kaunsa task? Pehle list dekhne ke liye *mere tasks* likhiye.",
  whichFragment: "Kaunsa task? Task ke naam ka ek hissa likhiye, jaise *Sharma ji*.",
  taskGone: "Ye task ab nahi mila. List dobara dekhne ke liye *mere tasks* likhiye.",
  reset: "Theek hai, naye sire se 🙂",
  askWhich: "Kaunsa wala? Number likhiye 👇",
};

const MEMORY_KINDS = new Set(["refine", "open", "more", "ask_task", "reset"]);
const CHOICES_MAX = 5;

/** What one message changes in the chat memory; applied to whatever is stored when saving. */
interface MemoryPatch {
  /** undefined = keep, null = forget. */
  query?: ChatFilter | null;
  shown?: string[];
  offset?: number;
  total?: number;
  sel?: string | null;
}

/** Memory state of one message: null when the switch is off (nothing is read or written then). */
interface Mem {
  /** The stored document as read (its version is what a save is checked against). */
  stored: ChatMemory | null;
  /** The stored memory when still fresh, with `sel` from the open task detail, else null. */
  fresh: ChatMemory | null;
  patch: MemoryPatch;
  cleared: boolean;
}

function isFresh(m: ChatMemory, now: Date): boolean {
  const age = now.getTime() - Date.parse(m.at);
  return Number.isFinite(age) && age < CHAT_MEMORY_MIN * 60_000;
}

const COURTESY = new Set([
  "ok", "okay", "okk", "k", "thanks", "thank you", "thankyou", "thx", "dhanyavad", "dhanyawad", "shukriya", "shukriya ji",
  "haan", "han", "ha", "haa", "theek hai", "thik hai", "theek", "thik", "accha", "acha", "achha", "ji", "ji haan", "hmm", "hm", "sahi hai", "badhiya",
]);

/** "ok", "thanks 🙏", "👍", one or two letters: a friendly line, no AI. */
export function isCourtesy(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  const words = normalizeWords(t);
  if (words === "") return true; // emoji / punctuation only
  const bare = words.endsWith(" ji") ? words.slice(0, -3) : words;
  return COURTESY.has(words) || COURTESY.has(bare) || Array.from(words.replace(/\s/g, "")).length <= 2;
}

function limitFor(user: User): number {
  return user.role === "admin" ? CHAT_LIMIT.admin : CHAT_LIMIT.staff;
}

/** Key of the daily AI counter: `ai:<phone>:<IST date>`. */
export function chatCountKey(phone: string, now: Date): string {
  return `ai:${phone}:${dayKey(istDay(now))}`;
}

function peopleFor(user: User, active: User[]): ChatPerson[] {
  if (user.role !== "admin") return [{ name: user.name, label: labelOf(user) }];
  return active.map((u) => ({ name: u.name, label: labelOf(u) }));
}

/** Menu with a short reason on top (the bot never goes silent). */
function withMenu(ctx: BotContext, intro: string): Outgoing[] {
  return [mainMenu(ctx, `${intro}\n\nKya karna hai? Neeche se chuniye.`)];
}

export async function handleChat(ctx: BotContext, raw: string, opts: { selectedTaskId?: string } = {}): Promise<Outgoing[]> {
  const { user, now } = ctx;
  const input = raw.replace(/\s+/g, " ").trim();
  if (!input) return [mainMenu(ctx)];

  // With the memory on, a bare number ("2") is an answer to a numbered list, not a courtesy.
  const memoryOn = canUseChatMemory(user);
  if (isCourtesy(input) && !(memoryOn && /^\d{1,2}$/.test(input))) return [text(user.phone, CHAT_MSG.courtesy)];

  // Admins: the active people (one read); staff only ever talk about themselves.
  const active = user.role === "admin" ? (await ctx.store.listUsers()).filter((u) => u.active) : [user];
  const people = peopleFor(user, active);
  const cctx: ChatContext = { now, role: user.role, self: user.name, people };

  // Round 7: the memory (one read). Only for people who have the switch; stale = forgotten but its version is kept.
  const mem = memoryOn ? await loadMemory(ctx, opts.selectedTaskId) : null;

  // Rules first: free, no AI call, not counted.
  const byFollowup = mem ? ruleFollowup(input, cctx, mem.fresh) : null;
  const byRule = byFollowup ?? ruleRequest(input, cctx);
  if (byRule) return finish(ctx, mem, await execute(ctx, byRule, input, active, mem));

  // Then the AI (one call). Limit is checked before the call; only messages that reach the AI count.
  if (!ctx.chat) return failureReply(ctx, { ok: false, reason: "not_configured" });
  const used = await ctx.store.bumpDailyCount(chatCountKey(user.phone, now), now);
  if (used > limitFor(user)) return withMenu(ctx, CHAT_MSG.limit);

  if (mem?.fresh) cctx.memory = await summaryOf(ctx, mem.fresh);
  let result: ChatResult;
  try {
    result = await ctx.chat.understand(input, cctx);
  } catch (err) {
    console.error("chat: understand threw", String(err));
    result = { ok: false, reason: "failed" };
  }
  if (!result.ok) return failureReply(ctx, result);
  return finish(ctx, mem, await execute(ctx, result.request, input, active, mem));
}

async function loadMemory(ctx: BotContext, selectedTaskId?: string): Promise<Mem> {
  let stored: ChatMemory | null = null;
  try {
    stored = await ctx.store.getChatMemory(ctx.user.phone);
  } catch (err) {
    console.error("chat: memory read failed", String(err));
  }
  let fresh = stored && isFresh(stored, ctx.now) ? stored : null;
  // The open task detail is the selected task, with or without a stored memory.
  if (selectedTaskId) fresh = { ...(fresh ?? { v: stored?.v ?? 0, at: ctx.now.toISOString() }), sel: selectedTaskId };
  const patch: MemoryPatch = selectedTaskId ? { sel: selectedTaskId } : {};
  return { stored, fresh, patch, cleared: false };
}

/** The compact memory for the AI: the last query, how many were shown, the selected task's title (if visible). */
async function summaryOf(ctx: BotContext, m: ChatMemory): Promise<ChatMemorySummary | null> {
  let selectedTitle: string | null = null;
  if (m.sel) {
    const t = await ctx.store.getTask(m.sel);
    if (t && canSeeTask(ctx.user, t)) selectedTitle = t.title;
  }
  if (!m.query && !(m.shown?.length) && !selectedTitle) return null;
  return { query: m.query ?? null, shown: m.shown?.length ?? 0, selectedTitle };
}

/** Saves what this message changed (version-checked). On a conflict: re-read once, re-apply, else skip silently. */
async function finish(ctx: BotContext, mem: Mem | null, outs: Outgoing[]): Promise<Outgoing[]> {
  if (!mem || mem.cleared || Object.keys(mem.patch).length === 0) return outs;
  const { phone } = ctx.user;
  try {
    let base = mem.stored;
    for (let attempt = 0; attempt < 2; attempt++) {
      const fresh = base && isFresh(base, ctx.now) ? base : null;
      const next: ChatMemory = {
        v: base?.v ?? 0,
        at: ctx.now.toISOString(),
        query: mem.patch.query === undefined ? (fresh?.query ?? null) : mem.patch.query,
        shown: mem.patch.shown ?? fresh?.shown ?? [],
        offset: mem.patch.offset ?? fresh?.offset ?? 0,
        total: mem.patch.total ?? fresh?.total ?? 0,
        sel: mem.patch.sel === undefined ? (fresh?.sel ?? null) : mem.patch.sel,
      };
      if (await ctx.store.saveChatMemory(phone, next)) return outs;
      if (attempt === 1) break;
      base = await ctx.store.getChatMemory(phone);
      // A newer message already wrote: an older one never overwrites it.
      if (base && Date.parse(base.at) > ctx.now.getTime()) return outs;
    }
  } catch (err) {
    console.error("chat: memory save failed", String(err));
  }
  return outs;
}

/** Our-side failures (failed / limit) go to the daily health check, like voice. */
async function failureReply(ctx: BotContext, result: Extract<ChatResult, { ok: false }>): Promise<Outgoing[]> {
  const why = result.detail ? `${result.reason}: ${result.detail}` : result.reason;
  console.log("chat: failed", why);
  if (result.reason === "failed" || result.reason === "limit") {
    await recordProblems(ctx.store, ctx.now, { errors: 1, problem: `chat ${why}` });
  }
  const debug = ctx.user.name === SUPER_ADMIN_NAME ? `\n\n_Tech: ${why}_` : "";
  return withMenu(ctx, CHAT_MSG.failed + debug);
}

async function execute(ctx: BotContext, request: ChatRequest, input: string, active: User[], mem: Mem | null): Promise<Outgoing[]> {
  // Without the memory switch the new kinds never run (a stray one is "unclear").
  if (!mem && MEMORY_KINDS.has(request.kind)) return withMenu(ctx, CHAT_MSG.unclear);
  switch (request.kind) {
    case "list":
    case "count":
      return answer(ctx, request, mem);
    case "refine":
      return mem ? refine(ctx, request.changes, mem) : [];
    case "more":
      return mem ? more(ctx, mem) : [];
    case "open":
      return mem ? open(ctx, request.ref, mem) : [];
    case "ask_task":
      return mem ? askTask(ctx, request, mem) : [];
    case "reset":
      return mem ? reset(ctx, mem) : [];
    case "update":
      return update(ctx, request, input, active);
    case "create":
      return create(ctx, request, input, active);
    case "other":
      return withMenu(ctx, CHAT_MSG.other);
    default:
      return withMenu(ctx, CHAT_MSG.unclear);
  }
}

// ---------- reads ----------

/** True when the outgoing messages hold a task picker of the `tasks` flow (taps open the detail). */
function hasTaskPicker(outs: Outgoing[]): boolean {
  return outs.some((o) => o.kind === "list" && o.rows.some((r) => r.id.startsWith("tasks:task:")) && !o.rows.some((r) => r.id.startsWith("tasks:page:")));
}

/**
 * A task picker in the reply: open a `tasks` session at its list step (marked `chat`), so a tap on a row
 * opens that task's detail through the normal flow (which re-checks the permission) and typed text goes
 * back to the chat (the router treats a `chat` list like no open session).
 */
async function openPickerSession(ctx: BotContext, outs: Outgoing[]): Promise<Outgoing[]> {
  if (hasTaskPicker(outs)) await setStep(ctx, tasksFlow.id, "list", { chat: "1" });
  return outs;
}

type Query = Extract<ChatRequest, { kind: "list" | "count" }>;

async function answer(ctx: BotContext, request: Query, mem: Mem | null): Promise<Outgoing[]> {
  if (!mem) return openPickerSession(ctx, await answerQuery(ctx.store, ctx.user, request, ctx.now));
  return runQuery(ctx, request, mem, 0);
}

/** A list/count with numbered lines; remembers the filter and the IDs shown, in order (lists only). */
async function runQuery(ctx: BotContext, request: Query, mem: Mem, offset: number): Promise<Outgoing[]> {
  const r = await answerQueryDetailed(ctx.store, ctx.user, request, ctx.now, { offset, numbered: true });
  if (request.kind === "list" && !r.refused) {
    // A page past the end changes nothing; a real list becomes the thing "doosra wala" and "aur dikhao" refer to.
    if (r.shown.length > 0 || r.total === 0) mem.patch = { ...mem.patch, query: request.filter, shown: r.shown, offset: r.offset, total: r.total };
  }
  return openPickerSession(ctx, r.outs);
}

async function refine(ctx: BotContext, changes: Extract<ChatRequest, { kind: "refine" }>["changes"], mem: Mem): Promise<Outgoing[]> {
  const prev = mem.fresh?.query;
  if (!prev) return [text(ctx.user.phone, CHAT_MSG.noQuery)];
  return runQuery(ctx, { kind: "list", filter: refineFilter(prev, changes) }, mem, 0);
}

async function more(ctx: BotContext, mem: Mem): Promise<Outgoing[]> {
  const prev = mem.fresh?.query;
  if (!prev) return [text(ctx.user.phone, CHAT_MSG.noQuery)];
  const offset = (mem.fresh?.offset ?? 0) + (mem.fresh?.shown?.length ?? 0);
  return runQuery(ctx, { kind: "list", filter: prev }, mem, offset);
}

const REF_MSG = {
  no_memory: CHAT_MSG.whichTask,
  expired: CHAT_MSG.whichTask,
  none_selected: CHAT_MSG.whichTask,
} as const;

/** The task a reference means, reloaded and re-checked; or the one focused question to send back. */
async function taskOfRef(ctx: BotContext, mem: Mem, ref: ChatRef): Promise<Task | Outgoing[]> {
  const r = resolveRef(mem.fresh, ref, ctx.now);
  if (!r.ok) {
    if (r.reason === "out_of_range") {
      const n = mem.fresh?.shown?.length ?? 0;
      return [text(ctx.user.phone, n > 0 ? `Itna number nahi hai. 1 se ${n} tak ka number likhiye.` : CHAT_MSG.whichTask)];
    }
    return [text(ctx.user.phone, REF_MSG[r.reason])];
  }
  const t = await ctx.store.getTask(r.taskId);
  if (!t || t.status === "deleted" || !canSeeTask(ctx.user, t)) return [text(ctx.user.phone, CHAT_MSG.taskGone)];
  return t;
}

async function open(ctx: BotContext, ref: ChatRef, mem: Mem): Promise<Outgoing[]> {
  const t = await taskOfRef(ctx, mem, ref);
  if (Array.isArray(t)) return t;
  mem.patch = { ...mem.patch, sel: t.id };
  return openDetailOf(ctx, t);
}

/** Same trick as staffDate: the normal tap on a task row, so the tasks flow does its own checks. */
async function openDetailOf(ctx: BotContext, t: Task): Promise<Outgoing[]> {
  const stub = { phone: ctx.user.phone, flow: tasksFlow.id, step: "list", data: {}, updatedAt: ctx.now.toISOString() };
  return tasksFlow.handle(ctx, stub, { text: t.title, reply: { kind: "list", id: `tasks:task:${t.id}`, title: t.title } });
}

/** Pending tasks this person may talk about by name: staff their own (assigned or created), admins all. */
async function visiblePending(ctx: BotContext): Promise<Task[]> {
  if (ctx.user.role === "admin") return ctx.store.listTasks({ status: "pending" });
  return ownPending(ctx);
}

async function askTask(ctx: BotContext, r: Extract<ChatRequest, { kind: "ask_task" }>, mem: Mem): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const words = Array.isArray(r.taskWords) ? r.taskWords.filter((w): w is string => typeof w === "string" && w.trim() !== "") : [];
  let task: Task;
  if (r.ref || words.length === 0) {
    const t = await taskOfRef(ctx, mem, r.ref ?? { by: "selected" });
    if (Array.isArray(t)) return t;
    task = t;
  } else {
    const found = matchTasks(await visiblePending(ctx), words, { limit: CHOICES_MAX + 1 })
      .map((m) => m.task)
      .filter((t) => canSeeTask(ctx.user, t));
    if (found.length === 0) return [text(to, CHAT_MSG.whichFragment)];
    if (found.length > 1) {
      // One numbered question; the number is answered through the saved list ("2" opens that task).
      const choices = found.slice(0, CHOICES_MAX);
      const showAssignee = ctx.user.role === "admin";
      const lines = choices.map((t, i) => `${i + 1}) ${t.urgent ? "🔴 " : ""}${clip(t.title, 60)} · ${formatDue(t.dueAt, t.dueHasTime, ctx.now)}${showAssignee ? ` · ${t.assigneeName}` : ""}`);
      mem.patch = { ...mem.patch, query: null, shown: choices.map((t) => t.id), offset: 0, total: choices.length };
      return [text(to, `${lines.join("\n")}\n\n${CHAT_MSG.askWhich}`)];
    }
    // One match: reload it and check again before answering.
    const t = await ctx.store.getTask(found[0].id);
    if (!t || t.status === "deleted" || !canSeeTask(ctx.user, t)) return [text(to, CHAT_MSG.taskGone)];
    task = t;
  }
  mem.patch = { ...mem.patch, sel: task.id };
  const body = describeTask(task, r.field, ctx.now);
  return [text(to, r.field === "all" ? body : `*${clip(task.title, 80)}*\n${body}`)];
}

async function reset(ctx: BotContext, mem: Mem): Promise<Outgoing[]> {
  try {
    await ctx.store.clearChatMemory(ctx.user.phone);
  } catch (err) {
    console.error("chat: memory clear failed", String(err));
  }
  mem.cleared = true;
  return [text(ctx.user.phone, CHAT_MSG.reset)];
}

// ---------- updates ----------

function draftOf(input: string, over: Partial<VoiceDraft>): VoiceDraft {
  return { transcript: input, title: null, person: null, personHeard: null, date: null, time: null, repeat: null, ...over };
}

async function update(ctx: BotContext, r: Extract<ChatRequest, { kind: "update" }>, input: string, active: User[]): Promise<Outgoing[]> {
  const { user } = ctx;
  const draft = draftOf(input, {
    intent: "update",
    action: r.action,
    person: r.person ?? null,
    personHeard: r.person ?? null,
    taskWords: Array.isArray(r.taskWords) ? r.taskWords.filter((w): w is string => typeof w === "string") : [],
    remark: r.remark ?? null,
    date: r.date ?? null,
    time: r.time ?? null,
    newPerson: r.newPerson ?? null,
    newPersonHeard: r.newPerson ?? null,
  });
  if (user.role === "admin") return startUpdateFromDraft(ctx, draft, active, { typed: true });

  // Staff: done / remark on their own tasks only; a date change goes through the task's own screen (25-day rule).
  if (r.action === "reassign") return withMenu(ctx, CHAT_MSG.staffReassign);
  if (r.action === "due") return staffDate(ctx, draft);
  return startUpdateFromDraft(ctx, draft, active, { typed: true });
}

async function ownPending(ctx: BotContext): Promise<Task[]> {
  const [mine, made] = await Promise.all([
    ctx.store.listTasks({ assigneePhone: ctx.user.phone, status: "pending" }),
    ctx.store.listTasks({ createdByPhone: ctx.user.phone, status: "pending" }),
  ]);
  const byId = new Map<string, Task>();
  for (const t of [...mine, ...made]) {
    if (t.status === "pending" && (t.assigneePhone === ctx.user.phone || t.createdByPhone === ctx.user.phone)) byId.set(t.id, t);
  }
  return [...byId.values()];
}

async function staffDate(ctx: BotContext, draft: VoiceDraft): Promise<Outgoing[]> {
  const words = draft.taskWords ?? [];
  const found = matchTasks(await ownPending(ctx), words, { limit: 8 }).map((m) => m.task);
  if (found.length === 0) return [text(ctx.user.phone, CHAT_MSG.dateHint)];
  if (found.length === 1) {
    // The normal tap on a task row: opens its detail (Done / Update / Date badlo) for the right checks.
    const stub = { phone: ctx.user.phone, flow: tasksFlow.id, step: "list", data: {}, updatedAt: ctx.now.toISOString() };
    const detail = await tasksFlow.handle(ctx, stub, { text: found[0].title, reply: { kind: "list", id: `tasks:task:${found[0].id}`, title: found[0].title } });
    return [text(ctx.user.phone, CHAT_MSG.dateOpen), ...detail];
  }
  const picker = [taskList(ctx.user.phone, tasksFlow.id, found, CHAT_MSG.pickForDate, { now: ctx.now })];
  return openPickerSession(ctx, picker);
}

// ---------- create ----------

const REPEAT_LABELS: Record<TaskRepeat, string> = { none: "Ek baar", every90: "Har 90 min", monthly: "Har mahine", weekly: "Har hafte" };
const isRepeat = (s: unknown): s is TaskRepeat => s === "none" || s === "every90" || s === "monthly" || s === "weekly";

async function create(ctx: BotContext, r: Extract<ChatRequest, { kind: "create" }>, input: string, active: User[]): Promise<Outgoing[]> {
  const { user } = ctx;
  if (user.role === "admin") {
    const draft = draftOf(input, {
      intent: "create",
      title: r.title ?? null,
      person: r.person ?? null,
      personHeard: r.person ?? null,
      date: r.date ?? null,
      time: r.time ?? null,
      repeat: r.repeat ?? null,
      urgent: r.urgent === true,
    });
    return startFromDraft(ctx, draft, active, { typed: true });
  }
  return createForSelf(ctx, r, input);
}

/** Staff: a task for themselves only, confirmed through the normal `create_task` buttons (its own save step). */
async function createForSelf(ctx: BotContext, r: Extract<ChatRequest, { kind: "create" }>, input: string): Promise<Outgoing[]> {
  const { user, now } = ctx;
  const to = user.phone;
  if (r.person && r.person.trim().toLowerCase() !== user.name.trim().toLowerCase()) return withMenu(ctx, CHAT_MSG.staffOthers);

  const ID = "create_task";
  const assignee = { assigneePhone: user.phone, assigneeName: user.name, assigneeBranch: user.branch ?? "", assigneeRole: user.role };
  const title = (r.title ?? "").replace(/\s+/g, " ").trim();
  if (!title || title.length > TITLE_MAX) {
    await setStep(ctx, ID, "ask_title", assignee);
    return [text(to, CHAT_MSG.askTitle)];
  }
  const repeat: TaskRepeat = isRepeat(r.repeat) ? r.repeat : "none";
  const base = { ...assignee, title, repeat, ...(r.urgent === true ? { urgent: "true" } : {}) };
  const due = dueFromInput(r.date ?? null, r.time ?? null);
  if (!due || due.dueAt.getTime() < now.getTime()) {
    await setStep(ctx, ID, "ask_due", base);
    return [quickDueList(to, ID, `📝 *${title}*\nYe task kab tak ka hai?`, now)];
  }
  const data = withNonce({ ...base, dueAt: due.dueAt.toISOString(), dueHasTime: String(due.hasTime) });
  await setStep(ctx, ID, "confirm", data);
  const repeatText = repeat === "weekly" ? `${REPEAT_LABELS.weekly} (${weekdayHi(due.dueAt)})` : repeat === "monthly" ? `${REPEAT_LABELS.monthly} (${istDay(due.dueAt).day} tareekh)` : REPEAT_LABELS[repeat];
  const summary = [
    `📝 Task: *${title}*`,
    ...(data.urgent ? ["🔴 Urgent"] : []),
    "👤 Kisko: *Aap khud*",
    `🕒 Due: *${formatDue(due.dueAt, due.hasTime, now)}*`,
    `🔔 Reminder: *${repeatText}*`,
  ].join("\n");
  const body = `Aapne likha: "${clip(input, 200)}"\n\n${summary}\n\nTask bana du?`;
  // Never title a button "Cancel" / "Stop" (an Interakt automation answers those words).
  return [
    buttons(to, body, [
      { id: `${ID}:confirm:yes`, title: "Haan ✅" },
      { id: `${ID}:confirm:edit`, title: "⚙️ Badlo" },
      { id: `${ID}:confirm:no`, title: "Nahi ❌" },
    ]),
  ];
}
