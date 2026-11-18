export type BranchId = string;
export type TaskStatus = "pending" | "done" | "cancelled" | "deleted";
export type TaskRepeat = "none" | "every90" | "monthly" | "weekly";
/** The status a task had before it went to the recycle bin (restore goes back to it). */
export type DeletedFrom = "pending" | "done" | "cancelled";

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
  /** Round 3 (F5): sorted first, red mark. Older workers omit it (treat as false). */
  urgent?: boolean;
  /** Round 3 (F8): set while the task is in the recycle bin. Older workers omit them. */
  deletedAt?: string | null;
  deletedByName?: string | null;
  deletedFrom?: DeletedFrom | null;
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
  /** The admin picked on the login screen, when it is still an active admin. */
  name: string | null;
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
  /** Round 3: only the super admin may empty the recycle bin for good. Older workers omit it. */
  superAdmin?: boolean;
}

export interface TaskActionResponse {
  task: TaskDTO;
  /** Only for Done on a monthly or weekly task: the newly created next task. */
  next: TaskDTO | null;
}

export interface PurgeResponse {
  purged: true;
}

export type ExportStatus = "all" | "pending" | "done" | "cancelled";
