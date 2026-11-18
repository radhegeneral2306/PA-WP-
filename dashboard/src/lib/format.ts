import type { TaskRepeat, TaskStatus } from "./types";

// All times are stored as ISO UTC and shown in IST (UTC+5:30), whatever the device timezone.
const IST_OFFSET_MS = 330 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface IstParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function istParts(input: string | Date): IstParts {
  const ms = typeof input === "string" ? Date.parse(input) : input.getTime();
  const d = new Date(ms + IST_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

export function formatClock(input: string | Date): string {
  const p = istParts(input);
  const h = p.hour % 12 || 12;
  return `${h}:${String(p.minute).padStart(2, "0")} ${p.hour < 12 ? "AM" : "PM"}`;
}

/** "28 Oct", or "28 Oct 2025" when the year differs from the current IST year. */
export function formatDate(iso: string, now: Date = new Date()): string {
  const p = istParts(iso);
  const base = `${p.day} ${MONTHS[p.month]}`;
  return p.year === istParts(now).year ? base : `${base} ${p.year}`;
}

/** "28 Oct, 4:00 PM" */
export function formatDateTime(iso: string, now: Date = new Date()): string {
  return `${formatDate(iso, now)}, ${formatClock(iso)}`;
}

/** Due date for a task: date only when the user never gave a time. */
export function formatDue(iso: string, hasTime: boolean, now: Date = new Date()): string {
  return hasTime ? formatDateTime(iso, now) : formatDate(iso, now);
}

export function isValidIso(iso: string | null | undefined): iso is string {
  return typeof iso === "string" && !Number.isNaN(Date.parse(iso));
}

const WEEKDAYS = ["Ravivaar", "Somvaar", "Mangalvaar", "Budhvaar", "Guruvaar", "Shukravaar", "Shanivaar"];

/** IST weekday name in Hinglish ("Mangalvaar"). */
export function istWeekday(iso: string): string {
  const ms = Date.parse(iso) + IST_OFFSET_MS;
  return WEEKDAYS[new Date(ms).getUTCDay()];
}

/** Short repeat labels, same words as the bot and the CSV export. */
export const REPEAT_LABELS: Record<TaskRepeat, string> = {
  none: "Ek baar",
  every90: "Har 90 min",
  monthly: "Har mahine",
  weekly: "Har hafte",
};

/** Long repeat text for the task detail. */
export function repeatText(t: { repeat: TaskRepeat; repeatDay: number | null; dueAt: string }): string {
  if (t.repeat === "monthly") return t.repeatDay ? `Har mahine, ${t.repeatDay} tareekh` : "Har mahine";
  if (t.repeat === "weekly") return isValidIso(t.dueAt) ? `Har hafte, ${istWeekday(t.dueAt)}` : "Har hafte";
  if (t.repeat === "every90") return "Har 90 min reminder (10 AM se 8 PM)";
  return "Ek baar";
}

/** Deleted tasks are purged by the daily cleanup this many days after deletedAt. */
export const BIN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left before the auto-clean removes a deleted task (never below 0). */
export function binDaysLeft(deletedAt: string, now: Date = new Date()): number {
  const at = Date.parse(deletedAt);
  if (Number.isNaN(at)) return BIN_DAYS;
  return Math.max(0, Math.ceil((at + BIN_DAYS * DAY_MS - now.getTime()) / DAY_MS));
}

/** "12 din mein apne aap hat jayega" */
export function binDaysLeftText(deletedAt: string | null | undefined, now: Date = new Date()): string {
  if (!isValidIso(deletedAt)) return `${BIN_DAYS} din mein apne aap hat jayega`;
  const n = binDaysLeft(deletedAt, now);
  return n === 0 ? "Agli safai mein apne aap hat jayega" : `${n} din mein apne aap hat jayega`;
}

/** "Bhaskar ne delete kiya, 28 Oct, 4:00 PM" */
export function deletedText(t: { deletedAt?: string | null; deletedByName?: string | null }, now: Date = new Date()): string {
  const who = t.deletedByName ? `${t.deletedByName} ne delete kiya` : "Delete hua";
  return isValidIso(t.deletedAt) ? `${who}, ${formatDateTime(t.deletedAt, now)}` : who;
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Pending",
  done: "Done",
  cancelled: "Cancelled",
  deleted: "Recycle bin",
};
