import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOUR,
  DEFAULT_MINUTE,
  addDays,
  atIST,
  clampDayOfMonth,
  daysFromToday,
  dueOnDay,
  formatDateTime,
  formatDue,
  isBeyondDays,
  isOverdue,
  istDay,
  parseDue,
  parseTime,
} from "../src/domain/dates";

// 26 Oct 2026, 12:00 IST
const NOW = new Date("2026-10-26T06:30:00Z");
const iso = (r: { dueAt: Date } | null) => r?.dueAt.toISOString();

describe("istDay / atIST / addDays", () => {
  it("uses the IST calendar day, not UTC", () => {
    expect(istDay(new Date("2026-10-26T20:00:00Z"))).toEqual({ year: 2026, month: 10, day: 27 });
    expect(istDay(new Date("2026-10-26T18:29:59Z"))).toEqual({ year: 2026, month: 10, day: 26 });
    expect(istDay(new Date("2026-10-26T18:30:00Z"))).toEqual({ year: 2026, month: 10, day: 27 });
    expect(istDay(new Date("2026-12-31T19:00:00Z"))).toEqual({ year: 2027, month: 1, day: 1 });
  });

  it("builds instants from IST wall-clock time", () => {
    expect(DEFAULT_HOUR).toBe(10);
    expect(DEFAULT_MINUTE).toBe(0);
    expect(atIST({ year: 2026, month: 10, day: 28 }).toISOString()).toBe("2026-10-28T04:30:00.000Z");
    expect(atIST({ year: 2026, month: 10, day: 28 }, { hour: 16, minute: 0 }).toISOString()).toBe(
      "2026-10-28T10:30:00.000Z",
    );
    expect(atIST({ year: 2026, month: 10, day: 28 }, { hour: 2, minute: 15 }).toISOString()).toBe(
      "2026-10-27T20:45:00.000Z",
    );
  });

  it("adds days across month and year ends", () => {
    expect(addDays({ year: 2026, month: 10, day: 30 }, 3)).toEqual({ year: 2026, month: 11, day: 2 });
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(addDays({ year: 2028, month: 2, day: 28 }, 1)).toEqual({ year: 2028, month: 2, day: 29 });
    expect(addDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({ year: 2026, month: 2, day: 28 });
  });
});

describe("parseTime", () => {
  it.each([
    ["4pm", 16, 0],
    ["4 pm", 16, 0],
    ["4PM", 16, 0],
    ["4:30pm", 16, 30],
    ["4.30 PM", 16, 30],
    ["11am", 11, 0],
    ["11 a.m.", 11, 0],
    ["4 p.m.", 16, 0],
    ["12am", 0, 0],
    ["12 AM", 0, 0],
    ["12pm", 12, 0],
    ["12:30am", 0, 30],
    ["16:00", 16, 0],
    ["0:30", 0, 30],
    ["07:00", 7, 0],
    ["23:59", 23, 59],
    ["4:30", 16, 30],
    ["9:15", 9, 15],
    ["4 baje", 16, 0],
    ["1 baje", 13, 0],
    ["7 baje", 19, 0],
    ["8 baje", 8, 0],
    ["11 baje", 11, 0],
    ["12 baje", 12, 0],
    ["4:30 baje", 16, 30],
    ["16 baje", 16, 0],
    ["subah 11", 11, 0],
    ["subah 7", 7, 0],
    ["subah 7 baje", 7, 0],
    ["shaam 6", 18, 0],
    ["sham 6", 18, 0],
    ["shaam 6:30", 18, 30],
    ["6 baje shaam", 18, 0],
    ["4 pm shaam", 16, 0],
    ["dopahar 2", 14, 0],
    ["dopahar 12", 12, 0],
    ["raat 9", 21, 0],
    ["raat 12", 0, 0],
    ["  Shaam  6  ", 18, 0],
  ])("%s -> %i:%i", (input, hour, minute) => {
    expect(parseTime(input)).toEqual({ hour, minute });
  });

  it.each(["", "4", "28", "13pm", "0am", "24:00", "4:60", "4:5pm", "1630", "kal", "hello", "subah", "abc 4", "shaam 13"])(
    "rejects %j",
    (input) => {
      expect(parseTime(input)).toBeNull();
    },
  );
});

describe("parseDue", () => {
  it("relative words, no time -> 10:00 IST", () => {
    expect(parseDue("aaj", NOW)).toEqual({ dueAt: new Date("2026-10-26T04:30:00Z"), hasTime: false });
    expect(iso(parseDue("today", NOW))).toBe("2026-10-26T04:30:00.000Z");
    expect(iso(parseDue("kal", NOW))).toBe("2026-10-27T04:30:00.000Z");
    expect(iso(parseDue("Tomorrow", NOW))).toBe("2026-10-27T04:30:00.000Z");
    expect(iso(parseDue("parso", NOW))).toBe("2026-10-28T04:30:00.000Z");
  });

  it("uses the IST day for 'today' near midnight", () => {
    const late = new Date("2026-10-26T20:00:00Z"); // 27 Oct 01:30 IST
    expect(iso(parseDue("aaj", late))).toBe("2026-10-27T04:30:00.000Z");
    expect(iso(parseDue("kal", late))).toBe("2026-10-28T04:30:00.000Z");
  });

  it.each(["28/10", "28-10", "28.10", "28/10/2026", "28/10/26", "28-10-2026", "28 oct", "28 Oct", "28 October", "28oct", "28th oct", "oct 28", "October 28", "28 oct 2026", "oct 28 2026", "28th October 2026"])(
    "date form %j",
    (input) => {
      expect(parseDue(input, NOW)).toEqual({ dueAt: new Date("2026-10-28T04:30:00Z"), hasTime: false });
    },
  );

  it.each([
    ["28/10 4pm", "2026-10-28T10:30:00.000Z"],
    ["28/10/2026 4:30pm", "2026-10-28T11:00:00.000Z"],
    ["28 oct 2026 4pm", "2026-10-28T10:30:00.000Z"],
    ["28 oct, 4pm", "2026-10-28T10:30:00.000Z"],
    ["kal 11am", "2026-10-27T05:30:00.000Z"],
    ["kal subah 11", "2026-10-27T05:30:00.000Z"],
    ["kal 4 baje", "2026-10-27T10:30:00.000Z"],
    ["shaam 6 kal", "2026-10-27T12:30:00.000Z"],
    ["4pm 28/10", "2026-10-28T10:30:00.000Z"],
    ["kal ko 4 baje", "2026-10-27T10:30:00.000Z"],
    ["28/10 at 16:00", "2026-10-28T10:30:00.000Z"],
    ["aaj raat 9", "2026-10-26T15:30:00.000Z"],
    ["parso 12am", "2026-10-27T18:30:00.000Z"],
    ["  KAL   4PM ", "2026-10-27T10:30:00.000Z"],
  ])("with time %j", (input, expected) => {
    const r = parseDue(input, NOW);
    expect(r?.hasTime).toBe(true);
    expect(iso(r)).toBe(expected);
  });

  it("is DD/MM, never MM/DD", () => {
    expect(iso(parseDue("5/11", NOW))).toBe("2026-11-05T04:30:00.000Z");
    expect(parseDue("10/28", NOW)).toBeNull();
  });

  it("rolls past dates (more than 7 days back) to next year", () => {
    expect(iso(parseDue("19/10", NOW))).toBe("2026-10-19T04:30:00.000Z"); // exactly 7 days back
    expect(iso(parseDue("18/10", NOW))).toBe("2027-10-18T04:30:00.000Z"); // 8 days back
    expect(iso(parseDue("5 jan", NOW))).toBe("2027-01-05T04:30:00.000Z");
    expect(iso(parseDue("31/12", NOW))).toBe("2026-12-31T04:30:00.000Z");
  });

  it("keeps an explicit year even if past", () => {
    expect(iso(parseDue("1/1/2026", NOW))).toBe("2026-01-01T04:30:00.000Z");
  });

  it("handles leap years", () => {
    const in2028 = new Date("2028-01-15T06:30:00Z");
    expect(iso(parseDue("29/02", in2028))).toBe("2028-02-29T04:30:00.000Z");
    expect(iso(parseDue("29/2/2028", NOW))).toBe("2028-02-29T04:30:00.000Z");
    expect(parseDue("29 feb 28", NOW)).toBeNull(); // word-form years must be 4 digits
    expect(parseDue("29/02/2027", NOW)).toBeNull();
    expect(parseDue("29/02", NOW)).toBeNull(); // rolls to 2027, not a leap year
  });

  it.each(["31/02", "32/1", "1/13", "0/5", "31 apr", "31/04/2026", "", "   ", "hello", "kal 4", "kal xyz", "28 foo", "4pm", "28/10 13pm", "28/10/2026/1"])(
    "rejects %j",
    (input) => {
      expect(parseDue(input, NOW)).toBeNull();
    },
  );
});

describe("dueOnDay", () => {
  const day = { year: 2026, month: 11, day: 3 };
  it("defaults to 10:00 when no time", () => {
    expect(dueOnDay(day, null)).toEqual({ dueAt: new Date("2026-11-03T04:30:00Z"), hasTime: false });
    expect(dueOnDay(day, "")).toEqual({ dueAt: new Date("2026-11-03T04:30:00Z"), hasTime: false });
    expect(dueOnDay(day, " Skip ")).toEqual({ dueAt: new Date("2026-11-03T04:30:00Z"), hasTime: false });
  });
  it("applies a typed time", () => {
    expect(dueOnDay(day, "shaam 6")).toEqual({ dueAt: new Date("2026-11-03T12:30:00Z"), hasTime: true });
  });
  it("returns null for an invalid time", () => {
    expect(dueOnDay(day, "kabhi bhi")).toBeNull();
    expect(dueOnDay(day, "25:00")).toBeNull();
  });
});

describe("formatting", () => {
  it("formatDue omits the current year", () => {
    expect(formatDue("2026-10-28T10:30:00.000Z", true, NOW)).toBe("28 Oct, 4:00 PM");
    expect(formatDue(new Date("2026-10-28T04:30:00Z"), false, NOW)).toBe("28 Oct");
  });
  it("formatDue shows other years", () => {
    expect(formatDue("2027-01-05T04:30:00.000Z", false, NOW)).toBe("5 Jan 2027");
    expect(formatDue("2027-01-05T10:30:00.000Z", true, NOW)).toBe("5 Jan 2027, 4:00 PM");
  });
  it("formats midnight, noon and IST day shift", () => {
    expect(formatDue("2026-10-27T18:30:00.000Z", true, NOW)).toBe("28 Oct, 12:00 AM");
    expect(formatDue("2026-10-28T06:30:00.000Z", true, NOW)).toBe("28 Oct, 12:00 PM");
    expect(formatDue("2026-12-31T19:00:00.000Z", true, NOW)).toBe("1 Jan 2027, 12:30 AM");
  });
  it("formatDateTime always includes time", () => {
    expect(formatDateTime("2026-10-28T10:35:00.000Z", NOW)).toBe("28 Oct, 4:05 PM");
    expect(formatDateTime(new Date("2026-10-26T04:30:00Z"), NOW)).toBe("26 Oct, 10:00 AM");
  });
});

describe("day arithmetic", () => {
  it("daysFromToday counts IST calendar days", () => {
    expect(daysFromToday("2026-10-26T18:00:00Z", NOW)).toBe(0); // 23:30 IST same day
    expect(daysFromToday("2026-10-26T18:30:00Z", NOW)).toBe(1); // 00:00 IST next day
    expect(daysFromToday("2026-10-20T04:30:00Z", NOW)).toBe(-6);
    expect(daysFromToday(new Date("2027-10-26T04:30:00Z"), NOW)).toBe(365);
  });

  it("isBeyondDays implements the 25-day rule", () => {
    const at = (day: number, month = 11) => atIST({ year: 2026, month, day }, { hour: 23, minute: 59 });
    expect(isBeyondDays(at(20), NOW, 25)).toBe(false); // 25 days
    expect(isBeyondDays(at(21), NOW, 25)).toBe(true); // 26 days
    expect(isBeyondDays(at(26, 10), NOW, 25)).toBe(false);
    // Near IST midnight "today" is already the next day.
    const late = new Date("2026-10-26T20:00:00Z");
    expect(isBeyondDays(at(21), late, 25)).toBe(false);
  });

  it("isOverdue compares instants", () => {
    expect(isOverdue("2026-10-26T06:29:59Z", NOW)).toBe(true);
    expect(isOverdue("2026-10-26T06:30:00Z", NOW)).toBe(false);
    expect(isOverdue(new Date("2026-10-27T00:00:00Z"), NOW)).toBe(false);
  });
});

describe("clampDayOfMonth", () => {
  it("clamps to the month's last day", () => {
    expect(clampDayOfMonth(2026, 4, 31)).toEqual({ year: 2026, month: 4, day: 30 });
    expect(clampDayOfMonth(2026, 2, 31)).toEqual({ year: 2026, month: 2, day: 28 });
    expect(clampDayOfMonth(2028, 2, 30)).toEqual({ year: 2028, month: 2, day: 29 });
    expect(clampDayOfMonth(2026, 1, 31)).toEqual({ year: 2026, month: 1, day: 31 });
    expect(clampDayOfMonth(2026, 6, 15)).toEqual({ year: 2026, month: 6, day: 15 });
  });
});
