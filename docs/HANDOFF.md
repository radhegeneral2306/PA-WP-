# PA-WP: Complete Project Handoff

*Snapshot: 26 Oct 2026 · Live build: `batch2.1` · 335 automatic tests passing*

> **Hinglish summary:** Ye ek WhatsApp task-management bot hai, Radhe Tiles World ke branches (Raipur, Jagdalpur, Durg, Hardware, Office) ke staff aur admins ke liye. Batch 0, 1 aur 2 poore ban gaye hain aur live chal rahe hain. Is file mein sab kuch hai: kya bana, kaise bana, security, kaun si file kya karti hai, kya pending hai, aur naye kaam ke rules. Naya chat **pehle ye poori file padhe**, phir kaam shuru kare.

---

## 0. Read this first (rules for whoever continues)

1. **Do not rebuild what exists.** Sections 4–8 list everything that is built and live. Extend it, don't replace it.
2. **Never put secrets in the repo or in chat**: API keys, the Firebase private key, the webhook secret, the Interakt webhook key, or real phone numbers. They live only in Cloudflare → Worker → Settings → Variables and Secrets.
3. **Code is deployed automatically.** Every push to branch `claude/nifty-franklin-xolea7` of `radhegeneral2306/pa-wp-` is built and deployed by Cloudflare Workers Builds. A push that doesn't compile fails the build, and the old version stays live. So only push code that passes `npx tsc --noEmit` and `npx vitest run` (from `worker/`).
4. **Parallel agents must own separate files** (Section 12). Shared "contract" files are changed only by the coordinator.
5. **Owner preferences:** the owner (Bhaskar) is non-technical. Reply in Hinglish (Roman script, no Devanagari). Be blunt and honest, state difficulty (Easy/Medium/Hard), and explain step by step. Bot texts are also Hinglish.
6. **Dashboard changes need "Deploy".** When the owner edits a variable in Cloudflare and picks "Save" instead of "Deploy", the change is only stored as a version and doesn't go live (this happened once). Always tell them to press **Deploy**.

---

## 1. What the product is

A WhatsApp bot on the business number (Interakt WhatsApp Business API, Advance plan). Registered staff and admins manage tasks entirely inside WhatsApp:

- Send **"Hi"** → a role-based menu (WhatsApp List message)
- Admins create tasks for staff (or other admins, or themselves); staff create tasks for themselves
- Reminders by WhatsApp **template**, on schedule
- Mark tasks Done, add remarks/updates, change due dates (with a 25-day approval rule for staff)
- Admins add, edit and remove staff from WhatsApp

**Customers also message this same number.** The bot answers only registered, active users and ignores everyone else.

**Out of scope:** the old To-do-list web app (`radhegeneral2306/To-do-list`) stays separate, with no sync. The Tasker/location idea is a separate project.

---

## 2. Tech stack and accounts

| Part | Choice | Notes |
|---|---|---|
| WhatsApp API | **Interakt** (Advance plan) | Incoming webhook + session messages + templates |
| Backend | **Cloudflare Worker** `pa-wp-bot` | URL: `https://pa-wp-bot.radhegeneral2306.workers.dev` |
| Deploy | Cloudflare **Workers Builds** from GitHub | Repo `radhegeneral2306/pa-wp-`, branch `claude/nifty-franklin-xolea7`, root dir `worker`, deploy cmd `npx wrangler deploy` |
| Scheduler | Cloudflare **Cron Triggers** | `*/5 * * * *` (reminders) and `30 4 * * *` (10:00 AM IST daily summary) |
| Database | **Firebase Firestore** (new project, region asia-south1 / Mumbai, production mode) | Accessed over REST with a service account. Firebase Spark has no Cloud Functions, which is why the backend runs on Cloudflare |
| Language | TypeScript (strict), tests with **vitest** | No runtime npm dependencies; WebCrypto + fetch only |
| Old logger | Google Apps Script → Google Sheet | Optional forward of every webhook (`SHEET_FORWARD_URL`) |

**Why not Apps Script:** its 302 redirect on webhooks, timer quotas, and no access to request headers (so signatures can't be verified).

---

## 3. Architecture (message flow)

```
WhatsApp user ──► Interakt ──POST──► Cloudflare Worker  /webhook/<WEBHOOK_SECRET>
                                         │
     1. path secret check (else 404)     │
     2. Interakt-Signature HMAC check    │  (else 401)
     3. forward raw body to Google Sheet (optional, async)
     4. reply 200 immediately; process in ctx.waitUntil
                                         ▼
                              processWebhook()
     5. parse body (only type "message_received"; ping/test ignored)
     6. organization_id must equal INTERAKT_ORG_ID
     7. TEST_NUMBERS gate (only if set; currently NOT set)
     8. user must exist in Firestore `users` and be active (else silent)
     9. dedup: create webhook_log/<messageId>; if it exists → skip
    10. router.handleMessage(ctx, {text, reply}) → Outgoing[]
    11. deliverAll() → Interakt API (session messages or templates)
        on any crash: clear session + send "Maaf kijiye... Hi bhejiye"

Cloudflare Cron ──► scheduled() ──► runCron()
     every 5 min  : runReminders(store, now)   → task_reminder_v1 templates
     04:30 UTC    : runDailySummary(store, now) → daily_summary_v1 (skip if DAILY_SUMMARY=off)
```

**Design rule:** flows and the scheduler never call Interakt. They return `Outgoing[]` (plain data), and only `interakt/deliver.ts` sends. That keeps everything testable.

---

## 4. Security layers (all live)

| # | Layer | Where | What it stops |
|---|---|---|---|
| 1 | **Secret URL path** `/webhook/<WEBHOOK_SECRET>` (48 hex chars), constant-time compare | `index.ts` | Random requests (404) |
| 2 | **Interakt-Signature** `sha256=<hex HMAC-SHA256(raw body, INTERAKT_WEBHOOK_KEY)>` | `interakt/signature.ts` | Forged webhooks (401). Verified live: an unsigned request got 401 and a real "Hi" got the menu |
| 3 | **Organization check** `data.organization_id === INTERAKT_ORG_ID` | `index.ts` | Payloads from another Interakt org |
| 4 | **Registered-user gate**: only active users in Firestore `users` get replies | `index.ts` | Customers on the business number never see the bot |
| 5 | **Role checks** in router and every flow (admin-only menus re-checked inside flows) | `router.ts`, flows | Staff opening admin features, including by forged/stale taps |
| 6 | **Namespaced reply ids** `<flowId>:<kind>:<value>`; a tap from another flow = "purana option" | `router.ts`, `flow.ts` | Stale or cross-flow taps doing wrong actions |
| 7 | **Session TTL 30 min** | `router.ts` | Half-finished flows resuming hours later |
| 8 | **Dedup** via `webhook_log/<Interakt message id>` (create-if-absent, 409 = duplicate) | `index.ts` | Interakt retries causing double replies/actions |
| 9 | **Optional TEST_NUMBERS** gate (incoming and outgoing) | `index.ts` | During testing, no message can reach a non-test phone. **Currently removed** (production mode) |
| 10 | **Dummy users use invalid numbers** (`9100000001xx`, Indian mobiles never start with 0) | data | Test data can't message real strangers |
| 11 | **Env trimming** (`cleanEnv`) and `keep_vars = true` | `env.ts`, `wrangler.toml` | Pasted secrets with spaces; deploys wiping dashboard vars |
| 12 | **Secrets only in Cloudflare**; `.gitignore` blocks `.dev.vars` and service-account JSON; logs mask phones (`***1234`) | repo | Leaks |
| 13 | **Admin endpoints behind the same secret path** (`/status`, `/users`) | `index.ts`, `admin.ts`, `status.ts` | Public access |

**Not protected yet:** the `/webhook/<secret>/users` and `/status` endpoints rely only on the path secret (no signature). Anyone with the secret could read or modify users. Rotating `WEBHOOK_SECRET` means updating both Cloudflare and the Interakt webhook URL.

---

## 5. Configuration (Cloudflare → pa-wp-bot → Settings → Variables and Secrets)

| Name | Type | Purpose | Status |
|---|---|---|---|
| `WEBHOOK_SECRET` | Secret | URL path secret | ✅ set (value is in Cloudflare and the Interakt webhook URL; never commit it) |
| `INTERAKT_API_KEY` | Secret | Interakt Developer Settings key (already base64; used as `Authorization: Basic <key>`) | ✅ |
| `INTERAKT_WEBHOOK_KEY` | Secret | Interakt webhook "Secret key" for signatures | ✅ set and verified |
| `INTERAKT_ORG_ID` | Secret | Interakt organization id | ✅ |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | Secret | Service account | ✅ |
| `SHEET_FORWARD_URL` | Secret | Old Apps Script logger | ✅ (optional) |
| `TEST_NUMBERS` | — | Testing gate | **Deleted** (production) |
| `DAILY_SUMMARY` | optional | `off` disables the 10 AM summary | not set (= on) |

**Interakt webhook URL:** `https://pa-wp-bot.radhegeneral2306.workers.dev/webhook/<WEBHOOK_SECRET>`, event "Message received" on, Secret key set.

**Health check:** `GET /webhook/<WEBHOOK_SECRET>/status` returns the build label, which settings are present (never their values), masked test numbers, the Interakt key shape, and Firebase connectivity. Use this first whenever the bot "stops replying".

---

## 6. Data model (Firestore)

| Collection | Doc id | Contents |
|---|---|---|
| `users` | phone (`91XXXXXXXXXX`) | `User` |
| `tasks` | auto id | `Task` (the id is not stored inside the doc) |
| `sessions` | phone | `Session` (current chat step) |
| `webhook_log` | Interakt message id | raw webhook + parsed fields (dedup + debugging) |

Defined in `worker/src/domain/types.ts`:

- **User**: `phone, name, role ("admin"|"staff"), branch ("RAIPUR"|"JAGDALPUR"|"DURG"|"HARDWARE"|"OFFICE"|null for admins), active, createdAt`
- **Task**: `title, assigneePhone/Name, branch, createdByPhone/Name, dueAt (ISO UTC), dueHasTime, status ("pending"|"done"|"cancelled"; cancelled = dashboard cancel, never reminded or listed, has cancelledAt/cancelledByName), repeat ("none"|"every90"|"monthly"), nextReminderAt, repeatDay?, dateRequest?, lastReminderAt?, remarks[] {at, byPhone, byName, text}, createdAt, updatedAt, doneAt`
- **DateRequest**: `dueAt, hasTime, remark, byPhone, byName, requestedAt`
- **Session**: `phone, flow, step, data: Record<string,string>, updatedAt`

**Rules:** all times are stored as ISO UTC strings and shown in IST (UTC+5:30, fixed offset). No time given → **10:00 AM IST**. Tasks from before Batch 2 lack the optional fields, so treat missing as `null`. Queries use **at most one equality filter and no orderBy** (no composite indexes needed); the rest is filtered and sorted in memory.

**Current users (27 Oct 2026):** admins Bhaskar and Nayan; 22 real staff imported from the owner's Excel on 27 Oct (Raipur 1, Jagdalpur 8, Durg 7, Hardware 2, Office 4) plus earlier real staff Hardware (Durg), Chikku (Raipur) and "Durg Office"; and 7 dummy test users (names end in "(dummy)", numbers start `910000000`). Bulk imports go through `PUT /webhook/<secret>/users` and do NOT send welcome messages. Real numbers live only in Firestore and Cloudflare.

---

## 7. Bot workflows (all live)

### Router (`bot/router.ts`)
- `hi / hello / menu / namaste / start` … → clears the session and shows the main menu
- `cancel / band / ruko / stop / exit` → clears the session
- Template quick replies (arrive as plain button text): **"Menu"**, **"Mere tasks"**, **"Approvals dekhein"**
- `MENU:<key>` taps start flows. An active session routes to its flow. Anything else shows the menu.

**Admin menu:** 📋 Mere tasks · 👥 Staff ke tasks · ➕ Naya task · ⏳ Approvals · ⚙️ Staff manage
**Staff menu:** 📋 Mere tasks · ➕ Naya task

### A. Naya task, `create_task` (`flows/createTask.ts`)
Steps: `pick_branch → pick_user → ask_title → ask_due → (ask_time | ask_custom_due) → ask_repeat → confirm`
- Admin: branch list (incl. 👔 Admins) → person (paged) → title. Staff skip straight to the title (self task).
- Due buttons: **Aaj / Kal / Date likho**. Aaj/Kal then ask for the time (Skip = 10 AM). A typed date is also accepted (`28/10`, `28/10 4pm`, `kal 11am`, `shaam 6`). Past times are rejected.
- Repeat buttons: **Ek baar / Har 90 min / Har mahine**
- On confirm: the task is saved (`nextReminderAt = dueAt`, monthly also gets `repeatDay`). The creator gets "✅ Task ban gaya". The assignee gets template **task_assigned_v1** (skipped for self tasks).

### B. Tasks, `tasks` (`flows/tasks.ts`)
Steps: `list | pick_branch → pick_user → list → detail → (ask_remark | ask_due → ask_time/ask_custom_due → ask_date_remark)`
- **Mere tasks:** pending tasks sorted by due, ⚠️ = overdue, 8 per page with ⬅️/➡️
- **Staff ke tasks (admin):** branch → person or "Sabhi ke pending tasks" (or the Admins group)
- **Detail:** title, assignee, creator, 🕒 due, reminder type, pending date request, last remark. Buttons: **Done ✅ / Update ✏️ / Date badlo 🕒**. Allowed for the assignee, the creator, or any admin.
- **Done:** status done, reminders stop, request cleared. Template **task_done_v1** goes only to the creator (if creator ≠ actor). Monthly → next month's task is created automatically.
- **Update:** remark required (≤500 chars), appended to remarks. every90 pauses until the next 10 AM. Template **task_updated_v1** to the creator if creator ≠ actor.
- **Date badlo:** new date → remark required.
  - Staff and > 25 days ahead → creates a `dateRequest` (date unchanged) and sends **date_approval_request_v1** to the approvers (the creator if they are an active admin, else all active admins, never the requester)
  - Otherwise: date changed, `nextReminderAt = new due`, any pending request cleared, **task_updated_v1** to the creator if creator ≠ actor

### C. Approvals, `approvals` (`flows/approvals.ts`, admin only)
Steps: `list → decide`. Lists pending `dateRequest`s (any admin can decide any). **Approve ✅** → new due applied, remark logged. **Reject ❌** → request cleared, remark logged. The requester gets **date_approval_result_v1**. If the request changed while the admin was viewing it, the decision is refused and the new one is shown.

### D. Staff manage, `manage_staff` (`flows/manageStaff.ts`, admin only)
- **Add:** name → 10-digit number → Staff/Admin → branch (staff) → confirm. Template **welcome_user_v1** to the new user. An existing active number is refused; an inactive one is re-activated.
- **Edit:** person → Naam / Branch / Role → confirm. Name/branch changes are copied to all their existing tasks (assignee name, branch, creator name). You can't change your own role or demote the last admin.
- **Remove:** sets `active=false` (soft delete); pending tasks stay. You can't remove yourself.
- **List:** everyone grouped by branch plus Admins.

---

## 8. Reminder system (`scheduler/*`, `domain/schedule.ts`)

| Type | First reminder | After that |
|---|---|---|
| **Ek baar** (`none`) | at the due time | **daily at 11 AM IST** while pending (at least 6 h after the previous one) |
| **Har 90 min** (`every90`) | at the due time | every 90 min, only **10 AM–8 PM IST** (outside that window → next 10 AM). A remark pauses it until the next 10 AM. |
| **Har mahine** (`monthly`) | at the due time | overdue: daily 11 AM. **Done** creates next month's task (same day, clamped: 31 → 30/28/29, then back to 31) |

- Cron runs every 5 min, so reminders can be up to ~5 min late
- Reminder = template **task_reminder_v1** (name, task, due + "(overdue)", last remark or "-")
- `nextReminderAt` is saved **before** sending, so a crash never double-sends (it may skip one)
- An inactive or missing assignee stops the reminders
- **Daily summary** 10:00 AM IST: **daily_summary_v1** (pending count, overdue count) to each active user with pending tasks

---

## 9. WhatsApp templates (all 8 approved in Interakt)

Defined in `bot/outgoing.ts` (`TEMPLATE_PARAMS`), wording in `docs/TEMPLATES.md`. Category Utility, language English (Hinglish text), quick-reply buttons only.

| Name | Sent when | Params (in order) |
|---|---|---|
| `task_assigned_v1` | task assigned to someone else | assignee, assigned by, task, due, next reminder |
| `task_reminder_v1` | scheduler | assignee, task, due, last remark |
| `task_done_v1` | Done by someone other than the creator | admin, done by, task, done at |
| `task_updated_v1` | remark or date change by a non-creator | admin, updated by, task, update |
| `date_approval_request_v1` | staff asks for > 25 days | admin, staff, task, current due, requested due |
| `date_approval_result_v1` | approve or reject | staff, task, Approved/Rejected, due |
| `daily_summary_v1` | 10 AM daily | name, pending, overdue |
| `welcome_user_v1` | new user added via WhatsApp | name, added by, role |

**Template delivery:** if a template send fails, `deliver.ts` sends the `fallbackText` as a plain message instead (this only works inside the 24 h window). Params are sanitized: newlines/tabs are flattened and empty values become "-". **Template names must never change**; editing a template in Meta means creating `_v2` and updating the code.

**Interakt API facts (verified live):**
- Send endpoint: `POST https://api.interakt.ai/v1/public/message/`, Basic auth
- Types: `Text`, `InteractiveList` (≤10 rows, title ≤24, desc ≤72), `InteractiveButton` (≤3 buttons, title ≤20), `Template`
- Session (non-template) messages only work within 24 h of the user's last message
- Incoming list/button replies are parsed tolerantly (`list_reply`, `button_reply`, nested `interactive`, template `button.payload/text`)

---

## 10. Code map (`worker/`)

| File | Role |
|---|---|
| `src/index.ts` | fetch (webhook, `/status`, `/users`), `processWebhook`, `scheduled`/`runCron`, outgoing TEST_NUMBERS filter |
| `src/env.ts` | Env type + `cleanEnv` |
| `src/status.ts` | `/status` report, `BUILD` label (bump on each release) |
| `src/admin.ts` | `/users` GET (list all) / PUT (upsert JSON array `{phone,name,role,branch,active?}`; `active:false` removes; renames sync to tasks) · `POST /users/welcome` `{phones, addedBy}` sends `welcome_user_v1` to active users |
| `src/bot/userChanges.ts` | shared by Staff manage and `/users`: `roleLabel`, `welcomeMessage`, `syncUserTasks` |
| `src/numbers.ts` | `testNumbers`, `mask`, `normalizePhone` |
| `src/interakt/parse.ts` | webhook → `IncomingMessage` |
| `src/interakt/send.ts` | payload builders + `send()` |
| `src/interakt/templates.ts` | template payload + param sanitizing |
| `src/interakt/deliver.ts` | `deliver`/`deliverAll` (never throws), `recipientFromPhone` |
| `src/interakt/signature.ts` | HMAC verification |
| `src/firebase/auth.ts` | service-account JWT → OAuth token (cached) |
| `src/firebase/firestore.ts` | REST helpers: get/set/patch/delete/create/query, `createIfAbsent` |
| `src/data/store.ts` | `Store` interface (**contract**) |
| `src/data/firestoreStore.ts` / `memoryStore.ts` | production / test implementations |
| `src/domain/types.ts` | data model (**contract**) |
| `src/domain/dates.ts` | IST parsing/formatting (Hinglish dates), 25-day helper, month clamp |
| `src/domain/schedule.ts` | reminder timing rules (**contract**) |
| `src/bot/flow.ts` | `Flow`, `BotContext`, `setStep`, `replyValue` (**contract**) |
| `src/bot/outgoing.ts` | `Outgoing` union, `TEMPLATE_PARAMS` (**contract**) |
| `src/bot/ui.ts` | list/button builders, paging (**contract**) |
| `src/bot/router.ts` | menus + routing (**coordinator**) |
| `src/bot/flows/*.ts` | createTask, tasks, approvals, manageStaff |
| `src/scheduler/reminders.ts`, `daily.ts` | cron jobs |
| `test/**` | 16 files, 335 tests; `test/helpers/bot.ts` holds shared fixtures |

**Docs:** `docs/BRIEFING.md` (Hinglish status), `docs/BATCH1-CONTRACT.md` (agent split for Batch 1 and 2), `docs/TEMPLATES.md`, `docs/SETUP-batch0.md`, `docs/TESTING-batch1.md` (checklist A–G), this file.

**Dev commands** (in `worker/`): `npm install`, `npx tsc --noEmit`, `npx vitest run`, `npx wrangler deploy --dry-run --outdir <tmp>`.

---

## 11. History and lessons (so they aren't repeated)

| Batch | What | How |
|---|---|---|
| 0 | Proved Interakt list/button send + reply parsing | 1 agent (coordinator) |
| 1 | Data model, Firestore store, dates, templates, router, create/view/act flows, staff add/remove | 5 agents in 2 phases |
| 2 | Scheduler, repeat types, approvals, monthly, creator updates, staff edit | 3 agents |
| 2.1 | Daily overdue reminders, edits update old tasks, auto-clear requests, 🕒 icon | coordinator |

**Problems hit during setup:**
1. A wrong `WEBHOOK_SECRET` value in Cloudflare gave 404 on every webhook. Debugged with a temporary `/diag` route (since removed).
2. Dashboard text variables were wiped on each deploy. Fixed with `keep_vars = true`.
3. A secret pasted with a trailing newline. Fixed with `cleanEnv` trimming.
4. The owner pressed "Save" instead of "Deploy" in Cloudflare, so the change wasn't live. Fixed via Deployments → Deploy version.
5. The welcome message to a new staff member was blocked by `TEST_NUMBERS` (by design). The variable has since been removed.

---

## 12. How to split work between parallel agents (proven pattern)

1. The **coordinator** first writes or changes the **contract files**: `types.ts`, `store.ts`, `memoryStore.ts`, `flow.ts`, `outgoing.ts`, `ui.ts`, `schedule.ts`, `router.ts`, `index.ts`, `test/helpers/bot.ts`. Agents must not edit these; they report needed changes instead.
2. Each agent **owns a disjoint set of files** (source + its tests), written into its prompt. Example from Batch 2: E1 `src/scheduler/*`; E2 `flows/createTask.ts` + `flows/manageStaff.ts`; E3 `flows/tasks.ts` + new `flows/approvals.ts`.
3. Agents **don't run git** commands that change state. The coordinator reviews, runs the full suite, verifies the committed tree in a clean `git worktree`, then commits and pushes each agent's files separately.
4. Never commit a file that imports a module not yet written (the auto-deploy would fail).
5. Flows return `Outgoing[]`; only `deliver.ts` talks to Interakt; only `FirestoreStore` talks to Firestore.
6. Reply ids are always `<flowId>:<kind>:<value>`; new flows must follow this.
7. After a release, bump `BUILD` in `status.ts` and confirm via `/status` that it's live.

---

## 13. What is left

### Open issue, needs the owner's input
- **Interakt's old auto-replies** (welcome / Greeting Flow / FAQ, e.g. the Hindi "राधे टाइल्स वर्ल्ड से जुड़ने…" message) also reply to staff, so staff get two replies. The automations can't be switched off (customers need them). **Proposed fix (Medium):** tag staff in Interakt (trait such as `is_staff=true`, set automatically by the bot through Interakt's user/track API whenever a user is added or edited) and add a condition in the Interakt automation to skip tagged users. **Waiting on:** the owner to check whether the Interakt automation supports conditions on tags/traits (screenshot).

### Known limitations (accepted for now)
- Tasks already reminded under the old rule (before 2.1) don't get daily overdue reminders. New tasks do.
- "Durg Office" never received its welcome message (it was blocked by TEST_NUMBERS); it just needs to send "Hi".
- Any admin can approve any date request (not only the creator).
- `/users` and `/status` are protected only by the path secret.
- Reminders can be up to 5 min late (cron granularity).
- No "back" button in task detail (3-button limit); "Hi" restarts.
- Remarks/history are never deleted, and tasks can't be deleted (only marked done).

### Testing still to do (owner)
Run the `docs/TESTING-batch1.md` checklist sections A–G on real phones.

### Future batches (owner said: later)
| Batch | Scope | Difficulty | Notes |
|---|---|---|---|
| 3 | WhatsApp Forms (static first) for one-screen task creation; submissions arrive as `flow_response` | Medium | Needs a Form built in Interakt |
| 4 | Voice notes: Groq Whisper (speech → text) + Gemini Flash (extract branch/staff/task/date); field-specific errors; branch inferred from staff name | Medium-Hard | Owner must create free Groq and Gemini API keys (Cloudflare secrets). `media_url` is already parsed |
| 5 | Mobile-first dashboard (PWA): summary cards, branch filters, overdue tracking, approvals, staff performance | Medium | Design not finalized; reads the same Firestore data |
| — | 10 extra ideas (priority flags, stuck-task detection, leaderboards, etc.) | — | Not decided |

---

## 13b. Dashboard API (in progress, see `docs/DASHBOARD-BRIEF.md`)

- **Phase 1 done:** `cancelled` status (Section 6).
- **Phase 2 done:** `/api/*` on the same Worker (`src/dashboard/`).
  - `POST /api/login {user, password}` → `{token, admins, sessionDays}`; `GET /api/me`; `POST /api/actor {name}` (pick "Aap kaun ho?" name, re-issues token)
  - Shared login from secrets `DASHBOARD_USER` + `DASHBOARD_PASSWORD` (≥12 chars, else login disabled with 503). Constant-time digest compare.
  - Lockout: 5 wrong tries per client (hashed IP) → 15 min; 30 wrong tries from all clients in 15 min → everyone locked 15 min. Stored in Firestore `login_guards`.
  - Token: `base64url(JSON{name,iat,exp}).HMAC`, key derived from `WEBHOOK_SECRET` + dashboard credentials; 30 days; password change logs everyone out. Sent as `Authorization: Bearer`.
  - Route auth levels: `none` (login), `session`, `named` (data-changing routes need a picked admin name).
  - CORS only for `DASHBOARD_ORIGINS` (comma list, never `*`); a browser request from any other origin gets 403.
- **Phase 3 done (code):** read routes `GET /api/users`, `GET /api/tasks?view=pending|archive` (`src/dashboard/routes/read.ts`, `toTaskDTO`). Errors carry a machine `code` (see `docs/DASHBOARD-API.md`).
- **PWA:** `dashboard/` (Vite + React 18 + TS + Tailwind v4 + Phosphor + vite-plugin-pwa, Geist font). Deployed separately on Cloudflare Pages (root `dashboard`, build `npm run build`, output `dist`). Design rules: `docs/DASHBOARD-DESIGN.md`. API contract: `docs/DASHBOARD-API.md`. Live as a Cloudflare Worker static site `radhe-tasks` (https://radhe-tasks.radhegeneral2306.workers.dev).
- **Phase 4 done:** `POST /api/tasks/:id/{done,remark,due,assign}` (`src/dashboard/routes/write.ts`), rules shared with WhatsApp in `src/bot/taskActions.ts`. PWA buttons: Done karo, Remark, Date badlo, Assign badlo (confirm dialog).
- **Phase 5 done:** `POST /api/tasks/:id/cancel` → `cancelTask` (sends `task_cancelled_v1` to assignee + creator, never the actor). PWA Cancel button asks "Pakka cancel karna hai?" ("Nahi" has default focus); cancelled tasks show in Archive with time and who cancelled.
- Next: 6 (date-request approvals screen), 7 (extras).

## 14. Quick troubleshooting

| Symptom | Check |
|---|---|
| Bot replies to nobody | `/status`: settings true and `firebase: ok`? A send without a valid signature gets 401, so re-copy `INTERAKT_WEBHOOK_KEY` from Interakt and press **Deploy** |
| 404 on webhook | `WEBHOOK_SECRET` doesn't match the URL in Interakt |
| One person gets no reply | Are they in `/users` and `active`? Is their number exactly `91` + 10 digits? |
| No reminder | Is the task pending, and is `nextReminderAt` in the past? Check the logs for "reminders:" |
| Template not received | Template name or param count mismatch, or the template isn't approved; the fallback text only arrives inside 24 h |
| Dashboard change not live | Cloudflare → Deployments → deploy the latest version |

Logs: Cloudflare → pa-wp-bot → **Observability / Logs** (every step is logged with masked phone numbers).
