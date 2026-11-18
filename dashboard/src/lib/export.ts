// F9 "Excel download": pure helpers for the CSV export form. Dates are IST calendar days.
import { isValidDate, todayIst } from "./due";
import type { ExportStatus } from "./types";

/** The Worker refuses a longer range. */
export const EXPORT_MAX_DAYS = 366;

export const EXPORT_STATUSES: { key: ExportStatus; label: string }[] = [
  { key: "all", label: "Sabhi" },
  { key: "pending", label: "Pending" },
  { key: "done", label: "Done" },
  { key: "cancelled", label: "Cancelled" },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Default range: this IST month, 1st to its last day. */
export function thisMonthRange(now: Date = new Date()): { from: string; to: string } {
  const today = todayIst(now);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

/** Days in the range, both ends included ("2026-11-01".."2026-11-30" is 30). */
export function rangeDays(from: string, to: string): number {
  const ms = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((ms(to) - ms(from)) / 86_400_000) + 1;
}

export interface RangeError {
  field: "from" | "to";
  message: string;
}

export function validateExportRange(from: string, to: string): RangeError | null {
  if (!from) return { field: "from", message: "Shuru ki date chuniye" };
  if (!isValidDate(from)) return { field: "from", message: "Date sahi nahi hai" };
  if (!to) return { field: "to", message: "Aakhri date chuniye" };
  if (!isValidDate(to)) return { field: "to", message: "Date sahi nahi hai" };
  if (to < from) return { field: "to", message: "Aakhri date shuru ki date se pehle nahi ho sakti" };
  if (rangeDays(from, to) > EXPORT_MAX_DAYS) return { field: "to", message: `Ek baar mein ${EXPORT_MAX_DAYS} din tak ka hi download hoga` };
  return null;
}

/** Same name the Worker puts in Content-Disposition; used when the header is not readable (CORS). */
export function exportFilename(from: string, to: string): string {
  return `radhe-tasks-${from}-to-${to}.csv`;
}

export function exportPath(from: string, to: string, status: ExportStatus): string {
  const q = new URLSearchParams({ from, to, status });
  return `/api/export?${q.toString()}`;
}

/** The filename from a Content-Disposition header, or null. Only a plain safe name is accepted. */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  let name: string | null = null;
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      name = null;
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
    name = plain ? plain[1].trim() : null;
  }
  return name && /^[\w.-]+$/.test(name) ? name : null;
}

/** Hands a Blob to the browser as a file download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Some browsers start the download after click returns; give them a moment before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
