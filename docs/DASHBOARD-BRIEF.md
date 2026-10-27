# PA-WP Batch 5: Interactive Dashboard (PWA) — Build Brief

*Prepared: 26 Oct 2026 · Based on: `HANDOFF.md` (live build `batch2.1`, 335 tests passing)*
*Owner: Bhaskar Sahu (non-technical) · Business: Radhe Tiles World (Raipur, Jagdalpur, Durg)*

---

## 0. Instructions for the new chat (READ THIS FIRST)

You are continuing an existing project. **Before doing anything else:**

1. **Read `HANDOFF.md` completely.** It describes the live WhatsApp task bot (Cloudflare Worker + Firebase Firestore + Interakt). The bot is live and used daily. **Do not rebuild or break it.**
2. **Then read this file completely.** This file defines ONE new piece of work: an interactive web dashboard (Batch 5), plus one small supporting change in the bot (the `cancelled` status).
3. **Owner communication rules** (from HANDOFF.md and owner preferences):
   - Reply in **Hinglish, Roman script only** (no Devanagari).
   - Be **blunt and honest**. If something is a bad idea, say so directly.
   - For every task, state the **difficulty (Easy / Medium / Hard / Very Hard)** and explain **step by step in simple language**. The owner is non-technical.
   - Do not make things sound easier than they are. State realistic effort.
4. **Never put secrets in the repo or in chat**: API keys, Firebase private key, webhook secret, Interakt keys, real phone numbers. Secrets live only in Cloudflare (Worker -> Settings -> Variables and Secrets).
5. **Do not update any skill files** unless the owner explicitly insists.
6. **Deployment rule:** pushes to branch `claude/nifty-franklin-xolea7` of `radhegeneral2306/pa-wp-` auto-deploy via Cloudflare Workers Builds. Only push code that passes `npx tsc --noEmit` and `npx vitest run` (run from `worker/`). A failing build leaves the old version live.
7. **Web app rules (owner preference):**
   - **Mobile-first** (phone is primary, PC is secondary).
   - Must be an **installable PWA** — include every file the browser needs to install it on a phone (manifest, service worker, icons, etc.).
8. **All planning questions are already answered** (Section 2 lists every owner decision, Section 9 says none remain). Start by briefly summarising the plan back to the owner in Hinglish and asking for a go-ahead, then proceed in the build order of Section 8.

---

## 1. Goal

Build a **fully interactive, mobile-first dashboard (PWA)** for the owner/admins to manage the same tasks that the WhatsApp bot manages. It reads and writes the **same Firestore data**. The owner should be able to see all pending tasks and act on them directly, without using WhatsApp.

The owner explicitly wants **only the important things**, not a bloated dashboard.

---

## 2. Decisions already made by the owner

| # | Decision |
|---|---|
| 1 | Dashboard is built **now**, before the other pending batches (Batch 3 Forms, Batch 4 Voice notes). |
| 2 | It must be **fully interactive** (read AND write), not read-only. |
| 3 | **There is no hard delete.** Instead, a **Cancel** button. Cancelling a task moves it to an **Archive tab**. |
| 4 | The 5 "must-have" features in Section 3 are confirmed important. |
| 5 | The **Archive tab shows BOTH cancelled tasks AND done tasks.** (Pending tasks stay in the main list.) |
| 6 | **Login = ONE shared admin ID + password** (not WhatsApp OTP). The app is used only by the owner's admins and will not be shared with anyone else. |
| 7 | **When a task is cancelled, BOTH the assignee AND the creator get a WhatsApp message** (the creator may be an admin or anyone else). Uses a NEW template `task_cancelled_v1` (needs Meta approval in Interakt; owner says the earlier 8 templates were approved within 10-30 minutes, so delay is not a concern). Rules: nobody is messaged about their own action (if the creator is the one cancelling, only the assignee is messaged, and vice versa); if creator and assignee are the same person, send ONE message only; skip inactive users. |
| 8 | **When a task is reassigned from the dashboard, the NEW assignee gets a WhatsApp message** using the existing `task_assigned_v1` template (no new template needed). |
| 9 | **Archive shows the date and time** each task was cancelled/completed (in IST). Because the login is shared, the actor name for dashboard actions shows as **"Dashboard (admin)"**, not a specific person. |
| 10 | **All dashboard users are equal.** No special owner-only powers in this version (the shared login cannot tell users apart). Per-person permissions would need separate logins and are out of scope. |
| 11 | **Hosting = Cloudflare Pages (separate from the bot Worker).** Reason: the bot is the critical daily system and the dashboard is secondary, so a dashboard bug or failed build must never affect the bot. The dashboard calls the Worker's API routes over HTTPS. |
| 13 | **Actor name (27 Oct):** after login the dashboard asks "Aap kaun ho?" (active admins list). The picked name is put in the session token and used in remarks/notifications ("Done from dashboard by Bhaskar"). Honor system. |
| 14 | **Session length (27 Oct): 30 days.** Changing `DASHBOARD_PASSWORD` logs out every device. |
| 15 | **Notifications from dashboard actions (27 Oct): YES, same as the bot.** Done → creator (`task_done_v1`); remark/date change by someone else → creator (`task_updated_v1`), and a date change also tells the assignee; reassign → new assignee (`task_assigned_v1`); cancel → assignee + creator (`task_cancelled_v1`). Never notify the actor. |
| 12 | **No Undo/Restore in version 1.** Restoring cancelled tasks is saved for **version 2**. In version 1, pressing Cancel must show a **confirmation prompt** (for example "Pakka cancel karna hai?") to avoid accidental cancels. |

---

## 3. Feature scope

### 3.1 MUST-HAVE (confirmed by owner — build first)

1. **Pending task list**
   - Shows all pending tasks.
   - Overdue tasks are visually marked (red / warning) and sorted to the top.
   - Shows: title, assignee, branch, due date/time, repeat type, last remark.
2. **Filters**
   - By **branch** (Raipur / Jagdalpur / Durg / Admins), by **staff member**, and by **status** (pending, or Archive = done + cancelled).
3. **Direct actions on a task**
   - **Mark Done** (same rules as the bot: stops reminders; monthly tasks auto-create next month's task).
   - **Change assignee** (reassign to another staff/admin; e.g. from Bhaskar to Nayan). Update assignee name and branch on the task.
   - **Change due date/time.**
   - **Add remark/update.**
   - **Cancel** (see 3.4).
4. **Date-request approvals**
   - List of pending `dateRequest`s (staff asked for a date more than 25 days ahead).
   - **Approve** / **Reject** with the same effect as the WhatsApp approvals flow, including notifying the requester.
5. **Search**
   - Search tasks by title text (and ideally assignee name).

### 3.2 NICE-TO-HAVE (build after the must-haves work)

- **Summary cards** at top: total pending, overdue, due today.
- **Task history**: show all remarks (who, when, what) for a task.
- **Pending count per staff member.**

### 3.3 LATER (do not build now)

- Staff performance (on-time vs late).
- Staff add / edit / remove page (this already works from WhatsApp).
- **Restore / Undo cancelled task** (version 2). It will need reminders to be re-enabled and a decision on whether to notify people again.

### 3.4 Cancel and Archive (owner's rule)

- A **Cancel** button on a pending task sets its status to `cancelled`. Pressing it must first show a **confirmation prompt** ("Pakka cancel karna hai?" with Yes/No), since there is no undo in version 1.
- The **Archive tab shows BOTH cancelled tasks and done tasks** (owner decision). The main task list shows only pending tasks.
- When a task is marked **Done** (from the dashboard or WhatsApp), it also leaves the pending list and appears in the Archive tab.
- In the Archive, each task should be clearly labelled **Done** or **Cancelled**, with a filter to show only one of them. Sort newest first.
- Archive tab is read-only history. Each task shows **when** it was cancelled or completed (date and time, IST). The actor shows as "Dashboard (admin)" for dashboard actions, or the person's name if it was done from WhatsApp.
- **Never permanently delete** tasks or remarks (matches the existing rule in HANDOFF.md).

---

## 4. Required change in the bot (small but mandatory)

Today `Task.status` is only `"pending" | "done"`. Cancel needs a third value.

**Required work in `worker/`:**

1. Extend `Task.status` in `src/domain/types.ts` to `"pending" | "done" | "cancelled"`. (`types.ts` is a **contract file**, so it is changed carefully and first.)
2. Add `cancelledAt` and `cancelledByName` fields (treat missing as `null`, as done for older tasks). `cancelledAt` is required so the Archive can show the time; `doneAt` already exists for done tasks.
3. **Stop all reminders for cancelled tasks.** Check `src/scheduler/reminders.ts` and `src/scheduler/daily.ts`: they must skip anything not `pending`. Also make sure cancelled tasks are **excluded from the daily summary counts** (pending / overdue).
4. Make sure WhatsApp "Mere tasks" / "Staff ke tasks" lists do **not** show cancelled tasks.
5. Update tests so the 335 existing tests still pass, and add new tests for the cancelled status.
6. **Cancel notification (owner decision: YES, to both assignee and creator).** When a task is cancelled:
   - The **assignee** gets a WhatsApp message.
   - The **creator** of the task also gets a WhatsApp message (the creator can be an admin or any other user).
   - **De-duplication rules:** never message the person who performed the cancel; if creator and assignee are the same person, send only ONE message; skip users who are inactive or missing.
   - This needs a **new template `task_cancelled_v1`**:
     - Category Utility, language English (Hinglish text), quick-reply buttons only, same style as the existing 8 templates (see `docs/TEMPLATES.md`).
     - Suggested params (in order): recipient name, cancelled by, task title, assigned to. (The "assigned to" param lets the creator know whose task was cancelled; confirm final wording with the owner.)
     - Add it to `TEMPLATE_PARAMS` in `bot/outgoing.ts` (contract file) with a `fallbackText`, and document the wording in `docs/TEMPLATES.md`.
     - The owner must create and submit the template in Interakt; give them the exact text to paste and wait for approval **before** the code that sends it goes live. Never change a template name after approval (new version = `_v2`).
7. Bump `BUILD` in `src/status.ts` after release and verify via `/status`.

**Why this matters:** without step 3, a cancelled task would keep sending reminders to staff, which is a real bug.

---

## 5. Architecture options (decision needed)

The dashboard needs to write to Firestore safely. Pick ONE approach. **Recommended: Option A.**

### Option A — Dashboard talks to the existing Cloudflare Worker (RECOMMENDED)

- Add new **API routes** to the existing Worker (for example under `/api/...`) for: list tasks, update task, mark done, reassign, change date, add remark, cancel, list/decide approvals.
- The Worker holds the Firebase service account (already the case). The browser **never** sees Firebase credentials.
- The dashboard (static PWA files) is hosted on **Cloudflare Pages** (owner decision, separate from the Worker) and calls these API routes over HTTPS.
- Reuse existing domain logic (done logic, monthly next-task creation, date rules, approval rules) **instead of duplicating it**, so the bot and dashboard behave identically.
- Difficulty: **Medium-Hard**.

### Option B — Dashboard talks to Firestore directly from the browser (NOT recommended)

- Needs Firestore security rules and Firebase Auth in the browser.
- Business logic (monthly repeat, reminder scheduling, notifications) would have to be duplicated in the frontend and could drift from the bot.
- Higher risk of inconsistent data.
- Difficulty: **Hard**, with more long-term risk.

### 5.1 Hosting setup consequences (Cloudflare Pages + separate Worker)

Because the dashboard and the bot are deployed separately, handle these explicitly:

1. **Separate project and deploy.** Create a separate folder in the same repo (for example `dashboard/`) or a separate repo, and a separate Cloudflare Pages project. Its build must not touch `worker/`. Do not change the bot's existing Workers Builds settings (root dir `worker`, branch `claude/nifty-franklin-xolea7`).
2. **CORS.** The browser will call the Worker from a different origin, so the Worker's `/api/...` routes must send correct CORS headers that allow **only the exact dashboard origin** (never `*`), including the preflight (OPTIONS) request and the Authorization header.
3. **Session handling across origins.** Because the origins differ, prefer a token sent in the `Authorization` header (stored carefully in the app) or a correctly configured cookie (`Secure`, `HttpOnly`, `SameSite` set properly). Decide which is simpler and safe; explain the choice to the owner.
4. **API base URL** is a config value in the dashboard, not a secret. The password and signing secret stay only in Cloudflare Worker secrets.
5. **Bot isolation rule:** any change to the Worker for the dashboard (new `/api/...` routes, `cancelled` status, new template) is still a change to the live bot. It must pass `npx tsc --noEmit` and `npx vitest run`, and the existing webhook flow must remain untouched.
6. Tell the owner step by step how to connect the repo to Cloudflare Pages and what the final dashboard URL will look like. Remind them to press **Deploy** when changing dashboard-related variables.

---

## 6. Security (critical)

The dashboard exposes and modifies real business data. **It must NOT rely on the existing path-secret approach alone** (HANDOFF.md already flags `/users` and `/status` as weak).

Requirements:

1. A **login is required** before any data is shown. **Owner decision: a single shared admin ID + password** (no per-person accounts, no OTP).
   - The password is stored **only as a Cloudflare secret** (never in the repo, never in the frontend code). Prefer storing a salted hash, or compare in constant time on the server.
   - Enforce a **strong password** (long, not guessable) and tell the owner honestly that one shared password means: if any admin leaks it or leaves the company, **the password must be changed** (update the Cloudflare secret and press **Deploy**).
   - **Add brute-force protection:** limit failed login attempts (for example, lock out for some minutes after 5 wrong tries) and log failures.
   - Because everyone shares one login, the audit trail cannot say *which person* acted. Record the action as "Dashboard (admin)" in remarks, or optionally ask for a "Your name" dropdown after login (confirm with the owner).
2. The shared login is treated as an admin-level login. The old rule about `role = "admin"` in Firestore `users` is not used for dashboard login, but it still applies to the WhatsApp bot.
3. Every API route must verify the session/token **on the server**. Never trust the browser.
4. Sessions expire (suggested: 7-30 days, to be confirmed).
5. No secrets in frontend code. No real phone numbers in the repo.
6. Log actions with masked phone numbers (`***1234`), as the rest of the system does.
7. Record **who did what from the dashboard** (for example, a remark such as "Done from dashboard by Bhaskar") so there is an audit trail.

---

## 7. Behaviour rules the dashboard must follow (copy the bot's logic)

Reuse, do not reinvent. Key rules from HANDOFF.md:

- Times are stored as **ISO UTC** and shown in **IST (UTC+5:30)**. If no time is given, default is **10:00 AM IST**.
- **Done:** status becomes `done`, reminders stop, pending date request cleared. For `monthly` tasks, the next month's task is created automatically (same day, clamped: 31 -> 30/28/29, then back to 31).
- **Date change:** new `dueAt`, `nextReminderAt` = new due, any pending request cleared. Past times should be rejected or clearly warned.
- **Staff 25-day rule:** this applies to staff in the bot. The dashboard is used by admins, so it is not enforced there. Admin changes apply immediately.
- **Reassign (owner decision: notify):** update `assigneePhone`, `assigneeName` and `branch` on the task, and send the **new assignee** the existing `task_assigned_v1` template (same as when a task is created for someone else). Do not message the person doing the reassigning if they are the new assignee. Reminders must follow the new assignee from then on.
- **Notifications:** when an admin changes something on someone else's task (done, date change, remark), the existing notification rules should be mirrored where sensible. Confirm the exact behaviour with the owner before implementing.
- **Template names must never change.** New templates must be `_v1` and need Meta approval in Interakt.
- Firestore queries: **at most one equality filter and no orderBy** (avoids composite indexes). Sort and filter in memory.
- Flows and the scheduler never call Interakt directly; only `interakt/deliver.ts` sends.

---

## 8. Suggested build order

Each phase should be tested and deployed on its own. Do not start the next until the previous one is verified.

| Phase | What | Difficulty |
|---|---|---|
| 1 | Add `cancelled` status in the bot + stop reminders/summary for it + tests. Deploy and verify. | Easy-Medium · ✅ **Done 27 Oct (build `dash-p1`)** |
| 2 | Shared admin ID + password login, brute-force lockout, and API skeleton in the Worker (session token verified server-side). | Medium · ✅ **Done 27 Oct (build `dash-p2`)** |
| 3 | Cloudflare Pages project + read-only dashboard: pending list, overdue highlighting, filters, search. PWA shell (installable, mobile-first). CORS set up on the Worker. | Medium · ✅ **Code done 27 Oct (`dashboard/`, read API live)**; owner to create the Pages project and set `DASHBOARD_ORIGINS` |
| 4 | Write actions: Done, remark, change date, change assignee (new assignee notified with `task_assigned_v1`). | Medium · ✅ **Done 27 Oct (API build `dash-p4a`, PWA in `dashboard/`)** |
| 5 | Cancel (with confirmation prompt) + Archive tab, including the `task_cancelled_v1` template (owner submits it in Interakt first). | Easy-Medium · ✅ **Done 27 Oct (API build `dash-p5a`, template approved, PWA Cancel button with confirm)** |
| 6 | Date-request approvals screen. | Medium |
| 7 | Nice-to-haves: summary cards, history view, per-staff counts. | Easy-Medium |

**Overall difficulty: Medium-Hard.** Realistically this is multiple sessions of work, not one. State this honestly to the owner.

---

## 9. Open questions

**None remaining.** All questions were answered by the owner and are recorded in Section 2 (Decisions). If something genuinely new comes up while building, ask the owner one question at a time, explain the options in simple Hinglish, give a recommendation, and then record the answer in Section 2.

---

## 10. PWA requirements (owner preference, mandatory)

Include everything the browser needs to install it on a phone:

- Web app manifest (name, short name, start URL, display `standalone`, theme/background colours)
- Icons in all needed sizes (including maskable icon)
- Service worker (offline shell; **never cache API data in a way that shows stale tasks as fresh**)
- HTTPS (already true on Cloudflare)
- Mobile-first layout: large tap targets, bottom or thumb-friendly navigation, readable on small screens; desktop is a secondary, wider layout
- Tell the owner step by step how to "Add to Home Screen" on Android and iPhone

---

## 11. Definition of done

- [ ] `cancelled` status live in the bot; cancelled tasks get no reminders and are not in summaries or WhatsApp lists
- [ ] All existing tests still pass, new tests added; `npx tsc --noEmit` and `npx vitest run` clean
- [ ] Shared admin ID + password login works; wrong-password lockout works; unauthenticated requests are rejected
- [ ] Dashboard shows pending tasks with overdue highlighting, filters and search
- [x] Done, remark, change date, change assignee and cancel all work and match bot behaviour
- [x] Archive tab shows both cancelled and done tasks, labelled and filterable, with date and time
- [ ] Cancel asks for confirmation before acting
- [ ] Date-request approvals work and notify the requester
- [ ] `task_cancelled_v1` template approved in Interakt; on cancel, both assignee and creator are notified (no self-notification, no duplicates)
- [ ] On reassign, the new assignee is notified with `task_assigned_v1`
- [ ] Dashboard live on Cloudflare Pages, calling the Worker with CORS restricted to the dashboard origin; bot deploys unaffected
- [ ] Installable on a phone as a PWA
- [ ] `BUILD` label bumped and confirmed via `/status`
- [ ] No secrets or real phone numbers in the repo
- [ ] `HANDOFF.md` updated (new section for the dashboard, API routes, login, and the `cancelled` status)

---

## 12. Still-pending items from before (do NOT mix into this batch)

- **Interakt double-reply issue:** staff get two replies (bot + old Interakt auto-reply). The owner is checking whether Interakt automation supports skipping tagged users. Web research did not confirm it. Waiting on the owner's screenshot or an Interakt support answer. Proposed fix: tag staff via Interakt's user/track API.
- Batch 3 (WhatsApp Forms) and Batch 4 (voice notes) are postponed.
- Real-phone testing of `docs/TESTING-batch1.md` sections A-G is still pending.
