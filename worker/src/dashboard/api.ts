// /api/* for the dashboard (Cloudflare Pages app on another origin).
// Every route except /api/login needs a valid session token; routes that change
// data also need the admin name picked after login (used in remarks).

import type { Env } from "../env";
import type { Store } from "../data/store";
import type { Outgoing } from "../bot/outgoing";
import { SESSION_DAYS, issueToken, login, verifyToken, type DashSession } from "./auth";
import { matchWriteRoute } from "./routes/write";

export type Deliver = (outs: Outgoing[]) => Promise<void>;

export interface ApiContext {
  env: Env;
  store: Store;
  now: Date;
  deliver: Deliver;
  request: Request;
  session: DashSession | null;
}

export type Handler = (ctx: ApiContext, body: unknown) => Promise<Response>;

export interface Route {
  method: string;
  path: string;
  auth: "none" | "session" | "named";
  handler: Handler;
}

const ROUTES: Route[] = [
  { method: "POST", path: "/api/login", auth: "none", handler: postLogin },
  { method: "GET", path: "/api/me", auth: "session", handler: getMe },
  { method: "POST", path: "/api/actor", auth: "session", handler: postActor },
];

/** Lets later phases add routes (tasks, approvals) without touching the plumbing. */
export function addRoutes(routes: Route[]): void {
  ROUTES.push(...routes);
}

export async function handleApi(request: Request, env: Env, store: Store, now: Date, deliver: Deliver): Promise<Response> {
  const origin = request.headers.get("Origin");
  const cors = corsHeaders(env, origin);
  if (origin && !cors) return json({ error: "Ye website allowed nahi hai", code: "origin_not_allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors ?? {} });

  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  const route = ROUTES.find((r) => r.path === path && r.method === request.method) ?? matchWriteRoute(request.method, path)?.route;
  if (!route) return json({ error: "Nahi mila", code: "not_found" }, 404, cors);

  const session = await verifyToken(env, request.headers.get("Authorization"), now);
  if (route.auth !== "none" && !session) return json({ error: "Login zaroori hai", code: "login_required" }, 401, cors);
  if (route.auth === "named" && !session?.name) return json({ error: "Pehle apna naam chuniye", code: "need_name" }, 403, cors);

  let body: unknown = null;
  if (request.method !== "GET") {
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request samajh nahi aayi", code: "bad_request" }, 400, cors);
    }
  }
  try {
    const res = await route.handler({ env, store, now, deliver, request, session }, body);
    for (const [k, v] of Object.entries(cors ?? {})) res.headers.set(k, v);
    return res;
  } catch (err) {
    console.error("API error", route.path, err);
    return json({ error: "Server mein dikkat aayi. Dobara try karein.", code: "server_error" }, 500, cors);
  }
}

export function json(data: unknown, status = 200, extra: Record<string, string> | null = null): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...(extra ?? {}) } });
}

/** CORS for an allowed origin only (never "*"); null when the origin isn't allowed. */
function corsHeaders(env: Env, origin: string | null): Record<string, string> | null {
  if (!origin) return null;
  const allowed = (env.DASHBOARD_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

async function activeAdminNames(store: Store): Promise<string[]> {
  return (await store.listUsers({ role: "admin" })).map((u) => u.name);
}

async function postLogin(ctx: ApiContext, body: unknown): Promise<Response> {
  const { user, password } = (body ?? {}) as { user?: unknown; password?: unknown };
  if (typeof user !== "string" || typeof password !== "string") return json({ error: "ID aur password dono chahiye" }, 400);
  const ip = ctx.request.headers.get("CF-Connecting-IP") ?? "unknown";
  const result = await login(ctx.env, ctx.store, ip, user, password, ctx.now);
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json({ token: result.token, admins: await activeAdminNames(ctx.store), sessionDays: SESSION_DAYS });
}

async function getMe(ctx: ApiContext): Promise<Response> {
  const s = ctx.session!;
  const admins = await activeAdminNames(ctx.store);
  // A name picked before that admin was removed or renamed no longer counts: ask "Aap kaun ho?" again.
  const name = s.name && admins.includes(s.name) ? s.name : null;
  return json({ name, expiresAt: new Date(s.exp * 1000).toISOString(), admins });
}

/** "Aap kaun ho?": re-issues the token with the picked admin name. */
async function postActor(ctx: ApiContext, body: unknown): Promise<Response> {
  const { name } = (body ?? {}) as { name?: unknown };
  const admins = await activeAdminNames(ctx.store);
  if (typeof name !== "string" || !admins.includes(name)) return json({ error: "Ye naam admin list mein nahi hai" }, 400);
  return json({ token: await issueToken(ctx.env, name, ctx.now), name });
}
