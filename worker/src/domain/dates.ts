// IST (UTC+05:30, no DST) date helpers. Workers run in UTC, so every
// conversion uses a fixed offset instead of the machine's time zone.

export const DEFAULT_HOUR = 10;
export const DEFAULT_MINUTE = 0;

export interface Clock {
  hour: number;
  minute: number;
}
export interface ISTDay {
  year: number;
  month: number;
  day: number;
}
export interface ParsedDue {
  dueAt: Date;
  hasTime: boolean;
}

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const RELATIVE: Record<string, number> = {
  aaj: 0, today: 0, kal: 1, tomorrow: 1, tmrw: 1, parso: 2, parson: 2, "day after tomorrow": 2,
};
type Period = "am" | "pm" | "night";
const PERIODS: Record<string, Period> = {
  subah: "am", subha: "am", morning: "am",
  dopahar: "pm", dopehar: "pm", dupahar: "pm", afternoon: "pm",
  shaam: "pm", sham: "pm", evening: "pm",
  raat: "night", rat: "night", night: "night",
};
const FILLER = new Set(["ko", "at", "@", "on", "by"]);
const ROLLOVER_GRACE_DAYS = 7;

const toDate = (d: Date | string): Date => (typeof d === "string" ? new Date(d) : d);
const dayNumber = (d: ISTDay): number => Date.UTC(d.year, d.month - 1, d.day) / DAY_MS;
const pad2 = (n: number): string => String(n).padStart(2, "0");

export function istDay(d: Date): ISTDay {
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate() };
}

export function atIST(day: ISTDay, clock: Clock = { hour: DEFAULT_HOUR, minute: DEFAULT_MINUTE }): Date {
  return new Date(Date.UTC(day.year, day.month - 1, day.day, clock.hour, clock.minute) - IST_OFFSET_MS);
}

export function addDays(day: ISTDay, n: number): ISTDay {
  const d = new Date((dayNumber(day) + n) * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidDay(year: number, month: number, day: number): boolean {
  return (
    Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day) &&
    month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
  );
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

const TIME_RE =
  /^(?:([a-z]+) )?(\d{1,2})(?:[:.](\d{2}))? ?(am|pm|a\.m\.|p\.m\.)?(?: ?(baje|bje))?(?: ([a-z]+))?$/;

export function parseTime(input: string): Clock | null {
  const m = TIME_RE.exec(normalize(input));
  if (!m) return null;
  const [, pre, hText, mText, mer, baje, post] = m;
  if (pre && !(pre in PERIODS)) return null;
  if (post && !(post in PERIODS)) return null;
  if (pre && post) return null;
  const period = PERIODS[pre ?? post ?? ""];
  if (!period && !mer && !baje && mText === undefined) return null;

  const h = Number(hText);
  const minute = mText === undefined ? 0 : Number(mText);
  if (minute > 59) return null;
  const hour = resolveHour(h, hText, mer?.[0] as "a" | "p" | undefined, period);
  return hour === null ? null : { hour, minute };
}

function resolveHour(h: number, hText: string, mer: "a" | "p" | undefined, period: Period | undefined): number | null {
  if (mer) {
    if (h < 1 || h > 12) return null;
    return mer === "a" ? h % 12 : (h % 12) + 12;
  }
  if (period === "am") return h >= 1 && h <= 12 ? h : null;
  if (period === "pm") return h >= 1 && h <= 12 ? (h % 12) + 12 : null;
  if (period === "night") {
    if (h < 1 || h > 12) return null;
    if (h === 12) return 0;
    return h <= 5 ? h : h + 12;
  }
  if (h > 23) return null;
  // Explicit 24h ("16:00", "07:00", "0:30") is taken literally.
  if (h === 0 || h >= 13 || hText.length === 2 && hText.startsWith("0")) return h;
  if (h === 12) return 12;
  return h <= 7 ? h + 12 : h;
}

function resolveYear(month: number, day: number, yearText: string | undefined, now: Date): ISTDay | null {
  if (yearText !== undefined) {
    const y = Number(yearText);
    const year = yearText.length === 2 ? 2000 + y : y;
    return isValidDay(year, month, day) ? { year, month, day } : null;
  }
  const today = istDay(now);
  let year = today.year;
  if (dayNumber({ year, month, day }) < dayNumber(today) - ROLLOVER_GRACE_DAYS) year += 1;
  return isValidDay(year, month, day) ? { year, month, day } : null;
}

const NUMERIC_RE = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/;
const DAY_MONTH_RE = /^(\d{1,2})(?:st|nd|rd|th)? ?([a-z]+)\.?(?: (\d{4}))?$/;
const MONTH_DAY_RE = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/;

/** The IST day named by a date phrase (no time), or null. */
export function parseDay(input: string, now: Date): ISTDay | null {
  const s = normalize(input);
  if (s in RELATIVE) return addDays(istDay(now), RELATIVE[s]);

  let m = NUMERIC_RE.exec(s);
  if (m) return resolveYear(Number(m[2]), Number(m[1]), m[3], now);
  m = DAY_MONTH_RE.exec(s);
  if (m && m[2] in MONTHS) return resolveYear(MONTHS[m[2]], Number(m[1]), m[3], now);
  m = MONTH_DAY_RE.exec(s);
  if (m && m[1] in MONTHS) return resolveYear(MONTHS[m[1]], Number(m[2]), m[3], now);
  return null;
}

export function parseDue(input: string, now: Date): ParsedDue | null {
  const tokens = normalize(input).split(" ").filter((t) => t && !FILLER.has(t));
  if (tokens.length === 0) return null;

  for (let k = tokens.length; k >= 1; k--) {
    const left = tokens.slice(0, k).join(" ");
    const right = tokens.slice(k).join(" ");
    const dayFirst = parseDay(left, now);
    if (dayFirst) {
      if (!right) return { dueAt: atIST(dayFirst), hasTime: false };
      const clock = parseTime(right);
      if (clock) return { dueAt: atIST(dayFirst, clock), hasTime: true };
    }
    if (right) {
      const dayLast = parseDay(right, now);
      const clock = dayLast && parseTime(left);
      if (dayLast && clock) return { dueAt: atIST(dayLast, clock), hasTime: true };
    }
  }
  return null;
}

export function dueOnDay(day: ISTDay, timeText: string | null): ParsedDue | null {
  const t = normalize(timeText ?? "");
  if (t === "" || t === "skip") return { dueAt: atIST(day), hasTime: false };
  const clock = parseTime(t);
  return clock ? { dueAt: atIST(day, clock), hasTime: true } : null;
}

function formatDay(d: Date, now: Date): string {
  const day = istDay(d);
  const base = `${day.day} ${MONTH_SHORT[day.month - 1]}`;
  return day.year === istDay(now).year ? base : `${base} ${day.year}`;
}

function formatClock(d: Date): string {
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  const h = s.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(s.getUTCMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

export function formatDue(dueAt: Date | string, hasTime: boolean, now: Date): string {
  const d = toDate(dueAt);
  return hasTime ? `${formatDay(d, now)}, ${formatClock(d)}` : formatDay(d, now);
}

export function formatDateTime(d: Date | string, now: Date): string {
  return formatDue(d, true, now);
}

export function daysFromToday(target: Date | string, now: Date): number {
  return dayNumber(istDay(toDate(target))) - dayNumber(istDay(now));
}

export function isBeyondDays(target: Date | string, now: Date, days: number): boolean {
  return daysFromToday(target, now) > days;
}

export function isOverdue(dueAt: Date | string, now: Date): boolean {
  return toDate(dueAt).getTime() < now.getTime();
}

export function clampDayOfMonth(year: number, month: number, day: number): ISTDay {
  return { year, month, day: Math.min(Math.max(day, 1), daysInMonth(year, month)) };
}
