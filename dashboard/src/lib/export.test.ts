import { describe, expect, it } from "vitest";
import { exportFilename, exportPath, filenameFromDisposition, rangeDays, thisMonthRange, validateExportRange } from "./export";

describe("export date range (F9)", () => {
  it("defaults to this IST month", () => {
    expect(thisMonthRange(new Date("2026-11-18T06:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(thisMonthRange(new Date("2028-02-10T06:00:00Z"))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
  it("uses the IST date at the month boundary", () => {
    // 31 Oct 20:00 UTC = 1 Nov 1:30 AM IST
    expect(thisMonthRange(new Date("2026-10-31T20:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });
  it("counts days with both ends included", () => {
    expect(rangeDays("2026-11-01", "2026-11-30")).toBe(30);
    expect(rangeDays("2026-11-05", "2026-11-05")).toBe(1);
    expect(rangeDays("2026-01-01", "2026-12-31")).toBe(365);
  });
  it("validates the range", () => {
    expect(validateExportRange("2026-11-01", "2026-11-30")).toBeNull();
    expect(validateExportRange("", "2026-11-30")?.field).toBe("from");
    expect(validateExportRange("2026-11-01", "")?.field).toBe("to");
    expect(validateExportRange("2026-02-30", "2026-03-01")?.message).toBe("Date sahi nahi hai");
    expect(validateExportRange("2026-11-10", "2026-11-01")?.field).toBe("to");
    expect(validateExportRange("2028-01-01", "2028-12-31")).toBeNull(); // 366 days in a leap year
    expect(validateExportRange("2026-01-01", "2027-01-02")?.field).toBe("to");
  });
});

describe("export file (F9)", () => {
  it("builds the filename and request path", () => {
    expect(exportFilename("2026-11-01", "2026-11-30")).toBe("radhe-tasks-2026-11-01-to-2026-11-30.csv");
    expect(exportPath("2026-11-01", "2026-11-30", "done")).toBe("/api/export?from=2026-11-01&to=2026-11-30&status=done");
  });
  it("reads the filename from Content-Disposition", () => {
    expect(filenameFromDisposition('attachment; filename="radhe-tasks-2026-11-01-to-2026-11-30.csv"')).toBe("radhe-tasks-2026-11-01-to-2026-11-30.csv");
    expect(filenameFromDisposition("attachment; filename*=UTF-8''tasks.csv")).toBe("tasks.csv");
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition('attachment; filename="../evil path.csv"')).toBeNull();
  });
});
