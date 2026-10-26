// Storage contract. FirestoreStore (production) and MemoryStore (tests)
// both implement it; bot code only ever sees this interface.

import type { BranchId, NewTask, Role, Session, Task, TaskStatus, User } from "../domain/types";

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
  /** Sorted by dueAt ascending. */
  listTasks(filter: TaskFilter): Promise<Task[]>;

  getSession(phone: string): Promise<Session | null>;
  saveSession(session: Session): Promise<void>;
  clearSession(phone: string): Promise<void>;
}
