// GET /api/export?from=YYYY-MM-DD&to=YYYY-MM-DD&status=all|pending|done|cancelled (Round 3, F9).
// A CSV that opens in Excel: UTF-8 with BOM, CRLF lines, every field quoted. Range on the due
// date's IST day (inclusive), at most 366 days. Never deleted tasks, never phone numbers.
//
// Firestore reads: one equality query on status (all = pending + done + cancelled, three queries),
// so the cost is the number of tasks with the chosen status(es); the date range is applied in memory
// (no composite index). Deleted tasks are never read.

import { branchName, type Task, type TaskRepeat, type TaskStatus } from "../../domain/types";
import { isValidDay, istDay } from "../../domain/dates";
import { json, type ApiContext, type Route } from "../api";

export const EXPORT_MAX_DAYS = 366;
const STATUSES = ["pending", "done", "cancelled"] as const;
type ExportStatus = (typeof STATUSES)[number];

export const EXPORT_COLUMNS = ["Task", "Kisko", "Branch", "Diya", "Due", "Status", "Done date", "Urgent", "Repeat", "Last remark"];
const STATUS_LABELS: Record<Exclude<TaskStatus, "deleted">, string> = { pending: "Pending", done: "Done", cancelled: "Cancelled" };
const REPEAT_LABELS: Record<TaskRepeat, string> = { none: "Ek baar", every90: "Har 90 min", monthly: "Har mahine", weekly: "Har hafte" };
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

const bad = (error: string): Response => json({ error, code: "bad_request" }, 400);

/** "YYYY-MM-DD" → day number (days since epoch), or null when not a real date. */
function dayNumber(s: string | null): number | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return isValidDay(y, m, d) ? Date.UTC(y, m - 1, d) / DAY_MS : null;
}

const istDayNumber = (iso: string): number => {
  const d = istDay(new Date(iso));
  return Date.UTC(d.year, d.month - 1, d.day) / DAY_MS;
};

/** Always with the year: "28 Oct 2026", with time "28 Oct 2026, 4:00 PM" (IST). */
export function exportDate(iso: string, withTime: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  const day = `${s.getUTCDate()} ${MONTH_SHORT[s.getUTCMonth()]} ${s.getUTCFullYear()}`;
  if (!withTime) return day;
  const h = s.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${day}, ${h12}:${String(s.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Quoted CSV field. Text starting like a formula (= + - @) gets a leading ' so Excel shows it as text. */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function row(t: Task): string[] {
  const last = t.remarks?.length ? t.remarks[t.remarks.length - 1].text : "";
  return [
    t.title,
    t.assigneeName,
    branchName(t.branch ?? null),
    t.createdByName,
    exportDate(t.dueAt, t.dueHasTime),
    STATUS_LABELS[t.status as ExportStatus] ?? t.status,
    t.status === "done" && t.doneAt ? exportDate(t.doneAt, true) : "",
    t.urgent ? "Haan" : "—",
    REPEAT_LABELS[t.repeat] ?? t.repeat,
    last,
  ];
}

export function tasksCsv(tasks: Task[]): string {
  const lines = [EXPORT_COLUMNS, ...tasks.map(row)].map((cells) => cells.map(csvField).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

async function getExport(ctx: ApiContext): Promise<Response> {
  const params = new URL(ctx.request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const fromDay = dayNumber(from);
  const toDay = dayNumber(to);
  if (fromDay === null || toDay === null) return bad("from aur to date YYYY-MM-DD mein dijiye");
  if (fromDay > toDay) return bad("from date to date se pehle honi chahiye");
  if (toDay - fromDay + 1 > EXPORT_MAX_DAYS) return bad(`Ek baar mein ${EXPORT_MAX_DAYS} din tak ka hi export ho sakta hai`);
  const status = params.get("status") ?? "all";
  if (status !== "all" && !STATUSES.includes(status as ExportStatus)) return bad("status all, pending, done ya cancelled hona chahiye");

  const wanted: readonly ExportStatus[] = status === "all" ? STATUSES : [status as ExportStatus];
  const lists = await Promise.all(wanted.map((s) => ctx.store.listTasks({ status: s })));
  const tasks = lists
    .flat()
    .filter((t) => t.status !== "deleted" && wanted.includes(t.status as ExportStatus))
    .filter((t) => {
      const day = istDayNumber(t.dueAt);
      return day >= fromDay && day <= toDay;
    })
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.createdAt.localeCompare(b.createdAt));

  return new Response(tasksCsv(tasks), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="radhe-tasks-${from}-to-${to}.csv"`,
      "Access-Control-Expose-Headers": "Content-Disposition",
      "Cache-Control": "no-store",
    },
  });
}

export const exportRoutes: Route[] = [{ method: "GET", path: "/api/export", auth: "session", handler: getExport }];
