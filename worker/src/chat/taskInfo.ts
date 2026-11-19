// Round 7, Agent B: who may see a task in chat, and short Hinglish answers built only from the task's own data.
// No phone numbers anywhere; dates are IST (domain/dates.ts).
import { formatDateTime, formatDue, isOverdue } from "../domain/dates";
import type { Task, User } from "../domain/types";
import type { TaskField } from "./types";

/** Admins see every task that is not in the recycle bin; staff only tasks they are assigned to or created. */
export function canSeeTask(user: User, task: Task): boolean {
  if (task.status === "deleted") return false;
  if (user.role === "admin") return true;
  return task.assigneePhone === user.phone || task.createdByPhone === user.phone;
}

const WEEKDAYS = ["Raviwar", "Somwar", "Mangalwar", "Budhwar", "Guruwar", "Shukrawar", "Shaniwar"];
const IST_OFFSET_MS = 5.5 * 3_600_000;
const AUTO_NOTE = /^\s*(voice|chat) se banaya/i;
const REMARK_CLIP = 150;
const TITLE_CLIP = 100;

function scrub(s: string): string {
  // A phone number must never leak through free text.
  return s.replace(/\+?\d[\d\s-]{8,}\d/g, (m) => (m.replace(/\D/g, "").length >= 10 ? "[number]" : m));
}

function clip(s: string, max: number): string {
  const one = scrub(s.replace(/\s+/g, " ").trim());
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

function realRemarks(task: Task) {
  return (task.remarks ?? []).filter((r) => r && typeof r.text === "string" && !AUTO_NOTE.test(r.text));
}

function head(task: Task): string {
  return `${task.urgent ? "🔴 " : ""}*${clip(task.title, TITLE_CLIP)}*`;
}

function dueText(task: Task, now: Date): string {
  return formatDue(task.dueAt, task.dueHasTime, now);
}

function overdueNote(task: Task, now: Date): boolean {
  return task.status === "pending" && isOverdue(task.dueAt, now);
}

function statusLine(task: Task, now: Date): string {
  switch (task.status) {
    case "pending":
      return "Abhi pending hai.";
    case "done":
      return task.doneAt ? `Done ho chuka hai (${formatDateTime(task.doneAt, now)}).` : "Done ho chuka hai.";
    case "cancelled":
      return `Ye task band (cancelled) hai${task.cancelledByName ? `, ${task.cancelledByName} ne kiya` : ""}.`;
    default:
      return "Ye task recycle bin mein hai.";
  }
}

function repeatLine(task: Task): string {
  switch (task.repeat) {
    case "weekly": {
      const wd = new Date(new Date(task.dueAt).getTime() + IST_OFFSET_MS).getUTCDay();
      return `Har hafte ${WEEKDAYS[wd]} ko repeat hota hai.`;
    }
    case "monthly": {
      const day = task.repeatDay ?? new Date(new Date(task.dueAt).getTime() + IST_OFFSET_MS).getUTCDate();
      return `Har mahine ${day} tareekh ko repeat hota hai.`;
    }
    case "every90":
      return "Jawab aane tak har 90 minute (10 AM se 8 PM) mein yaad dilaya jata hai.";
    default:
      return "Ye ek baar ka task hai, repeat nahi hota.";
  }
}

function lastRemarkLine(task: Task, now: Date, max = REMARK_CLIP): string | null {
  const list = realRemarks(task);
  const r = list[list.length - 1];
  if (!r) return null;
  const who = r.byName ? `, ${clip(r.byName, 30)}` : "";
  return `Last update (${formatDateTime(r.at, now)}${who}): "${clip(r.text, max)}"`;
}

/** Hinglish answer built only from the task's own fields (IST dates, last remark with its time). Max 6 short lines. */
export function describeTask(task: Task, field: TaskField, now: Date): string {
  const lines: string[] = [head(task)];
  switch (field) {
    case "due":
      lines.push(`📅 Due: ${dueText(task, now)}`);
      if (overdueNote(task, now)) lines.push("⚠️ Ye overdue hai.");
      if (task.status === "done") lines.push("Ye task ho chuka hai.");
      break;
    case "assignee":
      lines.push(`👤 Ye ${task.assigneeName} ko diya gaya hai.`);
      break;
    case "creator":
      lines.push(
        task.createdByPhone === task.assigneePhone
          ? `✍️ ${task.createdByName} ne ye khud ke liye banaya hai.`
          : `✍️ ${task.createdByName} ne ye task diya hai.`,
      );
      break;
    case "status":
      lines.push(statusLine(task, now));
      if (overdueNote(task, now)) lines.push(`⚠️ Overdue hai (due ${dueText(task, now)}).`);
      break;
    case "urgent":
      lines.push(task.urgent ? "🔴 Haan, ye urgent hai." : "Nahi, ye urgent nahi hai.");
      break;
    case "repeat":
      lines.push(repeatLine(task));
      break;
    case "last_remark":
      lines.push(lastRemarkLine(task, now) ?? "Abhi koi remark nahi hai.");
      break;
    case "remark_count": {
      const n = realRemarks(task).length;
      lines.push(n === 0 ? "Abhi koi remark nahi hai." : `💬 Abhi tak ${n} remark ${n === 1 ? "hai" : "hain"}.`);
      break;
    }
    case "created":
      lines.push(`🗓️ ${formatDateTime(task.createdAt, now)} ko ${task.createdByName} ne banaya.`);
      break;
    case "done_at":
      if (task.status === "done") {
        lines.push(task.doneAt ? `✅ ${formatDateTime(task.doneAt, now)} ko done hua.` : "✅ Done hai, par time ka record nahi hai.");
      } else if (task.status === "cancelled") {
        lines.push("Ye task band (cancelled) hai, done nahi hua.");
      } else {
        lines.push("Abhi done nahi hua, pending hai.");
      }
      break;
    default: {
      lines.push(`👤 Kisko: ${task.assigneeName}`);
      lines.push(`📅 Due: ${dueText(task, now)}${overdueNote(task, now) ? " (⚠️ overdue)" : ""}`);
      lines.push(`Status: ${statusLine(task, now)}`);
      if (task.repeat !== "none") lines.push(repeatLine(task));
      lines.push(lastRemarkLine(task, now, 80) ?? "Abhi koi remark nahi hai.");
      break;
    }
  }
  return lines.slice(0, 6).join("\n");
}
