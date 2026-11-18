import { ADMINS, isAdminTask } from "./filters";
import type { Branch, TaskDTO, UserDTO } from "./types";

export interface BranchStat {
  /** Branch id, or ADMINS. */
  key: string;
  label: string;
  pending: number;
  overdue: number;
  today: number;
}

export interface BranchStats {
  rows: BranchStat[];
  /** Pending tasks of staff without a known branch (counted nowhere else, not filterable). */
  other: { pending: number; overdue: number; today: number };
}

/**
 * Pending / Overdue / Aaj due per branch from the already loaded list (no reads). Only open
 * (pending) tasks count. Pass the list after `withLiveStatus` so overdue / today are live.
 * Branches keep API order and are always listed; "Admins" is added only when it has tasks.
 * Admin tasks are counted under Admins, never under a branch (same rule as the branch filter).
 */
export function branchStats(tasks: TaskDTO[], users: UserDTO[], branches: Branch[]): BranchStats {
  const adminPhones = new Set(users.filter((u) => u.role === "admin").map((u) => u.phone));
  const knownPhones = new Set(users.map((u) => u.phone));
  const rows = new Map<string, BranchStat>(branches.map((b) => [b.id, { key: b.id, label: b.name, pending: 0, overdue: 0, today: 0 }]));
  const admins: BranchStat = { key: ADMINS, label: "Admins", pending: 0, overdue: 0, today: 0 };
  const other = { pending: 0, overdue: 0, today: 0 };
  for (const t of tasks) {
    if (t.status !== "pending") continue;
    const target = isAdminTask(t, adminPhones, knownPhones) ? admins : (t.branch !== null ? rows.get(t.branch) : undefined) ?? other;
    target.pending++;
    if (t.overdue) target.overdue++;
    if (t.dueToday) target.today++;
  }
  const list = [...rows.values()];
  if (admins.pending > 0) list.push(admins);
  return { rows: list, other };
}
