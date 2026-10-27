// In-memory Store for tests and local experiments.

import type { LoginGuard, NewTask, Session, Task, User } from "../domain/types";
import type { Store, TaskFilter, UserFilter } from "./store";

export class MemoryStore implements Store {
  users = new Map<string, User>();
  tasks = new Map<string, Task>();
  sessions = new Map<string, Session>();
  guards = new Map<string, LoginGuard>();
  private seq = 0;

  constructor(seed: { users?: User[]; tasks?: Task[] } = {}) {
    for (const u of seed.users ?? []) this.users.set(u.phone, structuredClone(u));
    for (const t of seed.tasks ?? []) this.tasks.set(t.id, structuredClone(t));
  }

  async getUser(phone: string) {
    const u = this.users.get(phone);
    return u ? structuredClone(u) : null;
  }

  async listUsers(filter: UserFilter = {}) {
    const activeOnly = filter.activeOnly ?? true;
    return [...this.users.values()]
      .filter((u) => (!activeOnly || u.active) && (!filter.branch || u.branch === filter.branch) && (!filter.role || u.role === filter.role))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((u) => structuredClone(u));
  }

  async saveUser(user: User) {
    this.users.set(user.phone, structuredClone(user));
  }

  async createTask(task: NewTask) {
    const created: Task = { ...structuredClone(task), id: `t${++this.seq}` };
    this.tasks.set(created.id, created);
    return structuredClone(created);
  }

  async getTask(id: string) {
    const t = this.tasks.get(id);
    return t ? structuredClone(t) : null;
  }

  async updateTask(id: string, patch: Partial<NewTask>) {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task ${id} not found`);
    this.tasks.set(id, { ...t, ...structuredClone(patch) });
  }

  async listTasks(filter: TaskFilter) {
    return [...this.tasks.values()]
      .filter(
        (t) =>
          (!filter.assigneePhone || t.assigneePhone === filter.assigneePhone) &&
          (!filter.createdByPhone || t.createdByPhone === filter.createdByPhone) &&
          (!filter.branch || t.branch === filter.branch) &&
          (!filter.status || t.status === filter.status),
      )
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
      .map((t) => structuredClone(t));
  }

  async getSession(phone: string) {
    const s = this.sessions.get(phone);
    return s ? structuredClone(s) : null;
  }

  async saveSession(session: Session) {
    this.sessions.set(session.phone, structuredClone(session));
  }

  async clearSession(phone: string) {
    this.sessions.delete(phone);
  }

  async getLoginGuard(key: string) {
    const g = this.guards.get(key);
    return g ? structuredClone(g) : null;
  }

  async saveLoginGuard(guard: LoginGuard) {
    this.guards.set(guard.key, structuredClone(guard));
  }
}
