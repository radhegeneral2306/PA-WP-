// Pure helpers for the Phase 4 forms (date change, remark). All dates are IST (UTC+5:30).
const IST_OFFSET_MS = 330 * 60 * 1000;

export const REMARK_MAX = 500;
/** Matches the Worker: a due date without a time means 10:00 AM IST. */
export const DEFAULT_HOUR = 10;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Today's date in IST as "YYYY-MM-DD" (for `<input type="date" min>`). */
export function todayIst(now: Date = new Date()): string {
  const d = new Date(now.getTime() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "YYYY-MM-DD" when it is a real calendar day. */
export function isValidDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** "HH:MM", 24 hour. */
export function isValidTime(time: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

/** The instant (ms) for an IST date and optional time; no time means 10:00 AM. Null when invalid. */
export function istInstant(date: string, time: string | null): number | null {
  if (!isValidDate(date)) return null;
  if (time !== null && time !== "" && !isValidTime(time)) return null;
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time ? time.split(":").map(Number) : [DEFAULT_HOUR, 0];
  return Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MS;
}

export interface DueError {
  field: "date" | "time";
  message: string;
}

/** Client-side guard for "Date badlo". Returns the error and which field it belongs to, or null. */
export function validateDue(date: string, time: string | null, now: Date = new Date()): DueError | null {
  if (!date) return { field: "date", message: "Nayi date chuniye" };
  if (!isValidDate(date)) return { field: "date", message: "Date sahi nahi hai" };
  if (time && !isValidTime(time)) return { field: "time", message: "Time sahi nahi hai" };
  if (date < todayIst(now)) return { field: "date", message: "Purani date nahi chal sakti. Aaj ya aage ki date chuniye." };
  const at = istInstant(date, time || null);
  if (at === null) return { field: "date", message: "Date sahi nahi hai" };
  if (at < now.getTime()) {
    return time
      ? { field: "time", message: "Ye time nikal chuka hai. Aage ka time chuniye." }
      : { field: "time", message: "Aaj 10:00 AM nikal chuka hai. Time daaliye ya aage ki date chuniye." };
  }
  return null;
}

/** Client-side guard for a remark. */
export function validateRemark(text: string): string | null {
  const t = text.trim();
  if (!t) return "Remark likhiye";
  if (t.length > REMARK_MAX) return `Remark ${REMARK_MAX} akshar se lamba nahi ho sakta`;
  return null;
}

/** Same limit as the WhatsApp "Naya task" wizard. */
export const TITLE_MAX = 200;

export interface NewTaskErrors {
  title?: string;
  assignee?: string;
  due?: DueError;
}

/** Client-side guard for "Naya task". All fields are checked at once so every error shows together. */
export function validateNewTask(
  input: { title: string; assignee: string | null; date: string; time: string },
  now: Date = new Date(),
): NewTaskErrors {
  const errors: NewTaskErrors = {};
  const t = input.title.trim();
  if (!t) errors.title = "Task kya hai, likhiye";
  else if (t.length > TITLE_MAX) errors.title = `${TITLE_MAX} akshar tak likhiye`;
  if (!input.assignee) errors.assignee = "Kisko dena hai, chuniye";
  const due = validateDue(input.date, input.time || null, now);
  if (due) errors.due = due.field === "date" && !input.date ? { field: "date", message: "Date chuniye" } : due;
  return errors;
}
