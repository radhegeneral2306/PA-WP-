// Adversarial end-to-end scenarios for the dashboard API (through handleApi, real routes)
// and the shared task rules in bot/taskActions.

import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { addRoutes, handleApi } from "../../src/dashboard/api";
import { LOCK_MINUTES, MAX_FAILS, issueToken, login } from "../../src/dashboard/auth";
import { createRoutes } from "../../src/dashboard/routes/create";
import { readRoutes, type TaskDTO } from "../../src/dashboard/routes/read";
import { changeDue, firstReminderAt, markDone } from "../../src/bot/taskActions";
import type { Outgoing } from "../../src/bot/outgoing";
import type { DateRequest, Task } from "../../src/domain/types";
import type { Env } from "../../src/env";
import { ADMIN, ADMIN2, INACTIVE, NOW, STAFF_DURG, STAFF_RAIPUR, USERS, task } from "../helpers/bot";

addRoutes(readRoutes);
addRoutes(createRoutes);

const env: Env = {
  WEBHOOK_SECRET: "w".repeat(48),
  INTERAKT_API_KEY: "k",
  FIREBASE_PROJECT_ID: "p",
  FIREBASE_CLIENT_EMAIL: "e",
  FIREBASE_PRIVATE_KEY: "k",
  DASHBOARD_USER: "radhe",
  DASHBOARD_PASSWORD: "correct horse battery",
  DASHBOARD_ORIGINS: "https://dash.example.pages.dev",
};
const ORIGIN = "https://dash.example.pages.dev";
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

interface Result {
  status: number;
  headers: Headers;
  body: { task?: TaskDTO; next?: TaskDTO | null; error?: string; code?: string; name?: string | null } & Record<string, unknown>;
  sent: Outgoing[];
}

async function call(
  store: MemoryStore,
  path: string,
  opts: { as?: string | null; body?: unknown; raw?: string; method?: string; origin?: string | null; now?: Date } = {},
): Promise<Result> {
  const now = opts.now ?? NOW;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN;
  if (opts.as !== undefined) headers.Authorization = `Bearer ${await issueToken(env, opts.as, now)}`;
  const method = opts.method ?? (opts.body !== undefined || opts.raw !== undefined ? "POST" : "GET");
  const body = opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);
  const sent: Outgoing[] = [];
  const res = await handleApi(new Request(`https://w${path}`, { method, headers, body }), env, store, now, async (outs) => void sent.push(...outs));
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : {}, sent };
}

const A = ADMIN.name;
const B = ADMIN2.name;
const storeWith = (...tasks: Task[]) => new MemoryStore({ users: USERS.map((u) => ({ ...u })), tasks: tasks.length ? tasks : [task()] });
const templates = (sent: Outgoing[]) => sent.map((o) => [o.to, o.kind === "template" ? o.template : o.kind]);
const request = (over: Partial<DateRequest> = {}): DateRequest => ({
  dueAt: "2026-12-01T04:30:00.000Z",
  hasTime: false,
  remark: "Maal late aayega",
  byPhone: STAFF_DURG.phone,
  byName: STAFF_DURG.name,
  requestedAt: "2026-10-25T06:00:00.000Z",
  ...over,
});

describe("two admins acting on the same task (stale screens)", () => {
  it("second Done is refused; the creator hears once; a monthly task repeats once", async () => {
    const store = storeWith(task({ repeat: "monthly", repeatDay: 27 }));
    const first = await call(store, "/api/tasks/task1/done", { as: B, body: {} });
    expect(first.status).toBe(200);
    expect(first.body.next).toMatchObject({ status: "pending", dueAt: "2026-11-27T04:30:00.000Z" });
    expect(templates(first.sent)).toEqual([[ADMIN.phone, "task_done_v1"]]);
    const second = await call(store, "/api/tasks/task1/done", { as: A, body: {} });
    expect(second).toMatchObject({ status: 409, body: { code: "task_closed" }, sent: [] });
    expect(await store.listTasks({ status: "pending" })).toHaveLength(1);
  });

  it("remark / due / assign / approve on a task another admin just cancelled are refused", async () => {
    const store = storeWith(task({ dateRequest: request() }));
    expect((await call(store, "/api/tasks/task1/cancel", { as: A, body: {} })).status).toBe(200);
    for (const [action, body] of [
      ["remark", { text: "ho gaya?" }],
      ["due", { date: "2026-11-02" }],
      ["assign", { phone: STAFF_RAIPUR.phone }],
      ["approve", {}],
      ["cancel", {}],
    ] as const) {
      const r = await call(store, `/api/tasks/task1/${action}`, { as: B, body });
      expect([action, r.status, r.body.code, r.sent]).toEqual([action, 409, "task_closed", []]);
    }
  });

  it("deciding a request that staff replaced meanwhile is refused (request_changed)", async () => {
    const store = storeWith(task({ dateRequest: request({ requestedAt: "2026-10-26T08:00:00.000Z" }) }));
    const r = await call(store, "/api/tasks/task1/approve", { as: A, body: { requestedAt: "2026-10-25T06:00:00.000Z" } });
    expect(r).toMatchObject({ status: 409, body: { code: "request_changed" }, sent: [] });
  });
});

describe("date requests", () => {
  it("approve of a requested date that has since passed is refused; reject still works", async () => {
    const store = storeWith(task({ dateRequest: request({ dueAt: "2026-10-26T04:30:00.000Z" }) })); // 26 Oct 10:00, NOW is 15:00
    const r = await call(store, "/api/tasks/task1/approve", { as: A, body: { requestedAt: "2026-10-25T06:00:00.000Z" } });
    expect(r).toMatchObject({ status: 409, body: { code: "request_expired" }, sent: [] });
    expect((await store.getTask("task1"))!.dateRequest).not.toBeNull();
    const rej = await call(store, "/api/tasks/task1/reject", { as: A, body: {} });
    expect(rej.status).toBe(200);
    expect(templates(rej.sent)).toEqual([[STAFF_DURG.phone, "date_approval_result_v1"]]);
  });

  it("approve when the requester has since been removed: date moves, nobody is messaged", async () => {
    const store = storeWith(task({ dateRequest: request() }));
    await store.saveUser({ ...STAFF_DURG, active: false });
    const r = await call(store, "/api/tasks/task1/approve", { as: A, body: {} });
    expect(r.status).toBe(200);
    expect(r.body.task).toMatchObject({ dueAt: "2026-12-01T04:30:00.000Z", nextReminderAt: "2026-12-01T04:30:00.000Z", dateRequest: null });
    expect(r.sent).toEqual([]);
  });

  it("Done on a task with a pending request clears the request; only the creator hears", async () => {
    const store = storeWith(task({ dateRequest: request(), createdByPhone: ADMIN2.phone, createdByName: ADMIN2.name }));
    const r = await call(store, "/api/tasks/task1/done", { as: A, body: {} });
    expect(r.body.task).toMatchObject({ status: "done", dateRequest: null, nextReminderAt: null });
    expect(templates(r.sent)).toEqual([[ADMIN2.phone, "task_done_v1"]]);
  });
});

describe("notifications go to the right, active people", () => {
  it("reassign then cancel: new assignee and creator are told, the old assignee is not", async () => {
    const store = storeWith(task({ createdByPhone: ADMIN2.phone, createdByName: ADMIN2.name }));
    const re = await call(store, "/api/tasks/task1/assign", { as: A, body: { phone: STAFF_RAIPUR.phone } });
    expect(templates(re.sent)).toEqual([[STAFF_RAIPUR.phone, "task_assigned_v1"]]);
    expect(re.body.task).toMatchObject({ assigneePhone: STAFF_RAIPUR.phone, branch: "RAIPUR" });
    const c = await call(store, "/api/tasks/task1/cancel", { as: A, body: {} });
    expect(templates(c.sent)).toEqual([
      [STAFF_RAIPUR.phone, "task_cancelled_v1"],
      [ADMIN2.phone, "task_cancelled_v1"],
    ]);
  });

  it("reassign to the acting admin: no message to themselves", async () => {
    const store = storeWith();
    const r = await call(store, "/api/tasks/task1/assign", { as: A, body: { phone: ADMIN.phone } });
    expect(r.status).toBe(200);
    expect(r.sent).toEqual([]);
  });

  it("creator was removed: done / remark send nothing; a date change still tells the assignee", async () => {
    const store = storeWith(task({ createdByPhone: INACTIVE.phone, createdByName: INACTIVE.name }));
    expect((await call(store, "/api/tasks/task1/remark", { as: A, body: { text: "Update do" } })).sent).toEqual([]);
    const due = await call(store, "/api/tasks/task1/due", { as: A, body: { date: "2026-11-03" } });
    expect(templates(due.sent)).toEqual([[STAFF_DURG.phone, "task_updated_v1"]]);
    expect((await call(store, "/api/tasks/task1/done", { as: A, body: {} })).sent).toEqual([]);
  });

  it("WhatsApp done by staff whose creator was removed: no task_done_v1 to the inactive creator", async () => {
    const store = storeWith(task({ createdByPhone: INACTIVE.phone, createdByName: INACTIVE.name }));
    const r = await markDone(store, (await store.getTask("task1"))!, { phone: STAFF_DURG.phone, name: STAFF_DURG.name }, NOW);
    expect(r).toMatchObject({ ok: true, outs: [] });
  });

  it("create with assignee = the acting admin: created by them, no message", async () => {
    const store = new MemoryStore({ users: USERS, tasks: [] });
    const r = await call(store, "/api/tasks", { as: A, body: { title: "Bank jana", assigneePhone: ADMIN.phone, date: "2026-10-28" } });
    expect(r.status).toBe(201);
    expect(r.body.task).toMatchObject({ assigneePhone: ADMIN.phone, createdByPhone: ADMIN.phone, dueAt: "2026-10-28T04:30:00.000Z" });
    expect(r.sent).toEqual([]);
  });
});

describe("reminders after dashboard changes", () => {
  it("reassigning a task whose reminders stopped (old assignee removed) restarts them for the new assignee", async () => {
    const future = storeWith(task({ assigneePhone: INACTIVE.phone, assigneeName: INACTIVE.name, nextReminderAt: null }));
    const r1 = await call(future, "/api/tasks/task1/assign", { as: A, body: { phone: STAFF_RAIPUR.phone } });
    expect(r1.body.task!.nextReminderAt).toBe("2026-10-27T04:30:00.000Z"); // due 27 Oct 10:00 is still ahead

    const overdue = storeWith(
      task({ assigneePhone: INACTIVE.phone, assigneeName: INACTIVE.name, dueAt: "2026-10-20T04:30:00.000Z", nextReminderAt: null }),
    );
    const r2 = await call(overdue, "/api/tasks/task1/assign", { as: A, body: { phone: STAFF_RAIPUR.phone } });
    expect(r2.body.task!.nextReminderAt).toBe("2026-10-27T05:30:00.000Z"); // next daily 11:00 IST
  });

  it("reassign keeps an existing reminder schedule untouched", async () => {
    const store = storeWith(task({ nextReminderAt: "2026-10-27T05:30:00.000Z" }));
    const r = await call(store, "/api/tasks/task1/assign", { as: A, body: { phone: STAFF_RAIPUR.phone } });
    expect(r.body.task!.nextReminderAt).toBe("2026-10-27T05:30:00.000Z");
  });

  it("every90 with a night due time starts nagging at 10 AM next morning (create, due, reopen, approve)", async () => {
    const tenNextDay = "2026-10-29T04:30:00.000Z"; // 29 Oct 10:00 IST
    const store = new MemoryStore({ users: USERS, tasks: [] });
    const c = await call(store, "/api/tasks", { as: A, body: { title: "Raat ka kaam", assigneePhone: STAFF_DURG.phone, date: "2026-10-28", time: "22:00", repeat: "every90" } });
    expect(c.body.task).toMatchObject({ dueAt: "2026-10-28T16:30:00.000Z", nextReminderAt: tenNextDay });
    expect((c.sent[0] as { bodyValues: string[] }).bodyValues[4]).toContain("10:00");
    const id = c.body.task!.id;

    const d = await call(store, `/api/tasks/${id}/due`, { as: A, body: { date: "2026-10-28", time: "06:00" } });
    expect(d.body.task!.nextReminderAt).toBe("2026-10-28T04:30:00.000Z"); // 6 AM → 10 AM same day

    await call(store, `/api/tasks/${id}/cancel`, { as: A, body: {} });
    const o = await call(store, `/api/tasks/${id}/reopen`, { as: A, body: { date: "2026-10-28", time: "21:15" } });
    expect(o.body.task).toMatchObject({ status: "pending", repeat: "every90", nextReminderAt: tenNextDay });

    await store.updateTask(id, { dateRequest: request({ dueAt: "2026-12-01T15:00:00.000Z", hasTime: true }) }); // 20:30 IST
    const a = await call(store, `/api/tasks/${id}/approve`, { as: A, body: {} });
    expect(a.body.task!.nextReminderAt).toBe("2026-12-02T04:30:00.000Z");
  });

  it("one-time / monthly tasks keep reminding at the exact due time picked", async () => {
    expect(firstReminderAt("none", new Date("2026-10-28T16:30:00.000Z"))).toBe("2026-10-28T16:30:00.000Z");
    expect(firstReminderAt("monthly", new Date("2026-10-28T00:30:00.000Z"))).toBe("2026-10-28T00:30:00.000Z");
    expect(firstReminderAt("every90", new Date("2026-10-28T09:00:00.000Z"))).toBe("2026-10-28T09:00:00.000Z"); // 14:30 inside hours
  });

  it("WhatsApp change-date (shared changeDue) applies the same every90 rule", async () => {
    const store = storeWith(task({ repeat: "every90" }));
    const due = { dueAt: new Date("2026-10-30T15:30:00.000Z"), hasTime: true }; // 30 Oct 21:00 IST
    const r = await changeDue(store, (await store.getTask("task1"))!, { phone: STAFF_DURG.phone, name: STAFF_DURG.name }, due, null, NOW, { notifyAssignee: false });
    expect(r).toMatchObject({ ok: true, task: { nextReminderAt: "2026-10-31T04:30:00.000Z" } });
  });
});

describe("reopen", () => {
  it("monthly: a done task never reopens; its cancelled next-month task reopens alone, keeping its repeat day", async () => {
    const store = storeWith(task({ repeat: "monthly", repeatDay: 27 }));
    const done = await call(store, "/api/tasks/task1/done", { as: A, body: {} });
    const nextId = done.body.next!.id;
    expect((await call(store, "/api/tasks/task1/reopen", { as: A, body: { date: "2026-11-05" } })).body.code).toBe("not_cancelled");
    expect((await call(store, `/api/tasks/${nextId}/reopen`, { as: A, body: { date: "2026-11-05" } })).body.code).toBe("not_cancelled");
    await call(store, `/api/tasks/${nextId}/cancel`, { as: A, body: {} });
    const r = await call(store, `/api/tasks/${nextId}/reopen`, { as: A, body: { date: "2026-11-05" } });
    expect(r.body.task).toMatchObject({ status: "pending", repeat: "monthly", repeatDay: 27, cancelledAt: null, dueAt: "2026-11-05T04:30:00.000Z" });
    expect(await store.listTasks({ status: "pending" })).toHaveLength(1);
  });

  it("refuses a past date and a removed assignee", async () => {
    const store = storeWith(task({ status: "cancelled", cancelledAt: NOW.toISOString() }));
    expect((await call(store, "/api/tasks/task1/reopen", { as: A, body: { date: "2026-10-26" } })).body.code).toBe("bad_request"); // 10:00 today has passed
    await store.saveUser({ ...STAFF_DURG, active: false });
    const r = await call(store, "/api/tasks/task1/reopen", { as: A, body: { date: "2026-11-02" } });
    expect(r).toMatchObject({ status: 400, sent: [] });
  });
});

describe("create: titles and bodies", () => {
  const base = { assigneePhone: STAFF_DURG.phone, date: "2026-10-28" };
  const fresh = () => new MemoryStore({ users: USERS, tasks: [] });

  it("keeps unicode / emoji titles, trims them, enforces 1..200 characters", async () => {
    for (const title of ["  सामान 📦 गिनना  ", "a".repeat(200), "🙏".repeat(100)]) {
      const r = await call(fresh(), "/api/tasks", { as: A, body: { ...base, title } });
      expect([title.slice(0, 5), r.status, r.body.task?.title]).toEqual([title.slice(0, 5), 201, title.trim()]);
    }
    for (const title of ["   ", "\n\t", "a".repeat(201), "🙏".repeat(101)]) {
      expect((await call(fresh(), "/api/tasks", { as: A, body: { ...base, title } })).status).toBe(400);
    }
  });

  it("malformed bodies are 400s, never 500s, and create nothing", async () => {
    const store = fresh();
    const cases: { raw?: string; body?: unknown }[] = [
      { raw: "{not json" },
      { raw: "" },
      { body: null },
      { body: [] },
      { body: "title" },
      { body: { ...base, title: null } },
      { body: { ...base, title: ["x"] } },
      { body: { ...base, title: "x", assigneePhone: 919000000011 } },
      { body: { ...base, title: "x", date: 20261028 } },
      { body: { ...base, title: "x", date: "2026-02-30" } },
      { body: { ...base, title: "x", time: "24:00" } },
      { body: { ...base, title: "x", time: "9:00" } },
      { body: { ...base, title: "x", repeat: "daily" } },
      { body: { ...base, title: "x", assigneePhone: INACTIVE.phone } },
      { body: { ...base, title: "x", assigneePhone: "910000000000" } },
    ];
    for (const c of cases) {
      const r = await call(store, "/api/tasks", { as: A, ...c });
      expect([JSON.stringify(c), r.status]).toEqual([JSON.stringify(c), 400]);
    }
    expect(store.tasks.size).toBe(0);
  });

  it("write routes with null / array bodies: actions that need nothing still work, others ask for input", async () => {
    const store = storeWith();
    expect((await call(store, "/api/tasks/task1/remark", { as: A, body: [] })).status).toBe(400);
    expect((await call(store, "/api/tasks/task1/remark", { as: A, body: { text: "   " } })).status).toBe(400);
    expect((await call(store, "/api/tasks/task1/due", { as: A, body: { date: "2026-11-02", remark: 5 } })).status).toBe(400);
    expect((await call(store, "/api/tasks/task1/assign", { as: A, body: { phone: null } })).status).toBe(400);
    expect((await call(store, "/api/tasks/task1/done", { as: A, body: null })).status).toBe(200);
  });
});

describe("paths, sessions, CORS", () => {
  it("encoded slashes / dots / control characters in the task id are just 'not found'", async () => {
    const store = storeWith();
    for (const id of ["task1%2Fx", "..%2Fusers%2F919000000011", "%2E%2E", "a%00b", "a%5Cb"]) {
      const r = await call(store, `/api/tasks/${id}/done`, { as: A, body: {} });
      expect([id, r.status]).toEqual([id, 404]);
    }
    expect((await store.getTask("task1"))!.status).toBe("pending");
    expect((await call(store, "/api/tasks/task1/done/", { as: A, body: {} })).status).toBe(200); // trailing slash ok
  });

  it("token of an admin later removed or renamed: writes need a name again, /api/me says name null", async () => {
    const store = storeWith();
    await store.saveUser({ ...ADMIN, active: false });
    const w = await call(store, "/api/tasks/task1/done", { as: A, body: {} });
    expect(w).toMatchObject({ status: 403, body: { code: "need_name" }, sent: [] });
    expect((await call(store, "/api/me", { as: A })).body).toMatchObject({ name: null, admins: [B] });

    await store.saveUser({ ...ADMIN, active: true, name: "Bhaskar Ji" });
    expect((await call(store, "/api/tasks/task1/done", { as: A, body: {} })).status).toBe(403);
    expect((await call(store, "/api/me", { as: "Bhaskar Ji" })).body.name).toBe("Bhaskar Ji");
    expect((await call(store, "/api/actor", { as: null, body: { name: A } })).status).toBe(400);
  });

  it("a staff member's name in the token is not an actor", async () => {
    const store = storeWith();
    expect((await call(store, "/api/tasks/task1/done", { as: STAFF_DURG.name, body: {} })).status).toBe(403);
    expect((await call(store, "/api/me", { as: STAFF_DURG.name })).body.name).toBeNull();
  });

  it("CORS: allowed origin only, on every response including errors and preflight", async () => {
    const store = storeWith();
    const pre = await call(store, "/api/tasks/task1/done", { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(pre.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect((await call(store, "/api/tasks", { method: "OPTIONS", origin: "https://evil.example" })).status).toBe(403);
    expect((await call(store, "/api/tasks", { method: "OPTIONS", origin: "null" })).status).toBe(403);
    expect((await call(store, "/api/tasks", { origin: `${ORIGIN}.evil.example`, as: A })).status).toBe(403);
    for (const r of [
      await call(store, "/api/nope"),
      await call(store, "/api/tasks?view=pending"),
      await call(store, "/api/tasks/missing/done", { as: A, body: {} }),
      await call(store, "/api/tasks/task1/remark", { as: A, raw: "{" }),
    ]) {
      expect(r.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
      expect(r.headers.get("Vary")).toBe("Origin");
    }
    const noOrigin = await call(store, "/api/tasks?view=pending", { as: A, origin: null });
    expect(noOrigin.status).toBe(200);
    expect(noOrigin.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("lockout: tries while locked don't extend it; after it ends the count starts fresh", async () => {
    const store = new MemoryStore();
    const ip = "5.5.5.5";
    for (let i = 0; i < MAX_FAILS; i++) await login(env, store, ip, "radhe", "nope", NOW);
    for (let m = 1; m < LOCK_MINUTES; m += 3) expect(await login(env, store, ip, "radhe", "nope", later(m))).toMatchObject({ status: 429 });
    expect(await login(env, store, ip, "radhe", "nope", later(LOCK_MINUTES + 1))).toMatchObject({ status: 401 });
    expect(await login(env, store, ip, "radhe", "correct horse battery", later(LOCK_MINUTES + 2))).toMatchObject({ ok: true });
    // a success resets the client's count: MAX_FAILS - 1 new failures do not lock
    for (let i = 0; i < MAX_FAILS - 1; i++) await login(env, store, ip, "radhe", "nope", later(LOCK_MINUTES + 3));
    expect(await login(env, store, ip, "radhe", "correct horse battery", later(LOCK_MINUTES + 4))).toMatchObject({ ok: true });
  });
});
