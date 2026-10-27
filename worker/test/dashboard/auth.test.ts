import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { GLOBAL_MAX_FAILS, LOCK_MINUTES, MAX_FAILS, issueToken, login, verifyToken } from "../../src/dashboard/auth";
import { addRoutes, handleApi, json } from "../../src/dashboard/api";
import type { Env } from "../../src/env";
import { ADMIN, ADMIN2, NOW, USERS } from "../helpers/bot";

const env: Env = {
  WEBHOOK_SECRET: "w".repeat(48),
  INTERAKT_API_KEY: "k",
  FIREBASE_PROJECT_ID: "p",
  FIREBASE_CLIENT_EMAIL: "e",
  FIREBASE_PRIVATE_KEY: "k",
  DASHBOARD_USER: "radhe",
  DASHBOARD_PASSWORD: "correct horse battery",
  DASHBOARD_ORIGINS: "https://dash.example.pages.dev, https://other.example",
};
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe("dashboard login", () => {
  it("is disabled until a long enough password is configured", async () => {
    const store = new MemoryStore();
    expect(await login({ ...env, DASHBOARD_PASSWORD: undefined }, store, "1.1.1.1", "radhe", "x", NOW)).toMatchObject({ ok: false, status: 503 });
    expect(await login({ ...env, DASHBOARD_PASSWORD: "short" }, store, "1.1.1.1", "radhe", "short", NOW)).toMatchObject({ ok: false, status: 503 });
  });

  it("accepts the right ID and password only", async () => {
    const store = new MemoryStore();
    expect(await login(env, store, "1.1.1.1", "radhe", "wrong", NOW)).toMatchObject({ ok: false, status: 401 });
    expect(await login(env, store, "1.1.1.1", "RADHE", "correct horse battery", NOW)).toMatchObject({ ok: false, status: 401 });
    expect(await login(env, store, "1.1.1.1", "radhe", "correct horse battery", NOW)).toMatchObject({ ok: true });
  });

  it(`locks a client for ${LOCK_MINUTES} minutes after ${MAX_FAILS} wrong tries, even for the right password`, async () => {
    const store = new MemoryStore();
    for (let i = 0; i < MAX_FAILS; i++) await login(env, store, "2.2.2.2", "radhe", "nope", NOW);
    expect(await login(env, store, "2.2.2.2", "radhe", "correct horse battery", later(1))).toMatchObject({ ok: false, status: 429 });
    // another client is not affected
    expect(await login(env, store, "3.3.3.3", "radhe", "correct horse battery", later(1))).toMatchObject({ ok: true });
    expect(await login(env, store, "2.2.2.2", "radhe", "correct horse battery", later(LOCK_MINUTES + 1))).toMatchObject({ ok: true });
  });

  it("locks everyone after too many failures from many clients", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < GLOBAL_MAX_FAILS; i++) await login(env, store, `10.0.0.${i}`, "radhe", "nope", NOW);
    expect(await login(env, store, "9.9.9.9", "radhe", "correct horse battery", later(1))).toMatchObject({ ok: false, status: 429 });
  });

  it("does not store raw IP addresses", async () => {
    const store = new MemoryStore();
    await login(env, store, "2.2.2.2", "radhe", "nope", NOW);
    expect(JSON.stringify([...store.guards.values()])).not.toContain("2.2.2.2");
  });
});

describe("session tokens", () => {
  it("verify, expire after 30 days, and reject tampering", async () => {
    const token = await issueToken(env, "Bhaskar", NOW);
    expect(await verifyToken(env, `Bearer ${token}`, later(60))).toMatchObject({ name: "Bhaskar" });
    expect(await verifyToken(env, `Bearer ${token}`, later(31 * 24 * 60))).toBeNull();
    const [body, sig] = token.split(".");
    const forged = btoa(JSON.stringify({ name: "Nayan", iat: 0, exp: 9e9 })).replace(/=+$/, "");
    expect(await verifyToken(env, `Bearer ${forged}.${sig}`, NOW)).toBeNull();
    expect(await verifyToken(env, `Bearer ${body}.x${sig}`, NOW)).toBeNull();
    expect(await verifyToken(env, token, NOW)).toBeNull(); // no "Bearer "
  });

  it("stop working when the password changes", async () => {
    const token = await issueToken(env, null, NOW);
    expect(await verifyToken({ ...env, DASHBOARD_PASSWORD: "a brand new password" }, `Bearer ${token}`, NOW)).toBeNull();
  });
});

describe("/api", () => {
  const ORIGIN = "https://dash.example.pages.dev";
  const call = (store: MemoryStore, path: string, init: RequestInit & { token?: string; origin?: string | null } = {}) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (init.origin !== null) headers.Origin = init.origin ?? ORIGIN;
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    return handleApi(new Request(`https://w${path}`, { ...init, headers }), env, store, NOW, async () => undefined);
  };

  it("only answers the allowed dashboard origins", async () => {
    const store = new MemoryStore();
    expect((await call(store, "/api/me", { origin: "https://evil.example" })).status).toBe(403);
    const pre = await call(store, "/api/login", { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(pre.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    const res = await call(store, "/api/me");
    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("logs in, picks a name, and reports who is logged in", async () => {
    const store = new MemoryStore({ users: USERS });
    const bad = await call(store, "/api/login", { method: "POST", body: JSON.stringify({ user: "radhe", password: "x" }) });
    expect(bad.status).toBe(401);

    const res = await call(store, "/api/login", { method: "POST", body: JSON.stringify({ user: "radhe", password: "correct horse battery" }) });
    const { token, admins, sessionDays } = (await res.json()) as { token: string; admins: string[]; sessionDays: number };
    expect(admins).toEqual([ADMIN.name, ADMIN2.name]);
    expect(sessionDays).toBe(30);

    const notAdmin = await call(store, "/api/actor", { method: "POST", token, body: JSON.stringify({ name: "Hardware" }) });
    expect(notAdmin.status).toBe(400);
    const picked = (await (await call(store, "/api/actor", { method: "POST", token, body: JSON.stringify({ name: "Bhaskar" }) })).json()) as { token: string };
    const me = (await (await call(store, "/api/me", { token: picked.token })).json()) as { name: string };
    expect(me.name).toBe("Bhaskar");
  });

  it("requires a picked name for routes that change data", async () => {
    addRoutes([{ method: "POST", path: "/api/test-named", auth: "named", handler: async (ctx) => json({ by: ctx.session!.name }) }]);
    const store = new MemoryStore({ users: USERS });
    const unnamed = await issueToken(env, null, NOW);
    expect((await call(store, "/api/test-named", { method: "POST", token: unnamed, body: "{}" })).status).toBe(403);
    const named = await issueToken(env, "Bhaskar", NOW);
    const ok = await call(store, "/api/test-named", { method: "POST", token: named, body: "{}" });
    expect(await ok.json()).toEqual({ by: "Bhaskar" });
  });

  it("returns 404 for unknown routes and 400 for bad JSON", async () => {
    const store = new MemoryStore();
    expect((await call(store, "/api/nope")).status).toBe(404);
    expect((await call(store, "/api/login", { method: "POST", body: "{" })).status).toBe(400);
  });
});
