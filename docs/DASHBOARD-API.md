# Dashboard API Contract

*Shared contract between the Worker (`worker/src/dashboard/`) and the PWA (`dashboard/`). Change it only through the coordinator, and update both sides together.*

**Base URL (not secret):** `https://pa-wp-bot.radhegeneral2306.workers.dev` (PWA reads `import.meta.env.VITE_API_BASE`, falling back to this).

**All requests:** JSON bodies, `Authorization: Bearer <token>` (except login). Errors always come back as `{ "error": "<Hinglish message for the user>", "code"?: string }` with a meaningful HTTP status. The PWA shows `error` text as-is and branches on `code`, never on the text. Codes: `login_required` (401, session missing/expired), `bad_login` (401, wrong ID/password), `locked` (429), `not_configured` (503), `need_name` (403), `origin_not_allowed` (403), `not_found` (404), `bad_request` (400), `server_error` (500).

| Status | Meaning in the PWA |
|---|---|
| 400 | show the error inline |
| 401 | token missing, expired or invalid → clear the token, go to Login |
| 403 | "Pehle apna naam chuniye" → go to the name picker (or origin not allowed) |
| 404 | show "Nahi mila" |
| 429 | login locked, show the error text |
| 503 | dashboard login not configured, show the error text |
| 5xx / network | inline error with "Dobara try karein"; offline banner if `navigator.onLine` is false |

---

## Phase 2 (live)

### `POST /api/login`  (auth: none)
Request `{ "user": string, "password": string }`
Response `{ "token": string, "admins": string[], "sessionDays": 30 }`
The token has no name yet. The PWA then shows "Aap kaun ho?" with `admins`.

### `POST /api/actor`  (auth: session)
Request `{ "name": string }` (must be one of `admins`)
Response `{ "token": string, "name": string }`. Replace the stored token with this one.

### `GET /api/me`  (auth: session)
Response `{ "name": string | null, "expiresAt": ISO, "admins": string[] }`. Used on app start to check the stored token.

---

## Phase 3 (read-only)

### `GET /api/users`  (auth: session)
Response
```json
{
  "users": [{ "phone": "91…", "name": "Hema", "role": "staff", "branch": "DURG" }],
  "branches": [{ "id": "RAIPUR", "name": "Raipur" }, …]
}
```
Active users only, sorted by name. `branch` is `null` for admins. `branches` comes from the Worker's `BRANCHES` (the PWA never hard-codes branch lists).

### `GET /api/tasks?view=pending`  (auth: session)
### `GET /api/tasks?view=archive&limit=200`  (auth: session)
Response
```json
{ "now": "ISO", "tasks": [TaskDTO, …] }
```
- `pending`: all tasks with status `pending`, sorted by `dueAt` ascending (so overdue come first).
- `archive`: tasks with status `done` or `cancelled`, sorted newest first by `closedAt`, at most `limit` (default 200, max 500).
- Unknown `view` → 400.
- `limit`: missing/non-numeric → 200; otherwise truncated and clamped to 1..500. Archive ties on `closedAt` break by `updatedAt` descending.
- A task due earlier today is both `overdue` and `dueToday`; the PWA should show "Overdue" in that case.
- `/api/users` lists active users only; names of removed assignees still appear on each task as `assigneeName`.

`TaskDTO` = the stored `Task` (see `worker/src/domain/types.ts`) with every optional field present (missing → `null`) plus computed fields:

| Field | Type | Notes |
|---|---|---|
| `id`, `title` | string | |
| `assigneePhone`, `assigneeName` | string | |
| `branch` | BranchId \| null | |
| `createdByPhone`, `createdByName` | string | |
| `dueAt` | ISO | |
| `dueHasTime` | boolean | false → show date only ("10 AM" default) |
| `status` | "pending" \| "done" \| "cancelled" | |
| `repeat` | "none" \| "every90" \| "monthly" | |
| `repeatDay` | number \| null | |
| `nextReminderAt`, `lastReminderAt` | ISO \| null | |
| `dateRequest` | `{dueAt, hasTime, remark, byPhone, byName, requestedAt}` \| null | |
| `remarks` | `{at, byPhone, byName, text}[]` | oldest first |
| `createdAt`, `updatedAt` | ISO | |
| `doneAt`, `cancelledAt` | ISO \| null | |
| `cancelledByName` | string \| null | |
| **`overdue`** | boolean | pending and `dueAt < now` |
| **`dueToday`** | boolean | pending and due on today's IST date |
| **`closedAt`** | ISO \| null | `doneAt` or `cancelledAt` |
| **`lastRemark`** | remark \| null | convenience: last item of `remarks` |

Filtering (branch, staff, search text) is done **in the PWA** on this list. At this business's size (tens to a few hundred tasks) that is fast and keeps the API simple.

---

## Phase 4 (write actions)

All four routes are `named` (the token must carry a picked admin name). The Worker resolves that name to the active admin's phone; if the name is no longer an active admin → 403 `need_name`. Shared rules live in `worker/src/bot/taskActions.ts` (same code the WhatsApp bot uses).

| Route | Body | Effect | WhatsApp notices (never to the actor) |
|---|---|---|---|
| `POST /api/tasks/:id/done` | `{}` | status done, reminders stop, date request cleared, remark "Done kiya" by "Name (dashboard)"; monthly → next month's task created | creator: `task_done_v1` |
| `POST /api/tasks/:id/remark` | `{ "text": string }` (1-500 chars) | remark added; every90 reminders pause till next 10 AM | creator: `task_updated_v1` |
| `POST /api/tasks/:id/due` | `{ "date": "YYYY-MM-DD", "time": "HH:MM" \| null, "remark"?: string }` | new due (no time = 10:00 AM IST), reminder reset to new due, date request cleared, remark "Date badli: old → new. …" | creator and assignee: `task_updated_v1` |
| `POST /api/tasks/:id/assign` | `{ "phone": "91…" }` (active user) | assignee name/phone/branch changed, remark "Assign badla: A → B" | new assignee: `task_assigned_v1` |

Response (all four): `{ "task": TaskDTO, "next": TaskDTO | null }` (`next` only for monthly Done).

Errors: 400 `bad_request` (validation, past date, same assignee, inactive user), 404 `not_found` (unknown task id), 409 `task_closed` (task already done or cancelled). The PWA should refresh the list after any success and show the `error` text on failure.

The 25-day staff limit does not apply to the dashboard (admins only).

---

## Later phases (planned, not built)

| Phase | Route | Body |
|---|---|---|
| 5 | `POST /api/tasks/:id/cancel` | `{}` |
| 6 | `GET /api/approvals`, `POST /api/approvals/:id` | `{ decision: "approve" \| "reject" }` |
