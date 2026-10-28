export type BranchId = string;
export type TaskStatus = "pending" | "done" | "cancelled";
export type TaskRepeat = "none" | "every90" | "monthly";

export interface Remark {
  at: string;
  byPhone: string;
  byName: string;
  text: string;
}

export interface DateRequest {
  dueAt: string;
  hasTime: boolean;
  remark: string;
  byPhone: string;
  byName: string;
  requestedAt: string;
}

export interface TaskDTO {
  id: string;
  title: string;
  assigneePhone: string;
  assigneeName: string;
  branch: BranchId | null;
  createdByPhone: string;
  createdByName: string;
  dueAt: string;
  dueHasTime: boolean;
  status: TaskStatus;
  repeat: TaskRepeat;
  repeatDay: number | null;
  nextReminderAt: string | null;
  lastReminderAt: string | null;
  dateRequest: DateRequest | null;
  /** "voice" when the bot made this task from a WhatsApp voice note. Older workers may omit it. */
  source?: "voice" | null;
  remarks: Remark[];
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  overdue: boolean;
  dueToday: boolean;
  closedAt: string | null;
  lastRemark: Remark | null;
}

export interface UserDTO {
  phone: string;
  name: string;
  role: "admin" | "staff";
  branch: BranchId | null;
}

export interface Branch {
  id: BranchId;
  name: string;
}

export interface UsersResponse {
  users: UserDTO[];
  branches: Branch[];
}

export interface TasksResponse {
  now: string;
  tasks: TaskDTO[];
}

export interface LoginResponse {
  token: string;
  admins: string[];
  sessionDays: number;
}

export interface ActorResponse {
  token: string;
  name: string;
}

export interface MeResponse {
  name: string | null;
  expiresAt: string;
  admins: string[];
}

export interface TaskActionResponse {
  task: TaskDTO;
  /** Only for Done on a monthly task: the newly created next-month task. */
  next: TaskDTO | null;
}
