// Daily summary (cron, 10:00 AM IST): pending / overdue counts per active user.
// Only users with something due today or overdue get it (owner decision 28 Oct: saves template
// cost and noise; someone whose tasks are all in the future gets nothing that day).

import { istDay, isOverdue } from "../domain/dates";
import type { Task, User } from "../domain/types";
import type { Store } from "../data/store";
import type { Outgoing } from "../bot/outgoing";

interface Counts {
  pending: number;
  overdue: number;
  /** Due later today (IST), not yet overdue. */
  today: number;
}

const sameIstDay = (a: Date, b: Date): boolean => {
  const x = istDay(a);
  const y = istDay(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
};

function countByAssignee(tasks: Task[], now: Date): Map<string, Counts> {
  const counts = new Map<string, Counts>();
  for (const t of tasks) {
    const c = counts.get(t.assigneePhone) ?? { pending: 0, overdue: 0, today: 0 };
    c.pending++;
    if (isOverdue(t.dueAt, now)) c.overdue++;
    else if (sameIstDay(new Date(t.dueAt), now)) c.today++;
    counts.set(t.assigneePhone, c);
  }
  return counts;
}

export function summaryMessage(user: User, c: Counts): Outgoing {
  return {
    to: user.phone,
    kind: "template",
    template: "daily_summary_v1",
    bodyValues: [user.name, String(c.pending), String(c.overdue)],
    fallbackText:
      `☀️ Namaste ${user.name} ji, aaj ke tasks ki summary:\n\n` +
      `Pending tasks: ${c.pending}\nOverdue tasks: ${c.overdue}\n\n` +
      "Dekhne ke liye *Mere tasks* likhiye.",
  };
}

export async function runDailySummary(store: Store, now: Date): Promise<Outgoing[]> {
  const [users, tasks] = await Promise.all([store.listUsers(), store.listTasks({ status: "pending" })]);
  const counts = countByAssignee(tasks, now);
  const out: Outgoing[] = [];
  for (const user of users) {
    const c = counts.get(user.phone);
    if (user.active && c && (c.today > 0 || c.overdue > 0)) out.push(summaryMessage(user, c));
  }
  console.log(`daily summary: ${out.length} users`);
  return out;
}
