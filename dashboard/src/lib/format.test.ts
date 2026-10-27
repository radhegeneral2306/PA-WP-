import { describe, expect, it } from "vitest";
import { formatClock, formatDate, formatDateTime, formatDue } from "./format";

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
