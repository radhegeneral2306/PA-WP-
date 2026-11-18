import { describe, expect, it } from "vitest";
import { AUTO_REFRESH_MS, canAutoRefresh, MIN_REFRESH_GAP_MS, nextAutoDelay } from "./refresh";

const T = Date.UTC(2026, 10, 18, 6, 0); // 18 Nov, 11:30 AM IST

describe("auto refresh budget", () => {
  it("keeps the agreed limits", () => {
    expect(AUTO_REFRESH_MS).toBe(5 * 60_000);
    expect(MIN_REFRESH_GAP_MS).toBe(3 * 60_000);
  });
  it("never refreshes while hidden or busy", () => {
    expect(canAutoRefresh({ lastAt: null, now: T, visible: false, busy: false })).toBe(false);
    expect(canAutoRefresh({ lastAt: T - 10 * 60_000, now: T, visible: false, busy: false })).toBe(false);
    expect(canAutoRefresh({ lastAt: T - 10 * 60_000, now: T, visible: true, busy: true })).toBe(false);
  });
  it("allows at most one automatic refresh every 3 minutes (visible + focus double fire)", () => {
    expect(canAutoRefresh({ lastAt: null, now: T, visible: true, busy: false })).toBe(true);
    expect(canAutoRefresh({ lastAt: T, now: T, visible: true, busy: false })).toBe(false);
    expect(canAutoRefresh({ lastAt: T - (3 * 60_000 - 1), now: T, visible: true, busy: false })).toBe(false);
    expect(canAutoRefresh({ lastAt: T - 3 * 60_000, now: T, visible: true, busy: false })).toBe(true);
  });
  it("does not get stuck when the clock jumps backwards", () => {
    expect(canAutoRefresh({ lastAt: T + 3_600_000, now: T, visible: true, busy: false })).toBe(true);
    expect(nextAutoDelay(T + 3_600_000, T)).toBe(AUTO_REFRESH_MS);
  });
  it("schedules the timed refresh 5 minutes after the last fetch", () => {
    expect(nextAutoDelay(null, T)).toBe(AUTO_REFRESH_MS);
    expect(nextAutoDelay(T, T)).toBe(AUTO_REFRESH_MS);
    expect(nextAutoDelay(T - 2 * 60_000, T)).toBe(3 * 60_000);
    // Hidden longer than the interval: due at once when visible again.
    expect(nextAutoDelay(T - 30 * 60_000, T)).toBe(0);
  });
  it("worst case stays inside the free plan", () => {
    // Visible all hour on the timer alone: 12 fetches of ~100 docs.
    expect((60 * 60_000) / AUTO_REFRESH_MS).toBe(12);
    // Even if focus/visibility fired constantly, the gap caps it at 20 an hour.
    expect((60 * 60_000) / MIN_REFRESH_GAP_MS).toBe(20);
  });
});
