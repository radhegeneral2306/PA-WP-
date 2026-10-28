import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import type { Outgoing } from "../../src/bot/outgoing";
import { runDailySummary } from "../../src/scheduler/daily";
import { ADMIN, INACTIVE, NOW, STAFF_DURG, STAFF_RAIPUR, USERS, task } from "../helpers/bot";

vi.spyOn(console, "log").mockImplementation(() => {});

const PAST = "2026-10-25T04:30:00.000Z";
const FUTURE = "2026-10-28T04:30:00.000Z";
const raipur = { assigneePhone: STAFF_RAIPUR.phone, assigneeName: STAFF_RAIPUR.name };

function store() {
  return new MemoryStore({
    users: USERS,
    tasks: [
      task({ id: "d1", dueAt: PAST }),
      task({ id: "d2", dueAt: FUTURE }),
      task({ id: "d3", dueAt: PAST }),
      task({ id: "d4", dueAt: PAST, status: "done" }),
      task({ id: "r1", dueAt: FUTURE, ...raipur }),
      task({ id: "i1", dueAt: PAST, assigneePhone: INACTIVE.phone, assigneeName: INACTIVE.name }),
    ],
  });
}

const byTo = (out: Outgoing[]) => new Map(out.map((m) => [m.to, m]));

describe("runDailySummary", () => {
  it("counts pending and overdue per user", async () => {
    const out = byTo(await runDailySummary(store(), NOW));
    const durg = out.get(STAFF_DURG.phone)!;
    expect(durg).toMatchObject({ kind: "template", template: "daily_summary_v1", bodyValues: ["Hardware", "3", "2"] });
    if (durg.kind !== "template") throw new Error();
    expect(durg.fallbackText.endsWith("Dekhne ke liye *Mere tasks* likhiye.")).toBe(true);
    // Raipur's only task is in 2 days: nothing due today or overdue -> no message (owner decision 28 Oct).
    expect(out.has(STAFF_RAIPUR.phone)).toBe(false);
  });

  it("sends to someone whose task is due later today (IST), counting all their pending tasks", async () => {
    const later = "2026-10-26T11:30:00.000Z"; // 5:00 PM IST, NOW is 3:00 PM IST
    const s = new MemoryStore({
      users: USERS,
      tasks: [task({ id: "t1", dueAt: later, ...raipur }), task({ id: "t2", dueAt: FUTURE, ...raipur })],
    });
    const out = byTo(await runDailySummary(s, NOW));
    expect(out.get(STAFF_RAIPUR.phone)).toMatchObject({ bodyValues: ["Chikku", "2", "0"] });
  });

  it("tomorrow early morning (IST) is not today", async () => {
    const tomorrow = "2026-10-26T19:00:00.000Z"; // 27 Oct 00:30 IST
    const s = new MemoryStore({ users: USERS, tasks: [task({ id: "t1", dueAt: tomorrow, ...raipur })] });
    expect(await runDailySummary(s, NOW)).toEqual([]);
  });

  it("skips users with nothing due today/overdue, no pending tasks, and inactive users", async () => {
    const out = byTo(await runDailySummary(store(), NOW));
    expect(out.size).toBe(1);
    expect(out.has(ADMIN.phone)).toBe(false);
    expect(out.has(INACTIVE.phone)).toBe(false);
  });

  it("fetches pending tasks with a single query", async () => {
    const s = store();
    const spy = vi.spyOn(s, "listTasks");
    await runDailySummary(s, NOW);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ status: "pending" });
  });
});
