import { describe, expect, it } from "vitest";
import { afterReminder, afterResponse, intoWorkingHours, monthKey, nextMonthlyDue, nextMonthlyTask, nextMorning } from "../src/domain/schedule";
import { task } from "./helpers/bot";

// IST = UTC+5:30, so 10:00 IST = 04:30Z and 20:00 IST = 14:30Z.
const at = (iso: string) => new Date(iso);

describe("intoWorkingHours", () => {
  it("keeps times inside 10 AM to 8 PM", () => {
    expect(intoWorkingHours(at("2026-10-26T09:00:00Z")).toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });
  it("moves early morning to 10 AM the same day", () => {
    expect(intoWorkingHours(at("2026-10-26T02:00:00Z")).toISOString()).toBe("2026-10-26T04:30:00.000Z");
  });
  it("moves 8 PM and later to 10 AM next day", () => {
    expect(intoWorkingHours(at("2026-10-26T14:30:00Z")).toISOString()).toBe("2026-10-27T04:30:00.000Z");
    expect(intoWorkingHours(at("2026-10-26T18:00:00Z")).toISOString()).toBe("2026-10-27T04:30:00.000Z"); // 23:30 IST
  });
});

describe("afterReminder", () => {
  it("repeats every90 tasks 90 minutes later within working hours", () => {
    expect(afterReminder({ repeat: "every90" }, at("2026-10-26T06:00:00Z"))).toBe("2026-10-26T07:30:00.000Z");
    // 7:00 PM IST + 90 min = 8:30 PM → next morning
    expect(afterReminder({ repeat: "every90" }, at("2026-10-26T13:30:00Z"))).toBe("2026-10-27T04:30:00.000Z");
  });
  it("repeats other kinds daily at 11 AM IST", () => {
    expect(afterReminder({ repeat: "none" }, at("2026-10-26T06:00:00Z"))).toBe("2026-10-27T05:30:00.000Z");
    expect(afterReminder({ repeat: "monthly" }, at("2026-10-26T06:00:00Z"))).toBe("2026-10-27T05:30:00.000Z");
    // sent just after midnight (00:30 IST on 27 Oct) → 11 AM the same day
    expect(afterReminder({ repeat: "none" }, at("2026-10-26T19:00:00Z"))).toBe("2026-10-27T05:30:00.000Z");
    // due reminder at 9 AM IST → not again at 11 AM the same day, but the next day
    expect(afterReminder({ repeat: "none" }, at("2026-10-26T03:30:00Z"))).toBe("2026-10-27T05:30:00.000Z");
  });
});

describe("afterResponse", () => {
  it("pauses every90 until next morning, leaves others alone", () => {
    const now = at("2026-10-26T06:00:00Z");
    expect(afterResponse({ repeat: "every90", nextReminderAt: "x" }, now)).toBe(nextMorning(now).toISOString());
    expect(afterResponse({ repeat: "none", nextReminderAt: null }, now)).toBeNull();
  });
});

describe("monthly", () => {
  it("moves to the same day and time next month", () => {
    // 15 Oct 4 PM IST
    expect(nextMonthlyDue({ dueAt: "2026-10-15T10:30:00.000Z", repeatDay: 15 }).toISOString()).toBe("2026-11-15T10:30:00.000Z");
  });
  it("clamps 31 to the month's last day and returns to 31 later", () => {
    const nov = nextMonthlyDue({ dueAt: "2026-10-31T04:30:00.000Z", repeatDay: 31 });
    expect(nov.toISOString()).toBe("2026-11-30T04:30:00.000Z");
    expect(nextMonthlyDue({ dueAt: nov.toISOString(), repeatDay: 31 }).toISOString()).toBe("2026-12-31T04:30:00.000Z");
    expect(nextMonthlyDue({ dueAt: "2027-01-31T04:30:00.000Z", repeatDay: 31 }).toISOString()).toBe("2027-02-28T04:30:00.000Z");
  });
  it("rolls December into January", () => {
    expect(nextMonthlyDue({ dueAt: "2026-12-05T04:30:00.000Z", repeatDay: 5 }).toISOString()).toBe("2027-01-05T04:30:00.000Z");
  });
  it("builds a fresh pending task for next month", () => {
    const done = task({ repeat: "monthly", repeatDay: 27, status: "done", doneAt: "2026-10-27T06:00:00.000Z", remarks: [{ at: "a", byPhone: "p", byName: "n", text: "t" }] });
    const next = nextMonthlyTask(done, at("2026-10-27T06:00:00Z"));
    expect(next).toMatchObject({ status: "pending", dueAt: "2026-11-27T04:30:00.000Z", nextReminderAt: "2026-11-27T04:30:00.000Z", remarks: [], doneAt: null, repeat: "monthly", repeatDay: 27 });
    expect("id" in next).toBe(false);
  });
});

describe("monthly cycleMonth (audit S5)", () => {
  const base = { repeatDay: 1 };

  it("a 1st-of-month task moved far into its month still repeats next month (no skip)", () => {
    // October's occurrence (due 1 Oct) moved to 20 Oct: next must be 1 Nov, not 1 Dec.
    expect(nextMonthlyDue({ ...base, dueAt: "2026-10-20T04:30:00.000Z", cycleMonth: "2026-10" }).toISOString()).toBe("2026-11-01T04:30:00.000Z");
  });

  it("a 28th task moved to the 5th of the next month does not repeat that month", () => {
    expect(nextMonthlyDue({ repeatDay: 28, dueAt: "2026-11-05T04:30:00.000Z", cycleMonth: "2026-10" }).toISOString()).toBe("2026-11-28T04:30:00.000Z");
  });

  it("without cycleMonth (older tasks) the nearest-repeat-day rule still applies", () => {
    expect(nextMonthlyDue({ repeatDay: 27, dueAt: "2026-11-02T04:30:00.000Z" }).toISOString()).toBe("2026-11-27T04:30:00.000Z");
  });

  it("the next task carries the next cycleMonth, month-end clamping included", () => {
    const t = task({ dueAt: "2026-01-31T04:30:00.000Z", status: "done", repeat: "monthly", repeatDay: 31, cycleMonth: "2026-01" });
    const feb = nextMonthlyTask(t, new Date("2026-02-01T00:00:00Z"));
    expect(feb).toMatchObject({ dueAt: "2026-02-28T04:30:00.000Z", cycleMonth: "2026-02", repeatDay: 31 });
    const mar = nextMonthlyTask(task({ ...feb, id: "y" }), new Date("2026-03-01T00:00:00Z"));
    expect(mar).toMatchObject({ dueAt: "2026-03-31T04:30:00.000Z", cycleMonth: "2026-03" });
  });

  it("monthKey uses the IST date", () => {
    expect(monthKey(new Date("2026-10-31T19:30:00Z"))).toBe("2026-11");
  });
});
