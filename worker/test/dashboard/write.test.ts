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
    for (const action of ["done", "remark", "due", "assign", "cancel", "reopen", "approve", "reject", "urgent", "delete", "restore", "purge"]) {
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
      ["POST", "/api/tasks/:id/reopen", "named"],
      ["POST", "/api/tasks/:id/approve", "named"],
      ["POST", "/api/tasks/:id/reject", "named"],
      ["POST", "/api/tasks/:id/urgent", "named"],
      ["POST", "/api/tasks/:id/delete", "named"],
      ["POST", "/api/tasks/:id/restore", "named"],
      ["POST", "/api/tasks/:id/purge", "named"],
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
  it("adds the remark and tells the creator and the assignee", async () => {
    const store = storeWith();
    const { res, body, sent } = await post(store, "/api/tasks/task1/remark", { text: "  Call kiya  " }, ADMIN2.name);
    expect(res.status).toBe(200);
    expect(body.task?.lastRemark).toMatchObject({ byPhone: ADMIN2.phone, byName: "Partner Two (dashboard)", text: "Call kiya" });
    expect((await store.getTask("task1"))?.remarks).toHaveLength(1);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ to: ADMIN.phone, template: "task_updated_v1" });
    expect(sent[1]).toMatchObject({ to: STAFF_DURG.phone, template: "task_updated_v1" });
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

describe("reopen", () => {
  const cancelled = (extra: Partial<Task> = {}) =>
    task({ status: "cancelled", cancelledAt: "2026-10-25T09:00:00.000Z", cancelledByName: "Bhaskar (dashboard)", nextReminderAt: null, ...extra });

  it("puts a cancelled task back to pending with the new date and tells the assignee", async () => {
    const store = storeWith(cancelled({ repeat: "monthly", repeatDay: 5 }));
    const { res, body, sent } = await post(store, "/api/tasks/task1/reopen", { date: "2026-10-30", time: "15:00", remark: "Party wapas aayi" }, ADMIN2.name);
    expect(res.status).toBe(200);
    expect(body.task).toMatchObject({ status: "pending", closedAt: null, dueHasTime: true, repeat: "monthly" });
    const saved = await store.getTask("task1");
    expect(saved).toMatchObject({
      status: "pending",
      dueAt: "2026-10-30T09:30:00.000Z",
      nextReminderAt: "2026-10-30T09:30:00.000Z",
      cancelledAt: null,
      cancelledByName: null,
    });
    expect(saved?.remarks.at(-1)).toMatchObject({ byName: "Partner Two (dashboard)" });
    expect(saved?.remarks.at(-1)?.text).toMatch(/^Wapas chalu kiya, nayi date: .*\. Party wapas aayi$/);
    expect((sent as { to: string; template: string }[]).map((o) => [o.to, o.template])).toEqual([[STAFF_DURG.phone, "task_assigned_v1"]]);
  });

  it("date without time means 10:00 AM; no message when the assignee reopens it", async () => {
    const store = storeWith(cancelled({ assigneePhone: ADMIN.phone, assigneeName: ADMIN.name }));
    const { res, sent } = await post(store, "/api/tasks/task1/reopen", { date: "2026-10-28" }, ADMIN.name);
    expect(res.status).toBe(200);
    expect(sent).toEqual([]);
    expect(await store.getTask("task1")).toMatchObject({ dueAt: "2026-10-28T04:30:00.000Z", dueHasTime: false });
  });

  it("needs a valid future date", async () => {
    for (const body of [{}, { date: "2026-13-01" }, { date: "2026-10-25" }]) {
      const store = storeWith(cancelled());
      const { res, sent } = await post(store, "/api/tasks/task1/reopen", body, ADMIN.name);
      expect(res.status).toBe(400);
      expect(sent).toEqual([]);
      expect((await store.getTask("task1"))?.status).toBe("cancelled");
    }
  });

  it("refuses pending and done tasks, and tasks of inactive users", async () => {
    for (const status of ["pending", "done"] as const) {
      const { res, body } = await post(storeWith(task({ status })), "/api/tasks/task1/reopen", { date: "2026-10-30" }, ADMIN.name);
      expect(res.status).toBe(409);
      expect(body.code).toBe("not_cancelled");
    }
    const gone = storeWith(cancelled({ assigneePhone: INACTIVE.phone, assigneeName: INACTIVE.name }));
    const r = await post(gone, "/api/tasks/task1/reopen", { date: "2026-10-30" }, ADMIN.name);
    expect(r.res.status).toBe(400);
    expect((await gone.getTask("task1"))?.status).toBe("cancelled");
  });
});

describe("approve / reject date requests", () => {
  const REQ = {
    dueAt: "2026-12-05T04:30:00.000Z",
    hasTime: false,
    remark: "Customer bahar hai",
    byPhone: STAFF_DURG.phone,
    byName: STAFF_DURG.name,
    requestedAt: "2026-10-26T08:00:00.000Z",
  };
  const withReq = () => storeWith(task({ dateRequest: REQ }));

  it("approve moves the date, restarts reminders and tells the requester", async () => {
    const store = withReq();
    const { res, body, sent } = await post(store, "/api/tasks/task1/approve", { requestedAt: REQ.requestedAt }, ADMIN.name);
    expect(res.status).toBe(200);
    expect(body.task).toMatchObject({ dueAt: REQ.dueAt, dateRequest: null });
    const saved = await store.getTask("task1");
    expect(saved).toMatchObject({ dueAt: REQ.dueAt, nextReminderAt: REQ.dueAt, dateRequest: null });
    expect(saved?.remarks.at(-1)).toMatchObject({ byName: "Bhaskar (dashboard)", text: "Date approve hui (Bhaskar): 27 Oct → 5 Dec. Customer bahar hai" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: STAFF_DURG.phone, template: "date_approval_result_v1", bodyValues: [STAFF_DURG.name, "Sharma ji se payment lena", "Approved", "5 Dec"] });
  });

  it("reject keeps the old date and tells the requester", async () => {
    const store = withReq();
    const { res, sent } = await post(store, "/api/tasks/task1/reject", {}, ADMIN.name);
    expect(res.status).toBe(200);
    const saved = await store.getTask("task1");
    expect(saved).toMatchObject({ dueAt: "2026-10-27T04:30:00.000Z", dateRequest: null });
    expect(saved?.remarks.at(-1)?.text).toBe("Date request reject hui (Bhaskar). Date 27 Oct hi rahegi.");
    expect(sent[0]).toMatchObject({ to: STAFF_DURG.phone, bodyValues: [STAFF_DURG.name, "Sharma ji se payment lena", "Rejected", "27 Oct"] });
  });

  it("409 when there is no request, the request was replaced, or the task is closed", async () => {
    const none = await post(storeWith(task()), "/api/tasks/task1/approve", {}, ADMIN.name);
    expect([none.res.status, none.body.code]).toEqual([409, "no_request"]);
    const changed = withReq();
    const r = await post(changed, "/api/tasks/task1/approve", { requestedAt: "2026-10-20T00:00:00.000Z" }, ADMIN.name);
    expect([r.res.status, r.body.code]).toEqual([409, "request_changed"]);
    expect((await changed.getTask("task1"))?.dateRequest).toEqual(REQ);
    const done = await post(storeWith(task({ status: "done", dateRequest: REQ })), "/api/tasks/task1/reject", {}, ADMIN.name);
    expect([done.res.status, done.body.code, done.sent]).toEqual([409, "task_closed", []]);
  });
});

describe("Round 3: urgent, delete (recycle bin), restore, purge", () => {
  const PAST_DUE = "2026-10-20T04:30:00.000Z"; // 20 Oct 10:00 IST, before NOW
  const binned = (overrides: Partial<Task> = {}) =>
    task({
      status: "deleted",
      deletedFrom: "pending",
      deletedAt: "2026-10-25T00:00:00.000Z",
      deletedByName: "Bhaskar (dashboard)",
      nextReminderAt: null,
      ...overrides,
    });

  it("urgent on and off: remark, no WhatsApp, reminders untouched; same value is a no-op", async () => {
    const store = storeWith();
    const on = await post(store, "/api/tasks/task1/urgent", { urgent: true }, ADMIN2.name);
    expect(on.res.status).toBe(200);
    expect(on.sent).toEqual([]);
    expect(on.body.task).toMatchObject({ urgent: true, nextReminderAt: "2026-10-27T04:30:00.000Z", status: "pending" });
    expect(on.body.task?.lastRemark).toMatchObject({ byName: "Partner Two (dashboard)", text: "Urgent kiya" });
    const again = await post(store, "/api/tasks/task1/urgent", { urgent: true });
    expect(again.body.task?.remarks).toHaveLength(1);
    const off = await post(store, "/api/tasks/task1/urgent", { urgent: false });
    expect(off.body.task).toMatchObject({ urgent: false });
    expect(off.body.task?.lastRemark?.text).toBe("Urgent hataya");
    expect(off.sent).toEqual([]);
  });

  it("urgent: body must be a boolean; refused on deleted tasks; allowed on done ones", async () => {
    expect((await post(storeWith(), "/api/tasks/task1/urgent", { urgent: "yes" })).body).toMatchObject({ code: "bad_request" });
    expect((await post(storeWith(), "/api/tasks/task1/urgent", {})).res.status).toBe(400);
    const del = await post(storeWith(binned()), "/api/tasks/task1/urgent", { urgent: true });
    expect(del.res.status).toBe(409);
    expect(del.body.code).toBe("task_closed");
    const done = await post(storeWith(task({ status: "done", doneAt: NOW.toISOString(), nextReminderAt: null })), "/api/tasks/task1/urgent", { urgent: true });
    expect(done.res.status).toBe(200);
  });

  it("delete: into the bin with deletedFrom, stops reminders and date requests, no WhatsApp", async () => {
    const req = { dueAt: "2026-12-01T04:30:00.000Z", hasTime: false, remark: "r", byPhone: STAFF_DURG.phone, byName: STAFF_DURG.name, requestedAt: NOW.toISOString() };
    const store = storeWith(task({ dateRequest: req }));
    const { res, body, sent } = await post(store, "/api/tasks/task1/delete", {});
    expect(res.status).toBe(200);
    expect(sent).toEqual([]);
    expect(body.task).toMatchObject({
      status: "deleted",
      deletedFrom: "pending",
      deletedAt: NOW.toISOString(),
      deletedByName: "Bhaskar (dashboard)",
      nextReminderAt: null,
      dateRequest: null,
    });
    expect(body.task?.lastRemark?.text).toBe("Recycle bin mein dala");
    expect(body.next).toBeNull();
    // Deleted tasks are closed for every other action.
    for (const [action, b] of [["done", {}], ["remark", { text: "x" }], ["due", { date: "2026-11-02" }], ["cancel", {}], ["assign", { phone: STAFF_RAIPUR.phone }]] as const) {
      const r = await post(store, `/api/tasks/task1/${action}`, b);
      expect(r.res.status).toBe(409);
      expect(r.body.code).toBe("task_closed");
    }
    expect((await post(store, "/api/tasks/task1/reopen", { date: "2026-11-02" })).res.status).toBe(409);
  });

  it("delete of done / cancelled / weekly tasks keeps the previous status; no next occurrence", async () => {
    const store = storeWith(
      task({ id: "d", status: "done", doneAt: "2026-10-25T00:00:00.000Z", nextReminderAt: null }),
      task({ id: "c", status: "cancelled", cancelledAt: "2026-10-25T00:00:00.000Z", nextReminderAt: null }),
      task({ id: "w", repeat: "weekly" }),
    );
    expect((await post(store, "/api/tasks/d/delete", {})).body.task?.deletedFrom).toBe("done");
    expect((await post(store, "/api/tasks/c/delete", {})).body.task?.deletedFrom).toBe("cancelled");
    expect((await post(store, "/api/tasks/w/delete", {})).body.next).toBeNull();
    expect(store.tasks.size).toBe(3);
  });

  it("delete twice → 409 task_closed", async () => {
    const r = await post(storeWith(binned()), "/api/tasks/task1/delete", {});
    expect(r.res.status).toBe(409);
    expect(r.body.code).toBe("task_closed");
  });

  it("restore of a pending task with a future due: reminders restart from the due date", async () => {
    const store = storeWith(binned({ repeat: "every90", dueAt: "2026-10-27T15:30:00.000Z", dueHasTime: true })); // 27 Oct 9 PM IST
    const { res, body, sent } = await post(store, "/api/tasks/task1/restore", {}, ADMIN2.name);
    expect(res.status).toBe(200);
    expect(sent).toEqual([]);
    expect(body.task).toMatchObject({
      status: "pending",
      deletedAt: null,
      deletedByName: null,
      deletedFrom: null,
      dueAt: "2026-10-27T15:30:00.000Z",
      nextReminderAt: "2026-10-28T04:30:00.000Z", // every90 starts in working hours (10 AM next day)
    });
    expect(body.task?.lastRemark).toMatchObject({ byName: "Partner Two (dashboard)", text: "Recycle bin se wapas" });
  });

  it("restore of a pending task whose due has passed needs a new future date", async () => {
    const store = storeWith(binned({ dueAt: PAST_DUE }));
    const none = await post(store, "/api/tasks/task1/restore", {});
    expect(none.res.status).toBe(400);
    expect(none.body.code).toBe("need_date");
    const past = await post(store, "/api/tasks/task1/restore", { date: "2026-10-25" });
    expect(past.res.status).toBe(400);
    expect(past.body.code).toBe("need_date");
    expect((await post(store, "/api/tasks/task1/restore", { date: "2026-13-01" })).body.code).toBe("bad_request");
    expect((await store.getTask("task1"))?.status).toBe("deleted");

    const ok = await post(store, "/api/tasks/task1/restore", { date: "2026-10-30", time: "16:00" });
    expect(ok.res.status).toBe(200);
    expect(ok.sent).toEqual([]);
    expect(ok.body.task).toMatchObject({
      status: "pending",
      dueAt: "2026-10-30T10:30:00.000Z",
      dueHasTime: true,
      nextReminderAt: "2026-10-30T10:30:00.000Z",
      deletedFrom: null,
    });
    expect(ok.body.task?.lastRemark?.text).toMatch(/^Recycle bin se wapas, nayi date: 30 Oct, 4:00 PM$/);
  });

  it("restore of done / cancelled tasks puts the status back, no reminders, date ignored", async () => {
    const store = storeWith(
      binned({ id: "d", deletedFrom: "done", doneAt: "2026-10-20T00:00:00.000Z", dueAt: PAST_DUE }),
      binned({ id: "c", deletedFrom: "cancelled", cancelledAt: "2026-10-20T00:00:00.000Z", dueAt: PAST_DUE }),
    );
    const d = await post(store, "/api/tasks/d/restore", {});
    expect(d.body.task).toMatchObject({ status: "done", nextReminderAt: null, dueAt: PAST_DUE, deletedAt: null });
    const c = await post(store, "/api/tasks/c/restore", { date: "2026-11-05" });
    expect(c.body.task).toMatchObject({ status: "cancelled", nextReminderAt: null, dueAt: PAST_DUE });
  });

  it("restore of a task not in the bin → 409 not_deleted", async () => {
    const r = await post(storeWith(), "/api/tasks/task1/restore", {});
    expect(r.res.status).toBe(409);
    expect(r.body.code).toBe("not_deleted");
  });

  it("purge: super admin only, only from the bin, removes the document", async () => {
    const store = storeWith(binned(), task({ id: "live" }));
    const other = await post(store, "/api/tasks/task1/purge", {}, ADMIN2.name);
    expect(other.res.status).toBe(403);
    expect(other.body.code).toBe("super_admin_only");
    expect(store.tasks.has("task1")).toBe(true);

    const live = await post(store, "/api/tasks/live/purge", {});
    expect(live.res.status).toBe(409);
    expect(live.body.code).toBe("not_deleted");
    expect(store.tasks.has("live")).toBe(true);

    const ok = await post(store, "/api/tasks/task1/purge", {});
    expect(ok.res.status).toBe(200);
    expect(ok.body).toEqual({ purged: true });
    expect(ok.sent).toEqual([]);
    expect(store.tasks.has("task1")).toBe(false);
    expect((await post(store, "/api/tasks/task1/purge", {})).res.status).toBe(404);
  });

  it("all four need a named active admin", async () => {
    for (const action of ["urgent", "delete", "restore", "purge"]) {
      for (const name of [null, STAFF_DURG.name]) {
        const r = await post(storeWith(binned()), `/api/tasks/task1/${action}`, { urgent: true }, name);
        expect(r.res.status).toBe(403);
        expect(r.body.code).toBe("need_name");
      }
    }
  });
});

describe("restore of an old bin record without deletedFrom", () => {
  it("guesses the status from doneAt / cancelledAt, else pending", async () => {
    const base = { status: "deleted" as const, deletedAt: "2026-10-25T00:00:00.000Z", nextReminderAt: null };
    const store = storeWith(
      task({ id: "d", ...base, doneAt: "2026-10-20T00:00:00.000Z" }),
      task({ id: "c", ...base, cancelledAt: "2026-10-20T00:00:00.000Z" }),
      task({ id: "p", ...base }),
    );
    expect((await post(store, "/api/tasks/d/restore", {})).body.task?.status).toBe("done");
    expect((await post(store, "/api/tasks/c/restore", {})).body.task?.status).toBe("cancelled");
    expect((await post(store, "/api/tasks/p/restore", {})).body.task).toMatchObject({ status: "pending", nextReminderAt: "2026-10-27T04:30:00.000Z" });
  });
});
