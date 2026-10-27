// "Naya task (Form)": sends the WhatsApp Form template and turns a submitted form into a task.
// The real Interakt payload has not been seen yet, so answers are read tolerantly:
// keys may be exact (`title`) or auto-generated (`screen_0_Task_kya_hai_2`), dropdown values
// may be labels ("Pinky (Durg)") or ids ("3_Pinky_(Durg)"). The form is never trusted:
// role, person, branch, title and date are all re-checked here.

import { branchName, type TaskRepeat, type User } from "../../domain/types";
import { atIST, formatDateTime, formatDue, istDay, isValidDay, parseTime, type ISTDay, type ParsedDue } from "../../domain/dates";
import type { BotContext, Flow } from "../flow";
import type { Outgoing } from "../outgoing";
import { createTaskFor, TITLE_MAX } from "../taskActions";
import { text } from "../ui";

const ID = "task_form";
const ADMIN_TOKEN = "task_form_admin";
const STAFF_TOKEN = "task_form_staff";

const FALLBACK = "Form abhi nahi khul raha. Menu se *➕ Naya task* chuniye, wahi kaam karega.";
const RETRY = "Menu se *📝 Naya task (Form)* dobara bhariye, ya purana *➕ Naya task* option use kijiye.";

const REPEAT_LABELS: Record<TaskRepeat, string> = { none: "Ek baar", every90: "Har 90 min", monthly: "Har mahine" };
const REPEAT_SUFFIX: Record<TaskRepeat, string> = {
  none: "",
  every90: " (phir har 90 min, jab tak jawab na mile)",
  monthly: " (har mahine)",
};

export const taskFormFlow: Flow = {
  id: ID,
  async start(ctx: BotContext) {
    const admin = ctx.user.role === "admin";
    return [
      {
        to: ctx.user.phone,
        kind: "template",
        template: admin ? "task_form_admin_v1" : "task_form_staff_v1",
        bodyValues: [],
        fallbackText: FALLBACK,
        flowToken: admin ? ADMIN_TOKEN : STAFF_TOKEN,
      },
    ];
  },
  async handle(ctx: BotContext) {
    // No session is ever opened; just in case, point back to the menu.
    return [text(ctx.user.phone, "Menu ke liye *Hi* bhejiye.")];
  },
};

// ---------- field lookup ----------

type Field = "branch" | "person" | "title" | "date" | "time" | "repeat";

/** Words that identify a field in an auto-generated key (exact field name first). */
const FIELD_WORDS: Record<Field, string[]> = {
  branch: ["branch"],
  person: ["person", "kisko", "assignee"],
  title: ["title", "kya_hai", "kyahai", "task"],
  date: ["date"],
  time: ["time", "samay"],
  repeat: ["repeat", "reminder"],
};
const FIELD_ORDER: Field[] = ["branch", "person", "title", "date", "time", "repeat"];

/** Maps each field to its form key (exact names win over keys that merely contain the words). */
function locateFields(form: Record<string, unknown>): Partial<Record<Field, string>> {
  const keys = Object.keys(form).filter((k) => k.toLowerCase() !== "flow_token");
  const used = new Set<string>();
  const found: Partial<Record<Field, string>> = {};
  for (const f of FIELD_ORDER) {
    const exact = keys.find((k) => k.toLowerCase() === f);
    if (exact) {
      found[f] = exact;
      used.add(exact);
    }
  }
  for (const f of FIELD_ORDER) {
    if (found[f]) continue;
    const key = keys.find((k) => {
      if (used.has(k)) return false;
      const low = k.toLowerCase().replace(/[\s-]+/g, "_");
      return FIELD_WORDS[f].some((w) => low.includes(w));
    });
    if (key) {
      found[f] = key;
      used.add(key);
    }
  }
  return found;
}

/** The answer as a trimmed string; arrays give their first item, objects their title/id. */
function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.length ? asText(v[0]) : "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return asText(o.title ?? o.label ?? o.value ?? o.id);
  }
  return String(v).trim();
}

/** Dropdown id → label: "3_Pinky_(Durg)" → "Pinky (Durg)". */
function cleanOption(v: string): string {
  return v.replace(/^\d+_/, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

/** Comparison key: case- and space-insensitive. */
const squash = (s: string): string => s.toLowerCase().replace(/\s+/g, "");

// ---------- value parsing ----------

function parseFormDate(raw: unknown): ISTDay | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return epochDay(raw);
  const s = asText(raw);
  if (!s) return null;
  if (/^\d{9,13}$/.test(s)) return epochDay(Number(s));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return day(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return day(Number(m[3]), Number(m[2]), Number(m[1]));
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : istDay(d);
  }
  return null;
}

/** Epoch milliseconds (or seconds, if short) → IST calendar day. */
function epochDay(n: number): ISTDay | null {
  const ms = n < 1e11 ? n * 1000 : n;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : istDay(d);
}

function day(year: number, month: number, d: number): ISTDay | null {
  return isValidDay(year, month, d) ? { year, month, day: d } : null;
}

/** Time answer → clock; undefined = default 10 AM (empty or the "(default)" option); null = not understood. */
function parseFormTime(raw: unknown): { hour: number; minute: number } | undefined | null {
  const s = cleanOption(asText(raw));
  if (!s || /default/i.test(s)) return undefined;
  return parseTime(s);
}

function parseRepeat(raw: unknown): TaskRepeat | null {
  const s = squash(cleanOption(asText(raw)));
  if (!s) return "none";
  if (s === "none" || s.includes("ekbaar") || s.includes("once")) return "none";
  if (s === "every90" || s.includes("90")) return "every90";
  if (s === "monthly" || s.includes("mahin") || s.includes("month")) return "monthly";
  return null;
}

// ---------- person / branch ----------

type BranchAnswer = { kind: "admins" } | { kind: "branch"; id: User["branch"] } | null;

/** Short tags used in the Interakt Person list where the 30-character option limit bites ("... (Hdw)"). */
const BRANCH_SHORT: Record<string, "HARDWARE"> = { hdw: "HARDWARE", hw: "HARDWARE" };

function parseBranch(raw: string): BranchAnswer | "bad" {
  const s = squash(cleanOption(raw));
  if (!s) return null;
  if (s === "admins" || s === "admin") return { kind: "admins" };
  const ids = ["RAIPUR", "JAGDALPUR", "DURG", "HARDWARE", "OFFICE"] as const;
  const id = ids.find((b) => squash(branchName(b)) === s || b.toLowerCase() === s) ?? BRANCH_SHORT[s];
  return id ? { kind: "branch", id } : "bad";
}

function fitsBranch(u: User, b: BranchAnswer): boolean {
  if (!b) return true;
  if (b.kind === "admins") return u.role === "admin";
  return u.role === "staff" && u.branch === b.id;
}

function label(u: User): string {
  return u.role === "admin" ? "Admin" : branchName(u.branch);
}

async function resolvePerson(ctx: BotContext, raw: string, branch: BranchAnswer): Promise<User | string> {
  const value = cleanOption(raw);
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(value);
  const name = (m ? m[1] : value).trim();
  const tag = m ? parseBranch(m[2]) : null;
  const all = await ctx.store.listUsers({ activeOnly: false });
  const named = all.filter((u) => squash(u.name) === squash(name));
  const active = named.filter((u) => u.active);
  if (active.length === 0) {
    return named.length ? `*${name}* ab active nahi hai.` : `*${value}* naam ka koi user nahi mila.`;
  }
  const tagged = tag === "bad" ? [] : active.filter((u) => fitsBranch(u, tag));
  const fits = tagged.filter((u) => fitsBranch(u, branch));
  if (fits.length === 1) return fits[0];
  if (fits.length > 1) return `*${value}* naam ke ek se zyada user hain, dashboard ya purane *➕ Naya task* se banaiye.`;
  const real = active[0];
  return `*${real.name}* ${label(real)} mein hai, chuni hui branch se match nahi karta.`;
}

// ---------- submission ----------

function failText(problems: string[]): string {
  return ["❌ Task nahi bana:", ...problems.map((p) => `• ${p}`), "", RETRY].join("\n");
}

export async function handleTaskForm(ctx: BotContext, form: Record<string, unknown>): Promise<Outgoing[]> {
  try {
    return await submit(ctx, form);
  } catch (err) {
    console.error("task form failed", err instanceof Error ? err.message : String(err));
    return [text(ctx.user.phone, failText(["Kuch gadbad hui."]))];
  }
}

async function submit(ctx: BotContext, form: Record<string, unknown>): Promise<Outgoing[]> {
  const { user, now } = ctx;
  const to = user.phone;
  const keys = locateFields(form);
  const token = asText(form.flow_token ?? form.Flow_token ?? form.FLOW_TOKEN).toLowerCase();
  const get = (f: Field): unknown => (keys[f] ? form[keys[f] as string] : undefined);
  const branchRaw = asText(get("branch"));
  const personRaw = asText(get("person"));

  const logKeys = (missing: string) =>
    console.log(`task form: ${missing} not found; keys=${JSON.stringify(Object.keys(form))}`);

  // Role is decided by the server, never by which form came back.
  if (user.role !== "admin" && (personRaw || branchRaw || token === ADMIN_TOKEN)) {
    return [text(to, "Ye form sirf admin ke liye hai. Apna task banane ke liye menu se *📝 Naya task (Form)* ya *➕ Naya task* chuniye.")];
  }

  const problems: string[] = [];
  let assignee: User | null = user.role === "admin" ? null : user;

  if (user.role === "admin") {
    const branch = parseBranch(branchRaw);
    if (branch === "bad") problems.push(`Branch *${cleanOption(branchRaw)}* samajh nahi aayi.`);
    if (!personRaw) {
      logKeys("person");
      problems.push("*Kisko dena hai* bhariye.");
    } else if (branch !== "bad") {
      const found = await resolvePerson(ctx, personRaw, branch);
      if (typeof found === "string") problems.push(found);
      else assignee = found;
    }
  }

  const title = asText(get("title"));
  if (!title) {
    if (!keys.title) logKeys("title");
    problems.push("*Task kya hai* khaali hai.");
  } else if (title.length > TITLE_MAX) {
    problems.push(`Task ${TITLE_MAX} akshar se chhota rakhiye.`);
  }

  let due: ParsedDue | null = null;
  const dateRaw = get("date");
  const dueDay = parseFormDate(dateRaw);
  const clock = parseFormTime(get("time"));
  if (!dueDay) {
    if (!keys.date) logKeys("date");
    problems.push(asText(dateRaw) ? "*Due date* samajh nahi aayi." : "*Due date* bhariye.");
  }
  if (clock === null) problems.push(`Time *${cleanOption(asText(get("time")))}* samajh nahi aaya.`);
  if (dueDay && clock !== null) {
    due = clock ? { dueAt: atIST(dueDay, clock), hasTime: true } : { dueAt: atIST(dueDay), hasTime: false };
    if (due.dueAt.getTime() < now.getTime()) {
      const today = istDay(now);
      const isToday = dueDay.year === today.year && dueDay.month === today.month && dueDay.day === today.day;
      problems.push(isToday ? `Aaj ka ye time (${formatDue(due.dueAt, true, now)}) nikal chuka hai, aage ka time chuniye.` : "Ye date nikal chuki hai, aage ki date chuniye.");
    }
  }

  const repeat = parseRepeat(get("repeat"));
  if (!repeat) problems.push(`Reminder *${cleanOption(asText(get("repeat")))}* samajh nahi aaya (Ek baar / Har 90 min / Har mahine).`);

  if (problems.length || !assignee || !due || !repeat) {
    return [text(to, failText(problems.length ? problems : ["Form adhoora hai."]))];
  }

  const res = await createTaskFor(ctx.store, { phone: user.phone, name: user.name }, { title, assignee, due, repeat }, now);
  if (!res.ok) return [text(to, failText([res.error]))];

  const t = res.task;
  const self = t.assigneePhone === user.phone;
  const dueText = formatDue(t.dueAt, t.dueHasTime, now);
  const repeatText = repeat === "monthly" ? `${REPEAT_LABELS.monthly} (${istDay(new Date(t.dueAt)).day} tareekh)` : REPEAT_LABELS[repeat];
  const first = !t.nextReminderAt || t.nextReminderAt === t.dueAt ? dueText : formatDateTime(t.nextReminderAt, now);
  const who = self ? "Aap khud" : `${assignee.name} (${label(assignee)})`;
  const created = [
    "✅ Task ban gaya!",
    "",
    `📝 Task: *${t.title}*`,
    `👤 Kisko: *${who}*`,
    `🕒 Due: *${dueText}*`,
    `🔔 Reminder: *${repeatText}*`,
    `⏰ Pehla reminder: *${first}${REPEAT_SUFFIX[repeat]}*`,
  ].join("\n");
  return [text(to, created), ...res.outs];
}
