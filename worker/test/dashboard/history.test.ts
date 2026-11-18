import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { issueToken } from "../../src/dashboard/auth";
import { addRoutes, handleApi } from "../../src/dashboard/api";
import { readRoutes } from "../../src/dashboard/routes/read";
import { matchHistoryRoute } from "../../src/dashboard/routes/history";
import { matchWriteRoute } from "../../src/dashboard/routes/write";
import type { Env } from "../../src/env";
import { ADMIN, NOW, STAFF_DURG, USERS, task } from "../helpers/bot";

const env: Env = {
  WEBHOOK_SECRET: "w".repeat(48),
  INTERAKT_API_KEY: "k",
  FIREBASE_PROJECT_ID: "p",
  FIREBASE_CLIENT_EMAIL: "e",
  FIREBASE_PRIVATE_KEY: "k",
  DASHBOARD_USER: "radhe",
  DASHBOARD_PASSWORD: "correct horse battery",
};
addRoutes(readRoutes);

async function call(store: MemoryStore, path: string, opts: { token?: boolean; method?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token !== false) headers.Authorization = `Bearer ${await issueToken(env, ADMIN.name, NOW)}`;
  return handleApi(new Request(`https://w${path}`, { method: opts.method ?? "GET", headers }), env, store, NOW, async () => undefined);
}

const rem = (at: string, text: string, byName = ADMIN.name) => ({ at, byPhone: ADMIN.phone, byName, text });
const hist = async (store: MemoryStore, id = "task1") => {
  const res = await call(store, `/api/tasks/${id}/history`);
  expect(res.status).toBe(200);
  return res.json() as Promise<{ task: Record<string, unknown>; events: { at: string; kind: string; by: string | null; text: string }[] }>;
};

describe("GET /api/tasks/:id/history routing", () => {
  it("matches only GET .../history and does not clash with write actions or the list", () => {
    expect(matchHistoryRoute("GET", "/api/tasks/abc/history")?.id).toBe("abc");
    expect(matchHistoryRoute("POST", "/api/tasks/abc/history")).toBeNull();
    expect(matchHistoryRoute("GET", "/api/tasks/abc/done")).toBeNull();
    expect(matchHistoryRoute("GET", "/api/tasks")).toBeNull();
    expect(matchHistoryRoute("GET", "/api/tasks/a%2Fb/history")).toBeNull();
    expect(matchWriteRoute("POST", "/api/tasks/abc/history")).toBeNull();
    expect(matchWriteRoute("GET", "/api/tasks/abc/done")).toBeNull();
  });

  it("POST history is 404 and existing list route still works", async () => {
    const store = new MemoryStore({ users: USERS, tasks: [task()] });
    expect((await call(store, "/api/tasks/task1/history", { method: "POST" })).status).toBe(404);
    expect((await call(store, "/api/tasks?view=pending")).status).toBe(200);
  });

  it("needs a session", async () => {
    const store = new MemoryStore({ users: USERS, tasks: [task()] });
    const res = await call(store, "/api/tasks/task1/history", { token: false });
    expect(res.status).toBe(401);
  });

  it("unknown id is 404 not_found", async () => {
    const res = await call(new MemoryStore({ users: USERS }), "/api/tasks/nope/history");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("not_found");
  });
});

describe("history events", () => {
  it("pending task with no remarks: just created", async () => {
    const body = await hist(new MemoryStore({ users: USERS, tasks: [task()] }));
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ kind: "created", by: ADMIN.name, text: "Task bana" });
    expect(Object.keys(body.task).sort()).toEqual(
      ["assigneeName", "createdAt", "createdByName", "dueAt", "dueHasTime", "id", "status", "title"],
    );
  });

  it("remarks keep author and text, oldest first", async () => {
    const t = task({
      createdAt: "2026-10-20T05:00:00.000Z",
      remarks: [rem("2026-10-21T05:00:00.000Z", "pehla"), rem("2026-10-22T05:00:00.000Z", "doosra", "Pinky")],
    });
    const body = await hist(new MemoryStore({ users: USERS, tasks: [t] }));
    expect(body.events.map((e) => e.kind)).toEqual(["created", "remark", "remark"]);
    expect(body.events[1]).toMatchObject({ by: ADMIN.name, text: "pehla" });
    expect(body.events[2]).toMatchObject({ by: "Pinky", text: "doosra" });
  });

  it("done task ends with done", async () => {
    const t = task({
      status: "done",
      createdAt: "2026-10-20T05:00:00.000Z",
      remarks: [rem("2026-10-21T05:00:00.000Z", "ho gaya")],
      doneAt: "2026-10-22T05:00:00.000Z",
    });
    const body = await hist(new MemoryStore({ users: USERS, tasks: [t] }));
    expect(body.events.map((e) => e.kind)).toEqual(["created", "remark", "done"]);
    expect(body.task.status).toBe("done");
  });

  it("cancelled task shows who cancelled", async () => {
    const t = task({ status: "cancelled", createdAt: "2026-10-20T05:00:00.000Z", cancelledAt: "2026-10-23T05:00:00.000Z", cancelledByName: "Pinky" });
    const body = await hist(new MemoryStore({ users: USERS, tasks: [t] }));
    expect(body.events.map((e) => e.kind)).toEqual(["created", "cancelled"]);
    expect(body.events[1].by).toBe("Pinky");
  });

  it("deleted task (from done) shows done then deleted", async () => {
    const t = task({
      status: "deleted",
      deletedFrom: "done",
      createdAt: "2026-10-20T05:00:00.000Z",
      doneAt: "2026-10-21T05:00:00.000Z",
      deletedAt: "2026-10-24T05:00:00.000Z",
      deletedByName: "Pinky",
    });
    const body = await hist(new MemoryStore({ users: USERS, tasks: [t] }));
    expect(body.events.map((e) => e.kind)).toEqual(["created", "done", "deleted"]);
    expect(body.events[2].by).toBe("Pinky");
  });

  it("restored task keeps the restore remark, no extra kind", async () => {
    const t = task({
      createdAt: "2026-10-20T05:00:00.000Z",
      remarks: [rem("2026-10-25T05:00:00.000Z", "Recycle bin se wapas")],
    });
    const body = await hist(new MemoryStore({ users: USERS, tasks: [t] }));
    expect(body.events.map((e) => e.kind)).toEqual(["created", "remark"]);
    expect(body.events[1].text).toBe("Recycle bin se wapas");
  });

  it("many remarks stay in time order even when stored out of order", async () => {
    const remarks = Array.from({ length: 60 }, (_, i) => rem(new Date(Date.UTC(2026, 9, 21, 0, i)).toISOString(), `r${i}`));
    const t = task({ createdAt: "2026-10-20T05:00:00.000Z", remarks: [...remarks].reverse() });
    const body = await hist(new MemoryStore({ users: USERS, tasks: [t] }));
    expect(body.events).toHaveLength(61);
    expect(body.events[0].kind).toBe("created");
    expect(body.events.slice(1).map((e) => e.text)).toEqual(remarks.map((r) => r.text));
  });

  it("has no phone numbers anywhere", async () => {
    const t = task({
      status: "cancelled",
      cancelledAt: "2026-10-23T05:00:00.000Z",
      cancelledByName: "Pinky",
      remarks: [rem("2026-10-21T05:00:00.000Z", "note")],
    });
    const res = await call(new MemoryStore({ users: USERS, tasks: [t] }), "/api/tasks/task1/history");
    const text = await res.text();
    for (const p of [ADMIN.phone, STAFF_DURG.phone]) expect(text).not.toContain(p.replace(/^\+/, ""));
    expect(text).not.toMatch(/\d{10}/);
    expect(text).not.toMatch(/Phone/i);
  });
});
