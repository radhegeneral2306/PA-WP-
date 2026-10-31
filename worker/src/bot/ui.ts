// Shared message builders so every flow looks and pages the same way.
// Reply ids follow `${flow}:<kind>:<value>`; flows read them with replyValue().

import { BRANCHES, branchName, type Task, type User } from "../domain/types";
import { addDays, dueOnDay, formatDue, isOverdue, istDay, type ParsedDue } from "../domain/dates";
import type { ListRow } from "../interakt/send";
import type { Outgoing } from "./outgoing";

const MAX_ROWS = 10;
const TITLE_MAX = 24;
const DESC_MAX = 72;

export function text(to: string, body: string): Outgoing {
  return { to, kind: "text", body };
}

export function list(to: string, body: string, button: string, rows: ListRow[], sectionTitle = "Options"): Outgoing {
  return { to, kind: "list", body, button, sectionTitle, rows: rows.slice(0, MAX_ROWS) };
}

export function buttons(to: string, body: string, items: { id: string; title: string }[]): Outgoing {
  return { to, kind: "buttons", body, buttons: items.slice(0, 3) };
}

export function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export interface Page<T> {
  items: T[];
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export function paginate<T>(items: T[], page: number, size: number): Page<T> {
  const last = Math.max(0, Math.ceil(items.length / size) - 1);
  const p = Math.min(Math.max(0, page), last);
  return {
    items: items.slice(p * size, p * size + size),
    page: p,
    hasPrev: p > 0,
    hasNext: p < last,
  };
}

/** Page size that leaves room for an optional extra row plus prev/next rows. */
function pageSize(extraRows: number): number {
  return MAX_ROWS - 2 - extraRows;
}

function navRows<T>(flow: string, pg: Page<T>): ListRow[] {
  const rows: ListRow[] = [];
  if (pg.hasPrev) rows.push({ id: `${flow}:page:${pg.page - 1}`, title: "⬅️ Peeche" });
  if (pg.hasNext) rows.push({ id: `${flow}:page:${pg.page + 1}`, title: "Aage ➡️" });
  return rows;
}

/** Branch picker. ids: `${flow}:branch:<BranchId>` and `${flow}:branch:ADMINS`. */
export function branchList(to: string, flow: string, body: string, opts: { includeAdmins?: boolean } = {}): Outgoing {
  const rows: ListRow[] = BRANCHES.map((b) => ({ id: `${flow}:branch:${b.id}`, title: b.name }));
  if (opts.includeAdmins) rows.push({ id: `${flow}:branch:ADMINS`, title: "👔 Admins" });
  return list(to, body, "Branch chuno", rows, "Branches");
}

/** User picker. ids: `${flow}:user:<phone>`, `${flow}:all`, `${flow}:page:<n>`. */
export function userList(
  to: string,
  flow: string,
  users: User[],
  body: string,
  opts: { page?: number; allLabel?: string } = {},
): Outgoing {
  const pg = paginate(users, opts.page ?? 0, pageSize(opts.allLabel ? 1 : 0));
  const rows: ListRow[] = pg.items.map((u) => ({
    id: `${flow}:user:${u.phone}`,
    title: clip(u.name, TITLE_MAX),
    description: u.role === "admin" ? "Admin" : branchName(u.branch),
  }));
  if (opts.allLabel) rows.push({ id: `${flow}:all`, title: clip(opts.allLabel, TITLE_MAX) });
  rows.push(...navRows(flow, pg));
  return list(to, body, "Naam chuno", rows, "Staff");
}

/** Task picker. ids: `${flow}:task:<taskId>`, `${flow}:page:<n>`. */
export function taskList(
  to: string,
  flow: string,
  tasks: Task[],
  body: string,
  opts: { page?: number; now: Date; showAssignee?: boolean },
): Outgoing {
  const pg = paginate(tasks, opts.page ?? 0, pageSize(0));
  const rows: ListRow[] = pg.items.map((t) => ({
    id: `${flow}:task:${t.id}`,
    title: clip(t.title, TITLE_MAX),
    description: clip(taskSubtitle(t, opts.now, opts.showAssignee ?? false), DESC_MAX),
  }));
  rows.push(...navRows(flow, pg));
  return list(to, body, "Task chuno", rows, "Tasks");
}

export function taskSubtitle(t: Task, now: Date, showAssignee: boolean): string {
  const parts = [`${isOverdue(t.dueAt, now) && t.status === "pending" ? "⚠️ " : ""}Due ${formatDue(t.dueAt, t.dueHasTime, now)}`];
  if (showAssignee) parts.push(t.assigneeName);
  return parts.join(" · ");
}

/** ids: `${flow}:due:today|tomorrow|custom`. */
export function dueDateButtons(to: string, flow: string, body: string): Outgoing {
  return buttons(to, body, [
    { id: `${flow}:due:today`, title: "Aaj" },
    { id: `${flow}:due:tomorrow`, title: "Kal" },
    { id: `${flow}:due:custom`, title: "Date likho" },
  ]);
}

/** One tap = date + time (replaces the old Aaj/Kal then time steps). `days` from today, `time` null = 10 AM default. */
const QUICK_DUE = [
  { key: "today18", title: "Aaj shaam 6 PM", days: 0, time: "6pm" },
  { key: "tom10", title: "Kal 10 AM", days: 1, time: null },
  { key: "tom14", title: "Kal 2 PM", days: 1, time: "2pm" },
  { key: "tom17", title: "Kal 5 PM", days: 1, time: "5pm" },
  { key: "day2", title: "Parso 10 AM", days: 2, time: null },
  { key: "week", title: "1 hafte baad 10 AM", days: 7, time: null },
] as const;

/** Options closer than this to now are not offered (they would be past by the time of the tap). */
const QUICK_MIN_AHEAD_MS = 30 * 60_000;

/** The due for a quick-pick id value, or null for an unknown / already past option. */
export function quickDue(key: string, now: Date): ParsedDue | null {
  const opt = QUICK_DUE.find((q) => q.key === key);
  if (!opt) return null;
  const due = dueOnDay(addDays(istDay(now), opt.days), opt.time);
  return due && due.dueAt.getTime() > now.getTime() ? due : null;
}

/** Due date picker. ids: `${flow}:quick:<key>` and `${flow}:quick:custom`; typed dates still work at the same step. */
export function quickDueList(to: string, flow: string, body: string, now: Date): Outgoing {
  const rows: ListRow[] = [];
  for (const q of QUICK_DUE) {
    const due = dueOnDay(addDays(istDay(now), q.days), q.time);
    if (!due || due.dueAt.getTime() - now.getTime() < QUICK_MIN_AHEAD_MS) continue;
    rows.push({ id: `${flow}:quick:${q.key}`, title: q.title, description: formatDue(due.dueAt, true, now) });
  }
  rows.push({ id: `${flow}:quick:custom`, title: "✍️ Date / time likho", description: "Jaise 28/10 4pm" });
  return list(to, `${body}\nYa seedha likh dijiye, jaise *28/10 4pm* 👇`, "Date chuno", rows, "Due date");
}

/** Active users whose name matches typed text: exact first, then starts-with, then contains (3+ letters). */
export function matchUsers(users: User[], typed: string): User[] {
  const q = typed.trim().toLowerCase().replace(/\s+/g, " ");
  if (q.length < 2) return [];
  const name = (u: User) => u.name.toLowerCase();
  const exact = users.filter((u) => name(u) === q);
  if (exact.length > 0) return exact;
  const starts = users.filter((u) => name(u).startsWith(q));
  if (starts.length > 0 || q.length < 3) return starts;
  return users.filter((u) => name(u).includes(q));
}

/** Ask for an optional time. id: `${flow}:time:skip` (means 10:00 AM). */
export function timeButtons(to: string, flow: string, body: string): Outgoing {
  return buttons(to, body, [{ id: `${flow}:time:skip`, title: "Skip (10 AM)" }]);
}

/** ids: `${flow}:confirm:yes|no`. */
export function confirmButtons(to: string, flow: string, body: string, yes = "Haan ✅", no = "Nahi ❌"): Outgoing {
  return buttons(to, body, [
    { id: `${flow}:confirm:yes`, title: yes },
    { id: `${flow}:confirm:no`, title: no },
  ]);
}
