// Auto-refresh timing for the pending list (audit D10 / F14).
// Firebase free plan: 50k reads a day, and one list refresh reads ~100 docs, so the
// rules are strict: refresh only while the tab is visible, every 5 minutes, plus once
// when the tab comes back. Never more than once every 3 minutes automatically (also
// swallows the double visibilitychange + focus event), so even constant tab switching
// stays at 20 refreshes (~2,000 reads) an hour per open dashboard.

/** Background refresh while the tab is visible. */
export const AUTO_REFRESH_MS = 5 * 60 * 1000;
/** No automatic refresh sooner than this after the last fetch started. */
export const MIN_REFRESH_GAP_MS = 3 * 60 * 1000;

export interface RefreshState {
  /** When the last fetch started (ms), success or not; null before the first one. */
  lastAt: number | null;
  now: number;
  visible: boolean;
  /** A fetch is already running. */
  busy: boolean;
}

/** May an automatic refresh (tab came back, tab switch) run now? */
export function canAutoRefresh(s: RefreshState, minGap: number = MIN_REFRESH_GAP_MS): boolean {
  if (!s.visible || s.busy) return false;
  // A clock that jumped backwards (now before lastAt) must not block refreshes for good.
  return s.lastAt === null || s.now < s.lastAt || s.now - s.lastAt >= minGap;
}

/** Milliseconds until the next timed refresh, counted from the last fetch (manual ones included). */
export function nextAutoDelay(lastAt: number | null, now: number, interval: number = AUTO_REFRESH_MS): number {
  if (lastAt === null) return interval;
  // Overdue (tab was hidden past the interval): right away. A clock jump backwards: at most one interval.
  return Math.min(interval, Math.max(lastAt + interval - now, 0));
}
