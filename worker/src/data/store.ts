// Storage contract. FirestoreStore (production) and MemoryStore (tests)
// both implement it; bot code only ever sees this interface.

import type { ChatMemory } from "../chat/types";
import type { BranchId, Health, LoginGuard, NewTask, Role, Session, Task, TaskStatus, User } from "../domain/types";

export interface UserFilter {
  branch?: BranchId;
  role?: Role;
  /** Default true: inactive (removed) users are skipped. */
  activeOnly?: boolean;
}

export interface TaskFilter {
  assigneePhone?: string;
  createdByPhone?: string;
  branch?: BranchId;
  status?: TaskStatus;
}

export interface Store {
  getUser(phone: string): Promise<User | null>;
  /** Sorted by name. */
  listUsers(filter?: UserFilter): Promise<User[]>;
  /** Create or replace (doc id = phone). */
  saveUser(user: User): Promise<void>;

  createTask(task: NewTask): Promise<Task>;
  getTask(id: string): Promise<Task | null>;
  /** Shallow merge of the given fields. Callers set updatedAt themselves. */
  updateTask(id: string, patch: Partial<NewTask>): Promise<void>;
  /** Removes the task for good (recycle bin purge). A missing task is not an error. */
  deleteTask(id: string): Promise<void>;
  /** Sorted by dueAt ascending. */
  listTasks(filter: TaskFilter): Promise<Task[]>;
  /**
   * Tasks whose nextReminderAt is at or before `now`, oldest first, at most `limit`.
   * One range query (automatic single-field index) instead of reading every pending task
   * on each 5-minute run (Firestore free tier: 50k reads/day). May include stale non-pending
   * tasks; callers re-check the status.
   */
  listDueTasks(now: Date, limit: number): Promise<Task[]>;

  getSession(phone: string): Promise<Session | null>;
  saveSession(session: Session): Promise<void>;
  clearSession(phone: string): Promise<void>;

  getLoginGuard(key: string): Promise<LoginGuard | null>;
  saveLoginGuard(guard: LoginGuard): Promise<void>;
  /** system/health; null before the first problem or check. */
  getHealth(): Promise<Health | null>;
  saveHealth(health: Health): Promise<void>;
  /** loggedAt of the newest webhook_log entry (any incoming message), or null if none. */
  latestWebhookAt(): Promise<Date | null>;
  /**
   * Chat memory of one person (Round 7). `saveChatMemory` returns false (and writes nothing) when the stored
   * version is not `memory.v` (another message was faster); on success the stored version becomes `memory.v + 1`.
   */
  getChatMemory(phone: string): Promise<ChatMemory | null>;
  saveChatMemory(phone: string, memory: ChatMemory): Promise<boolean>;
  clearChatMemory(phone: string): Promise<void>;
  /**
   * Records `key` once (audit C4/F1: double taps, a form sent twice). Returns false when the same
   * key was already recorded less than `windowMs` ago; an older record is renewed and counts as new.
   */
  claimOnce(key: string, now: Date, windowMs: number): Promise<boolean>;
  /**
   * Round 5: counts one more AI chat message for `key` (e.g. `ai:<phone>:<IST date>`) and returns the new
   * count. A quota, not a lock: a simple read-then-write is enough. Stored in the `claims` collection so
   * the daily cleanup removes old counters.
   */
  bumpDailyCount(key: string, now: Date): Promise<number>;
}
