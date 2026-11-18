// Daily Firestore housekeeping: prunes old duplicate-detection logs, stale
// dashboard login guards and old double-tap claims. Touches only `webhook_log`,
// `login_guards` and `claims`.
//
// Request budget per run (excluding a possible OAuth token refresh):
//   webhook_log:  1 query + at most 1 commit
//   login_guards: 1 query + at most 1 commit
//   claims:       1 query + at most 1 commit
// so at most 6 Firestore requests. A larger backlog is cleared over
// several daily runs, `batch` docs per collection per run.

import { deleteMany, queryBefore, type FirestoreConfig } from "../firebase/firestore";

const WEBHOOK_LOG = "webhook_log";
const LOGIN_GUARDS = "login_guards";
const CLAIMS = "claims";
const GLOBAL_GUARD = "global";
/** Claims guard against double taps within minutes; two days is plenty. */
const CLAIM_RETENTION_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CleanupOptions {
  /** Documents older than this many days are removed. Default 30. */
  retentionDays?: number;
  /** Max documents deleted per collection per run (<= 500). Default 500. */
  batch?: number;
}

export interface CleanupResult {
  webhookLogs: number;
  loginGuards: number;
  claims: number;
}

export async function runCleanup(cfg: FirestoreConfig, now: Date, opts: CleanupOptions = {}): Promise<CleanupResult> {
  const retentionDays = opts.retentionDays ?? 30;
  const batch = Math.min(Math.max(1, opts.batch ?? 500), 500);
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const result: CleanupResult = { webhookLogs: 0, loginGuards: 0, claims: 0 };
  const errors: string[] = [];

  try {
    // loggedAt is a Firestore timestamp; fetch ids only (docs hold full raw bodies).
    const docs = await queryBefore(cfg, WEBHOOK_LOG, "loggedAt", cutoff, batch, ["__name__"]);
    const ids = docs.map((d) => d.id);
    if (ids.length) await deleteMany(cfg, WEBHOOK_LOG, ids);
    result.webhookLogs = ids.length;
  } catch (err) {
    errors.push(`webhook_log: ${errMsg(err)}`);
  }

  try {
    // windowStart / lockedUntil are ISO strings, so string comparison orders them.
    const docs = await queryBefore(cfg, LOGIN_GUARDS, "windowStart", cutoff.toISOString(), batch, [
      "key",
      "lockedUntil",
    ]);
    const ids = docs
      .filter((d) => d.id !== GLOBAL_GUARD && d.data.key !== GLOBAL_GUARD)
      .filter((d) => !isLocked(d.data.lockedUntil, now))
      .map((d) => d.id);
    if (ids.length) await deleteMany(cfg, LOGIN_GUARDS, ids);
    result.loginGuards = ids.length;
  } catch (err) {
    errors.push(`login_guards: ${errMsg(err)}`);
  }

  try {
    // createdAt is an ISO string (see FirestoreStore.claimOnce).
    const claimCutoff = new Date(now.getTime() - CLAIM_RETENTION_DAYS * DAY_MS).toISOString();
    const docs = await queryBefore(cfg, CLAIMS, "createdAt", claimCutoff, batch, ["__name__"]);
    const ids = docs.map((d) => d.id);
    if (ids.length) await deleteMany(cfg, CLAIMS, ids);
    result.claims = ids.length;
  } catch (err) {
    errors.push(`claims: ${errMsg(err)}`);
  }

  const summary = `Cleanup: deleted ${result.webhookLogs} webhook_log, ${result.loginGuards} login_guards, ${result.claims} claims (cutoff ${cutoff.toISOString()})`;
  if (errors.length) console.error(`${summary}; errors: ${errors.join(" | ")}`);
  else console.log(summary);
  return result;
}

function isLocked(lockedUntil: unknown, now: Date): boolean {
  if (typeof lockedUntil !== "string" || !lockedUntil) return false;
  const t = Date.parse(lockedUntil);
  // An unparseable value is treated as locked: keep the doc rather than guess.
  return Number.isNaN(t) || t > now.getTime();
}

function errMsg(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}
