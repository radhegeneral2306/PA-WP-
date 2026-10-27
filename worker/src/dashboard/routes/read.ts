// Phase 3 read-only routes: users list and task lists (pending / archive).
// Filtering by branch, staff and text happens in the PWA on these lists.

import { BRANCHES, type BranchId, type DateRequest, type Remark, type Task, type TaskRepeat, type TaskStatus } from "../../domain/types";
import { istDay, isOverdue } from "../../domain/dates";
import { json, type ApiContext, type Route } from "../api";

export const ARCHIVE_DEFAULT_LIMIT = 200;
export const ARCHIVE_MAX_LIMIT = 500;

/** A Task as the dashboard sees it: optional fields always present, plus computed fields. */
export interface TaskDTO {
  id: string;
  title: string;
  assigneePhone: string;
  assigneeName: string;
  branch: BranchId | null;
  createdByPhone: string;
  createdByName: string;
  dueAt: string;
  dueHasTime: boolean;
  status: TaskStatus;
  repeat: TaskRepeat;
  repeatDay: number | null;
  nextReminderAt: string | null;
  lastReminderAt: string | null;
  dateRequest: DateRequest | null;
  /** "voice" when the bot made this task from a WhatsApp voice note. */
  source: "voice" | null;
  remarks: Remark[];
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  overdue: boolean;
  dueToday: boolean;
  closedAt: string | null;
  lastRemark: Remark | null;
}

function sameIstDay(a: Date, b: Date): boolean {
  const x = istDay(a);
  const y = istDay(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

export function toTaskDTO(task: Task, now: Date): TaskDTO {
  const pending = task.status === "pending";
  const remarks = task.remarks ?? [];
  const doneAt = task.doneAt ?? null;
  const cancelledAt = task.cancelledAt ?? null;
  return {
    id: task.id,
    title: task.title,
    assigneePhone: task.assigneePhone,
    assigneeName: task.assigneeName,
    branch: task.branch ?? null,
    createdByPhone: task.createdByPhone,
    createdByName: task.createdByName,
    dueAt: task.dueAt,
    dueHasTime: task.dueHasTime,
    status: task.status,
    repeat: task.repeat,
    repeatDay: task.repeatDay ?? null,
    nextReminderAt: task.nextReminderAt ?? null,
    lastReminderAt: task.lastReminderAt ?? null,
    dateRequest: task.dateRequest ?? null,
    source: task.source === "voice" ? "voice" : null,
    remarks,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    doneAt,
    cancelledAt,
    cancelledByName: task.cancelledByName ?? null,
    overdue: pending && isOverdue(task.dueAt, now),
    dueToday: pending && sameIstDay(new Date(task.dueAt), now),
    closedAt: doneAt ?? cancelledAt,
    lastRemark: remarks.length > 0 ? remarks[remarks.length - 1] : null,
  };
}

/** Archive page size: default when missing or not a number, clamped to 1..ARCHIVE_MAX_LIMIT. */
export function archiveLimit(raw: string | null): number {
  const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(n)) return ARCHIVE_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), ARCHIVE_MAX_LIMIT);
}

const closedAtOf = (t: Task): string => t.doneAt ?? t.cancelledAt ?? "";

function newestClosedFirst(a: Task, b: Task): number {
  return closedAtOf(b).localeCompare(closedAtOf(a)) || b.updatedAt.localeCompare(a.updatedAt);
}

async function archiveTasks(ctx: ApiContext, limit: number): Promise<Task[]> {
  const [done, cancelled] = await Promise.all([
    ctx.store.listTasks({ status: "done" }),
    ctx.store.listTasks({ status: "cancelled" }),
  ]);
  return [...done, ...cancelled].sort(newestClosedFirst).slice(0, limit);
}

async function getUsers(ctx: ApiContext): Promise<Response> {
  const users = (await ctx.store.listUsers()).map(({ phone, name, role, branch }) => ({ phone, name, role, branch: branch ?? null }));
  return json({ users, branches: BRANCHES });
}

async function getTasks(ctx: ApiContext): Promise<Response> {
  const params = new URL(ctx.request.url).searchParams;
  const view = params.get("view");
  let tasks: Task[];
  if (view === "pending") tasks = await ctx.store.listTasks({ status: "pending" });
  else if (view === "archive") tasks = await archiveTasks(ctx, archiveLimit(params.get("limit")));
  else return json({ error: "view pending ya archive hona chahiye" }, 400);
  return json({ now: ctx.now.toISOString(), tasks: tasks.map((t) => toTaskDTO(t, ctx.now)) });
}

export const readRoutes: Route[] = [
  { method: "GET", path: "/api/users", auth: "session", handler: getUsers },
  { method: "GET", path: "/api/tasks", auth: "session", handler: getTasks },
];
