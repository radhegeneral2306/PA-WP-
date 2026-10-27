// Decides which flow handles a message: greetings and menu taps reset to the
// main menu, an active session goes to its flow, anything else gets the menu.

import { SESSION_TTL_MINUTES, type Role, type User } from "../domain/types";
import type { BotContext, Flow, Inbound } from "./flow";
import type { Outgoing } from "./outgoing";
import { list, text } from "./ui";
import { createTaskFlow } from "./flows/createTask";
import { manageStaffFlow } from "./flows/manageStaff";
import { tasksFlow } from "./flows/tasks";
import { approvalsFlow } from "./flows/approvals";
import { handleTaskForm, taskFormFlow } from "./flows/createTaskForm";

interface MenuEntry {
  key: string;
  title: string;
  description: string;
  roles: Role[];
  flow: Flow;
  arg?: string;
}

/** Batch 3: switch on for everyone once a real form submission has been checked. */
export const FORMS_LIVE = false;
/** Until then the form option shows only for these users (by name; templates approved 27 Oct). */
export const FORM_TESTERS: ReadonlySet<string> = new Set(["Bhaskar", "Ofc Hardware - 66466"]);

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

const FLOWS: Flow[] = [tasksFlow, createTaskFlow, manageStaffFlow, approvalsFlow, taskFormFlow];

const GREETINGS = new Set(["hi", "hii", "hiii", "hello", "helo", "hey", "menu", "namaste", "start"]);
const CANCEL_WORDS = new Set(["cancel", "band", "band karo", "ruko", "stop", "exit"]);

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
  return list(user.phone, body, "Menu kholo", rows, user.role === "admin" ? "Admin menu" : "Staff menu");
}

export async function handleMessage(ctx: BotContext, input: Inbound): Promise<Outgoing[]> {
  const { store, user } = ctx;
  const lower = input.text.toLowerCase();
  const replyId = input.reply?.id ?? "";
  // Template quick replies carry only the button text (as plain text or as the reply id).
  const quick = (input.reply && !replyId.includes(":") ? replyId : input.text).toLowerCase();

  // A submitted form stands on its own (whatever session was open).
  if (input.form) {
    await store.clearSession(user.phone);
    return handleTaskForm(ctx, input.form);
  }
  if (GREETINGS.has(lower) || quick === "menu") {
    await store.clearSession(user.phone);
    return [mainMenu(ctx)];
  }
  if (CANCEL_WORDS.has(lower)) {
    await store.clearSession(user.phone);
    return [text(user.phone, "Theek hai, cancel kar diya. Menu ke liye *Hi* bhejiye.")];
  }
  if (quick === "mere tasks") return startEntry(ctx, "my_tasks");
  if (quick === "approvals dekhein") return startEntry(ctx, "approvals");
  if (replyId.startsWith("MENU:")) return startEntry(ctx, replyId.slice("MENU:".length));

  const session = await store.getSession(user.phone);
  const fresh = session && ctx.now.getTime() - Date.parse(session.updatedAt) < SESSION_TTL_MINUTES * 60_000;
  if (session && !fresh) await store.clearSession(user.phone);

  if (session && fresh) {
    const flow = FLOWS.find((f) => f.id === session.flow);
    if (!flow) {
      await store.clearSession(user.phone);
      return [mainMenu(ctx)];
    }
    if (input.reply && !replyId.startsWith(`${flow.id}:`)) {
      return [mainMenu(ctx, "Ye option purana hai 🙂 Naye menu se chuniye.")];
    }
    return flow.handle(ctx, session, input);
  }

  if (input.reply) return [mainMenu(ctx, "Ye option purana ho gaya hai 🙂 Naye menu se chuniye.")];
  return [mainMenu(ctx)];
}

async function startEntry(ctx: BotContext, key: string): Promise<Outgoing[]> {
  const entry = MENU.find((m) => m.key === key && available(m, ctx.user));
  await ctx.store.clearSession(ctx.user.phone);
  if (!entry) return [mainMenu(ctx, "Ye option aapke liye available nahi hai.")];
  return entry.flow.start(ctx, entry.arg);
}
