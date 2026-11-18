// Finds the existing task a voice note is about (Round 4). Pure functions, no I/O.
// STUB written by the coordinator so other code can compile; the matcher agent replaces the body.

import type { Task } from "../domain/types";

export interface TaskMatch {
  task: Task;
  /** Higher = better. Only tasks with score > 0 are returned. */
  score: number;
}

/**
 * Pending tasks whose title matches the spoken `words` (customer / item words), best first;
 * ties: urgent first, then earliest due. Returns [] when `words` is empty or nothing matches.
 */
export function matchTasks(tasks: Task[], words: string[], opts: { limit?: number } = {}): TaskMatch[] {
  const limit = opts.limit ?? 8;
  const needles = words.map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (needles.length === 0) return [];
  return tasks
    .map((task) => ({ task, score: needles.filter((n) => task.title.toLowerCase().includes(n)).length }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || Number(!!b.task.urgent) - Number(!!a.task.urgent) || a.task.dueAt.localeCompare(b.task.dueAt))
    .slice(0, limit);
}

/** Pending tasks to show when no words matched: urgent first, then earliest due. */
export function shortlist(tasks: Task[], limit = 8): Task[] {
  return [...tasks]
    .filter((t) => t.status === "pending")
    .sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || a.dueAt.localeCompare(b.dueAt))
    .slice(0, limit);
}
