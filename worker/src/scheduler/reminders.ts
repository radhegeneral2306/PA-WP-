// Due reminders (cron, every 5 minutes).
//
// Free-tier limits shape this file (audit 28 Oct, S1/S2):
// - Firestore Spark: 50k reads/day, so each run reads only the DUE tasks (listDueTasks), not every
//   pending task.
// - Cloudflare Workers Free: 50 subrequests per run. One reminder costs ~5 (re-read, user, send,
//   maybe a text fallback, save), so a run handles at most MAX_REMINDERS_PER_RUN; the rest go out
//   on the next runs, oldest first, a few minutes later.
// - With a `send` function the reminder is SENT FIRST and nextReminderAt is saved only after a
//   successful send; a failed send is retried after RETRY_AFTER_FAILURE_MS instead of being lost.

import { formatDue } from "../domain/dates";
import { afterReminder, reminderSlot } from "../domain/schedule";
import type { Task, User } from "../domain/types";
import type { Store } from "../data/store";
import type { Outgoing } from "../bot/outgoing";
import { clip } from "../bot/ui";

const OVERDUE_GRACE_MS = 5 * 60_000;
/** ~5 subrequests each + 2 for the run (token, query) + 2 for health counters stays under 50. */
export const MAX_REMINDERS_PER_RUN = 8;
export const RETRY_AFTER_FAILURE_MS = 30 * 60_000;
const REMARK_MAX = 150;

export interface ReminderStats {
  due: number;
  sent: number;
  stopped: number;
  failed: number;
}

export function isReminderDue(task: Task, now: Date): boolean {
  const at = task.nextReminderAt;
  return task.status === "pending" && typeof at === "string" && at !== "" && Date.parse(at) <= now.getTime();
}

function dueText(task: Task, now: Date): string {
  const base = formatDue(task.dueAt, task.dueHasTime, now);
  const late = now.getTime() - Date.parse(task.dueAt) > OVERDUE_GRACE_MS;
  return late ? `${base} (overdue)` : base;
}

function lastRemark(task: Task): string {
  const last = task.remarks?.[task.remarks.length - 1];
  const text = last?.text.trim();
  return text ? clip(text, REMARK_MAX) : "-";
}

export function reminderMessage(task: Task, user: User, now: Date): Outgoing {
  const due = dueText(task, now);
  const remark = lastRemark(task);
  return {
    to: user.phone,
    kind: "template",
    template: "task_reminder_v1",
    bodyValues: [user.name, task.title, due, remark],
    fallbackText:
      `⏰ Reminder: ${user.name} ji, ye task pending hai.\n\n` +
      `Task: ${task.title}\nDue date: ${due}\nLast remark: ${remark}\n\n` +
      "Update ke liye *Mere tasks* likhiye.",
  };
}

/** Sends one reminder; true when it reached Interakt (or was deliberately not sent, e.g. TEST_NUMBERS). */
export type SendReminder = (message: Outgoing) => Promise<boolean>;

async function remindOne(store: Store, listed: Task, now: Date, stats: ReminderStats, send?: SendReminder): Promise<Outgoing | null> {
  // Re-read: the task may have been done, cancelled, re-dated or reminded (an overlapping cron run)
  // since the list was loaded.
  const task = await store.getTask(listed.id);
  if (!task || !isReminderDue(task, now)) {
    // A closed task that still carries a reminder time would come back in every due query and
    // crowd out real reminders: clear it once.
    if (task && task.status !== "pending" && task.nextReminderAt) await store.updateTask(task.id, { nextReminderAt: null });
    stats.stopped++;
    return null;
  }
  // every90 reminders only go out 10 AM–8 PM IST: a due time at night waits for the morning.
  const slot = reminderSlot(task, new Date(task.nextReminderAt!));
  if (slot.getTime() > now.getTime()) {
    await store.updateTask(task.id, { nextReminderAt: slot.toISOString() });
    stats.stopped++;
    return null;
  }
  const user = await store.getUser(task.assigneePhone);
  if (!user || !user.active) {
    // Paused, not stopped: nothing is sent, but if the user is re-activated the reminders resume.
    await store.updateTask(task.id, { nextReminderAt: afterReminder(task, now) });
    stats.stopped++;
    return null;
  }
  const message = reminderMessage(task, user, now);
  if (send && !(await send(message))) {
    // Not lost: try again in a while (the health check counts the failure).
    await store.updateTask(task.id, { nextReminderAt: new Date(now.getTime() + RETRY_AFTER_FAILURE_MS).toISOString() });
    stats.failed++;
    return null;
  }
  await store.updateTask(task.id, { nextReminderAt: afterReminder(task, now), lastReminderAt: now.toISOString() });
  stats.sent++;
  return message;
}

/**
 * Handles up to `max` due reminders, oldest first. With `send`, each one is delivered before it is
 * marked as reminded and the returned list holds the ones that went out; without it (tests, older
 * callers) the messages are only planned, marked, and returned for the caller to deliver.
 */
export async function runReminders(
  store: Store,
  now: Date,
  opts: { send?: SendReminder; max?: number } = {},
): Promise<Outgoing[]> {
  const max = opts.max ?? MAX_REMINDERS_PER_RUN;
  // Oldest reminder first; same reminder time -> earlier due date first.
  const due = (await store.listDueTasks(now, max)).sort(
    (a, b) => (a.nextReminderAt ?? "").localeCompare(b.nextReminderAt ?? "") || a.dueAt.localeCompare(b.dueAt),
  );
  const stats: ReminderStats = { due: due.length, sent: 0, stopped: 0, failed: 0 };
  const out: Outgoing[] = [];
  for (const task of due) {
    try {
      const message = await remindOne(store, task, now, stats, opts.send);
      if (message) out.push(message);
    } catch (err) {
      stats.failed++;
      console.error(`reminder failed for task ${task.id}`, err);
    }
  }
  console.log(`reminders: ${JSON.stringify(stats)}`);
  return out;
}
