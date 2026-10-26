import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import type { Outgoing } from "../../src/bot/outgoing";
import { runReminders } from "../../src/scheduler/reminders";
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

  it("inactive or missing assignee: stops reminders, sends nothing", async () => {
    const store = setup([
      task({ id: "inactive", assigneePhone: INACTIVE.phone, assigneeName: INACTIVE.name, nextReminderAt: PAST }),
      task({ id: "missing", assigneePhone: "910000000000", assigneeName: "Ghost", nextReminderAt: PAST }),
    ]);
    expect(await runReminders(store, NOW)).toEqual([]);
    expect(store.tasks.get("inactive")!.nextReminderAt).toBeNull();
    expect(store.tasks.get("missing")!.nextReminderAt).toBeNull();
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
