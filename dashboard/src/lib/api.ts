import { clearToken, getToken } from "./storage";
import { exportFilename, exportPath, filenameFromDisposition } from "./export";
import type { ActorResponse, ExportStatus, LoginResponse, MeResponse, PurgeResponse, TaskActionResponse, TaskRepeat, TasksResponse, UsersResponse } from "./types";

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? "https://pa-wp-bot.radhegeneral2306.workers.dev";

export class ApiError extends Error {
  status: number;
  /** The API's machine-readable `code` ("task_closed", "bad_request", ...), "" when missing. */
  code: string;
  constructor(status: number, message: string, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Handlers = { onUnauthorized: (msg: string) => void; onNeedName: () => void };
let handlers: Handlers = { onUnauthorized: () => {}, onNeedName: () => {} };
export function setAuthHandlers(h: Handlers): void {
  handlers = h;
}

export const NETWORK_ERROR = "Server se connect nahi ho paya. Dobara try karein.";

interface Options {
  method?: "GET" | "POST";
  body?: unknown;
  /** false for login: a 401 there means wrong password, not an expired session. */
  authHandling?: boolean;
}

export async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, authHandling = true } = opts;
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, NETWORK_ERROR);
  }

  const data = await readJson(res);
  if (res.ok) return data as T;
  throw failure(res.status, data, authHandling);
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Turns an error response into an ApiError (and runs the 401 / need_name handlers). */
function failure(status: number, data: unknown, authHandling: boolean): ApiError {
  const errBody = (data && typeof data === "object" ? data : {}) as { error?: unknown; code?: unknown };
  const apiMsg = typeof errBody.error === "string" ? errBody.error : "";
  const code = typeof errBody.code === "string" ? errBody.code : "";

  if (status === 401 && authHandling) {
    clearToken();
    handlers.onUnauthorized("Session khatam ho gaya. Dobara login karein.");
    return new ApiError(401, apiMsg || "Login zaroori hai", code);
  }
  if (status === 403 && authHandling && code === "need_name") {
    handlers.onNeedName();
    return new ApiError(403, apiMsg || "Pehle apna naam chuniye", code);
  }
  if (status === 403 && code === "super_admin_only") return new ApiError(403, apiMsg || "Ye sirf super admin kar sakte hain.", code);
  if (status === 404) return new ApiError(404, apiMsg || "Nahi mila", code);
  // Setup problems (e.g. password shorter than 12) come with a clear reason; show it instead of a generic error.
  if (status === 503 && code === "not_configured") return new ApiError(503, apiMsg || "Dashboard login set nahi hai.", code);
  if (status >= 500) return new ApiError(status, "Server mein dikkat hai. Dobara try karein.", code);
  return new ApiError(status, apiMsg || "Kuch gadbad ho gayi. Dobara try karein.", code);
}

/** F9: the CSV comes as a file, not JSON, so it gets its own fetch (same auth header and error handling). */
async function exportCsv(from: string, to: string, status: ExportStatus): Promise<{ blob: Blob; filename: string }> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(API_BASE + exportPath(from, to, status), { method: "GET", headers, cache: "no-store" });
  } catch {
    throw new ApiError(0, NETWORK_ERROR);
  }
  if (!res.ok) throw failure(res.status, await readJson(res), true);
  let blob: Blob;
  try {
    blob = await res.blob();
  } catch {
    throw new ApiError(0, NETWORK_ERROR);
  }
  const filename = filenameFromDisposition(res.headers.get("Content-Disposition")) ?? exportFilename(from, to);
  return { blob, filename };
}

export const api = {
  loginNames: () => request<{ admins: string[] }>("/api/login-names", { authHandling: false }),
  login: (password: string, name: string | null) =>
    request<LoginResponse>("/api/login", { method: "POST", body: name ? { password, name } : { password }, authHandling: false }),
  actor: (name: string) => request<ActorResponse>("/api/actor", { method: "POST", body: { name } }),
  me: () => request<MeResponse>("/api/me"),
  users: () => request<UsersResponse>("/api/users"),
  tasks: (view: "pending" | "archive" | "bin") =>
    request<TasksResponse>(view === "pending" ? "/api/tasks?view=pending" : `/api/tasks?view=${view}&limit=200`),

  // Phase 4 write actions. All return { task, next } (next only for a monthly Done).
  done: (id: string) => request<TaskActionResponse>(`${taskPath(id)}/done`, { method: "POST", body: {} }),
  remark: (id: string, text: string) => request<TaskActionResponse>(`${taskPath(id)}/remark`, { method: "POST", body: { text } }),
  changeDue: (id: string, date: string, time: string | null, remark?: string) =>
    request<TaskActionResponse>(`${taskPath(id)}/due`, {
      method: "POST",
      body: remark && remark.trim() ? { date, time, remark: remark.trim() } : { date, time },
    }),
  assign: (id: string, phone: string) => request<TaskActionResponse>(`${taskPath(id)}/assign`, { method: "POST", body: { phone } }),
  cancel: (id: string) => request<TaskActionResponse>(`${taskPath(id)}/cancel`, { method: "POST", body: {} }),
  /** "Naya task" from the dashboard. */
  createTask: (body: { title: string; assigneePhone: string; date: string; time: string | null; repeat: TaskRepeat; urgent: boolean }) =>
    request<TaskActionResponse>("/api/tasks", { method: "POST", body }),
  /** Staff date request (Phase 6). requestedAt makes the server refuse a request that was replaced meanwhile. */
  approveDate: (id: string, requestedAt: string) => request<TaskActionResponse>(`${taskPath(id)}/approve`, { method: "POST", body: { requestedAt } }),
  rejectDate: (id: string, requestedAt: string) => request<TaskActionResponse>(`${taskPath(id)}/reject`, { method: "POST", body: { requestedAt } }),
  /** Cancelled task back to pending with a new date (Archive only). */
  reopen: (id: string, date: string, time: string | null, remark?: string) =>
    request<TaskActionResponse>(`${taskPath(id)}/reopen`, {
      method: "POST",
      body: remark && remark.trim() ? { date, time, remark: remark.trim() } : { date, time },
    }),

  // Round 3. No WhatsApp goes out for any of these.
  /** F5: mark or unmark urgent (not for deleted tasks). */
  setUrgent: (id: string, urgent: boolean) => request<TaskActionResponse>(`${taskPath(id)}/urgent`, { method: "POST", body: { urgent } }),
  /** F8: soft delete into the recycle bin (409 task_closed when already there). */
  deleteTask: (id: string) => request<TaskActionResponse>(`${taskPath(id)}/delete`, { method: "POST", body: {} }),
  /** F8: back to the status it had. A pending task whose due has passed needs a new date (400 need_date). */
  restoreTask: (id: string, date?: string, time?: string | null) =>
    request<TaskActionResponse>(`${taskPath(id)}/restore`, { method: "POST", body: date ? (time ? { date, time } : { date }) : {} }),
  /** F8: super admin only, tasks already in the bin. */
  purgeTask: (id: string) => request<PurgeResponse>(`${taskPath(id)}/purge`, { method: "POST", body: {} }),
  /** F9: CSV for Excel. */
  exportCsv,
};

function taskPath(id: string): string {
  return `/api/tasks/${encodeURIComponent(id)}`;
}

/** 409 task_closed: the task was done or cancelled elsewhere (WhatsApp, another admin). */
export function isTaskClosed(e: unknown): boolean {
  return e instanceof ApiError && (e.code === "task_closed" || e.status === 409);
}

/** 400 need_date from restore: the task's due has passed, a new date is required. */
export function isNeedDate(e: unknown): boolean {
  return e instanceof ApiError && e.code === "need_date";
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return NETWORK_ERROR;
}
