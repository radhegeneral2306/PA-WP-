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
  "agle hafte": 7, "agla hafta": 7, "agle week": 7, "next week": 7,
};
// 0 = Sunday … 6 = Saturday (JS getUTCDay). A weekday means the coming one; today's name means +7.
const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, ravivar: 0, raviwar: 0, itvaar: 0, itvar: 0, itwar: 0, itwaar: 0,
  monday: 1, mon: 1, somvar: 1, somwar: 1,
  tuesday: 2, tue: 2, tues: 2, mangalvar: 2, mangalwar: 2, mangal: 2,
  wednesday: 3, wed: 3, budhvar: 3, budhwar: 3, budh: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, guruvar: 4, guruwar: 4, brihaspativar: 4, brihaspatiwar: 4,
  friday: 5, fri: 5, shukravar: 5, shukrawar: 5, shukra: 5,
  saturday: 6, sat: 6, shanivar: 6, shaniwar: 6, shani: 6,
};
// Devanagari words mapped to their roman spelling before parsing.
const DEVANAGARI: Record<string, string> = {
  "आज": "aaj", "कल": "kal", "परसों": "parso", "परसो": "parso",
  "सुबह": "subah", "दोपहर": "dopahar", "शाम": "shaam", "रात": "raat", "बजे": "baje", "को": "ko",
};
type Period = "am" | "pm" | "night";
const PERIODS: Record<string, Period> = {
  subah: "am", subha: "am", morning: "am",
  dopahar: "pm", dopehar: "pm", dupahar: "pm", afternoon: "pm",
  shaam: "pm", sham: "pm", evening: "pm",
  raat: "night", rat: "night", night: "night",
};
// A time-of-day word on its own: subah 10 AM, dopahar 2 PM, shaam 6 PM, raat 8 PM.
const PERIOD_DEFAULT_HOUR: Record<string, number> = {
  subah: 10, subha: 10, morning: 10,
  dopahar: 14, dopehar: 14, dupahar: 14, afternoon: 14,
  shaam: 18, sham: 18, evening: 18,
  raat: 20, rat: 20, night: 20,
};
const FILLER = new Set(["ko", "at", "@", "on", "by"]);
// A typed day/month without a year that passed less than this many days ago stays in the
// current year (callers then refuse it as past); older ones roll to next year.
const ROLLOVER_PAST_DAYS = 180;

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
  return input
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?\u0964]+$/, "") // trailing punctuation: "Kal." == "kal"
    .split(" ")
    .map((t) => DEVANAGARI[t] ?? t)
    .join(" ")
    .trim();
}

const TIME_RE =
  /^(?:([a-z]+) )?(\d{1,2})(?:[:.](\d{2}))? ?(am|pm|a\.m\.?|p\.m\.?)?(?: ?(baje|bje))?(?: ([a-z]+))?$/;

/** A parsed time plus how it shifts the day: "raat 12" / "raat 2" fall after midnight (+1 day). */
interface TimeOfDay extends Clock {
  dayShift: number;
  hasPeriod: boolean;
}

export function parseTime(input: string): Clock | null {
  const t = parseTimeOfDay(input);
  return t && { hour: t.hour, minute: t.minute };
}

function parseTimeOfDay(input: string): TimeOfDay | null {
  const s = normalize(input);
  if (s in PERIOD_DEFAULT_HOUR) return { hour: PERIOD_DEFAULT_HOUR[s], minute: 0, dayShift: 0, hasPeriod: true };
  const m = TIME_RE.exec(s);
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
  if (hour === null) return null;
  // "raat 12" / "raat 1".."raat 5" are after midnight, i.e. the next calendar day.
  const dayShift = period === "night" && hour <= 5 ? 1 : 0;
  return { hour, minute, dayShift, hasPeriod: period !== undefined };
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
  if (dayNumber(today) - dayNumber({ year, month, day }) >= ROLLOVER_PAST_DAYS) year += 1;
  return isValidDay(year, month, day) ? { year, month, day } : null;
}

const NUMERIC_RE = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/;
const DAY_MONTH_RE = /^(\d{1,2})(?:st|nd|rd|th)? ?([a-z]+)\.?(?: (\d{4}))?$/;
const MONTH_DAY_RE = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/;

/** The IST day named by a date phrase (no time), or null. */
export function parseDay(input: string, now: Date): ISTDay | null {
  const s = normalize(input);
  if (s in RELATIVE) return addDays(istDay(now), RELATIVE[s]);
  if (s in WEEKDAYS) {
    const today = istDay(now);
    const ahead = (WEEKDAYS[s] - new Date(dayNumber(today) * DAY_MS).getUTCDay() + 7) % 7;
    return addDays(today, ahead === 0 ? 7 : ahead);
  }

  let m = NUMERIC_RE.exec(s);
  if (m) return resolveYear(Number(m[2]), Number(m[1]), m[3], now);
  m = DAY_MONTH_RE.exec(s);
  if (m && m[2] in MONTHS) return resolveYear(MONTHS[m[2]], Number(m[1]), m[3], now);
  m = MONTH_DAY_RE.exec(s);
  if (m && m[1] in MONTHS) return resolveYear(MONTHS[m[1]], Number(m[2]), m[3], now);
  return null;
}

const timed = (day: ISTDay, t: TimeOfDay): ParsedDue => ({
  dueAt: atIST(addDays(day, t.dayShift), { hour: t.hour, minute: t.minute }),
  hasTime: true,
});

export function parseDue(input: string, now: Date): ParsedDue | null {
  const tokens = normalize(input).split(" ").filter((t) => t && !FILLER.has(t));
  if (tokens.length === 0) return null;

  for (let k = tokens.length; k >= 1; k--) {
    const left = tokens.slice(0, k).join(" ");
    const right = tokens.slice(k).join(" ");
    const dayFirst = parseDay(left, now);
    if (dayFirst) {
      if (!right) return { dueAt: atIST(dayFirst), hasTime: false };
      const t = parseTimeOfDay(right);
      if (t) return timed(dayFirst, t);
    }
    if (right) {
      const dayLast = parseDay(right, now);
      const t = dayLast && parseTimeOfDay(left);
      if (dayLast && t) return timed(dayLast, t);
    }
  }
  // A time-of-day word with no day ("shaam", "raat 9") means today.
  const t = parseTimeOfDay(tokens.join(" "));
  return t?.hasPeriod ? timed(istDay(now), t) : null;
}

export function dueOnDay(day: ISTDay, timeText: string | null): ParsedDue | null {
  const t = normalize(timeText ?? "");
  if (t === "" || t === "skip") return { dueAt: atIST(day), hasTime: false };
  const tod = parseTimeOfDay(t);
  return tod ? timed(day, tod) : null;
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
