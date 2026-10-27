// Due reminders (cron, every 5 minutes). Reads and updates the Store and
// returns the messages to send; delivery is the caller's job.

import { formatDue } from "../domain/dates";
import { afterReminder, reminderSlot } from "../domain/schedule";
import type { Task, User } from "../domain/types";
import type { Store } from "../data/store";
import type { Outgoing } from "../bot/outgoing";
import { clip } from "../bot/ui";

const OVERDUE_GRACE_MS = 5 * 60_000;
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

async function remindOne(store: Store, listed: Task, now: Date, stats: ReminderStats): Promise<Outgoing | null> {
  // Re-read: the task may have been done, cancelled, re-dated or reminded (an overlapping cron run)
  // since the list was loaded.
  const task = await store.getTask(listed.id);
  if (!task || !isReminderDue(task, now)) {
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
  await store.updateTask(task.id, { nextReminderAt: afterReminder(task, now), lastReminderAt: now.toISOString() });
  stats.sent++;
  return message;
}

export async function runReminders(store: Store, now: Date): Promise<Outgoing[]> {
  const pending = await store.listTasks({ status: "pending" });
  const due = pending.filter((t) => isReminderDue(t, now));
  const stats: ReminderStats = { due: due.length, sent: 0, stopped: 0, failed: 0 };
  const out: Outgoing[] = [];
  for (const task of due) {
    try {
      const message = await remindOne(store, task, now, stats);
      if (message) out.push(message);
    } catch (err) {
      stats.failed++;
      console.error(`reminder failed for task ${task.id}`, err);
    }
  }
  console.log(`reminders: ${JSON.stringify(stats)}`);
  return out;
}
