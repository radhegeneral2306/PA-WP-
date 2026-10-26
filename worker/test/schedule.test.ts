import { describe, expect, it } from "vitest";
import { afterReminder, afterResponse, intoWorkingHours, nextMonthlyDue, nextMonthlyTask, nextMorning } from "../src/domain/schedule";
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
  it("stops after one reminder for other kinds", () => {
    expect(afterReminder({ repeat: "none" }, at("2026-10-26T06:00:00Z"))).toBeNull();
    expect(afterReminder({ repeat: "monthly" }, at("2026-10-26T06:00:00Z"))).toBeNull();
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
