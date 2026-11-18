import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCleanup } from "../../src/scheduler/cleanup";

vi.mock("../../src/firebase/auth", () => ({ getAccessToken: vi.fn(async () => "tok") }));

const cfg = { projectId: "proj", clientEmail: "bot@x", privateKey: "unused" };
const BASE = "https://firestore.googleapis.com/v1/projects/proj/databases/(default)/documents";
const NAME = "projects/proj/databases/(default)/documents";
const NOW = new Date("2026-10-27T03:30:00.000Z");
const CUTOFF = "2026-09-27T03:30:00.000Z"; // exactly 30 days before NOW

interface Call {
  url: string;
  method: string;
  body: any;
}

let calls: Call[];
let handler: (call: Call) => Response;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const isQuery = (c: Call, coll: string) =>
  c.url === `${BASE}:runQuery` && c.body.structuredQuery.from[0].collectionId === coll;
const isCommit = (c: Call, coll: string) =>
  c.url === `${BASE}:commit` && c.body.writes.every((w: any) => w.delete.startsWith(`${NAME}/${coll}/`));

function rows(coll: string, docs: { id: string; fields?: Record<string, unknown> }[]) {
  return docs.map((d) => ({ document: { name: `${NAME}/${coll}/${d.id}`, fields: d.fields ?? {} } }));
}

function guard(id: string, lockedUntil: string | null) {
  return {
    id,
    fields: {
      key: { stringValue: id },
      lockedUntil: lockedUntil === null ? { nullValue: null } : { stringValue: lockedUntil },
    },
  };
}

beforeEach(() => {
  calls = [];
  handler = () => json([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body as string) : undefined };
      calls.push(call);
      return handler(call);
    }),
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runCleanup", () => {
  it("queries all four collections with LESS_THAN filters (claims: 2-day cutoff)", async () => {
    await runCleanup(cfg, NOW);
    const q = calls.filter((c) => c.url === `${BASE}:runQuery`).map((c) => c.body.structuredQuery);
    expect(q).toHaveLength(4);
    expect(q[3]).toMatchObject({
      from: [{ collectionId: "tasks" }],
      where: { fieldFilter: { field: { fieldPath: "deletedAt" }, op: "LESS_THAN", value: { stringValue: CUTOFF } } },
      select: { fields: [{ fieldPath: "status" }, { fieldPath: "deletedAt" }] },
      limit: 500,
    });
    expect(q[2]).toMatchObject({
      from: [{ collectionId: "claims" }],
      where: { fieldFilter: { field: { fieldPath: "createdAt" }, op: "LESS_THAN", value: { stringValue: new Date(NOW.getTime() - 2 * 86_400_000).toISOString() } } },
    });
    expect(q[0]).toMatchObject({
      from: [{ collectionId: "webhook_log" }],
      where: { fieldFilter: { field: { fieldPath: "loggedAt" }, op: "LESS_THAN", value: { timestampValue: CUTOFF } } },
      limit: 500,
    });
    expect(q[1]).toMatchObject({
      from: [{ collectionId: "login_guards" }],
      where: { fieldFilter: { field: { fieldPath: "windowStart" }, op: "LESS_THAN", value: { stringValue: CUTOFF } } },
      limit: 500,
    });
    for (const s of q) expect(s.orderBy).toBeUndefined();
  });

  it("makes no commit when nothing is old enough", async () => {
    const res = await runCleanup(cfg, NOW);
    expect(res).toEqual({ webhookLogs: 0, loginGuards: 0, claims: 0, binTasks: 0 });
    expect(calls).toHaveLength(4);
    expect(calls.some((c) => c.url.endsWith(":commit"))).toBe(false);
  });

  it("deletes old webhook logs and stale unlocked guards, keeping global and locked ones", async () => {
    handler = (c) => {
      if (isQuery(c, "webhook_log")) return json(rows("webhook_log", [{ id: "msg-1" }, { id: "msg-2" }]));
      if (isQuery(c, "login_guards"))
        return json(
          rows("login_guards", [
            guard("ip-old", null),
            guard("global", null),
            guard("ip-locked", "2026-10-27T04:00:00.000Z"),
            guard("ip-expired-lock", "2026-09-01T00:00:00.000Z"),
          ]),
        );
      return json({ writeResults: [] });
    };
    const res = await runCleanup(cfg, NOW);
    expect(res).toEqual({ webhookLogs: 2, loginGuards: 2, claims: 0, binTasks: 0 });

    const commits = calls.filter((c) => c.url === `${BASE}:commit`);
    expect(commits).toHaveLength(2);
    expect(commits[0].body.writes).toEqual([
      { delete: `${NAME}/webhook_log/msg-1` },
      { delete: `${NAME}/webhook_log/msg-2` },
    ]);
    expect(commits[1].body.writes).toEqual([
      { delete: `${NAME}/login_guards/ip-old` },
      { delete: `${NAME}/login_guards/ip-expired-lock` },
    ]);
    expect(calls.length).toBeLessThanOrEqual(8);
  });

  it("makes no guard commit when only global and locked guards are stale", async () => {
    handler = (c) =>
      isQuery(c, "login_guards")
        ? json(rows("login_guards", [guard("global", null), guard("ip-x", "2026-10-28T00:00:00.000Z")]))
        : json([]);
    const res = await runCleanup(cfg, NOW);
    expect(res.loginGuards).toBe(0);
    expect(calls.some((c) => c.url.endsWith(":commit"))).toBe(false);
  });

  it("caps each run at 500 deletions in a single commit", async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `m${i}` }));
    handler = (c) => (isQuery(c, "webhook_log") ? json(rows("webhook_log", many)) : json(c.url.endsWith(":commit") ? {} : []));
    const res = await runCleanup(cfg, NOW);
    expect(res.webhookLogs).toBe(500);
    const commits = calls.filter((c) => c.url.endsWith(":commit"));
    expect(commits).toHaveLength(1);
    expect(commits[0].body.writes).toHaveLength(500);
  });

  it("deletes claims older than two days", async () => {
    handler = (c) => (isQuery(c, "claims") ? json(rows("claims", [{ id: "c1" }])) : json(c.url.endsWith(":commit") ? {} : []));
    const res = await runCleanup(cfg, NOW);
    expect(res.claims).toBe(1);
    expect(calls.find((c) => isCommit(c, "claims"))?.body.writes).toEqual([{ delete: `${NAME}/claims/c1` }]);
  });

  it("purges recycle-bin tasks deleted over 30 days ago, re-checking the status", async () => {
    handler = (c) => {
      if (isQuery(c, "tasks"))
        return json(
          rows("tasks", [
            { id: "old-bin", fields: { status: { stringValue: "deleted" }, deletedAt: { stringValue: "2026-09-01T00:00:00.000Z" } } },
            { id: "restored", fields: { status: { stringValue: "pending" }, deletedAt: { stringValue: "2026-09-01T00:00:00.000Z" } } },
          ]),
        );
      return json(c.url.endsWith(":commit") ? {} : []);
    };
    const res = await runCleanup(cfg, NOW);
    expect(res.binTasks).toBe(1);
    const commits = calls.filter((c) => isCommit(c, "tasks"));
    expect(commits).toHaveLength(1);
    expect(commits[0].body.writes).toEqual([{ delete: `${NAME}/tasks/old-bin` }]);
    expect(calls).toHaveLength(5);
  });

  it("makes no tasks commit when no old bin task is found", async () => {
    handler = (c) =>
      isQuery(c, "tasks") ? json(rows("tasks", [{ id: "p", fields: { status: { stringValue: "done" } } }])) : json([]);
    const res = await runCleanup(cfg, NOW);
    expect(res.binTasks).toBe(0);
    expect(calls.some((c) => c.url.endsWith(":commit"))).toBe(false);
  });

  it("a failing bin purge does not stop the other parts", async () => {
    handler = (c) => {
      if (isQuery(c, "webhook_log")) return json(rows("webhook_log", [{ id: "a" }]));
      if (isQuery(c, "tasks")) return new Response("boom", { status: 500 });
      return json(c.url.endsWith(":commit") ? {} : []);
    };
    const res = await runCleanup(cfg, NOW);
    expect(res).toEqual({ webhookLogs: 1, loginGuards: 0, claims: 0, binTasks: 0 });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("tasks bin: Firestore query tasks"));
  });

  it("never addresses any other collection", async () => {
    handler = (c) => {
      if (isQuery(c, "webhook_log")) return json(rows("webhook_log", [{ id: "a" }]));
      if (isQuery(c, "login_guards")) return json(rows("login_guards", [guard("ip-a", null)]));
      return json({});
    };
    await runCleanup(cfg, NOW);
    for (const c of calls) {
      expect(c.method).toBe("POST");
      expect([`${BASE}:runQuery`, `${BASE}:commit`]).toContain(c.url);
      if (c.url.endsWith(":runQuery")) {
        expect(["webhook_log", "login_guards", "claims", "tasks"]).toContain(c.body.structuredQuery.from[0].collectionId);
      } else {
        expect(isCommit(c, "webhook_log") || isCommit(c, "login_guards") || isCommit(c, "claims")).toBe(true);
      }
    }
    // Tasks are only queried here (nothing old in the bin), never written.
    expect(JSON.stringify(calls)).not.toMatch(/\/(users|tasks|sessions|system)\//);
  });

  it("still cleans login guards when the webhook_log part fails", async () => {
    handler = (c) => {
      if (isQuery(c, "webhook_log")) return new Response("boom", { status: 500 });
      if (isQuery(c, "login_guards")) return json(rows("login_guards", [guard("ip-a", null)]));
      return json({});
    };
    const res = await runCleanup(cfg, NOW);
    expect(res).toEqual({ webhookLogs: 0, loginGuards: 1, claims: 0, binTasks: 0 });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("webhook_log: Firestore query webhook_log"));
  });

  it("still reports webhook deletions when the login_guards part fails", async () => {
    handler = (c) => {
      if (isQuery(c, "webhook_log")) return json(rows("webhook_log", [{ id: "a" }]));
      if (isQuery(c, "login_guards")) return json(rows("login_guards", [guard("ip-a", null)]));
      if (isCommit(c, "login_guards")) return new Response("denied", { status: 403 });
      return json({});
    };
    const res = await runCleanup(cfg, NOW);
    expect(res).toEqual({ webhookLogs: 1, loginGuards: 0, claims: 0, binTasks: 0 });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("login_guards: Firestore delete"));
  });

  it("logs a one-line summary", async () => {
    await runCleanup(cfg, NOW);
    expect(console.log).toHaveBeenCalledWith(
      `Cleanup: deleted 0 webhook_log, 0 login_guards, 0 claims, 0 bin tasks (cutoff ${CUTOFF})`,
    );
  });
});
