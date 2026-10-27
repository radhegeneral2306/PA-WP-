// Bot health monitor ("bot band ho jaye toh pata chale").
//
// recordProblems() bumps counters in system/health whenever a send or a handler fails.
// runHealthCheck() runs from the daily 10:00 AM IST cron: it looks at those counters,
// at when the last webhook arrived and at stuck reminders, and if anything is wrong it
// creates one "Bot check: ..." task per active admin (the normal reminders then keep nagging).
//
// Honest limitation: if Interakt itself is down or INTERAKT_API_KEY is invalid, the alert
// cannot be delivered by WhatsApp (the task_assigned_v1 notice fails like everything else).
// The alert task is still saved, so it shows in the admin dashboard; and if Firestore itself
// is unreachable, the check can only console.error (Cloudflare → Observability → Logs).

import type { Store } from "../data/store";
import type { Outgoing } from "../bot/outgoing";
import { createTaskFor, type Actor } from "../bot/taskActions";
import { clip } from "../bot/ui";
import { addDays, atIST, istDay } from "../domain/dates";
import type { Health, User } from "../domain/types";

export const ALERT_PREFIX = "Bot check: ";
const BOT_ACTOR: Actor = { phone: "", name: "Bot" };
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const TITLE_LIMIT = 200;
const PROBLEM_LIMIT = 120;

export interface ProblemCounts {
  sendFailures?: number;
  templateFailures?: number;
  errors?: number;
  /** Short description, no phone numbers or message text (long digit runs are masked anyway). */
  problem?: string | null;
}

export interface HealthCheckOptions {
  /** No incoming webhook for this long counts as a problem (default 48). */
  webhookSilenceHours?: number;
  /** A pending reminder this late means the reminder cron is stuck (default 60). */
  reminderLagMinutes?: number;
}

function emptyHealth(now: Date): Health {
  return { since: now.toISOString(), sendFailures: 0, templateFailures: 0, errors: 0, lastProblem: null, lastProblemAt: null, lastCheckAt: null };
}

/** Masks anything that looks like a phone number and keeps the text short. */
function scrub(problem: string): string {
  return clip(problem.replace(/\+?\d[\d\s-]{6,}\d/g, "***").replace(/\s+/g, " ").trim(), PROBLEM_LIMIT);
}

const count = (n: number | undefined): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * Adds to the counters in system/health (creating it with since = now). Never throws:
 * it is called from error paths, where a second failure must not hide the first.
 */
export async function recordProblems(store: Store, now: Date, p: ProblemCounts): Promise<void> {
  try {
    const sendFailures = count(p.sendFailures);
    const templateFailures = count(p.templateFailures);
    const errors = count(p.errors);
    const problem = p.problem ? scrub(p.problem) : null;
    if (!sendFailures && !templateFailures && !errors && !problem) return;
    const h = (await store.getHealth()) ?? emptyHealth(now);
    h.sendFailures += sendFailures;
    h.templateFailures += templateFailures;
    h.errors += errors;
    if (problem) {
      h.lastProblem = problem;
      h.lastProblemAt = now.toISOString();
    }
    await store.saveHealth(h);
  } catch (err) {
    console.error("health: recordProblems failed", String(err));
  }
}

/** Alert due time: the next full hour today, but 10:00 tomorrow from 20:00 IST and 10:00 today before 09:00 IST. */
export function alertDueAt(now: Date): Date {
  const day = istDay(now);
  const hour = istHour(now);
  if (hour >= 20) return atIST(addDays(day, 1));
  if (hour < 9) return atIST(day);
  return atIST(day, { hour: hour + 1, minute: 0 });
}

function istHour(now: Date): number {
  return new Date(now.getTime() + 330 * MINUTE_MS).getUTCHours();
}

function silenceText(latest: Date | null, now: Date): string {
  if (!latest) return "koi incoming message record nahi mila";
  const hours = Math.floor((now.getTime() - latest.getTime()) / HOUR_MS);
  return hours >= 72 ? `${Math.floor(hours / 24)} din se koi message nahi aaya` : `${hours} ghante se koi message nahi aaya`;
}

/** Short Hinglish summary used as the task title (no phone numbers). */
export function alertTitle(parts: string[], lastProblem: string | null): string {
  const base = `${ALERT_PREFIX}${parts.join(", ")}.`;
  const tail = " Interakt/Cloudflare check karein";
  const withLast = lastProblem ? `${base} Last: ${scrub(lastProblem)}.${tail}` : null;
  if (withLast && withLast.length <= TITLE_LIMIT) return withLast;
  return clip(base + tail, TITLE_LIMIT);
}

/**
 * Daily check (10:00 AM IST cron). Returns the task_assigned_v1 notices for the new alert tasks.
 * Never throws; a failing Firestore read is only logged.
 */
export async function runHealthCheck(store: Store, now: Date, opts: HealthCheckOptions = {}): Promise<Outgoing[]> {
  const silenceHours = opts.webhookSilenceHours ?? 48;
  const lagMinutes = opts.reminderLagMinutes ?? 60;

  let health: Health | null;
  let latest: Date | null;
  let users: User[];
  let stuck: number;
  try {
    [health, latest, users] = await Promise.all([store.getHealth(), store.latestWebhookAt(), store.listUsers()]);
    const active = new Set(users.map((u) => u.phone));
    const cutoff = now.getTime() - lagMinutes * MINUTE_MS;
    const pending = await store.listTasks({ status: "pending" });
    stuck = pending.filter(
      (t) => t.nextReminderAt && new Date(t.nextReminderAt).getTime() < cutoff && active.has(t.assigneePhone),
    ).length;
  } catch (err) {
    // Nothing else works without Firestore (not even the alert task), so the log is all we can do.
    console.error("health: check could not read Firestore", String(err));
    return [];
  }

  const h = health ?? emptyHealth(now);
  const parts: string[] = [];
  // a. problems counted since the last check
  if (h.sendFailures > 0) parts.push(`${h.sendFailures} message fail hue`);
  if (h.templateFailures > 0) parts.push(`${h.templateFailures} template fail (text bheja)`);
  if (h.errors > 0) parts.push(`${h.errors} error aaye`);
  // b. no incoming webhook: broken Interakt webhook URL/secret (happened before)
  if (!latest || now.getTime() - latest.getTime() > silenceHours * HOUR_MS) parts.push(silenceText(latest, now));
  // c. reminder backlog: the 5-minute reminder cron is stuck or crashing
  if (stuck > 0) parts.push(`${stuck} reminder ${lagMinutes} min se zyada late (reminder cron atka?)`);

  const outs: Outgoing[] = [];
  if (parts.length) {
    const title = alertTitle(parts, h.sendFailures || h.templateFailures || h.errors ? h.lastProblem : null);
    console.warn("health: problems found", title);
    const due = { dueAt: alertDueAt(now), hasTime: true };
    for (const admin of users.filter((u) => u.role === "admin" && u.active)) {
      try {
        const open = await store.listTasks({ assigneePhone: admin.phone, status: "pending" });
        if (open.some((t) => t.title.startsWith(ALERT_PREFIX.trim()))) {
          console.log("health: alert already pending for an admin, not adding another");
          continue;
        }
        const res = await createTaskFor(store, BOT_ACTOR, { title, assignee: admin, due, repeat: "none" }, now);
        if (res.ok) outs.push(...res.outs);
        else console.error("health: alert task refused", res.code, res.error);
      } catch (err) {
        console.error("health: alert task failed", String(err));
      }
    }
  } else {
    console.log("health: all ok");
  }

  // Reset the window. Re-read first so problems recorded while the check ran are kept.
  try {
    const latestHealth = (await store.getHealth()) ?? h;
    await store.saveHealth({
      since: now.toISOString(),
      sendFailures: Math.max(0, latestHealth.sendFailures - h.sendFailures),
      templateFailures: Math.max(0, latestHealth.templateFailures - h.templateFailures),
      errors: Math.max(0, latestHealth.errors - h.errors),
      lastProblem: latestHealth.lastProblem,
      lastProblemAt: latestHealth.lastProblemAt,
      lastCheckAt: now.toISOString(),
    });
  } catch (err) {
    console.error("health: could not reset counters", String(err));
  }
  return outs;
}
