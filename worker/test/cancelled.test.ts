import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/data/memoryStore";
import { runReminders } from "../src/scheduler/reminders";
import { runDailySummary } from "../src/scheduler/daily";
import { tasksFlow } from "../src/bot/flows/tasks";
import { approvalsFlow } from "../src/bot/flows/approvals";
import type { Task } from "../src/domain/types";
import type { BotContext, Inbound } from "../src/bot/flow";
import { ADMIN, NOW, STAFF_DURG, USERS, makeCtx, tap, task } from "./helpers/bot";

const PAST = "2026-10-26T08:00:00.000Z";
const cancelled = (o: Partial<Task> = {}) =>
  task({ id: "c1", status: "cancelled", cancelledAt: PAST, cancelledByName: "Dashboard (admin)", nextReminderAt: PAST, dueAt: PAST, ...o });

async function step(ctx: BotContext, input: Inbound) {
  const s = await ctx.store.getSession(ctx.user.phone);
  return tasksFlow.handle(ctx, s!, input);
}

describe("cancelled tasks", () => {
  it("get no reminders even with a due nextReminderAt", async () => {
    const store = new MemoryStore({ users: USERS, tasks: [cancelled()] });
    expect(await runReminders(store, NOW)).toEqual([]);
  });

  it("are not counted in the daily summary", async () => {
    const store = new MemoryStore({ users: USERS, tasks: [cancelled(), task({ id: "p1", dueAt: PAST })] });
    const outs = await runDailySummary(store, NOW);
    expect(outs).toHaveLength(1);
    expect(outs[0]).toMatchObject({ to: STAFF_DURG.phone, bodyValues: ["Hardware", "1", "1"] });
  });

  it("are not listed in Mere tasks", async () => {
    const ctx = makeCtx(STAFF_DURG, new MemoryStore({ users: USERS, tasks: [cancelled()] }));
    const out = await tasksFlow.start(ctx, "mine");
    expect(JSON.stringify(out)).toContain("koi pending task nahi");
  });

  it("show as Cancelled without action buttons when opened from an old list", async () => {
    const store = new MemoryStore({ users: USERS, tasks: [cancelled(), task({ id: "p1" })] });
    const ctx = makeCtx(STAFF_DURG, store);
    await tasksFlow.start(ctx, "mine");
    const out = await step(ctx, tap("tasks:task:c1"));
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("text");
    expect(JSON.stringify(out)).toContain("Cancelled ❌");
  });

  it("can't be marked done, updated or re-dated if cancelled mid-flow", async () => {
    for (const act of ["done", "update", "date"]) {
      const store = new MemoryStore({ users: USERS, tasks: [task({ id: "p1" })] });
      const ctx = makeCtx(STAFF_DURG, store);
      await tasksFlow.start(ctx, "mine");
      await step(ctx, tap("tasks:task:p1"));
      await store.updateTask("p1", { status: "cancelled", cancelledAt: PAST });
      const out = await step(ctx, tap(`tasks:act:${act}`));
      expect(JSON.stringify(out)).toContain("cancel ho chuka hai");
      expect((await store.getTask("p1"))?.status).toBe("cancelled");
    }
  });

  it("drop out of pending approvals", async () => {
    const req = { dueAt: "2026-12-01T04:30:00.000Z", hasTime: false, remark: "r", byPhone: STAFF_DURG.phone, byName: "Hardware", requestedAt: PAST };
    const store = new MemoryStore({ users: USERS, tasks: [cancelled({ dateRequest: req })] });
    const out = await approvalsFlow.start(makeCtx(ADMIN, store));
    expect(JSON.stringify(out)).toContain("Koi approval pending nahi");
  });
});
