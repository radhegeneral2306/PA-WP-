// Decides which flow handles a message: greetings and menu taps reset to the
// main menu, an active session goes to its flow, anything else gets the menu.

import { SESSION_TTL_MINUTES, TYPING_TTL_MINUTES, type Role, type Session, type User } from "../domain/types";
import type { BotContext, Flow, Inbound } from "./flow";
import type { Outgoing } from "./outgoing";
import { buttons, list, text } from "./ui";
import { createTaskFlow } from "./flows/createTask";
import { manageStaffFlow } from "./flows/manageStaff";
import { tasksFlow } from "./flows/tasks";
import { approvalsFlow } from "./flows/approvals";
import { handleTaskForm, taskFormFlow } from "./flows/createTaskForm";
import { handleVoice, voiceTaskFlow } from "./flows/voiceTask";

interface MenuEntry {
  key: string;
  title: string;
  description: string;
  roles: Role[];
  flow: Flow;
  arg?: string;
}

/** Batch 3: switch on for everyone once a real form submission has been checked. */
export const FORMS_LIVE = true;
/** Until then the form option shows only for these users (by name; templates approved 27 Oct). */
export const FORM_TESTERS: ReadonlySet<string> = new Set(["Bhaskar", "Ofc Hardware - 66466", "Chikku"]);

/** Batch 4 (VOICE-BRIEF): admins only. While VOICE_LIVE is false, only these admins (by name). */
export const VOICE_LIVE = false;
export const VOICE_TESTERS: ReadonlySet<string> = new Set(["Bhaskar"]);

export function canUseVoice(user: User): boolean {
  return user.role === "admin" && (VOICE_LIVE || VOICE_TESTERS.has(user.name));
}

export function expiredText(minutes: number): string {
  return `⏱️ Session expire ho gaya (${minutes} minute tak koi jawab nahi aaya). Dobara shuru karne ke liye *Hi* bhejiye.`;
}
export const EXPIRED = expiredText(SESSION_TTL_MINUTES);

/** Steps that wait for typed text (F15): they get TYPING_TTL_MINUTES instead of SESSION_TTL_MINUTES. */
const TYPING_STEPS: Readonly<Record<string, readonly string[]>> = {
  create_task: ["ask_title", "ask_custom_due"],
  // "detail" takes a typed update too (typing on an open task saves it as a remark).
  tasks: ["detail", "ask_remark", "ask_custom_due", "ask_date_remark"],
  manage_staff: ["add_name", "add_phone", "edit_name"],
  voice_task: ["ask_title", "ask_custom_date"],
};

/** How long this chat stays open after the user's last message. */
export function sessionTtlMinutes(s: Pick<Session, "flow" | "step">): number {
  return TYPING_STEPS[s.flow]?.includes(s.step) ? TYPING_TTL_MINUTES : SESSION_TTL_MINUTES;
}

function isFresh(s: Session, now: Date): boolean {
  return now.getTime() - Date.parse(s.updatedAt) < sessionTtlMinutes(s) * 60_000;
}

// Never tell users to type "cancel" / "stop": an Interakt automation answers those words with a
// customer goodbye message (audit C17). "band karo" is accepted as a cancel word instead.
export const BUSY_FOR_VOICE = "Pehle chal raha kaam pura kijiye ya *band karo* likhiye, phir voice note bhejiye.";

const FORM_ENTRY: MenuEntry = {
  key: "create_task_form",
  title: "📝 Naya task (Form)",
  description: "Ek hi screen pe form bhar ke task banao",
  roles: ["admin", "staff"],
  flow: taskFormFlow,
};

export const MENU: MenuEntry[] = [
  { key: "my_tasks", title: "📋 Mere tasks", description: "Apne pending tasks dekho", roles: ["admin", "staff"], flow: tasksFlow, arg: "mine" },
  { key: "staff_tasks", title: "👥 Staff ke tasks", description: "Branch aur staff chun ke tasks dekho", roles: ["admin"], flow: tasksFlow, arg: "staff" },
  { key: "create_task", title: "➕ Naya task", description: "Task banao aur assign karo", roles: ["admin", "staff"], flow: createTaskFlow },
  FORM_ENTRY,
  { key: "approvals", title: "⏳ Approvals", description: "Staff ki date badalne ki requests", roles: ["admin"], flow: approvalsFlow },
  { key: "manage_staff", title: "⚙️ Staff manage", description: "Staff add / edit / remove / list", roles: ["admin"], flow: manageStaffFlow },
];

const FLOWS: Flow[] = [tasksFlow, createTaskFlow, manageStaffFlow, approvalsFlow, taskFormFlow, voiceTaskFlow];

/** Reply ids that carry the id of what they act on (see tasks / approvals detail messages). */
const DIRECT: { re: RegExp; flow: Flow }[] = [
  { re: /^tasks:act:(done|update|date):./, flow: tasksFlow },
  { re: /^approvals:decide:(approve|reject):./, flow: approvalsFlow },
];

const GREETINGS = new Set(["hi", "hii", "hiii", "hello", "helo", "hey", "menu", "namaste", "start"]);
const CANCEL_WORDS = new Set(["cancel", "band", "band karo", "ruko", "stop", "exit"]);

/**
 * Text as compared with the words above: lowercase, punctuation and emoji removed, spaces
 * collapsed ("Hi! 🙏" -> "hi"). Only letters, digits and spaces stay.
 */
export function normalizeWords(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** A whole message that is exactly one of `words`, optionally followed by "ji" ("hello ji"). */
function isWord(words: ReadonlySet<string>, cleaned: string): boolean {
  return words.has(cleaned) || (cleaned.endsWith(" ji") && words.has(cleaned.slice(0, -3)));
}

function available(m: MenuEntry, user: User): boolean {
  if (!m.roles.includes(user.role)) return false;
  return m !== FORM_ENTRY || FORMS_LIVE || FORM_TESTERS.has(user.name);
}

export function mainMenu(ctx: BotContext, intro?: string): Outgoing {
  const { user } = ctx;
  const rows = MENU.filter((m) => available(m, user)).map((m) => ({
    id: `MENU:${m.key}`,
    title: m.title,
    description: m.description,
  }));
  const body = intro ?? `Namaste ${user.name} 🙏\nKya karna hai? Neeche se chuniye.`;
  // Three options or fewer (staff): plain buttons, one tap instead of "open list" + pick.
  if (rows.length <= 3) return buttons(user.phone, body, rows.map((r) => ({ id: r.id, title: r.title })));
  return list(user.phone, body, "Menu kholo", rows, user.role === "admin" ? "Admin menu" : "Staff menu");
}

export async function handleMessage(ctx: BotContext, input: Inbound): Promise<Outgoing[]> {
  const { store, user } = ctx;
  // "Hi!", "hi 🙏", "Hello ji" count as greetings even inside a flow; "Hisab karna" stays a title.
  const cleaned = normalizeWords(input.text);
  const replyId = input.reply?.id ?? "";
  // Template quick replies carry only the button text (as plain text or as the reply id).
  const quick = normalizeWords(input.reply && !replyId.includes(":") ? replyId : input.text);

  // A submitted form stands on its own (whatever session was open).
  if (input.form) {
    await store.clearSession(user.phone);
    return handleTaskForm(ctx, input.form);
  }
  // Voice note from an allowed admin: a task attempt, unless another flow is open (brief decision 21).
  // Anyone else's voice note falls through to the old behaviour (menu).
  if (input.voice && canUseVoice(user)) {
    const open = await store.getSession(user.phone);
    const busy = open && open.flow !== voiceTaskFlow.id && isFresh(open, ctx.now);
    if (busy) return [text(user.phone, BUSY_FOR_VOICE)];
    await store.clearSession(user.phone);
    return handleVoice(ctx, input.voice.mediaUrl);
  }
  if (isWord(GREETINGS, cleaned) || quick === "menu") {
    await store.clearSession(user.phone);
    return [mainMenu(ctx)];
  }
  if (isWord(CANCEL_WORDS, cleaned)) {
    await store.clearSession(user.phone);
    return [text(user.phone, "Theek hai, cancel kar diya. Menu ke liye *Hi* bhejiye.")];
  }
  if (quick === "mere tasks") return startEntry(ctx, "my_tasks");
  if (quick === "approvals dekhein") return startEntry(ctx, "approvals");
  if (replyId.startsWith("MENU:")) return startEntry(ctx, replyId.slice("MENU:".length));

  const session = await store.getSession(user.phone);
  const fresh = session && isFresh(session, ctx.now);
  const expired = !!session && !fresh;
  if (expired) await store.clearSession(user.phone);

  // A chat that went quiet: say so instead of silently treating the message as something else.
  // This includes Done / Approve buttons on older messages (owner decision 2 Nov: they expire too).
  if (expired) return [text(user.phone, expiredText(sessionTtlMinutes(session)))];

  // While a chat is open, buttons that name their own task (task actions, approvals) act on that
  // task even from an older message or from another flow's chat.
  const direct = DIRECT.find((d) => d.re.test(replyId));
  if (direct && session && fresh && session.flow !== direct.flow.id) {
    await store.saveSession({ ...session, updatedAt: ctx.now.toISOString() });
    const stub = { phone: user.phone, flow: "", step: "", data: {}, updatedAt: ctx.now.toISOString() };
    return direct.flow.handle(ctx, stub, input);
  }

  if (session && fresh) {
    const flow = FLOWS.find((f) => f.id === session.flow);
    if (!flow) {
      await store.clearSession(user.phone);
      return [mainMenu(ctx)];
    }
    if (input.reply && !replyId.startsWith(`${flow.id}:`)) {
      return [mainMenu(ctx, "Ye option purana hai 🙂 Naye menu se chuniye.")];
    }
    // The timeout counts from the user's last message, also when a step only re-prompts.
    const touched = { ...session, updatedAt: ctx.now.toISOString() };
    await store.saveSession(touched);
    return flow.handle(ctx, touched, input);
  }

  // A tap on a list/button whose chat already ended (no session left).
  if (input.reply) return [text(user.phone, EXPIRED)];
  return [mainMenu(ctx)];
}

async function startEntry(ctx: BotContext, key: string): Promise<Outgoing[]> {
  const entry = MENU.find((m) => m.key === key && available(m, ctx.user));
  await ctx.store.clearSession(ctx.user.phone);
  if (!entry) return [mainMenu(ctx, "Ye option aapke liye available nahi hai.")];
  return entry.flow.start(ctx, entry.arg);
}
