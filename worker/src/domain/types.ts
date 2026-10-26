// Shared data model. Every module codes against these shapes; change them only
// in one place and update all users together.

export type BranchId = "RAIPUR" | "JAGDALPUR" | "DURG";

export const BRANCHES: { id: BranchId; name: string }[] = [
  { id: "RAIPUR", name: "Raipur" },
  { id: "JAGDALPUR", name: "Jagdalpur" },
  { id: "DURG", name: "Durg" },
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

export type TaskStatus = "pending" | "done";

/** Batch 2 fills in reminder behaviour; Batch 1 always writes "none". */
export type TaskRepeat = "none" | "every90" | "monthly";

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
  /** When the next reminder should go out (Batch 2 scheduler reads this). */
  nextReminderAt: string | null;
  remarks: Remark[];
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
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
