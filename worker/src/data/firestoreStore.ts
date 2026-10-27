// Production Store over the Firestore REST API.
// Queries use at most one equality filter and no orderBy so no composite
// indexes are needed; remaining filters and sorting happen in memory,
// matching MemoryStore exactly.

import type { LoginGuard, NewTask, Session, Task, User } from "../domain/types";
import {
  createDoc,
  deleteDoc,
  getDoc,
  patchDoc,
  queryDocs,
  setDoc,
  type Doc,
  type EqualityFilter,
  type FirestoreConfig,
  type Plain,
} from "../firebase/firestore";
import type { Store, TaskFilter, UserFilter } from "./store";

const USERS = "users";
const TASKS = "tasks";
const SESSIONS = "sessions";
const LOGIN_GUARDS = "login_guards";

type Fields = { [k: string]: Plain };

/** Our domain objects hold only Plain-compatible values; drops undefined keys. */
function plain(obj: object): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v as Plain;
  return out;
}

function toTask(doc: Doc): Task {
  const { id: _ignored, ...data } = doc.data;
  return { ...(data as unknown as NewTask), id: doc.id };
}

/** Most selective filter first. */
function taskQuery(f: TaskFilter): EqualityFilter | undefined {
  if (f.assigneePhone) return { field: "assigneePhone", value: f.assigneePhone };
  if (f.createdByPhone) return { field: "createdByPhone", value: f.createdByPhone };
  if (f.branch) return { field: "branch", value: f.branch };
  if (f.status) return { field: "status", value: f.status };
  return undefined;
}

function userQuery(f: UserFilter): EqualityFilter | undefined {
  if (f.branch) return { field: "branch", value: f.branch };
  if (f.role) return { field: "role", value: f.role };
  return undefined;
}

export class FirestoreStore implements Store {
  constructor(private cfg: FirestoreConfig) {}

  async getUser(phone: string): Promise<User | null> {
    const doc = await getDoc(this.cfg, USERS, phone);
    return doc ? (doc.data as unknown as User) : null;
  }

  async listUsers(filter: UserFilter = {}): Promise<User[]> {
    const activeOnly = filter.activeOnly ?? true;
    const docs = await queryDocs(this.cfg, USERS, userQuery(filter));
    return docs
      .map((d) => d.data as unknown as User)
      .filter((u) => (!activeOnly || u.active) && (!filter.branch || u.branch === filter.branch) && (!filter.role || u.role === filter.role))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveUser(user: User): Promise<void> {
    await setDoc(this.cfg, USERS, user.phone, plain(user));
  }

  async createTask(task: NewTask): Promise<Task> {
    const { id: _ignored, ...data } = task as NewTask & { id?: string };
    const id = await createDoc(this.cfg, TASKS, plain(data));
    return { ...structuredClone(data), id };
  }

  async getTask(id: string): Promise<Task | null> {
    const doc = await getDoc(this.cfg, TASKS, id);
    return doc ? toTask(doc) : null;
  }

  async updateTask(id: string, patch: Partial<NewTask>): Promise<void> {
    const { id: _ignored, ...rest } = patch as Partial<NewTask> & { id?: string };
    const fields = plain(rest);
    if (Object.keys(fields).length === 0) return;
    await patchDoc(this.cfg, TASKS, id, fields);
  }

  async listTasks(filter: TaskFilter): Promise<Task[]> {
    const docs = await queryDocs(this.cfg, TASKS, taskQuery(filter));
    return docs
      .map(toTask)
      .filter(
        (t) =>
          (!filter.assigneePhone || t.assigneePhone === filter.assigneePhone) &&
          (!filter.createdByPhone || t.createdByPhone === filter.createdByPhone) &&
          (!filter.branch || t.branch === filter.branch) &&
          (!filter.status || t.status === filter.status),
      )
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }

  async getSession(phone: string): Promise<Session | null> {
    const doc = await getDoc(this.cfg, SESSIONS, phone);
    return doc ? (doc.data as unknown as Session) : null;
  }

  async saveSession(session: Session): Promise<void> {
    await setDoc(this.cfg, SESSIONS, session.phone, plain(session));
  }

  async clearSession(phone: string): Promise<void> {
    await deleteDoc(this.cfg, SESSIONS, phone);
  }

  async getLoginGuard(key: string): Promise<LoginGuard | null> {
    const doc = await getDoc(this.cfg, LOGIN_GUARDS, key);
    return doc ? (doc.data as unknown as LoginGuard) : null;
  }

  async saveLoginGuard(guard: LoginGuard): Promise<void> {
    await setDoc(this.cfg, LOGIN_GUARDS, guard.key, plain(guard));
  }
}
