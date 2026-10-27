import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import type { ApiContext } from "../../src/dashboard/api";
import type { TaskDTO } from "../../src/dashboard/routes/read";
import { matchWriteRoute, writeRoutes } from "../../src/dashboard/routes/write";
import type { Outgoing } from "../../src/bot/outgoing";
import type { Task } from "../../src/domain/types";
import type { Env } from "../../src/env";
import { ADMIN, ADMIN2, INACTIVE, NOW, STAFF_DURG, STAFF_RAIPUR, USERS, task } from "../helpers/bot";

const env = {} as Env;

interface Call {
  res: Response;
  body: { task?: TaskDTO; next?: TaskDTO | null; error?: string; code?: string };
  sent: Outgoing[];
}

/** Mimics handleApi's intended fallback: exact routes first, then matchWriteRoute. */
async function post(store: MemoryStore, path: string, body: unknown, name: string | null = ADMIN.name): Promise<Call> {
  const match = matchWriteRoute("POST", path);
  if (!match) throw new Error(`no route for ${path}`);
  const sent: Outgoing[] = [];
  const ctx: ApiContext = {
    env,
    store,
    now: NOW,
    deliver: async (outs) => void sent.push(...outs),
    request: new Request(`https://w${path}`, { method: "POST" }),
    session: { name, iat: 0, exp: 0 },
  };
  const res = await match.route.handler(ctx, body);
  return { res, body: await res.json(), sent };
}

const storeWith = (...tasks: Task[]) => new MemoryStore({ users: USERS, tasks: tasks.length ? tasks : [task()] });

describe("matchWriteRoute", () => {
  it("parses POST /api/tasks/<id>/<action>", () => {
    for (const action of ["done", "remark", "due", "assign", "cancel"]) {
      const m = matchWriteRoute("POST", `/api/tasks/abc123/${action}`);
      expect(m?.id).toBe("abc123");
      expect(m?.route).toMatchObject({ method: "POST", auth: "named", path: `/api/tasks/abc123/${action}` });
    }
    expect(matchWriteRoute("POST", "/api/tasks/a%20b/done")?.id).toBe("a b");
  });

  it("rejects wrong method, unknown actions and extra or missing segments", () => {
    expect(matchWriteRoute("GET", "/api/tasks/abc/done")).toBeNull();
    expect(matchWriteRoute("PATCH", "/api/tasks/abc/done")).toBeNull();
    expect(matchWriteRoute("POST", "/api/tasks/abc/explode")).toBeNull();
    expect(matchWriteRoute("POST", "/api/tasks/abc/done/x")).toBeNull();
    expect(matchWriteRoute("POST", "/api/tasks/a/b/done")).toBeNull();
    expect(matchWriteRoute("POST", "/api/tasks//done")).toBeNull();
    expect(matchWriteRoute("POST", "/api/tasks/done")).toBeNull();
    expect(matchWriteRoute("POST", "/api/tasks/%E0/done")).toBeNull();
  });

  it("exports one named pattern route per action", () => {
    expect(writeRoutes.map((r) => [r.method, r.path, r.auth])).toEqual([
      ["POST", "/api/tasks/:id/done", "named"],
      ["POST", "/api/tasks/:id/remark", "named"],
      ["POST", "/api/tasks/:id/due", "named"],
      ["POST", "/api/tasks/:id/assign", "named"],
      ["POST", "/api/tasks/:id/cancel", "named"],
    ]);
  });
});

describe("actor and task lookup", () => {
  it("need_name when the session has no name or it isn't an active admin", async () => {
    for (const name of [null, "Stranger", STAFF_DURG.name]) {
      const { res, body, sent } = await post(storeWith(), "/api/tasks/task1/done", {}, name);
      expect(res.status).toBe(403);
      expect(body).toEqual({ error: "Pehle apna naam chuniye", code: "need_name" });
      expect(sent).toEqual([]);
    }
  });

  it("need_name when the admin was deactivated", async () => {
    const store = new MemoryStore({ users: [{ ...ADMIN2, active: false }, STAFF_DURG], tasks: [task()] });
    expect((await post(store, "/api/tasks/task1/done", {}, ADMIN2.name)).res.status).toBe(403);
  });

  it("404 for an unknown task id", async () => {
    const { res, body } = await post(storeWith(), "/api/tasks/nope/remark", { text: "x" });
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Task nahi mila", code: "not_found" });
  });

  it("409 for a closed task", async () => {
    const store = storeWith(task({ status: "done", doneAt: "2026-10-20T00:00:00.000Z" }));
    const { res, body, sent } = await post(store, "/api/tasks/task1/remark", { text: "hello" });
    expect(res.status).toBe(409);
    expect(body.code).toBe("task_closed");
    expect(sent).toEqual([]);
  });
});

describe("POST /api/tasks/:id/done", () => {
  it("marks done, notifies the creator and returns the DTO", async () => {
    const store = storeWith(task({ createdByPhone: ADMIN2.phone, createdByName: ADMIN2.name }));
    const { res, body, sent } = await post(store, "/api/tasks/task1/done", { extra: 1 });
    expect(res.status).toBe(200);
    expect(body.task).toMatchObject({ id: "task1", status: "done", nextReminderAt: null, closedAt: NOW.toISOString() });
    expect(body.task?.lastRemark).toMatchObject({ byPhone: ADMIN.phone, byName: "Bhaskar (dashboard)", text: "Done kiya" });
    expect(body.next).toBeNull();
    expect((await store.getTask("task1"))?.status).toBe("done");
    expect(sent.map((o) => [o.to, o.kind === "template" ? o.template : null])).toEqual([[ADMIN2.phone, "task_done_v1"]]);
  });

  it("never notifies the actor (creator marks done)", async () => {
    const { res, sent } = await post(storeWith(), "/api/tasks/task1/done", null);
    expect(res.status).toBe(200);
    expect(sent).toEqual([]);
  });

  it("monthly done returns next month's task", async () => {
    const store = storeWith(task({ repeat: "monthly", repeatDay: 27 }));
    const { body } = await post(store, "/api/tasks/task1/done", {});
    expect(body.next).toMatchObject({ status: "pending", repeat: "monthly", title: "Sharma ji se payment lena" });
    expect(body.next?.id).not.toBe("task1");
    expect(body.next?.dueAt.startsWith("2026-11-2")).toBe(true);
    expect(await store.getTask(body.next!.id)).not.toBeNull();
  });
});

describe("POST /api/tasks/:id/remark", () => {
  it("adds the remark and tells the creator", async () => {
    const store = storeWith();
    const { res, body, sent } = await post(store, "/api/tasks/task1/remark", { text: "  Call kiya  " }, ADMIN2.name);
    expect(res.status).toBe(200);
    expect(body.task?.lastRemark).toMatchObject({ byPhone: ADMIN2.phone, byName: "Partner Two (dashboard)", text: "Call kiya" });
    expect((await store.getTask("task1"))?.remarks).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ADMIN.phone, template: "task_updated_v1" });
  });

  it("400 for missing, empty or too long text", async () => {
    for (const b of [{}, { text: 5 }, { text: "   " }, { text: "x".repeat(501) }]) {
      const { res, body } = await post(storeWith(), "/api/tasks/task1/remark", b);
      expect(res.status).toBe(400);
      expect(body.code).toBe("bad_request");
    }
  });
});

describe("POST /api/tasks/:id/due", () => {
  it("changes the due date and notifies creator and assignee, never the actor", async () => {
    const dateRequest = { dueAt: "2026-11-05T04:30:00.000Z", hasTime: false, remark: "Time chahiye", byPhone: STAFF_DURG.phone, byName: STAFF_DURG.name, requestedAt: NOW.toISOString() };
    const store = storeWith(task({ dateRequest }));
    const { res, body, sent } = await post(store, "/api/tasks/task1/due", { date: "2026-10-30", time: "14:30", remark: "Party late" }, ADMIN2.name);
    expect(res.status).toBe(200);
    // 30 Oct 14:30 IST
    expect(body.task).toMatchObject({ dueAt: "2026-10-30T09:00:00.000Z", dueHasTime: true, nextReminderAt: "2026-10-30T09:00:00.000Z", dateRequest: null });
    expect(body.task?.lastRemark?.text).toMatch(/^Date badli: .+ → .+\. Party late$/);
    expect(sent.map((o) => o.to).sort()).toEqual([ADMIN.phone, STAFF_DURG.phone].sort());
    expect(sent.every((o) => o.kind === "template" && o.template === "task_updated_v1")).toBe(true);
  });

  it("skips the actor when the creator changes the date; no time means 10:00 IST", async () => {
    const { body, sent } = await post(storeWith(), "/api/tasks/task1/due", { date: "2026-10-30", time: null });
    expect(body.task).toMatchObject({ dueAt: "2026-10-30T04:30:00.000Z", dueHasTime: false });
    expect(sent.map((o) => o.to)).toEqual([STAFF_DURG.phone]);
  });

  it("400 for bad or past dates and bad remarks", async () => {
    const cases: [unknown, string | null][] = [
      [{ date: "30-10-2026", time: null }, "Date ya time galat hai"],
      [{ date: "2026-02-30", time: null }, "Date ya time galat hai"],
      [{ date: "2026-10-30", time: "25:00" }, "Date ya time galat hai"],
      [{}, "Date ya time galat hai"],
      [{ date: "2026-10-25", time: null }, null],
      [{ date: "2026-10-30", time: null, remark: 5 }, null],
      [{ date: "2026-10-30", time: null, remark: "x".repeat(501) }, null],
    ];
    for (const [b, error] of cases) {
      const store = storeWith();
      const { res, body, sent } = await post(store, "/api/tasks/task1/due", b);
      expect(res.status).toBe(400);
      expect(body.code).toBe("bad_request");
      if (error) expect(body.error).toBe(error);
      expect(sent).toEqual([]);
      expect((await store.getTask("task1"))?.dueAt).toBe(task().dueAt);
    }
  });
});

describe("POST /api/tasks/:id/assign", () => {
  it("reassigns and notifies the new assignee", async () => {
    const store = storeWith();
    const { res, body, sent } = await post(store, "/api/tasks/task1/assign", { phone: STAFF_RAIPUR.phone });
    expect(res.status).toBe(200);
    expect(body.task).toMatchObject({ assigneePhone: STAFF_RAIPUR.phone, assigneeName: "Chikku", branch: "RAIPUR" });
    expect(body.task?.lastRemark?.text).toBe("Assign badla: Hardware → Chikku");
    expect((await store.getTask("task1"))?.assigneePhone).toBe(STAFF_RAIPUR.phone);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: STAFF_RAIPUR.phone, template: "task_assigned_v1" });
  });

  it("400 for unknown, inactive or same assignee and a missing phone", async () => {
    for (const phone of [undefined, "", "910000000000", INACTIVE.phone, STAFF_DURG.phone]) {
      const store = storeWith();
      const { res, body, sent } = await post(store, "/api/tasks/task1/assign", { phone });
      expect(res.status).toBe(400);
      expect(body.code).toBe("bad_request");
      expect(sent).toEqual([]);
      expect((await store.getTask("task1"))?.assigneePhone).toBe(STAFF_DURG.phone);
    }
  });
});

describe("cancel", () => {
  it("cancels, keeps the task for the archive and tells assignee and creator", async () => {
    const store = storeWith(task({ repeat: "every90", nextReminderAt: "2026-10-26T10:00:00.000Z" }));
    const { res, body, sent } = await post(store, "/api/tasks/task1/cancel", {}, ADMIN2.name);
    expect(res.status).toBe(200);
    expect((body as { task: { status: string; closedAt: string; cancelledByName: string } }).task).toMatchObject({
      status: "cancelled",
      closedAt: NOW.toISOString(),
      cancelledByName: "Partner Two (dashboard)",
    });
    const saved = await store.getTask("task1");
    expect(saved).toMatchObject({ status: "cancelled", nextReminderAt: null, dateRequest: null });
    expect(saved?.remarks.at(-1)?.text).toBe("Cancel kiya");
    expect((sent as { to: string; template: string }[]).map((o) => [o.to, o.template]).sort()).toEqual(
      [[ADMIN.phone, "task_cancelled_v1"], [STAFF_DURG.phone, "task_cancelled_v1"]].sort(),
    );
  });

  it("never notifies the actor, sends one message when creator is the assignee, skips inactive users", async () => {
    const self = storeWith(task({ assigneePhone: ADMIN.phone, assigneeName: ADMIN.name, createdByPhone: ADMIN.phone }));
    expect((await post(self, "/api/tasks/task1/cancel", {}, ADMIN.name)).sent).toEqual([]);
    const shared = storeWith(task({ assigneePhone: ADMIN.phone, assigneeName: ADMIN.name, createdByPhone: ADMIN.phone }));
    expect((await post(shared, "/api/tasks/task1/cancel", {}, ADMIN2.name)).sent).toHaveLength(1);
    const gone = storeWith(task({ assigneePhone: INACTIVE.phone, assigneeName: INACTIVE.name }));
    const r = await post(gone, "/api/tasks/task1/cancel", {}, ADMIN.name);
    expect(r.sent).toEqual([]);
  });

  it("refuses already closed tasks", async () => {
    for (const status of ["done", "cancelled"] as const) {
      const { res, sent } = await post(storeWith(task({ status })), "/api/tasks/task1/cancel", {}, ADMIN.name);
      expect(res.status).toBe(409);
      expect(sent).toEqual([]);
    }
  });
});
