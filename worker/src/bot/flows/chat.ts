// Round 5 (docs/ROUND5-6-CONTRACT.md): typed free text that nothing else recognised. Courtesy words and
// the rule layer answer for free; the rest costs one AI call (daily limit per person). The AI result is
// only a suggestion: reads go through answerQuery (permissions in code), every change goes through the
// existing confirm flows (voice_update / voice_task / create_task) and the shared taskActions.

import type { ChatPerson, ChatRequest, ChatResult } from "../../chat/types";
import { ruleRequest } from "../../chat/rules";
import { answerQuery } from "../../chat/answer";
import { formatDue, istDay } from "../../domain/dates";
import type { Task, TaskRepeat, User } from "../../domain/types";
import { recordProblems, SUPER_ADMIN_NAME } from "../../scheduler/health";
import type { VoiceDraft } from "../../voice/types";
import { setStep, withNonce, type BotContext } from "../flow";
import type { Outgoing } from "../outgoing";
import { mainMenu, normalizeWords } from "../router";
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
};

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

export async function handleChat(ctx: BotContext, raw: string): Promise<Outgoing[]> {
  const { user, now } = ctx;
  const input = raw.replace(/\s+/g, " ").trim();
  if (!input) return [mainMenu(ctx)];

  if (isCourtesy(input)) return [text(user.phone, CHAT_MSG.courtesy)];

  // Admins: the active people (one read); staff only ever talk about themselves.
  const active = user.role === "admin" ? (await ctx.store.listUsers()).filter((u) => u.active) : [user];
  const people = peopleFor(user, active);
  const cctx = { now, role: user.role, self: user.name, people };

  // Rules first: free, no AI call, not counted.
  const byRule = ruleRequest(input, cctx);
  if (byRule) return execute(ctx, byRule, input, active);

  // Then the AI (one call). Limit is checked before the call; only messages that reach the AI count.
  if (!ctx.chat) return failureReply(ctx, { ok: false, reason: "not_configured" });
  const used = await ctx.store.bumpDailyCount(chatCountKey(user.phone, now), now);
  if (used > limitFor(user)) return withMenu(ctx, CHAT_MSG.limit);

  let result: ChatResult;
  try {
    result = await ctx.chat.understand(input, cctx);
  } catch (err) {
    console.error("chat: understand threw", String(err));
    result = { ok: false, reason: "failed" };
  }
  if (!result.ok) return failureReply(ctx, result);
  return execute(ctx, result.request, input, active);
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

async function execute(ctx: BotContext, request: ChatRequest, input: string, active: User[]): Promise<Outgoing[]> {
  switch (request.kind) {
    case "list":
    case "count":
      return answer(ctx, request);
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

async function answer(ctx: BotContext, request: Extract<ChatRequest, { kind: "list" | "count" }>): Promise<Outgoing[]> {
  const outs = await answerQuery(ctx.store, ctx.user, request, ctx.now);
  return openPickerSession(ctx, outs);
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
