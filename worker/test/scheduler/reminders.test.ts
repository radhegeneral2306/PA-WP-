import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import type { Outgoing } from "../../src/bot/outgoing";
import { MAX_REMINDERS_PER_RUN, RETRY_AFTER_FAILURE_MS, runReminders } from "../../src/scheduler/reminders";
import { INACTIVE, NOW, STAFF_DURG, STAFF_RAIPUR, USERS, task } from "../helpers/bot";
import type { Task } from "../../src/domain/types";

type Template = Extract<Outgoing, { kind: "template" }>;

const PAST = "2026-10-26T09:00:00.000Z"; // 26 Oct 14:30 IST
const FUTURE = "2026-10-26T10:00:00.000Z";

function setup(tasks: Task[]) {
  return new MemoryStore({ users: USERS, tasks });
}

function asTemplate(m: Outgoing): Template {
  if (m.kind !== "template") throw new Error("expected template");
  return m;
}

beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("runReminders", () => {
  it("sends only due pending tasks", async () => {
    const store = setup([
      task({ id: "due", nextReminderAt: PAST }),
      task({ id: "exact", nextReminderAt: NOW.toISOString() }),
      task({ id: "later", nextReminderAt: FUTURE }),
      task({ id: "never", nextReminderAt: null }),
      task({ id: "done", nextReminderAt: PAST, status: "done" }),
    ]);
    const out = await runReminders(store, NOW);
    expect(out).toHaveLength(2);
    expect(store.tasks.get("later")!.nextReminderAt).toBe(FUTURE);
    expect(store.tasks.get("done")!.lastReminderAt).toBeUndefined();
  });

  it("builds task_reminder_v1 for the assignee", async () => {
    const store = setup([task({ nextReminderAt: PAST })]);
    const [m] = (await runReminders(store, NOW)).map(asTemplate);
    expect(m.to).toBe(STAFF_DURG.phone);
    expect(m.template).toBe("task_reminder_v1");
    expect(m.bodyValues).toEqual([STAFF_DURG.name, "Sharma ji se payment lena", "27 Oct", "-"]);
    expect(m.fallbackText).toContain("Sharma ji se payment lena");
    expect(m.fallbackText.endsWith("Update ke liye *Mere tasks* likhiye.")).toBe(true);
  });

  it("uses the latest remark, clipped", async () => {
    const remarks = [
      { at: PAST, byPhone: STAFF_DURG.phone, byName: STAFF_DURG.name, text: "pehla" },
      { at: PAST, byPhone: STAFF_DURG.phone, byName: STAFF_DURG.name, text: "x".repeat(300) },
    ];
    const store = setup([task({ nextReminderAt: PAST, remarks })]);
    const [m] = (await runReminders(store, NOW)).map(asTemplate);
    expect(m.bodyValues[3].length).toBe(150);
    expect(m.bodyValues[3].endsWith("…")).toBe(true);

    const store2 = setup([task({ nextReminderAt: PAST, remarks: remarks.slice(0, 1) })]);
    const [m2] = (await runReminders(store2, NOW)).map(asTemplate);
    expect(m2.bodyValues[3]).toBe("pehla");
  });

  it("marks overdue only when more than 5 minutes past due", async () => {
    const store = setup([
      task({ id: "late", dueAt: PAST, dueHasTime: true, nextReminderAt: PAST }),
      task({ id: "just", dueAt: "2026-10-26T09:27:00.000Z", dueHasTime: true, nextReminderAt: PAST }),
    ]);
    const out = (await runReminders(store, NOW)).map(asTemplate);
    expect(out[0].bodyValues[2]).toBe("26 Oct, 2:30 PM (overdue)");
    expect(out[1].bodyValues[2]).toBe("26 Oct, 2:57 PM");
  });

  it("repeat none: reminds again next day at 11 AM while pending", async () => {
    const store = setup([task({ nextReminderAt: PAST })]);
    await runReminders(store, NOW);
    expect(store.tasks.get("task1")!.nextReminderAt).toBe("2026-10-27T05:30:00.000Z"); // 27 Oct 11:00 IST
    expect(await runReminders(store, NOW)).toEqual([]);
    expect(await runReminders(store, new Date("2026-10-27T05:30:00Z"))).toHaveLength(1);
  });

  it("monthly: overdue reminders daily at 11 AM too", async () => {
    const store = setup([task({ repeat: "monthly", repeatDay: 27, nextReminderAt: PAST })]);
    await runReminders(store, NOW);
    expect(store.tasks.get("task1")!.nextReminderAt).toBe("2026-10-27T05:30:00.000Z");
  });

  it("every90: next reminder 90 minutes later", async () => {
    const store = setup([task({ repeat: "every90", nextReminderAt: PAST })]);
    await runReminders(store, NOW);
    expect(store.tasks.get("task1")!.nextReminderAt).toBe("2026-10-26T11:00:00.000Z"); // 16:30 IST
  });

  it("every90 near 8 PM: next reminder at 10 AM next day", async () => {
    const evening = new Date("2026-10-26T13:30:00Z"); // 19:00 IST
    const store = setup([task({ repeat: "every90", nextReminderAt: PAST })]);
    await runReminders(store, evening);
    expect(store.tasks.get("task1")!.nextReminderAt).toBe("2026-10-27T04:30:00.000Z");
  });

  it("sets lastReminderAt and leaves updatedAt alone", async () => {
    const t = task({ nextReminderAt: PAST });
    const store = setup([t]);
    await runReminders(store, NOW);
    const saved = store.tasks.get("task1")!;
    expect(saved.lastReminderAt).toBe(NOW.toISOString());
    expect(saved.updatedAt).toBe(t.updatedAt);
  });

  it("still reminds when a date request is pending", async () => {
    const dateRequest = {
      dueAt: "2026-12-30T04:30:00.000Z", hasTime: false, remark: "late", byPhone: STAFF_DURG.phone,
      byName: STAFF_DURG.name, requestedAt: PAST,
    };
    const store = setup([task({ nextReminderAt: PAST, dateRequest })]);
    const [m] = (await runReminders(store, NOW)).map(asTemplate);
    expect(m.bodyValues[2]).toBe("27 Oct");
  });

  it("inactive or missing assignee: sends nothing, pauses until the next slot (resumes if re-activated)", async () => {
    const store = setup([
      task({ id: "inactive", assigneePhone: INACTIVE.phone, assigneeName: INACTIVE.name, nextReminderAt: PAST }),
      task({ id: "missing", assigneePhone: "910000000000", assigneeName: "Ghost", nextReminderAt: PAST }),
    ]);
    expect(await runReminders(store, NOW)).toEqual([]);
    expect(store.tasks.get("inactive")!.nextReminderAt).toBe("2026-10-27T05:30:00.000Z");
    expect(store.tasks.get("missing")!.nextReminderAt).toBe("2026-10-27T05:30:00.000Z");
    expect(store.tasks.get("inactive")!.lastReminderAt).toBeUndefined();
  });

  it("one failing update does not block the others", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = setup([
      task({ id: "a", dueAt: "2026-10-25T04:30:00.000Z", nextReminderAt: PAST }),
      task({ id: "bad", dueAt: "2026-10-25T05:30:00.000Z", nextReminderAt: PAST }),
      task({ id: "c", dueAt: "2026-10-25T06:30:00.000Z", nextReminderAt: PAST }),
    ]);
    const real = store.updateTask.bind(store);
    store.updateTask = async (id, patch) => {
      if (id === "bad") throw new Error("boom");
      return real(id, patch);
    };
    const out = await runReminders(store, NOW);
    expect(out).toHaveLength(2);
    expect(store.tasks.get("a")!.lastReminderAt).toBe(NOW.toISOString());
    expect(store.tasks.get("c")!.lastReminderAt).toBe(NOW.toISOString());
    expect(err).toHaveBeenCalled();
  });

  it("returns messages in due order", async () => {
    const store = setup([
      task({ id: "z", title: "Later", dueAt: "2026-10-26T08:00:00.000Z", nextReminderAt: PAST }),
      task({ id: "y", title: "Earlier", dueAt: "2026-10-26T07:00:00.000Z", nextReminderAt: PAST,
        assigneePhone: STAFF_RAIPUR.phone, assigneeName: STAFF_RAIPUR.name }),
    ]);
    const out = (await runReminders(store, NOW)).map(asTemplate);
    expect(out.map((m) => m.bodyValues[1])).toEqual(["Earlier", "Later"]);
    expect(out[0].to).toBe(STAFF_RAIPUR.phone);
  });
});

describe("free-tier limits (audit S1/S2)", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      task({ id: `t${String(i).padStart(2, "0")}`, nextReminderAt: new Date(Date.parse(PAST) - (n - i) * 60_000).toISOString() }),
    );

  it("handles at most MAX_REMINDERS_PER_RUN per run, oldest first; the rest go out on the next runs", async () => {
    const store = setup(many(20));
    const first = await runReminders(store, NOW);
    expect(first).toHaveLength(MAX_REMINDERS_PER_RUN);
    const second = await runReminders(store, new Date(NOW.getTime() + 5 * 60_000));
    const third = await runReminders(store, new Date(NOW.getTime() + 10 * 60_000));
    expect(second).toHaveLength(MAX_REMINDERS_PER_RUN);
    expect(third).toHaveLength(20 - 2 * MAX_REMINDERS_PER_RUN);
    // every task reminded exactly once, none lost
    const all = await store.listTasks({ status: "pending" });
    expect(all.every((t) => t.lastReminderAt)).toBe(true);
  });

  it("reads only due tasks (no full scan of pending tasks)", async () => {
    const store = setup([...many(3), task({ id: "future", nextReminderAt: FUTURE })]);
    const full = vi.spyOn(store, "listTasks");
    const dueQuery = vi.spyOn(store, "listDueTasks");
    await runReminders(store, NOW);
    expect(full).not.toHaveBeenCalled();
    expect(dueQuery).toHaveBeenCalledWith(NOW, MAX_REMINDERS_PER_RUN);
  });

  it("with send: claims, then delivers, then marks", async () => {
    const store = setup([task({ id: "a", nextReminderAt: PAST })]);
    const order: string[] = [];
    const update = store.updateTask.bind(store);
    store.updateTask = async (id, patch) => {
      order.push("save");
      return update(id, patch);
    };
    const out = await runReminders(store, NOW, { send: async () => (order.push("send"), true) });
    expect(order).toEqual(["save", "send", "save"]); // claim (+30 min), send, mark
    expect(out).toHaveLength(1);
    expect((await store.getTask("a"))?.lastReminderAt).toBe(NOW.toISOString());
  });

  it("with send: a failed send is retried after 30 minutes, not lost or marked", async () => {
    const store = setup([task({ id: "a", nextReminderAt: PAST })]);
    const out = await runReminders(store, NOW, { send: async () => false });
    expect(out).toEqual([]);
    const t = await store.getTask("a");
    expect(t?.nextReminderAt).toBe(new Date(NOW.getTime() + RETRY_AFTER_FAILURE_MS).toISOString());
    expect(t?.lastReminderAt ?? null).toBeNull();
    // next attempt after 30 minutes succeeds
    const later = new Date(NOW.getTime() + RETRY_AFTER_FAILURE_MS);
    expect(await runReminders(store, later, { send: async () => true })).toHaveLength(1);
  });

  it("a closed task that still carries a reminder time is cleared, so it can't crowd out real ones", async () => {
    const stale = Array.from({ length: MAX_REMINDERS_PER_RUN }, (_, i) =>
      task({ id: `done${i}`, status: "done", nextReminderAt: "2026-10-20T04:30:00.000Z" }),
    );
    const store = setup([...stale, task({ id: "real", nextReminderAt: PAST })]);
    expect(await runReminders(store, NOW)).toEqual([]); // first run: only stale ones fit
    for (const s of stale) expect((await store.getTask(s.id))?.nextReminderAt).toBeNull();
    expect(await runReminders(store, NOW)).toHaveLength(1); // the real one goes out next run
  });

  it("subrequest budget: a full run stays under Cloudflare Free's 50 even if every template falls back", async () => {
    const store = setup(many(30));
    let calls = 2; // OAuth token + the due query
    for (const m of ["getTask", "getUser", "updateTask"] as const) { // updateTask = claim + mark
      const orig = (store[m] as (...a: unknown[]) => Promise<unknown>).bind(store);
      (store as unknown as Record<string, unknown>)[m] = async (...a: unknown[]) => (calls++, orig(...a));
    }
    await runReminders(store, NOW, { send: async () => ((calls += 2), true) }); // template fails + text fallback
    calls += 2; // recordProblems: read + save health
    expect(calls).toBeLessThan(50);
  });

  it("send OK but the final save fails: the claim makes it repeat after 30 min, not on every run", async () => {
    const store = setup([task({ id: "a", nextReminderAt: PAST })]);
    const update = store.updateTask.bind(store);
    let n = 0;
    store.updateTask = async (id, patch) => {
      if (n++ === 1) throw new Error("write quota"); // 1st = claim OK, 2nd = mark fails
      return update(id, patch);
    };
    const stats = { due: 0, sent: 0, stopped: 0, sendFailed: 0, errors: 0 };
    let sends = 0;
    await runReminders(store, NOW, { send: async () => (sends++, true), stats });
    expect(stats.errors).toBe(1);
    // 5 and 25 minutes later: nothing (claimed until +30 min)
    for (const m of [5, 25]) await runReminders(store, new Date(NOW.getTime() + m * 60_000), { send: async () => (sends++, true) });
    expect(sends).toBe(1);
    await runReminders(store, new Date(NOW.getTime() + 30 * 60_000), { send: async () => (sends++, true) });
    expect(sends).toBe(2);
  });

  it("an empty reminder time is cleared instead of blocking a queue slot", async () => {
    const store = setup([task({ id: "blank", nextReminderAt: "" }), task({ id: "real", nextReminderAt: PAST })]);
    const out = await runReminders(store, NOW);
    expect((await store.getTask("blank"))?.nextReminderAt).toBeNull();
    expect(out).toHaveLength(1);
  });
});
