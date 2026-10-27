import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import type { ApiContext } from "../../src/dashboard/api";
import { createRoutes } from "../../src/dashboard/routes/create";
import type { Outgoing } from "../../src/bot/outgoing";
import type { Env } from "../../src/env";
import { ADMIN, ADMIN2, INACTIVE, NOW, STAFF_DURG, STAFF_RAIPUR, USERS } from "../helpers/bot";

const route = createRoutes[0];

async function create(store: MemoryStore, body: unknown, name: string | null = ADMIN.name) {
  const sent: Outgoing[] = [];
  const ctx: ApiContext = {
    env: {} as Env,
    store,
    now: NOW,
    deliver: async (outs) => void sent.push(...outs),
    request: new Request("https://w/api/tasks", { method: "POST" }),
    session: { name, iat: 0, exp: 0 },
  };
  const res = await route.handler(ctx, body);
  return { res, body: (await res.json()) as { task?: Record<string, unknown>; error?: string; code?: string }, sent };
}

const fresh = () => new MemoryStore({ users: USERS, tasks: [] });
const base = { title: "Durg godown stock count", assigneePhone: STAFF_DURG.phone, date: "2026-10-28", time: "16:00", repeat: "none" };

describe("POST /api/tasks", () => {
  it("is a named route", () => {
    expect([route.method, route.path, route.auth]).toEqual(["POST", "/api/tasks", "named"]);
  });

  it("creates the task like the WhatsApp wizard and tells the assignee", async () => {
    const store = fresh();
    const { res, body, sent } = await create(store, { ...base, title: "  Durg godown stock count  " });
    expect(res.status).toBe(201);
    expect(body.task).toMatchObject({ title: "Durg godown stock count", status: "pending", overdue: false });
    const [saved] = await store.listTasks({ status: "pending" });
    expect(saved).toMatchObject({
      assigneePhone: STAFF_DURG.phone,
      assigneeName: STAFF_DURG.name,
      branch: "DURG",
      createdByPhone: ADMIN.phone,
      createdByName: ADMIN.name,
      dueAt: "2026-10-28T10:30:00.000Z",
      dueHasTime: true,
      nextReminderAt: "2026-10-28T10:30:00.000Z",
      repeat: "none",
      repeatDay: null,
      dateRequest: null,
    });
    expect(saved.remarks).toEqual([{ at: NOW.toISOString(), byPhone: ADMIN.phone, byName: "Bhaskar (dashboard)", text: "Dashboard se banaya" }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: STAFF_DURG.phone, template: "task_assigned_v1" });
    expect((sent[0] as { bodyValues: string[] }).bodyValues.slice(0, 3)).toEqual([STAFF_DURG.name, ADMIN.name, "Durg godown stock count"]);
  });

  it("no time means 10:00 AM; monthly keeps the due day; admins can be assignees", async () => {
    const store = fresh();
    const { res } = await create(store, { ...base, assigneePhone: ADMIN2.phone, date: "2026-10-31", time: null, repeat: "monthly" });
    expect(res.status).toBe(201);
    const [saved] = await store.listTasks({ status: "pending" });
    expect(saved).toMatchObject({ dueAt: "2026-10-31T04:30:00.000Z", dueHasTime: false, repeat: "monthly", repeatDay: 31, branch: null });
  });

  it("no message for a task the actor gives to themselves; every90 allowed; repeat defaults to none", async () => {
    const self = fresh();
    expect((await create(self, { ...base, assigneePhone: ADMIN.phone, repeat: "every90" })).sent).toEqual([]);
    const plain = fresh();
    const { title, assigneePhone, date } = base;
    await create(plain, { title, assigneePhone, date });
    expect((await plain.listTasks({ status: "pending" }))[0].repeat).toBe("none");
  });

  it("no 25-day limit for the dashboard", async () => {
    const store = fresh();
    expect((await create(store, { ...base, assigneePhone: STAFF_RAIPUR.phone, date: "2027-03-01" })).res.status).toBe(201);
  });

  it("rejects bad input without creating anything", async () => {
    const cases: unknown[] = [
      { ...base, title: "   " },
      { ...base, title: "x".repeat(201) },
      { ...base, title: 5 },
      { ...base, assigneePhone: "" },
      { ...base, assigneePhone: INACTIVE.phone },
      { ...base, assigneePhone: "919999999999" },
      { ...base, date: "2026-10-25" },
      { ...base, date: "2026-10-26", time: "09:00" },
      { ...base, date: "26/10/2026" },
      { ...base, time: "25:00" },
      { ...base, repeat: "daily" },
      null,
    ];
    for (const body of cases) {
      const store = fresh();
      const r = await create(store, body);
      expect([r.res.status, r.body.code]).toEqual([400, "bad_request"]);
      expect(r.sent).toEqual([]);
      expect(await store.listTasks({ status: "pending" })).toEqual([]);
    }
  });

  it("needs a picked admin name", async () => {
    const r = await create(fresh(), base, "Not An Admin");
    expect([r.res.status, r.body.code]).toEqual([403, "need_name"]);
  });
});
