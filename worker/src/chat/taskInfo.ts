// STUB (coordinator): agent B replaces the bodies, keeps the signatures.
import type { Task, User } from "../domain/types";
import type { TaskField } from "./types";

/** Admins see every task that is not in the recycle bin; staff only tasks they are assigned to or created. */
export function canSeeTask(_user: User, _task: Task): boolean {
  return false;
}

/** Hinglish answer built only from the task's own fields (IST dates, last remark with its time). */
export function describeTask(task: Task, _field: TaskField, _now: Date): string {
  return task.title;
}
