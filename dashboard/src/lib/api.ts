import { clearToken, getToken } from "./storage";
import type { ActorResponse, LoginResponse, MeResponse, TaskActionResponse, TasksResponse, UsersResponse } from "./types";

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

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (res.ok) return data as T;

  const errBody = (data && typeof data === "object" ? data : {}) as { error?: unknown; code?: unknown };
  const apiMsg = typeof errBody.error === "string" ? errBody.error : "";
  const code = typeof errBody.code === "string" ? errBody.code : "";

  if (res.status === 401 && authHandling) {
    clearToken();
    handlers.onUnauthorized("Session khatam ho gaya. Dobara login karein.");
    throw new ApiError(401, apiMsg || "Login zaroori hai", code);
  }
  if (res.status === 403 && authHandling && code === "need_name") {
    handlers.onNeedName();
    throw new ApiError(403, apiMsg || "Pehle apna naam chuniye", code);
  }
  if (res.status === 404) throw new ApiError(404, apiMsg || "Nahi mila", code);
  if (res.status >= 500) throw new ApiError(res.status, "Server mein dikkat hai. Dobara try karein.", code);
  throw new ApiError(res.status, apiMsg || "Kuch gadbad ho gayi. Dobara try karein.", code);
}

export const api = {
  login: (user: string, password: string) =>
    request<LoginResponse>("/api/login", { method: "POST", body: { user, password }, authHandling: false }),
  actor: (name: string) => request<ActorResponse>("/api/actor", { method: "POST", body: { name } }),
  me: () => request<MeResponse>("/api/me"),
  users: () => request<UsersResponse>("/api/users"),
  tasks: (view: "pending" | "archive") =>
    request<TasksResponse>(view === "pending" ? "/api/tasks?view=pending" : "/api/tasks?view=archive&limit=200"),

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
  /** Staff date request (Phase 6). requestedAt makes the server refuse a request that was replaced meanwhile. */
  approveDate: (id: string, requestedAt: string) => request<TaskActionResponse>(`${taskPath(id)}/approve`, { method: "POST", body: { requestedAt } }),
  rejectDate: (id: string, requestedAt: string) => request<TaskActionResponse>(`${taskPath(id)}/reject`, { method: "POST", body: { requestedAt } }),
  /** Cancelled task back to pending with a new date (Archive only). */
  reopen: (id: string, date: string, time: string | null, remark?: string) =>
    request<TaskActionResponse>(`${taskPath(id)}/reopen`, {
      method: "POST",
      body: remark && remark.trim() ? { date, time, remark: remark.trim() } : { date, time },
    }),
};

function taskPath(id: string): string {
  return `/api/tasks/${encodeURIComponent(id)}`;
}

/** 409 task_closed: the task was done or cancelled elsewhere (WhatsApp, another admin). */
export function isTaskClosed(e: unknown): boolean {
  return e instanceof ApiError && (e.code === "task_closed" || e.status === 409);
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return NETWORK_ERROR;
}
