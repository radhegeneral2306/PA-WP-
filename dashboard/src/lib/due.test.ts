import { describe, expect, it } from "vitest";
import { istInstant, isValidDate, isValidTime, TITLE_MAX, todayIst, validateDue, validateNewTask, validateRemark } from "./due";

// 27 Oct 2026, 9:00 AM IST = 03:30 UTC
const morning = new Date("2026-10-27T03:30:00Z");
// 27 Oct 2026, 11:30 PM IST = 18:00 UTC (still the 27th in IST, the 27th in UTC too)
const lateNight = new Date("2026-10-27T18:00:00Z");
// 28 Oct 2026, 1:00 AM IST = 27 Oct 19:30 UTC (UTC date lags behind IST)
const afterMidnightIst = new Date("2026-10-27T19:30:00Z");

describe("todayIst", () => {
  it("uses the IST calendar day, not UTC", () => {
    expect(todayIst(morning)).toBe("2026-10-27");
    expect(todayIst(lateNight)).toBe("2026-10-27");
    expect(todayIst(afterMidnightIst)).toBe("2026-10-28");
  });
  it("pads month and day", () => {
    expect(todayIst(new Date("2026-01-04T00:00:00Z"))).toBe("2026-01-04");
  });
});

describe("isValidDate / isValidTime", () => {
  it("rejects impossible days and bad formats", () => {
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("27-10-2026")).toBe(false);
  });
  it("checks HH:MM", () => {
    expect(isValidTime("09:05")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("9:05")).toBe(false);
  });
});

describe("istInstant", () => {
  it("defaults to 10:00 AM IST", () => {
    expect(new Date(istInstant("2026-10-28", null)!).toISOString()).toBe("2026-10-28T04:30:00.000Z");
  });
  it("uses the given time in IST", () => {
    expect(new Date(istInstant("2026-10-28", "16:00")!).toISOString()).toBe("2026-10-28T10:30:00.000Z");
  });
  it("returns null for invalid input", () => {
    expect(istInstant("2026-02-30", null)).toBeNull();
    expect(istInstant("2026-10-28", "25:00")).toBeNull();
  });
});

describe("validateDue", () => {
  it("needs a date", () => {
    expect(validateDue("", null, morning)?.message).toMatch(/date chuniye/);
  });
  it("blocks past dates", () => {
    expect(validateDue("2026-10-26", null, morning)?.message).toMatch(/Purani date/);
    expect(validateDue("2026-10-27", null, afterMidnightIst)?.message).toMatch(/Purani date/);
  });
  it("allows today before 10 AM without a time", () => {
    expect(validateDue("2026-10-27", null, morning)).toBeNull();
  });
  it("blocks today without a time after 10 AM", () => {
    expect(validateDue("2026-10-27", null, lateNight)?.message).toMatch(/10:00 AM nikal chuka/);
  });
  it("blocks a time that has passed today, allows a later one", () => {
    expect(validateDue("2026-10-27", "08:59", morning)?.message).toMatch(/time nikal chuka/);
    expect(validateDue("2026-10-27", "09:30", morning)).toBeNull();
  });
  it("puts the error on the right field", () => {
    expect(validateDue("2026-10-26", null, morning)?.field).toBe("date");
    expect(validateDue("2026-10-27", "08:00", morning)?.field).toBe("time");
  });
  it("allows future dates", () => {
    expect(validateDue("2026-11-01", null, lateNight)).toBeNull();
    expect(validateDue("2026-10-28", "00:30", lateNight)).toBeNull();
  });
});

describe("validateRemark", () => {
  it("needs text after trimming", () => {
    expect(validateRemark("   ")).toMatch(/likhiye/);
    expect(validateRemark(" ok ")).toBeNull();
  });
  it("caps at 500 characters", () => {
    expect(validateRemark("a".repeat(500))).toBeNull();
    expect(validateRemark("a".repeat(501))).toMatch(/500/);
  });
});

describe("validateNewTask", () => {
  const ok = { title: "GST return", assignee: "919100000002", date: "2026-10-28", time: "" };
  it("accepts a complete form", () => {
    expect(validateNewTask(ok, morning)).toEqual({});
  });
  it("reports every empty field at once", () => {
    const e = validateNewTask({ title: "   ", assignee: null, date: "", time: "" }, morning);
    expect(e.title).toBe("Task kya hai, likhiye");
    expect(e.assignee).toBe("Kisko dena hai, chuniye");
    expect(e.due).toEqual({ field: "date", message: "Date chuniye" });
  });
  it("limits the title to TITLE_MAX after trimming", () => {
    expect(validateNewTask({ ...ok, title: "x".repeat(TITLE_MAX) }, morning).title).toBeUndefined();
    expect(validateNewTask({ ...ok, title: `  ${"x".repeat(TITLE_MAX)}  ` }, morning).title).toBeUndefined();
    expect(validateNewTask({ ...ok, title: "x".repeat(TITLE_MAX + 1) }, morning).title).toBe(`${TITLE_MAX} akshar tak likhiye`);
  });
  it("rejects a time that already passed today", () => {
    expect(validateNewTask({ ...ok, date: "2026-10-27", time: "08:30" }, morning).due?.field).toBe("time");
    expect(validateNewTask({ ...ok, date: "2026-10-27", time: "09:30" }, morning).due).toBeUndefined();
  });
  it("keeps the past-date message", () => {
    expect(validateNewTask({ ...ok, date: "2026-10-26" }, morning).due?.message).toMatch(/Purani date/);
  });
});
