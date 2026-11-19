// Production Store over the Firestore REST API.
// Queries use at most one equality filter and no orderBy so no composite
// indexes are needed; remaining filters and sorting happen in memory,
// matching MemoryStore exactly.

import type { ChatMemory } from "../chat/types";
import type { Health, LoginGuard, NewTask, Session, Task, User } from "../domain/types";
import {
  createDoc,
  createIfAbsent,
  deleteDoc,
  getDoc,
  latestDoc,
  queryAtMost,
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
const SYSTEM = "system";
const WEBHOOK_LOG = "webhook_log";
export const CLAIMS = "claims";
export const CHAT_CTX = "chat_ctx";

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
    // "" (e.g. the "Bot" creator of health alert tasks) would address the collection itself.
    if (!phone) return null;
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
    if (!id) return null;
    const doc = await getDoc(this.cfg, TASKS, id);
    return doc ? toTask(doc) : null;
  }

  async updateTask(id: string, patch: Partial<NewTask>): Promise<void> {
    const { id: _ignored, ...rest } = patch as Partial<NewTask> & { id?: string };
    const fields = plain(rest);
    if (Object.keys(fields).length === 0) return;
    await patchDoc(this.cfg, TASKS, id, fields);
  }

  async deleteTask(id: string): Promise<void> {
    // "" would address the collection itself.
    if (!id) return;
    await deleteDoc(this.cfg, TASKS, id);
  }

  async listDueTasks(now: Date, limit: number): Promise<Task[]> {
    // nextReminderAt is always stored as toISOString(), so string order = time order; null (done,
    // cancelled, stopped) never matches a range filter.
    const docs = await queryAtMost(this.cfg, TASKS, "nextReminderAt", now.toISOString(), limit);
    return docs.map(toTask);
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

  // STUB (coordinator): agent A makes the save version-checked (Firestore updateTime precondition).
  async getChatMemory(phone: string): Promise<ChatMemory | null> {
    if (!phone) return null;
    const doc = await getDoc(this.cfg, CHAT_CTX, phone);
    return doc ? (doc.data as unknown as ChatMemory) : null;
  }

  async saveChatMemory(phone: string, memory: ChatMemory): Promise<boolean> {
    if (!phone) return false;
    const stored = await this.getChatMemory(phone);
    if ((stored?.v ?? 0) !== memory.v) return false;
    await setDoc(this.cfg, CHAT_CTX, phone, plain({ ...memory, v: memory.v + 1 }));
    return true;
  }

  async clearChatMemory(phone: string): Promise<void> {
    if (phone) await deleteDoc(this.cfg, CHAT_CTX, phone);
  }

  async claimOnce(key: string, now: Date, windowMs: number): Promise<boolean> {
    // Atomic create: of two simultaneous taps exactly one wins. Hashed id: keys may hold any characters.
    const id = await sha256Hex(key);
    const createdAt = now.toISOString();
    if (await createIfAbsent(this.cfg, CLAIMS, id, { createdAt })) return true;
    const doc = await getDoc(this.cfg, CLAIMS, id);
    const at = Date.parse(String(doc?.data.createdAt ?? ""));
    if (Number.isFinite(at) && now.getTime() - at < windowMs) return false;
    await setDoc(this.cfg, CLAIMS, id, { createdAt });
    return true;
  }

  async bumpDailyCount(key: string, now: Date): Promise<number> {
    // Same collection and hashed id as claimOnce; createdAt (ISO) lets the daily cleanup remove old counters.
    const id = await sha256Hex(key);
    const doc = await getDoc(this.cfg, CLAIMS, id);
    const was = Number(doc?.data.count);
    const count = (Number.isFinite(was) && was > 0 ? Math.floor(was) : 0) + 1;
    await setDoc(this.cfg, CLAIMS, id, { createdAt: doc && typeof doc.data.createdAt === "string" ? doc.data.createdAt : now.toISOString(), count });
    return count;
  }

  async getLoginGuard(key: string): Promise<LoginGuard | null> {
    const doc = await getDoc(this.cfg, LOGIN_GUARDS, key);
    return doc ? (doc.data as unknown as LoginGuard) : null;
  }

  async saveLoginGuard(guard: LoginGuard): Promise<void> {
    await setDoc(this.cfg, LOGIN_GUARDS, guard.key, plain(guard));
  }

  async getHealth(): Promise<Health | null> {
    const doc = await getDoc(this.cfg, SYSTEM, "health");
    return doc ? (doc.data as unknown as Health) : null;
  }

  async saveHealth(health: Health): Promise<void> {
    await setDoc(this.cfg, SYSTEM, "health", plain(health));
  }

  async latestWebhookAt(): Promise<Date | null> {
    const doc = await latestDoc(this.cfg, WEBHOOK_LOG, "loggedAt");
    const at = doc?.data.loggedAt;
    if (at instanceof Date) return at;
    return typeof at === "string" && !Number.isNaN(Date.parse(at)) ? new Date(at) : null;
  }
}

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
