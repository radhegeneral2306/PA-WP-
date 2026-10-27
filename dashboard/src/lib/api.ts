import { clearToken, getToken } from "./storage";
import type { ActorResponse, LoginResponse, MeResponse, TasksResponse, UsersResponse } from "./types";

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? "https://pa-wp-bot.radhegeneral2306.workers.dev";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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
    throw new ApiError(401, apiMsg || "Login zaroori hai");
  }
  if (res.status === 403 && authHandling && code === "need_name") {
    handlers.onNeedName();
    throw new ApiError(403, apiMsg);
  }
  if (res.status === 404) throw new ApiError(404, apiMsg || "Nahi mila");
  if (res.status >= 500) throw new ApiError(res.status, "Server mein dikkat hai. Dobara try karein.");
  throw new ApiError(res.status, apiMsg || "Kuch gadbad ho gayi. Dobara try karein.");
}

export const api = {
  login: (user: string, password: string) =>
    request<LoginResponse>("/api/login", { method: "POST", body: { user, password }, authHandling: false }),
  actor: (name: string) => request<ActorResponse>("/api/actor", { method: "POST", body: { name } }),
  me: () => request<MeResponse>("/api/me"),
  users: () => request<UsersResponse>("/api/users"),
  tasks: (view: "pending" | "archive") =>
    request<TasksResponse>(view === "pending" ? "/api/tasks?view=pending" : "/api/tasks?view=archive&limit=200"),
};

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return NETWORK_ERROR;
}
