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
