// Dashboard login: one shared ID + password (Cloudflare secrets), lockout after
// repeated failures, and signed 30-day session tokens.
//
// Tokens are HMAC-signed with a key derived from WEBHOOK_SECRET + the dashboard
// credentials, so changing the password logs every device out.

import type { Env } from "../env";
import type { Store } from "../data/store";
import type { LoginGuard } from "../domain/types";
import { safeEqual } from "../interakt/signature";

export const SESSION_DAYS = 30;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_FAILS = 5;
export const LOCK_MINUTES = 15;
/** Failures from all clients together before everyone is locked out for a while. */
export const GLOBAL_MAX_FAILS = 30;
const WINDOW_MINUTES = 15;

export interface DashSession {
  /** Admin name picked after login ("Aap kaun ho?"); null until picked. */
  name: string | null;
  iat: number;
  exp: number;
}

export type LoginResult = { ok: true; token: string } | { ok: false; status: number; error: string };

const enc = new TextEncoder();

export function dashboardConfigured(env: Env): boolean {
  return Boolean(env.DASHBOARD_USER && env.DASHBOARD_PASSWORD && env.DASHBOARD_PASSWORD.length >= MIN_PASSWORD_LENGTH);
}

export async function login(env: Env, store: Store, clientIp: string, user: string, password: string, now: Date): Promise<LoginResult> {
  if (!dashboardConfigured(env)) {
    return { ok: false, status: 503, error: "Dashboard login set nahi hai (DASHBOARD_USER / DASHBOARD_PASSWORD, kam se kam 12 characters)." };
  }
  const ipKey = `ip-${(await sha256Hex(clientIp)).slice(0, 32)}`;
  for (const key of [ipKey, "global"]) {
    const g = await store.getLoginGuard(key);
    if (g?.lockedUntil && Date.parse(g.lockedUntil) > now.getTime()) {
      return { ok: false, status: 429, error: "Bahut baar galat password. Thodi der baad try karein." };
    }
  }

  const userOk = await sameSecret(user, env.DASHBOARD_USER!);
  const passOk = await sameSecret(password, env.DASHBOARD_PASSWORD!);
  if (!userOk || !passOk) {
    await recordFailure(store, ipKey, MAX_FAILS, now);
    await recordFailure(store, "global", GLOBAL_MAX_FAILS, now);
    console.warn("Dashboard login failed", ipKey.slice(0, 11));
    return { ok: false, status: 401, error: "ID ya password galat hai." };
  }
  await store.saveLoginGuard({ key: ipKey, fails: 0, windowStart: now.toISOString(), lockedUntil: null });
  return { ok: true, token: await issueToken(env, null, now) };
}

async function recordFailure(store: Store, key: string, max: number, now: Date): Promise<void> {
  const g = await store.getLoginGuard(key);
  const windowOpen = g && now.getTime() - Date.parse(g.windowStart) < WINDOW_MINUTES * 60_000;
  const next: LoginGuard = windowOpen
    ? { ...g, fails: g.fails + 1 }
    : { key, fails: 1, windowStart: now.toISOString(), lockedUntil: null };
  if (next.fails >= max) next.lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString();
  await store.saveLoginGuard(next);
}

export async function issueToken(env: Env, name: string | null, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  const session: DashSession = { name, iat, exp: iat + SESSION_DAYS * 86_400 };
  const body = b64url(enc.encode(JSON.stringify(session)));
  return `${body}.${await sign(env, body)}`;
}

/** Returns the session for a valid, unexpired token from an "Authorization: Bearer" header. */
export async function verifyToken(env: Env, header: string | null, now: Date): Promise<DashSession | null> {
  if (!dashboardConfigured(env) || !header?.startsWith("Bearer ")) return null;
  const [body, sig] = header.slice(7).trim().split(".");
  if (!body || !sig || !safeEqual(sig, await sign(env, body))) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(fromB64url(body))) as DashSession;
    if (typeof s.exp !== "number" || s.exp * 1000 <= now.getTime()) return null;
    return { name: typeof s.name === "string" ? s.name : null, iat: s.iat, exp: s.exp };
  } catch {
    return null;
  }
}

async function sign(env: Env, data: string): Promise<string> {
  const seed = `dashboard-session:${env.DASHBOARD_USER}:${env.DASHBOARD_PASSWORD}`;
  const keyBytes = await hmac(enc.encode(env.WEBHOOK_SECRET), enc.encode(seed));
  return b64url(await hmac(keyBytes, enc.encode(data)));
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/** Compares digests so neither length nor content leaks through timing. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  return safeEqual(await sha256Hex(given), await sha256Hex(expected));
}

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
