// Reminder timing rules shared by the flows and the scheduler.

import { addDays, atIST, clampDayOfMonth, istDay } from "./dates";
import type { NewTask, Task } from "./types";

export const WORK_START_HOUR = 10;
export const WORK_END_HOUR = 20;
export const REPEAT_MINUTES = 90;

const IST_OFFSET_MS = 330 * 60_000;

function istHourMinute(t: Date): number {
  const ist = new Date(t.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** Moves an instant into working hours: before 10 AM → 10 AM that day; 8 PM or later → 10 AM next day. */
export function intoWorkingHours(t: Date): Date {
  const minutes = istHourMinute(t);
  const day = istDay(t);
  if (minutes < WORK_START_HOUR * 60) return atIST(day, { hour: WORK_START_HOUR, minute: 0 });
  if (minutes >= WORK_END_HOUR * 60) return atIST(addDays(day, 1), { hour: WORK_START_HOUR, minute: 0 });
  return t;
}

/** 10 AM IST on the day after `now`. */
export function nextMorning(now: Date): Date {
  return atIST(addDays(istDay(now), 1), { hour: WORK_START_HOUR, minute: 0 });
}

/** nextReminderAt to store after a reminder went out at `sentAt`; null = no more reminders. */
export function afterReminder(task: Pick<Task, "repeat">, sentAt: Date): string | null {
  if (task.repeat !== "every90") return null;
  return intoWorkingHours(new Date(sentAt.getTime() + REPEAT_MINUTES * 60_000)).toISOString();
}

/**
 * nextReminderAt after the assignee answers without finishing (remark):
 * every90 pauses until the next working morning; other kinds keep their schedule.
 */
export function afterResponse(task: Pick<Task, "repeat" | "nextReminderAt">, now: Date): string | null {
  return task.repeat === "every90" ? nextMorning(now).toISOString() : task.nextReminderAt;
}

/** Same day next month (clamped to month end), same IST time of day. */
export function nextMonthlyDue(task: Pick<Task, "dueAt" | "repeatDay">): Date {
  const due = new Date(task.dueAt);
  const day = istDay(due);
  const minutes = istHourMinute(due);
  const year = day.month === 12 ? day.year + 1 : day.year;
  const month = day.month === 12 ? 1 : day.month + 1;
  const target = clampDayOfMonth(year, month, task.repeatDay ?? day.day);
  return atIST(target, { hour: Math.floor(minutes / 60), minute: minutes % 60 });
}

/** The next occurrence of a monthly task that was just marked done. */
export function nextMonthlyTask(task: Task, now: Date): NewTask {
  const { id: _id, ...rest } = task;
  const dueAt = nextMonthlyDue(task).toISOString();
  const stamp = now.toISOString();
  return {
    ...rest,
    dueAt,
    status: "pending",
    nextReminderAt: dueAt,
    repeatDay: task.repeatDay ?? istDay(new Date(task.dueAt)).day,
    dateRequest: null,
    lastReminderAt: null,
    remarks: [],
    createdAt: stamp,
    updatedAt: stamp,
    doneAt: null,
  };
}
