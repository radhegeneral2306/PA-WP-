// Shared data model. Every module codes against these shapes; change them only
// in one place and update all users together.

export type BranchId = "RAIPUR" | "JAGDALPUR" | "DURG" | "HARDWARE" | "OFFICE";

export const BRANCHES: { id: BranchId; name: string }[] = [
  { id: "RAIPUR", name: "Raipur" },
  { id: "JAGDALPUR", name: "Jagdalpur" },
  { id: "DURG", name: "Durg" },
  { id: "HARDWARE", name: "Hardware" },
  { id: "OFFICE", name: "Office" },
];

export function branchName(id: BranchId | null): string {
  return BRANCHES.find((b) => b.id === id)?.name ?? "—";
}

export type Role = "admin" | "staff";

export interface User {
  /** Digits with country code, e.g. "919999999999". Also the Firestore doc id. */
  phone: string;
  name: string;
  role: Role;
  /** Staff belong to one branch; admins may have none. */
  branch: BranchId | null;
  active: boolean;
  createdAt: string; // ISO UTC
}

/** cancelled: stopped from the dashboard; never reminded, never listed as pending (kept in the archive). */
export type TaskStatus = "pending" | "done" | "cancelled";

/**
 * none: reminder at the due time, then daily at 11 AM IST while still pending.
 * every90: reminder at the due time, then every 90 minutes within working
 *   hours (10 AM to 8 PM IST) until the assignee responds.
 * monthly: due on the same day every month (overdue: daily at 11 AM like none);
 *   marking it Done creates next month's task.
 */
export type TaskRepeat = "none" | "every90" | "monthly";

/** A staff request to move a due date beyond the 25-day limit, waiting for an admin. */
export interface DateRequest {
  dueAt: string; // ISO UTC
  hasTime: boolean;
  remark: string;
  byPhone: string;
  byName: string;
  requestedAt: string; // ISO UTC
}

export interface Remark {
  at: string; // ISO UTC
  byPhone: string;
  byName: string;
  text: string;
}

export interface Task {
  id: string;
  title: string;
  assigneePhone: string;
  assigneeName: string;
  /** Assignee's branch at creation time (null for admins without a branch). */
  branch: BranchId | null;
  createdByPhone: string;
  createdByName: string;
  dueAt: string; // ISO UTC
  /** False when the user gave only a date; dueAt is then 10:00 IST that day. */
  dueHasTime: boolean;
  status: TaskStatus;
  repeat: TaskRepeat;
  /** When the next reminder should go out; null = no more reminders. The scheduler reads this. */
  nextReminderAt: string | null;
  /** Monthly tasks: the day of month the user chose (31 stays 31 even in 30-day months). */
  repeatDay?: number | null;
  /** Pending date-change approval, if any. Tasks saved before Batch 2 lack this field. */
  dateRequest?: DateRequest | null;
  /** Last time a reminder was sent (for logs and the dashboard later). */
  lastReminderAt?: string | null;
  remarks: Remark[];
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  /** Set when status becomes "cancelled". Older tasks lack these fields. */
  cancelledAt?: string | null;
  cancelledByName?: string | null;
}

export type NewTask = Omit<Task, "id">;

/** Conversation state for a multi-step chat flow. One per phone. */
export interface Session {
  phone: string;
  /** Flow id that owns this session, e.g. "create_task". */
  flow: string;
  /** Flow-defined step name, e.g. "ask_title". */
  step: string;
  /** Flow-defined scratch values (strings only to keep storage simple). */
  data: Record<string, string>;
  updatedAt: string; // ISO UTC; sessions older than SESSION_TTL_MINUTES are dropped
}

export const SESSION_TTL_MINUTES = 30;
