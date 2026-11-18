// GET /api/tasks/:id/history: a timeline built from the task itself (one store read, no phones).
// Kinds: created, remark, done, cancelled, deleted. A restore from the bin shows up as the remark
// "Recycle bin se wapas", so there is no extra kind. Matched like the write routes (id bound in).

import type { Task } from "../../domain/types";
import { json, type ApiContext, type Route } from "../api";

export type HistoryKind = "created" | "remark" | "done" | "cancelled" | "deleted";

export interface HistoryEvent {
  at: string;
  kind: HistoryKind;
  by: string | null;
  text: string;
}

const PATH_RE = /^\/api\/tasks\/([^/]+)\/history$/;

export function historyEvents(task: Task): HistoryEvent[] {
  const events: HistoryEvent[] = [{ at: task.createdAt, kind: "created", by: task.createdByName || null, text: "Task bana" }];
  for (const r of task.remarks ?? []) events.push({ at: r.at, kind: "remark", by: r.byName || null, text: r.text });
  if (task.doneAt) events.push({ at: task.doneAt, kind: "done", by: null, text: "Task done" });
  if (task.cancelledAt) events.push({ at: task.cancelledAt, kind: "cancelled", by: task.cancelledByName ?? null, text: "Task cancel kiya" });
  if (task.deletedAt) events.push({ at: task.deletedAt, kind: "deleted", by: task.deletedByName ?? null, text: "Recycle bin mein daala" });
  // Stable: events with the same time keep the order above (created first).
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

export function historyResponse(task: Task) {
  return {
    task: {
      id: task.id,
      title: task.title,
      assigneeName: task.assigneeName,
      createdByName: task.createdByName,
      status: task.status,
      createdAt: task.createdAt,
      dueAt: task.dueAt,
      dueHasTime: task.dueHasTime,
    },
    events: historyEvents(task),
  };
}

async function run(ctx: ApiContext, id: string): Promise<Response> {
  const task = await ctx.store.getTask(id);
  if (!task) return json({ error: "Task nahi mila", code: "not_found" }, 404);
  return json(historyResponse(task));
}

function isSafeId(id: string): boolean {
  return id.length <= 256 && id !== "." && id !== ".." && !/[/\\\u0000-\u001f\u007f]/.test(id);
}

/** `GET /api/tasks/<id>/history` → a route with the id bound in; null otherwise. */
export function matchHistoryRoute(method: string, path: string): { route: Route; id: string } | null {
  if (method !== "GET") return null;
  const m = PATH_RE.exec(path);
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  if (!isSafeId(id)) return null;
  return { route: { method: "GET", path, auth: "session", handler: (ctx) => run(ctx, id) }, id };
}
