import { describe, expect, it } from "vitest";
import { binDaysLeft, binDaysLeftText, deletedText, formatClock, formatDate, formatDateTime, formatDue, istWeekday, REPEAT_LABELS, repeatText } from "./format";

const now = new Date("2026-10-27T06:00:00Z");

describe("IST formatting", () => {
  it("formats date and time in IST", () => {
    // 10:30 UTC = 4:00 PM IST
    expect(formatDateTime("2026-10-28T10:30:00Z", now)).toBe("28 Oct, 4:00 PM");
  });
  it("rolls over to the next IST day", () => {
    // 20:00 UTC on 27 Oct = 1:30 AM IST on 28 Oct
    expect(formatDateTime("2026-10-27T20:00:00Z", now)).toBe("28 Oct, 1:30 AM");
  });
  it("shows the year only when it is not the current year", () => {
    expect(formatDate("2025-12-31T04:30:00Z", now)).toBe("31 Dec 2025");
    expect(formatDate("2026-01-05T04:30:00Z", now)).toBe("5 Jan");
  });
  it("uses the IST year at the new-year boundary", () => {
    // 31 Dec 2026 19:00 UTC = 1 Jan 2027 00:30 IST
    expect(formatDate("2026-12-31T19:00:00Z", now)).toBe("1 Jan 2027");
  });
  it("handles noon and midnight", () => {
    expect(formatClock("2026-10-28T06:30:00Z")).toBe("12:00 PM");
    expect(formatClock("2026-10-27T18:30:00Z")).toBe("12:00 AM");
  });
  it("shows date only when the task has no time", () => {
    expect(formatDue("2026-10-28T04:30:00Z", false, now)).toBe("28 Oct");
    expect(formatDue("2026-10-28T04:30:00Z", true, now)).toBe("28 Oct, 10:00 AM");
  });
  it("never contains an em or en dash", () => {
    expect(formatDateTime("2026-03-01T04:30:00Z", now)).not.toMatch(/[–—]/);
  });
});

describe("repeat labels (F4)", () => {
  it("has a short label for every repeat", () => {
    expect(REPEAT_LABELS).toEqual({ none: "Ek baar", every90: "Har 90 min", monthly: "Har mahine", weekly: "Har hafte" });
  });
  it("names the IST weekday", () => {
    // Tue 17 Nov 2026, 10:00 AM IST
    expect(istWeekday("2026-11-17T04:30:00Z")).toBe("Mangalvaar");
    // 20:00 UTC Sat = 1:30 AM IST Sunday
    expect(istWeekday("2026-11-21T20:00:00Z")).toBe("Ravivaar");
  });
  it("shows the weekday for a weekly task", () => {
    expect(repeatText({ repeat: "weekly", repeatDay: null, dueAt: "2026-11-17T04:30:00Z" })).toBe("Har hafte, Mangalvaar");
    expect(repeatText({ repeat: "monthly", repeatDay: 5, dueAt: "2026-11-05T04:30:00Z" })).toBe("Har mahine, 5 tareekh");
    expect(repeatText({ repeat: "none", repeatDay: null, dueAt: "2026-11-05T04:30:00Z" })).toBe("Ek baar");
  });
});

describe("recycle bin text (F8)", () => {
  const binNow = new Date("2026-11-18T06:00:00Z");
  it("counts whole days left of the 30", () => {
    expect(binDaysLeft("2026-11-18T06:00:00Z", binNow)).toBe(30);
    expect(binDaysLeft("2026-11-08T06:00:00Z", binNow)).toBe(20);
    // 10.5 days ago: 19.5 days left, shown as 20
    expect(binDaysLeft("2026-11-07T18:00:00Z", binNow)).toBe(20);
    expect(binDaysLeft("2026-10-01T00:00:00Z", binNow)).toBe(0);
  });
  it("says when it goes away", () => {
    expect(binDaysLeftText("2026-11-08T06:00:00Z", binNow)).toBe("20 din mein apne aap hat jayega");
    expect(binDaysLeftText("2026-10-01T00:00:00Z", binNow)).toBe("Agli safai mein apne aap hat jayega");
    expect(binDaysLeftText(null, binNow)).toBe("30 din mein apne aap hat jayega");
  });
  it("says who deleted it and when", () => {
    expect(deletedText({ deletedAt: "2026-11-17T10:30:00Z", deletedByName: "Bhaskar" }, binNow)).toBe("Bhaskar ne delete kiya, 17 Nov, 4:00 PM");
    expect(deletedText({ deletedAt: null, deletedByName: null }, binNow)).toBe("Delete hua");
  });
});
