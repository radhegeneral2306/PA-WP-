import { todayIst } from "./due";
import type { Branch, TaskDTO, UserDTO } from "./types";

export const ALL = "ALL";
export const ADMINS = "ADMINS";
export type SummaryFilter = "all" | "overdue" | "today";
export type ArchiveKind = "all" | "done" | "cancelled";

export interface TaskFilters {
  branch: string; // ALL, ADMINS or a branch id
  staffPhone: string | null;
  query: string;
}

/** True when the bot made this task from a WhatsApp voice note. */
export function isVoiceTask(t: Pick<TaskDTO, "source">): boolean {
  return t.source === "voice";
}

export function normalize(s: string): string {
  return s.toLocaleLowerCase("en-IN").trim();
}

export function matchesQuery(t: TaskDTO, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return normalize(t.title).includes(q) || normalize(t.assigneeName).includes(q);
}

/** A task belongs to "Admins" when its assignee is an admin (or has no branch and is unknown). */
export function isAdminTask(t: TaskDTO, adminPhones: Set<string>, knownPhones: Set<string>): boolean {
  if (adminPhones.has(t.assigneePhone)) return true;
  return !knownPhones.has(t.assigneePhone) && t.branch === null;
}

export function applyFilters(tasks: TaskDTO[], f: TaskFilters, users: UserDTO[]): TaskDTO[] {
  const adminPhones = new Set(users.filter((u) => u.role === "admin").map((u) => u.phone));
  const knownPhones = new Set(users.map((u) => u.phone));
  return tasks.filter((t) => {
    if (f.staffPhone && t.assigneePhone !== f.staffPhone) return false;
    if (f.branch === ADMINS) {
      if (!isAdminTask(t, adminPhones, knownPhones)) return false;
    } else if (f.branch !== ALL) {
      if (t.branch !== f.branch || isAdminTask(t, adminPhones, knownPhones)) return false;
    }
    return matchesQuery(t, f.query);
  });
}

/** F5: true only when the Worker says so (older workers send nothing). */
export function isUrgent(t: Pick<TaskDTO, "urgent">): boolean {
  return t.urgent === true;
}

/** Pending lists: urgent first, then by due (earliest first, so overdue comes first). Ties keep the older task first. */
export function sortPending(tasks: TaskDTO[]): TaskDTO[] {
  return tasks.slice().sort((a, b) => {
    const u = Number(isUrgent(b)) - Number(isUrgent(a));
    if (u !== 0) return u;
    const d = (Date.parse(a.dueAt) || 0) - (Date.parse(b.dueAt) || 0);
    if (d !== 0) return d;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/** Recycle bin: newest delete first (the Worker sends this order too). */
export function sortBin(tasks: TaskDTO[]): TaskDTO[] {
  return tasks
    .filter((t) => t.status === "deleted")
    .sort((a, b) => (Date.parse(b.deletedAt ?? b.updatedAt) || 0) - (Date.parse(a.deletedAt ?? a.updatedAt) || 0));
}

export function applySummary(tasks: TaskDTO[], s: SummaryFilter): TaskDTO[] {
  if (s === "overdue") return tasks.filter((t) => t.overdue);
  if (s === "today") return tasks.filter((t) => t.dueToday);
  return tasks;
}

export function summaryCounts(tasks: TaskDTO[]): { pending: number; overdue: number; today: number } {
  let overdue = 0;
  let today = 0;
  for (const t of tasks) {
    if (t.overdue) overdue++;
    if (t.dueToday) today++;
  }
  return { pending: tasks.length, overdue, today };
}

/**
 * The Worker sets `overdue` / `dueToday` when the list is fetched, so they go stale while the
 * page stays open. Recompute both against `now`, with the Worker's rules (overdue: pending and
 * due time passed; dueToday: pending and due on today's IST date). Unchanged tasks keep identity.
 */
export function withLiveStatus(tasks: TaskDTO[], now: Date = new Date()): TaskDTO[] {
  const nowMs = now.getTime();
  const today = todayIst(now);
  let changed = false;
  const out = tasks.map((t) => {
    const pending = t.status === "pending";
    const dueMs = Date.parse(t.dueAt);
    if (Number.isNaN(dueMs)) return t;
    const overdue = pending && dueMs < nowMs;
    const dueToday = pending && todayIst(new Date(dueMs)) === today;
    if (overdue === t.overdue && dueToday === t.dueToday) return t;
    changed = true;
    return { ...t, overdue, dueToday };
  });
  return changed ? out : tasks;
}

/** Nav badge on Tasks: pending tasks whose due time has passed. */
export function overdueCount(pending: TaskDTO[], now: Date = new Date()): number {
  const nowMs = now.getTime();
  return pending.filter((t) => t.status === "pending" && Date.parse(t.dueAt) < nowMs).length;
}

export function approvalCount(pending: TaskDTO[]): number {
  return pending.filter((t) => t.status === "pending" && t.dateRequest !== null && t.dateRequest !== undefined).length;
}

export function filterArchive(tasks: TaskDTO[], kind: ArchiveKind): TaskDTO[] {
  // The Worker already leaves deleted tasks out of the archive; this guards against an older one.
  const closed = tasks.filter((t) => t.status === "done" || t.status === "cancelled");
  const list = kind === "all" ? closed : closed.filter((t) => t.status === kind);
  return list.sort((a, b) => Date.parse(b.closedAt ?? b.updatedAt) - Date.parse(a.closedAt ?? a.updatedAt));
}

export function branchLabel(id: string | null, branches: Branch[]): string {
  if (id === null) return "Admin";
  const b = branches.find((x) => x.id === id);
  if (b) return b.name;
  return id.charAt(0) + id.slice(1).toLowerCase();
}

export interface UserGroup {
  key: string;
  label: string;
  users: UserDTO[];
}

/** Staff picker: one group per branch (API order), admins last. Empty groups dropped. */
export function groupUsers(users: UserDTO[], branches: Branch[], query: string): UserGroup[] {
  const q = normalize(query);
  const list = users.filter((u) => !q || normalize(u.name).includes(q));
  const groups: UserGroup[] = branches.map((b) => ({
    key: b.id,
    label: b.name,
    users: list.filter((u) => u.role !== "admin" && u.branch === b.id),
  }));
  const known = new Set(branches.map((b) => b.id));
  const other = list.filter((u) => u.role !== "admin" && (u.branch === null || !known.has(u.branch)));
  if (other.length) groups.push({ key: "OTHER", label: "Baaki", users: other });
  groups.push({ key: ADMINS, label: "Admins", users: list.filter((u) => u.role === "admin") });
  return groups.filter((g) => g.users.length > 0);
}
