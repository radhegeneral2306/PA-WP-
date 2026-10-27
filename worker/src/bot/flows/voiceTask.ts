// "Voice se task" (Batch 4, docs/VOICE-BRIEF.md): an admin's voice note is transcribed and
// understood by ctx.voice, then checked against the real staff list and dates here. The bot asks
// only for what is missing (person from a list, title, date), always shows the transcript and the
// understood task (Haan / Badlo / Cancel) and creates the task only on Haan, via createTaskFor.

import { BRANCHES, branchName, type BranchId, type TaskRepeat, type User } from "../../domain/types";
import { addDays, atIST, formatDateTime, formatDue, istDay, isValidDay, parseDue, parseTime, type ISTDay, type ParsedDue } from "../../domain/dates";
import { recordProblems, SUPER_ADMIN_NAME } from "../../scheduler/health";
import type { VoiceDraft, VoiceFailure, VoicePerson, VoiceResult } from "../../voice/types";
import { createTaskFor, TITLE_MAX } from "../taskActions";
import { endFlow, replyValue, setStep, type BotContext, type Flow, type Inbound } from "../flow";
import type { Outgoing } from "../outgoing";
import { branchList, buttons, clip, list, text, userList } from "../ui";

const ID = "voice_task";
const ADMINS = "ADMINS";
/** WhatsApp interactive body limit is 1024; keep a margin for the hint line. */
const BODY_MAX = 1000;
/** Transcript kept in the session (the remark is clipped to REMARK_MAX anyway). */
const TRANSCRIPT_KEEP = 450;
const MAX_CANDIDATES = 9;

// ---------- messages (VOICE-BRIEF section 3 drafts; owner has not approved the final wording) ----------

export const VOICE_MSG = {
  tooLong: "Voice note bahut lamba hai. 1 minute ke andar bhejiye.",
  off: "Voice se task abhi band hai. Form ya 'Naya task' use kijiye.",
  notUnderstood: "Samajh nahi aaya. Dobara bhejiye ya form se task banaiye.",
  adminsOnly: "Voice se task abhi sirf admin bana sakte hain. Menu ke liye *Hi* bhejiye.",
  twoPeople: "Is naam ke do log hain. Kisko dena hai?",
  notFound: "Ye naam staff list mein nahi mila. Kisko dena hai?",
  noName: "Naam nahi suna. Kisko dena hai?",
  whom: "Kisko dena hai?",
  title: "Task kya hai? Likh ke bhejiye 📝",
  dateMissing: "Date nahi suni. Ye task kab tak ka hai?",
  date: "Ye task kab tak ka hai?",
  datePast: "Ye date/time nikal chuka hai, aage ki date dijiye.",
  customDate: "Date likhiye, jaise *28/10*, *28/10 4pm* ya *kal 11am*",
  time: "Time likhiye, jaise *4pm*, *11:30 am* ya *shaam 6*. Time nahi hai toh *10 baje* dabaiye.",
  repeat: "Reminder kaise chahiye?\n• *Ek baar*: due time pe ek reminder\n• *Har 90 min*: jab tak jawab na mile (10 AM–8 PM)\n• *Har mahine*: har mahine isi tareekh ko",
  editMenu: "Kya badalna hai?",
  cancelled: "Theek hai, task nahi banaya.",
  created: "✅ Task ban gaya!",
  tapHint: "Neeche diye option mein se chuniye 👇",
  broken: "Kuch gadbad hui, voice note dobara bhejiye ya *Hi* bhejiye.",
};

const REPEAT_LABELS: Record<TaskRepeat, string> = { none: "Ek baar", every90: "Har 90 min", monthly: "Har mahine" };
const REPEAT_SUFFIX: Record<TaskRepeat, string> = {
  none: "",
  every90: " (phir har 90 min, jab tak jawab na mile)",
  monthly: " (har mahine)",
};
const FAILURE_TEXT: Record<VoiceFailure, string> = {
  too_long: VOICE_MSG.tooLong,
  not_configured: VOICE_MSG.off,
  limit: VOICE_MSG.off,
  not_understood: VOICE_MSG.notUnderstood,
  download: VOICE_MSG.notUnderstood,
  failed: VOICE_MSG.notUnderstood,
};
/** These are our problem (not the speaker's) and go to the daily health check. */
const HEALTH_FAILURES: ReadonlySet<VoiceFailure> = new Set(["limit", "download", "failed"]);

/**
 * Session data (strings only):
 * t transcript · title · phone/name/label assignee · heard spoken name · cands candidate phones (comma)
 * date "YYYY-MM-DD" · time "HH:MM" or "" (10 AM) · repeat
 */
type Data = Record<string, string>;
type Field = "person" | "title" | "date" | "time" | "repeat";

// ---------- entry ----------

export async function handleVoice(ctx: BotContext, mediaUrl: string): Promise<Outgoing[]> {
  const { user } = ctx;
  if (user.role !== "admin") return [text(user.phone, VOICE_MSG.adminsOnly)];

  const active = (await ctx.store.listUsers()).filter((u) => u.active);
  const people: VoicePerson[] = active.map((u) => ({ name: u.name, label: labelOf(u) }));

  let result: VoiceResult;
  if (!ctx.voice) result = { ok: false, reason: "not_configured" };
  else {
    try {
      result = await ctx.voice.understand(mediaUrl, { now: ctx.now, people });
    } catch (err) {
      console.error("voice: understand threw", String(err));
      result = { ok: false, reason: "failed" };
    }
  }

  if (!result.ok) {
    const why = result.detail ? `${result.reason}: ${result.detail}` : result.reason;
    console.log("voice: failed", why);
    if (HEALTH_FAILURES.has(result.reason)) {
      await recordProblems(ctx.store, ctx.now, { errors: 1, problem: `voice ${why}` });
    }
    const msg = FAILURE_TEXT[result.reason] ?? VOICE_MSG.notUnderstood;
    // While voice is being tested, the super admin also sees the technical reason (no keys or numbers in it).
    const debug = user.name === SUPER_ADMIN_NAME ? `\n\n_Tech: ${why}_` : "";
    return [text(user.phone, msg + debug)];
  }
  return startFromDraft(ctx, result.draft, active);
}

async function startFromDraft(ctx: BotContext, draft: VoiceDraft, active: User[]): Promise<Outgoing[]> {
  const transcript = (draft.transcript ?? "").replace(/\s+/g, " ").trim();
  const title = (draft.title ?? "").replace(/\s+/g, " ").trim();
  const data: Data = {
    t: clip(transcript, TRANSCRIPT_KEEP),
    title: title.length > TITLE_MAX ? "" : title,
    date: validDate(draft.date) ? draft.date! : "",
    time: validTime(draft.time) ? draft.time! : "",
    repeat: isRepeat(draft.repeat) ? draft.repeat : "none",
  };

  // Person: the service's pick must be a real active user; otherwise resolve what was heard.
  const picked = draft.person ? active.filter((u) => same(u.name, draft.person!)) : [];
  if (picked.length === 1) return next(ctx, { ...data, ...assignee(picked[0]) });

  const heard = (draft.personHeard ?? draft.person ?? "").trim();
  if (!heard) return askPerson(ctx, data, [], VOICE_MSG.noName);
  const withHeard = { ...data, heard: clip(heard, 40) };

  const scored = matches(heard, active);
  const exact = scored.filter((m) => m.score >= 3);
  if (exact.length === 1) return next(ctx, { ...withHeard, ...assignee(exact[0].user) });
  if (exact.length > 1) return askPerson(ctx, withHeard, exact.map((m) => m.user), VOICE_MSG.twoPeople);

  const all = await ctx.store.listUsers({ activeOnly: false });
  const gone = all.find((u) => !u.active && same(u.name, heard));
  const msg = gone ? `${gone.name} ab active nahi hai. Kisko dena hai?` : VOICE_MSG.notFound;
  return askPerson(ctx, withHeard, scored.map((m) => m.user), msg);
}

// ---------- flow ----------

export const voiceTaskFlow: Flow = {
  id: ID,

  async start(ctx) {
    await endFlow(ctx);
    return [text(ctx.user.phone, "Task ke liye voice note bhejiye (1 minute ke andar).")];
  },

  async handle(ctx, session, input) {
    if (ctx.user.role !== "admin") return broken(ctx);
    const data = session.data;
    switch (session.step) {
      case "pick_person":
        return pickPerson(ctx, data, input);
      case "pick_branch":
        return pickBranch(ctx, data, input);
      case "pick_user":
        return pickUser(ctx, data, input);
      case "ask_title":
        return answerTitle(ctx, data, input);
      case "ask_date":
        return answerDate(ctx, data, input);
      case "ask_custom_date":
        return answerCustomDate(ctx, data, input);
      case "ask_time":
        return answerTime(ctx, data, input);
      case "ask_repeat":
        return answerRepeat(ctx, data, input);
      case "edit_menu":
        return answerEdit(ctx, data, input);
      case "confirm":
        return answerConfirm(ctx, data, input);
      default:
        return broken(ctx);
    }
  },
};

async function broken(ctx: BotContext): Promise<Outgoing[]> {
  await endFlow(ctx);
  return [text(ctx.user.phone, VOICE_MSG.broken)];
}

function withHint(hint: string | undefined, body: string): string {
  return hint ? `${hint}\n\n${body}` : body;
}

/** Asks for the first missing part, else shows the confirmation. */
async function next(ctx: BotContext, data: Data, hint?: string): Promise<Outgoing[]> {
  if (!data.phone) return askPerson(ctx, data, [], VOICE_MSG.whom);
  if (!data.title) return ask(ctx, data, "title", hint);
  if (!data.date) return ask(ctx, data, "date", hint ?? VOICE_MSG.dateMissing);
  const due = dueOf(data);
  if (!due) return ask(ctx, { ...data, date: "" }, "date", hint);
  if (due.dueAt.getTime() < ctx.now.getTime()) {
    const today = dayKey(istDay(ctx.now));
    if (data.date === today) {
      const was = data.time ? formatDue(due.dueAt, true, ctx.now) : "Aaj 10 AM";
      return ask(ctx, data, "time", `⏰ ${was} nikal chuka hai. Aage ka time likhiye ya date badliye.`);
    }
    return ask(ctx, data, "date", `⏰ ${VOICE_MSG.datePast}`);
  }
  return showConfirm(ctx, data, hint);
}

async function ask(ctx: BotContext, data: Data, field: Field, hint?: string): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  switch (field) {
    case "person":
      return askPerson(ctx, data, [], withHint(hint, VOICE_MSG.whom));
    case "title":
      await setStep(ctx, ID, "ask_title", data);
      return [text(to, withHint(hint, data.title ? `Abhi: *${data.title}*\n\n${VOICE_MSG.title}` : VOICE_MSG.title))];
    case "date":
      await setStep(ctx, ID, "ask_date", data);
      return [dateButtons(to, hint === VOICE_MSG.dateMissing ? hint : withHint(hint, VOICE_MSG.date))];
    case "time":
      await setStep(ctx, ID, "ask_time", data);
      return [timeButtons(to, withHint(hint, VOICE_MSG.time))];
    case "repeat":
      await setStep(ctx, ID, "ask_repeat", data);
      return [repeatButtons(to, withHint(hint, VOICE_MSG.repeat))];
  }
}

// ---------- person ----------

function labelOf(u: Pick<User, "role" | "branch">): string {
  return u.role === "admin" ? "Admin" : branchName(u.branch);
}

function assignee(u: User): Data {
  return { phone: u.phone, name: u.name, label: labelOf(u) };
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function same(a: string, b: string): boolean {
  return norm(a) !== "" && norm(a) === norm(b);
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * How well a spoken name fits a user: 3 = the full name or one of its words is exactly what was
 * heard; 2 = a name word starts with it (or the other way round, 3+ letters); 1 = one or two
 * letters off ("Chiku" / "Chikku"); 0 = no match.
 */
function nameScore(heard: string, name: string): number {
  const h = norm(heard);
  const n = norm(name);
  if (!h || !n) return 0;
  const words = n.split(" ");
  if (h === n || words.includes(h)) return 3;
  const hFirst = h.split(" ")[0];
  const prefix = (a: string, b: string) => a.length >= 3 && b.startsWith(a);
  if (words.some((w) => prefix(h, w) || prefix(w, h) || prefix(hFirst, w)) || prefix(h, n)) return 2;
  const allowed = h.length <= 4 ? 1 : 2;
  if ([n, ...words].some((w) => editDistance(h, w) <= allowed)) return 1;
  return 0;
}

function matches(heard: string, users: User[]): { user: User; score: number }[] {
  return users
    .map((user) => ({ user, score: nameScore(heard, user.name) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.user.name.localeCompare(b.user.name))
    .slice(0, MAX_CANDIDATES);
}

/** Short list of candidates (+ "Doosra naam"), or the branch picker when there are none. */
async function askPerson(ctx: BotContext, data: Data, cands: User[], body: string): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const { phone: _p, name: _n, label: _l, cands: _c, ...rest } = data;
  if (cands.length === 0) {
    await setStep(ctx, ID, "pick_branch", rest);
    return [branchList(to, ID, body, { includeAdmins: true })];
  }
  const shown = cands.slice(0, MAX_CANDIDATES);
  await setStep(ctx, ID, "pick_person", { ...rest, cands: shown.map((u) => u.phone).join(",") });
  return [candidateList(to, shown, body)];
}

function candidateList(to: string, users: User[], body: string): Outgoing {
  const rows = users.map((u) => ({ id: `${ID}:user:${u.phone}`, title: clip(u.name, 24), description: labelOf(u) }));
  rows.push({ id: `${ID}:other`, title: "Doosra naam", description: "Branch se naam chuniye" });
  return list(to, body, "Naam chuno", rows, "Staff");
}

async function pickedUser(ctx: BotContext, input: Inbound): Promise<User | null | undefined> {
  const phone = replyValue(input, ID, "user");
  if (!phone) return undefined;
  const u = await ctx.store.getUser(phone);
  return u?.active ? u : null;
}

async function pickPerson(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  if (input.reply?.id === `${ID}:other`) return askPerson(ctx, data, [], VOICE_MSG.whom);
  const u = await pickedUser(ctx, input);
  if (u) {
    const { cands: _c, ...rest } = data;
    return next(ctx, { ...rest, ...assignee(u) });
  }
  const phones = (data.cands ?? "").split(",").filter(Boolean);
  const cands: User[] = [];
  for (const p of phones) {
    const c = await ctx.store.getUser(p);
    if (c?.active) cands.push(c);
  }
  const hint = u === null ? "Ye naam ab list mein nahi hai." : VOICE_MSG.tapHint;
  return askPerson(ctx, data, cands, withHint(hint, VOICE_MSG.whom));
}

async function usersFor(ctx: BotContext, key: string): Promise<User[] | null> {
  if (key === ADMINS) return ctx.store.listUsers({ role: "admin" });
  if (!BRANCHES.some((b) => b.id === key)) return null;
  return ctx.store.listUsers({ branch: key as BranchId, role: "staff" });
}

function groupLabel(key: string): string {
  return key === ADMINS ? "Admins" : branchName(key as BranchId);
}

function userPrompt(key: string): string {
  return `*${groupLabel(key)}* mein kisko task dena hai?`;
}

async function pickBranch(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const key = replyValue(input, ID, "branch");
  const users = key ? await usersFor(ctx, key) : null;
  if (!key || !users) return [branchList(to, ID, withHint(VOICE_MSG.tapHint, VOICE_MSG.whom), { includeAdmins: true })];
  if (users.length === 0) {
    return [branchList(to, ID, `*${groupLabel(key)}* mein abhi koi nahi hai. Dusri branch chuniye.`, { includeAdmins: true })];
  }
  await setStep(ctx, ID, "pick_user", { ...data, branch: key });
  return [userList(to, ID, users, userPrompt(key))];
}

async function pickUser(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  const key = data.branch;
  const users = key ? await usersFor(ctx, key) : null;
  if (!key || !users) return broken(ctx);
  const page = replyValue(input, ID, "page");
  if (page !== null) return [userList(to, ID, users, userPrompt(key), { page: Number(page) || 0 })];
  const u = await pickedUser(ctx, input);
  if (!u) {
    const hint = u === null ? "Ye naam ab list mein nahi hai." : VOICE_MSG.tapHint;
    return [userList(to, ID, users, withHint(hint, userPrompt(key)))];
  }
  const { branch: _b, ...rest } = data;
  return next(ctx, { ...rest, ...assignee(u) });
}

// ---------- title / date / time / repeat ----------

async function answerTitle(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const title = input.text.replace(/\s+/g, " ").trim();
  if (input.reply || !title || title.length > TITLE_MAX) {
    return [text(ctx.user.phone, withHint(`Task likh ke bhejiye (${TITLE_MAX} akshar tak).`, VOICE_MSG.title))];
  }
  return next(ctx, { ...data, title });
}

function dayKey(d: ISTDay): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

function validDate(s: string | null | undefined): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  return !!m && isValidDay(Number(m[1]), Number(m[2]), Number(m[3]));
}

function validTime(s: string | null | undefined): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(s ?? "");
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

function isRepeat(s: string | null | undefined): s is TaskRepeat {
  return s === "none" || s === "every90" || s === "monthly";
}

function dueOf(data: Data): ParsedDue | null {
  if (!validDate(data.date)) return null;
  const [year, month, day] = data.date.split("-").map(Number);
  if (!data.time) return { dueAt: atIST({ year, month, day }), hasTime: false };
  if (!validTime(data.time)) return null;
  const [hour, minute] = data.time.split(":").map(Number);
  return { dueAt: atIST({ year, month, day }, { hour, minute }), hasTime: true };
}

function clockKey(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** A typed date (optionally with time): the day, and the time only if one was typed. */
function fromTyped(due: ParsedDue, data: Data): Data {
  const date = dayKey(istDay(due.dueAt));
  if (!due.hasTime) return { ...data, date };
  const ist = new Date(due.dueAt.getTime() + 330 * 60_000);
  return { ...data, date, time: clockKey(ist.getUTCHours(), ist.getUTCMinutes()) };
}

function dateButtons(to: string, body: string): Outgoing {
  return buttons(to, body, [
    { id: `${ID}:due:today`, title: "Aaj" },
    { id: `${ID}:due:tomorrow`, title: "Kal" },
    { id: `${ID}:due:custom`, title: "Doosri date" },
  ]);
}

function timeButtons(to: string, body: string): Outgoing {
  return buttons(to, body, [
    { id: `${ID}:time:default`, title: "10 baje" },
    { id: `${ID}:edit:date`, title: "Date badlo" },
  ]);
}

function repeatButtons(to: string, body: string): Outgoing {
  return buttons(to, body, (Object.keys(REPEAT_LABELS) as TaskRepeat[]).map((r) => ({ id: `${ID}:repeat:${r}`, title: REPEAT_LABELS[r] })));
}

async function answerDate(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const choice = replyValue(input, ID, "due");
  if (choice === "today" || choice === "tomorrow") {
    const today = istDay(ctx.now);
    return next(ctx, { ...data, date: dayKey(choice === "today" ? today : addDays(today, 1)) });
  }
  if (choice === "custom") {
    await setStep(ctx, ID, "ask_custom_date", data);
    return [text(ctx.user.phone, VOICE_MSG.customDate)];
  }
  const typed = input.reply ? null : parseDue(input.text, ctx.now);
  if (typed) return next(ctx, fromTyped(typed, data));
  return [dateButtons(ctx.user.phone, withHint("Button dabaiye ya date likhiye (jaise *28/10*).", VOICE_MSG.date))];
}

async function answerCustomDate(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const typed = input.reply ? null : parseDue(input.text, ctx.now);
  if (!typed) return [text(ctx.user.phone, withHint("Date samajh nahi aayi.", VOICE_MSG.customDate))];
  return next(ctx, fromTyped(typed, data));
}

async function answerTime(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  if (input.reply?.id === `${ID}:edit:date`) return ask(ctx, data, "date");
  if (input.reply?.id === `${ID}:time:default`) return next(ctx, { ...data, time: "" });
  if (!input.reply && input.text.trim()) {
    const clock = parseTime(input.text);
    if (clock) return next(ctx, { ...data, time: clockKey(clock.hour, clock.minute) });
    const typed = parseDue(input.text, ctx.now);
    if (typed) return next(ctx, fromTyped(typed, data));
  }
  return [timeButtons(ctx.user.phone, withHint("Time samajh nahi aaya.", VOICE_MSG.time))];
}

async function answerRepeat(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const repeat = replyValue(input, ID, "repeat");
  if (!isRepeat(repeat)) return [repeatButtons(ctx.user.phone, withHint(VOICE_MSG.tapHint, VOICE_MSG.repeat))];
  return next(ctx, { ...data, repeat });
}

// ---------- confirm / edit ----------

function repeatOf(data: Data): TaskRepeat {
  return isRepeat(data.repeat) ? data.repeat : "none";
}

function dueText(ctx: BotContext, data: Data): string {
  const due = dueOf(data);
  return due ? formatDue(due.dueAt, due.hasTime, ctx.now) : "—";
}

function confirmBody(ctx: BotContext, data: Data, hint?: string): string {
  const task = [
    `Task: ${data.title}`,
    `Kisko: ${data.name} (${data.label})`,
    `Kab: ${dueText(ctx, data)}`,
    `Repeat: ${REPEAT_LABELS[repeatOf(data)]}`,
    "",
    "Ye task banau?",
  ].join("\n");
  const fixed = withHint(hint, `Maine suna: ""\n\n${task}`);
  const room = Math.max(40, BODY_MAX - fixed.length);
  return withHint(hint, `Maine suna: "${clip(data.t || "—", room)}"\n\n${task}`);
}

async function showConfirm(ctx: BotContext, data: Data, hint?: string): Promise<Outgoing[]> {
  await setStep(ctx, ID, "confirm", data);
  return [confirmButtons(ctx.user.phone, confirmBody(ctx, data, hint))];
}

/** Titles carry an emoji so the router's typed-"cancel" shortcut does not swallow the tap. */
function confirmButtons(to: string, body: string): Outgoing {
  return buttons(to, body, [
    { id: `${ID}:confirm:yes`, title: "Haan ✅" },
    { id: `${ID}:confirm:edit`, title: "Badlo ✏️" },
    { id: `${ID}:confirm:no`, title: "Cancel ❌" },
  ]);
}

const TYPED_YES = new Set(["haan", "han", "ha", "haa", "yes", "ok", "theek", "theek hai", "banao", "bana do"]);
const TYPED_EDIT = new Set(["badlo", "change", "edit"]);
const TYPED_NO = new Set(["nahi", "na", "no", "mat banao"]);

async function answerConfirm(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const to = ctx.user.phone;
  if (!data.phone || !data.title || !data.date) return next(ctx, data);
  const typed = input.reply ? "" : norm(input.text);
  let answer = replyValue(input, ID, "confirm");
  if (!answer && TYPED_YES.has(typed)) answer = "yes";
  if (!answer && TYPED_EDIT.has(typed)) answer = "edit";
  if (!answer && TYPED_NO.has(typed)) answer = "no";

  if (answer === "no") {
    await endFlow(ctx);
    return [text(to, VOICE_MSG.cancelled)];
  }
  if (answer === "edit") {
    await setStep(ctx, ID, "edit_menu", data);
    return [editList(ctx, data)];
  }
  if (answer !== "yes") return showConfirm(ctx, data, "Haan, Badlo ya Cancel dabaiye 👇");
  return save(ctx, data);
}

function editList(ctx: BotContext, data: Data, hint?: string): Outgoing {
  const rows = [
    { id: `${ID}:edit:title`, title: "Task", description: clip(data.title || "—", 72) },
    { id: `${ID}:edit:person`, title: "Kisko", description: clip(`${data.name} (${data.label})`, 72) },
    { id: `${ID}:edit:date`, title: "Date", description: dueText(ctx, data) },
    { id: `${ID}:edit:time`, title: "Time", description: data.time ? dueText(ctx, data) : "10 AM (default)" },
    { id: `${ID}:edit:repeat`, title: "Repeat", description: REPEAT_LABELS[repeatOf(data)] },
  ];
  return list(ctx.user.phone, withHint(hint, VOICE_MSG.editMenu), "Chuniye", rows, "Badlo");
}

async function answerEdit(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const field = replyValue(input, ID, "edit");
  if (field === "title" || field === "person" || field === "date" || field === "time" || field === "repeat") {
    return ask(ctx, data, field);
  }
  return [editList(ctx, data, VOICE_MSG.tapHint)];
}

async function save(ctx: BotContext, data: Data): Promise<Outgoing[]> {
  const { user, now } = ctx;
  // The session can be up to 30 minutes old: re-check the person and the due time.
  const person = await ctx.store.getUser(data.phone);
  if (!person?.active) {
    return askPerson(ctx, data, [], `${data.name} ab active nahi hai. Kisko dena hai?`);
  }
  const due = dueOf(data);
  if (!due || due.dueAt.getTime() < now.getTime()) return next(ctx, data);

  const result = await createTaskFor(
    ctx.store,
    { phone: user.phone, name: user.name },
    {
      title: data.title,
      assignee: person,
      due,
      repeat: repeatOf(data),
      source: "voice",
      note: `Voice se banaya. Maine suna: "${data.t}"`,
    },
    now,
  );
  // Person and due time were checked above, so a refusal here is about the title.
  if (!result.ok) return ask(ctx, data, "title", `${result.error}.`);
  await endFlow(ctx);
  const t = result.task;
  const repeat = t.repeat;
  const dueStr = formatDue(t.dueAt, t.dueHasTime, now);
  const first = t.nextReminderAt && t.nextReminderAt !== t.dueAt ? formatDateTime(t.nextReminderAt, now) : dueStr;
  const who = t.assigneePhone === user.phone ? "Aap khud" : `${t.assigneeName} (${labelOf(person)})`;
  const repeatText = repeat === "monthly" ? `${REPEAT_LABELS[repeat]} (${istDay(new Date(t.dueAt)).day} tareekh)` : REPEAT_LABELS[repeat];
  const summary = [
    `📝 Task: *${t.title}*`,
    `👤 Kisko: *${who}*`,
    `🕒 Due: *${dueStr}*`,
    `🔔 Reminder: *${repeatText}*`,
    `⏰ Pehla reminder: *${first}${REPEAT_SUFFIX[repeat]}*`,
    "🎤 Voice se banaya",
  ].join("\n");
  return [text(user.phone, `${VOICE_MSG.created}\n\n${summary}`), ...result.outs];
}
