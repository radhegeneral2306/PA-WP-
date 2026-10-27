// Task changes shared by the WhatsApp flows and the dashboard API, so both
// apply the same rules (reminders, monthly repeat, notifications).
// Callers check permissions; these functions refuse closed (done/cancelled) tasks.

import type { Store } from "../data/store";
import { atIST, formatDateTime, formatDue, isValidDay, type ParsedDue } from "../domain/dates";
import { afterResponse, nextMonthlyTask } from "../domain/schedule";
import type { DateRequest, Remark, Task, User } from "../domain/types";
import type { Outgoing } from "./outgoing";
import { clip } from "./ui";

export const REMARK_MAX = 500;
const UPDATE_CLIP = 200;

export interface Actor {
  phone: string;
  name: string;
  /** Dashboard actions are marked "(dashboard)" in remarks. */
  viaDashboard?: boolean;
}

export type ActionResult =
  | { ok: true; task: Task; next?: Task; outs: Outgoing[] }
  | { ok: false; status: number; code: string; error: string };

const fail = (status: number, code: string, error: string): ActionResult => ({ ok: false, status, code, error });

function closed(t: Task): ActionResult | null {
  if (t.status === "done") return fail(409, "task_closed", "Ye task pehle hi done ho chuka hai");
  if (t.status === "cancelled") return fail(409, "task_closed", "Ye task cancel ho chuka hai");
  return null;
}

export function remarkBy(actor: Actor, text: string, now: Date): Remark {
  const byName = actor.viaDashboard ? `${actor.name} (dashboard)` : actor.name;
  return { at: now.toISOString(), byPhone: actor.phone, byName, text };
}

async function reload(store: Store, id: string): Promise<Task> {
  const t = await store.getTask(id);
  if (!t) throw new Error(`Task ${id} vanished`);
  return t;
}

// ---------- notifications ----------

export function doneNotice(t: Task, actorName: string, now: Date): Outgoing {
  const when = formatDateTime(now, now);
  return {
    to: t.createdByPhone,
    kind: "template",
    template: "task_done_v1",
    bodyValues: [t.createdByName, actorName, t.title, when],
    fallbackText: `Namaste ${t.createdByName} ji,\n${actorName} ne ek task complete kar diya hai ✅\n\nTask: ${t.title}\nComplete hua: ${when}`,
  };
}

export function updateNotice(t: Task, to: { phone: string; name: string }, actorName: string, update: string): Outgoing {
  const body = clip(update, UPDATE_CLIP);
  return {
    to: to.phone,
    kind: "template",
    template: "task_updated_v1",
    bodyValues: [to.name, actorName, t.title, body],
    fallbackText: `Namaste ${to.name} ji,\n${actorName} ne ek task par update diya hai.\n\nTask: ${t.title}\nUpdate: ${body}`,
  };
}

/** task_assigned_v1 for the (new) assignee. */
export function assignedNotice(t: Task, assignedBy: string, now: Date): Outgoing {
  const due = formatDue(t.dueAt, t.dueHasTime, now);
  const next = t.nextReminderAt ? formatDateTime(t.nextReminderAt, now) : due;
  return {
    to: t.assigneePhone,
    kind: "template",
    template: "task_assigned_v1",
    bodyValues: [t.assigneeName, assignedBy, t.title, due, next],
    fallbackText: [
      `Namaste ${t.assigneeName} ji,`,
      `${assignedBy} ne aapko ek naya task diya hai.`,
      "",
      `📝 Task: *${t.title}*`,
      `🕒 Due: *${due}*`,
      `⏰ Agla reminder: *${next}*`,
      "",
      "Menu ke liye *Hi* bhejiye.",
    ].join("\n"),
  };
}

// ---------- actions ----------

/** Done: stops reminders, clears a pending date request, creates next month's task for monthly ones. */
export async function markDone(store: Store, t: Task, actor: Actor, now: Date): Promise<ActionResult> {
  const blocked = closed(t);
  if (blocked) return blocked;
  const at = now.toISOString();
  const remarks = actor.viaDashboard ? [...t.remarks, remarkBy(actor, "Done kiya", now)] : t.remarks;
  await store.updateTask(t.id, { status: "done", doneAt: at, updatedAt: at, nextReminderAt: null, dateRequest: null, remarks });
  const next = t.repeat === "monthly" ? await store.createTask(nextMonthlyTask(t, now)) : undefined;
  const outs = t.createdByPhone !== actor.phone ? [doneNotice(t, actor.name, now)] : [];
  return { ok: true, task: await reload(store, t.id), next, outs };
}

/** Remark: every90 reminders pause until the next morning; the creator hears about it. */
export async function addRemark(store: Store, t: Task, actor: Actor, text: string, now: Date): Promise<ActionResult> {
  const blocked = closed(t);
  if (blocked) return blocked;
  const body = text.trim();
  if (!body) return fail(400, "bad_request", "Remark khaali nahi ho sakta");
  if (body.length > REMARK_MAX) return fail(400, "bad_request", `Remark ${REMARK_MAX} characters se chhota rakhiye`);
  await store.updateTask(t.id, {
    remarks: [...t.remarks, remarkBy(actor, body, now)],
    nextReminderAt: afterResponse(t, now),
    updatedAt: now.toISOString(),
  });
  const outs = t.createdByPhone !== actor.phone ? [updateNotice(t, { phone: t.createdByPhone, name: t.createdByName }, actor.name, body)] : [];
  return { ok: true, task: await reload(store, t.id), outs };
}

/**
 * Applies a new due date (no 25-day check: callers decide who may skip it).
 * Clears any pending date request; tells the creator, and the assignee too when notifyAssignee.
 */
export async function changeDue(
  store: Store,
  t: Task,
  actor: Actor,
  due: ParsedDue,
  remark: string | null,
  now: Date,
  opts: { notifyAssignee: boolean },
): Promise<ActionResult> {
  const blocked = closed(t);
  if (blocked) return blocked;
  if (due.dueAt.getTime() < now.getTime()) return fail(400, "bad_request", "Ye date/time nikal chuka hai, aage ki date dijiye");
  const oldText = formatDue(t.dueAt, t.dueHasTime, now);
  const newText = formatDue(due.dueAt, due.hasTime, now);
  const update = `Date badli: ${oldText} → ${newText}.${remark?.trim() ? ` ${remark.trim()}` : ""}`;
  await store.updateTask(t.id, {
    dueAt: due.dueAt.toISOString(),
    dueHasTime: due.hasTime,
    nextReminderAt: due.dueAt.toISOString(),
    dateRequest: null,
    remarks: [...t.remarks, remarkBy(actor, update, now)],
    updatedAt: now.toISOString(),
  });
  const recipients = new Map<string, string>();
  recipients.set(t.createdByPhone, t.createdByName);
  if (opts.notifyAssignee) recipients.set(t.assigneePhone, t.assigneeName);
  recipients.delete(actor.phone);
  const outs = [...recipients].map(([phone, name]) => updateNotice(t, { phone, name }, actor.name, update));
  return { ok: true, task: await reload(store, t.id), outs };
}

/** Reassign to another active user; the new assignee gets task_assigned_v1 (unless they did it). */
export async function reassign(store: Store, t: Task, actor: Actor, to: User, now: Date): Promise<ActionResult> {
  const blocked = closed(t);
  if (blocked) return blocked;
  if (!to.active) return fail(400, "bad_request", "Ye user ab active nahi hai");
  if (to.phone === t.assigneePhone) return fail(400, "bad_request", "Task pehle se isi ke naam pe hai");
  const note = `Assign badla: ${t.assigneeName} → ${to.name}`;
  await store.updateTask(t.id, {
    assigneePhone: to.phone,
    assigneeName: to.name,
    branch: to.branch,
    remarks: [...t.remarks, remarkBy(actor, note, now)],
    updatedAt: now.toISOString(),
  });
  const task = await reload(store, t.id);
  const outs = to.phone !== actor.phone ? [assignedNotice(task, actor.name, now)] : [];
  return { ok: true, task, outs };
}

/** cancelled_v1 for one recipient. */
export function cancelledNotice(t: Task, to: { phone: string; name: string }, actorName: string): Outgoing {
  return {
    to: to.phone,
    kind: "template",
    template: "task_cancelled_v1",
    bodyValues: [to.name, actorName, t.title, t.assigneeName],
    fallbackText: `Namaste ${to.name} ji,\n${actorName} ne ek task cancel kar diya hai.\n\nTask: ${t.title}\nKiska task: ${t.assigneeName}\n\nIs task ka ab koi reminder nahi aayega.`,
  };
}

/**
 * Cancel: never deleted, just closed (archive). Reminders and date requests stop.
 * Assignee and creator are told once each (never the actor, never inactive users).
 */
export async function cancelTask(store: Store, t: Task, actor: Actor, now: Date): Promise<ActionResult> {
  const blocked = closed(t);
  if (blocked) return blocked;
  const at = now.toISOString();
  const by = remarkBy(actor, "Cancel kiya", now);
  await store.updateTask(t.id, {
    status: "cancelled",
    cancelledAt: at,
    cancelledByName: by.byName,
    nextReminderAt: null,
    dateRequest: null,
    remarks: [...t.remarks, by],
    updatedAt: at,
  });
  const outs: Outgoing[] = [];
  for (const phone of new Set([t.assigneePhone, t.createdByPhone])) {
    if (phone === actor.phone) continue;
    const user = await store.getUser(phone);
    if (user?.active) outs.push(cancelledNotice(t, { phone, name: user.name }, actor.name));
  }
  return { ok: true, task: await reload(store, t.id), outs };
}

/**
 * Reopen (dashboard only): a cancelled task goes back to pending with a new due date,
 * so reminders restart from that date (never an old, already-passed one).
 * The assignee gets task_assigned_v1 (unless they did it). Done tasks stay closed.
 */
export async function reopenTask(store: Store, t: Task, actor: Actor, due: ParsedDue, remark: string | null, now: Date): Promise<ActionResult> {
  if (t.status !== "cancelled") return fail(409, "not_cancelled", "Sirf cancel hua task wapas chalu ho sakta hai");
  if (due.dueAt.getTime() < now.getTime()) return fail(400, "bad_request", "Ye date/time nikal chuka hai, aage ki date dijiye");
  const assignee = await store.getUser(t.assigneePhone);
  if (!assignee?.active) return fail(400, "bad_request", `${t.assigneeName} ab active nahi hai, naya task banaiye`);
  const note = `Wapas chalu kiya, nayi date: ${formatDue(due.dueAt, due.hasTime, now)}.${remark?.trim() ? ` ${remark.trim()}` : ""}`;
  await store.updateTask(t.id, {
    status: "pending",
    dueAt: due.dueAt.toISOString(),
    dueHasTime: due.hasTime,
    nextReminderAt: due.dueAt.toISOString(),
    cancelledAt: null,
    cancelledByName: null,
    dateRequest: null,
    remarks: [...t.remarks, remarkBy(actor, note, now)],
    updatedAt: now.toISOString(),
  });
  const task = await reload(store, t.id);
  const outs = task.assigneePhone !== actor.phone ? [assignedNotice(task, actor.name, now)] : [];
  return { ok: true, task, outs };
}

export type DateDecision = "approve" | "reject";

/** date_approval_result_v1 for the staff member who asked for the new date. */
export function dateResultNotice(t: Task, req: DateRequest, approved: boolean, dueText: string): Outgoing {
  const result = approved ? "Approved" : "Rejected";
  return {
    to: req.byPhone,
    kind: "template",
    template: "date_approval_result_v1",
    bodyValues: [req.byName, t.title, result, dueText],
    fallbackText:
      `Namaste ${req.byName} ji,\naapki due date badalne ki request par faisla ho gaya hai.\n\n` +
      `Task: ${t.title}\nResult: ${result}\nAb due date: ${dueText}`,
  };
}

/**
 * Approve or reject a staff date request (beyond the 25-day limit). Approve moves the due date
 * and restarts reminders from it; reject keeps the old date. The requester is always told.
 * expectedRequestedAt (when given) guards against deciding on a request that was replaced meanwhile.
 */
export async function decideDateRequest(
  store: Store,
  t: Task,
  actor: Actor,
  decision: DateDecision,
  now: Date,
  expectedRequestedAt?: string | null,
): Promise<ActionResult> {
  const blocked = closed(t);
  if (blocked) return blocked;
  const r = t.dateRequest;
  if (!r) return fail(409, "no_request", "Ye request pehle hi handle ho chuki hai");
  if (expectedRequestedAt && r.requestedAt !== expectedRequestedAt) {
    return fail(409, "request_changed", "Is request mein badlav hua hai, dobara dekh ke decide kijiye");
  }
  const oldText = formatDue(t.dueAt, t.dueHasTime, now);
  const newText = formatDue(r.dueAt, r.hasTime, now);
  const approved = decision === "approve";
  if (approved) {
    await store.updateTask(t.id, {
      dueAt: r.dueAt,
      dueHasTime: r.hasTime,
      nextReminderAt: r.dueAt,
      dateRequest: null,
      remarks: [...t.remarks, remarkBy(actor, `Date approve hui (${actor.name}): ${oldText} → ${newText}. ${r.remark}`, now)],
      updatedAt: now.toISOString(),
    });
  } else {
    await store.updateTask(t.id, {
      dateRequest: null,
      remarks: [...t.remarks, remarkBy(actor, `Date request reject hui (${actor.name}). Date ${oldText} hi rahegi.`, now)],
      updatedAt: now.toISOString(),
    });
  }
  const outs = [dateResultNotice(t, r, approved, approved ? newText : oldText)];
  return { ok: true, task: await reload(store, t.id), outs };
}

/** Dashboard date input ("YYYY-MM-DD", optional "HH:MM") → instant; no time means 10:00 AM IST. */
export function dueFromInput(date: unknown, time: unknown): ParsedDue | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  if (!isValidDay(year, month, day)) return null;
  if (time === null || time === undefined || time === "") return { dueAt: atIST({ year, month, day }), hasTime: false };
  if (typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [hour, minute] = time.split(":").map(Number);
  if (hour > 23 || minute > 59) return null;
  return { dueAt: atIST({ year, month, day }, { hour, minute }), hasTime: true };
}
