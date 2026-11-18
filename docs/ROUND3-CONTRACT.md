# Round 3 contract (small features): shared rules for the parallel agents

*18 Nov 2026. Source of decisions: `docs/PENDING-BRIEF.md` + `docs/PENDING-BRIEF-ADDENDUM.md`. The coordinator owns this file, `worker/src/domain/types.ts`, `worker/src/domain/schedule.ts` and `worker/src/bot/router.ts`.*

## Already done by the coordinator (don't redo)

**Types** (`worker/src/domain/types.ts`):
- `TaskRepeat` now includes `"weekly"`.
- `TaskStatus` now includes `"deleted"`.
- `Task` has new optional fields: `urgent?: boolean`, `deletedAt?: string | null`, `deletedByName?: string | null`, `deletedFrom?: "pending" | "done" | "cancelled" | null`.

**Schedule** (`worker/src/domain/schedule.ts`):
- `nextWeeklyDue` = due + 7 days at the same time; `nextWeeklyTask`; `nextRepeatTask(task, now)` (monthly / weekly / null).
- `markDone` in `taskActions.ts` already creates the next task for monthly and weekly.
- Overdue reminders for weekly behave like `none`/`monthly` (daily 11 AM), via `afterReminder`.

**`createTaskFor(..., { urgent?: boolean })`** stores `urgent: true` when set.

**F15 timeouts** (`router.ts`):
- Typing steps get 5 min, tap steps 2 min (`TYPING_STEPS`).
- Expiry text: `expiredText(minutes)`.

**Labels:** `REPEAT_LABELS` maps include `weekly: "Har hafte"`, and the suffix maps include `weekly: " (har hafte)"`.

## Owner rules (must follow)

**F5 Urgent 🔴**
- Effect: a 🔴 mark, and the task is sorted **first** in WhatsApp lists and the dashboard (urgent first, then by due). **No extra reminders.**
- Who sets it: admins on any task; staff only on their own tasks (staff can only create self-tasks anyway).
- Where it can be set:
  - Dashboard: create sheet + task detail toggle, admins.
  - WhatsApp chat wizard: on the confirm screen.
  - Voice: "urgent hai" / "jaldi", extracted by Gemini, editable in the voice edit menu.
  - **Not** the WhatsApp Form.

**F4 Weekly repeat**
- Same weekday as the due date, every week. Done creates next week's task. Overdue: daily 11 AM.
- Available from the chat wizard, voice and dashboard. **Not** the WhatsApp Form.

**F8 Soft delete + recycle bin (dashboard only)**
- **Cancel vs Delete:**
  - Cancel = work no longer needed (Archive, can be reopened).
  - Delete = mistake/test/junk → recycle bin.
- **Who deletes:** any admin can soft-delete from the dashboard. No WhatsApp message to anyone on delete or restore.
- **Delete sets:**
  - `status: "deleted"`, `deletedFrom` (previous status), `deletedAt`, `deletedByName`
  - `nextReminderAt: null`, `dateRequest: null`
  - a remark "Recycle bin mein dala"
- **Restore:**
  - Back to `deletedFrom`.
  - If it was pending: reminders restart from its due date. If that date/time has passed, the admin must pick a new date (API 400 `need_date` without a future date).
  - A remark "Recycle bin se wapas".
- **Weekly/monthly deleted:** no next occurrence is created (nothing to do: only Done creates one).
- **Permanent delete:**
  - Only the **super admin** (dashboard session name === `SUPER_ADMIN_NAME` from `worker/src/scheduler/health.ts`, i.e. "Bhaskar"), with a confirm.
  - Only for tasks already in the bin.
- **Auto-clean:** deleted tasks with `deletedAt` older than **30 days** are purged by the daily cleanup.

**F9 Export CSV** (admins, dashboard)
- CSV that opens in Excel: UTF-8 with BOM, comma separated, quoted fields.
- Filters: date range on the **due date (IST day)** and status = pending / done / cancelled / all. **Never** deleted tasks.
- Columns, in this order: Task, Kisko (assignee name), Branch, Diya (created by), Due (e.g. "28 Oct 2026, 4:00 PM" or "28 Oct 2026"), Status, Done date, Urgent (Haan/—), Repeat (Ek baar/Har 90 min/Har mahine/Har hafte), Last remark.
- **No phone numbers.**

## API (agent B implements in the Worker, agent C consumes in the dashboard)

**`TaskDTO`** (`worker/src/dashboard/routes/read.ts` → mirrored in `dashboard/src/lib/types.ts`) adds:
- `urgent: boolean`
- `deletedAt: string | null`, `deletedByName: string | null`, `deletedFrom: "pending" | "done" | "cancelled" | null`
- `repeat` may be `"weekly"`; `status` may be `"deleted"`.

**`GET /api/me`** adds `superAdmin: boolean`.

**`GET /api/tasks?view=...`**
- `view=pending`: unchanged (pending only).
- `view=archive`: **must exclude deleted**.
- New `view=bin`: deleted tasks, newest `deletedAt` first, `limit` like archive (default 200).

**`POST /api/tasks`** (create) accepts `urgent?: boolean` and `repeat: "weekly"`.

**New task actions** (all `named` auth, same response shape as the others: `{ task, next? }`):
| Action | Body | Rules |
|---|---|---|
| `POST /api/tasks/:id/urgent` | `{ urgent: boolean }` | Any admin. Not for deleted tasks. No WhatsApp. |
| `POST /api/tasks/:id/delete` | `{}` | Any admin. Already deleted → 409 `task_closed`. |
| `POST /api/tasks/:id/restore` | `{ date?: "YYYY-MM-DD", time?: "HH:MM" }` | Only deleted tasks. Pending with a past due and no future date → 400 `need_date`. |
| `POST /api/tasks/:id/purge` | `{}` | Super admin only (else 403 `super_admin_only`). Only deleted tasks (else 409). Removes the document; response `{ purged: true }`. |

**`GET /api/export?from=YYYY-MM-DD&to=YYYY-MM-DD&status=all|pending|done|cancelled`**
- Session auth.
- Response: `text/csv; charset=utf-8`, with `Content-Disposition: attachment; filename="radhe-tasks-<from>-to-<to>.csv"`.
- Bad input → 400 JSON `{ error, code: "bad_request" }`.
- Max range 366 days.
- The dashboard downloads it with `fetch` (Authorization header) → Blob → link click.

## File ownership (no agent edits another's files)

| Agent | Owns | Must not touch |
|---|---|---|
| **A: WhatsApp + voice** | `worker/src/bot/flows/createTask.ts`, `tasks.ts`, `voiceTask.ts`, `worker/src/bot/ui.ts`, `worker/src/voice/**`, `worker/src/scheduler/reminders.ts`, and their tests | `taskActions.ts`, `router.ts`, `dashboard/**`, `worker/src/dashboard/**`, data stores |
| **B: Worker API** | `worker/src/dashboard/**`, `worker/src/bot/taskActions.ts`, `worker/src/data/**` (add `deleteTask`), `worker/src/scheduler/cleanup.ts`, `worker/src/index.ts` (only if a route must be registered), and their tests | bot flows, `router.ts`, `dashboard/**` |
| **C: Dashboard UI** | everything under `dashboard/` | anything under `worker/` |

- Only the coordinator commits, pushes and updates docs.
- Firestore free plan: 50k reads/day. Don't add reads to hot paths (the reminder cron every 5 min, every webhook).
