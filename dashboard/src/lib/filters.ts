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

export function approvalCount(pending: TaskDTO[]): number {
  return pending.filter((t) => t.status === "pending" && t.dateRequest !== null && t.dateRequest !== undefined).length;
}

export function filterArchive(tasks: TaskDTO[], kind: ArchiveKind): TaskDTO[] {
  const list = kind === "all" ? tasks.slice() : tasks.filter((t) => t.status === kind);
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
