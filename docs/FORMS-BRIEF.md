# PA-WP Batch 3: WhatsApp Form for "Naya task" — Build Brief

*Prepared: 26 Oct 2026 · Based on: `HANDOFF.md` (live build `batch2.1`, 335 tests passing)*
*Owner: Bhaskar Sahu (non-technical) · Business: Radhe Tiles World (Raipur, Jagdalpur, Durg)*

---

## 0. Instructions for the new chat (READ THIS FIRST)

You are continuing an existing project. **Before doing anything else:**

1. **Read `HANDOFF.md` completely.** It describes the live WhatsApp task bot (Cloudflare Worker + Firebase Firestore + Interakt). The bot is live and used daily. **Do not rebuild or break it.**
2. **Then read this file completely.** All owner decisions are in Section 2. Do not re-ask questions that are already answered there.
3. **Owner communication rules:** the owner is non-technical. Reply in Hinglish (Roman script, no Devanagari). Be blunt and honest. State difficulty (Easy/Medium/Hard) for each step. Explain step by step in simple language.
4. **Never put secrets in the repo or chat** (API keys, Firebase key, webhook secrets, real phone numbers).
5. **Do not update any skill files** unless the owner insists.
6. **Deploy rules:** only push code that passes `npx tsc --noEmit` and `npx vitest run` (from `worker/`). The 335-test baseline must still pass. Remind the owner to press **Deploy** (not just Save) when editing Cloudflare variables.
7. **Contract files** (`types.ts`, `store.ts`, `flow.ts`, `outgoing.ts`, `ui.ts`, `schedule.ts`, `router.ts`, `index.ts`, `test/helpers/bot.ts`) are changed only by a coordinator, never by parallel agents.
8. **All planning questions are already answered** (Section 2 lists every owner decision, Section 9 says none remain). Start by briefly summarising the plan back to the owner in Hinglish and asking for a go-ahead, then follow the build order in Section 7.

---

## 1. Goal

Today, creating a task takes 6-7 taps/typing steps in a chat flow (branch, person, title, date, time, repeat, confirm). Batch 3 adds a **WhatsApp Form (WhatsApp Flows)** so the owner and staff can fill the whole task on **one screen** and submit once.

The form is an **optional extra way** to create a task. The existing chat flow stays exactly as it is.

---

## 2. Decisions already made by the owner

| # | Decision |
|---|---|
| 1 | The form is **optional and additional**. The existing "Naya task" chat flow is **kept unchanged**. If the form has any problem, staff can still use the old flow. The old flow may be removed later only if the form works well in real use. |
| 2 | **Admin form fields:** Branch, Person, Task title, Date, Time, Repeat. |
| 3 | **Staff form fields:** Task title, Date, Time, Repeat only. (No branch/person fields, because staff create tasks only for themselves.) |
| 4 | The **Person dropdown is a static list** in version 1, written into the form when it is built. If staff are added or removed later from WhatsApp, the owner must update the form's list by hand. Auto-updating lists (needs a separate data endpoint server) is **out of scope for now**. |
| 5 | **How the form opens:** a **new menu option**, for example "Naya task (Form)", is added to the main menu. Tapping it makes the bot send the form template. The old "Naya task" option stays. Admin menu has 5 options and staff menu has 2, so there is room (WhatsApp list allows up to 10 rows). |

---

## 3. What the form must do

### 3.1 Admin form (one screen)
- **Branch** (dropdown): Raipur, Jagdalpur, Durg, Admins
- **Person** (dropdown): static list of active staff and admins
- **Task title** (text, required)
- **Date** (date picker, required; past dates not allowed)
- **Time** (optional; if empty use **10:00 AM IST**, same as the chat flow)
- **Repeat** (radio/dropdown): Ek baar / Har 90 min / Har mahine
- Submit button

### 3.2 Staff form (one screen)
- **Task title**, **Date**, **Time**, **Repeat**, Submit. Assignee is always the staff member themself.

### 3.3 Because the Person list is static
The bot must **re-check on the server** after submission: the chosen person must exist, be active, and belong to the chosen branch. If not, reply with a clear Hinglish error and let the user retry. Never trust the form blindly.

---

## 4. Required bot-side work

1. **Parse the submission.** The form result arrives as a `flow_response` (in Interakt: inside the incoming message webhook, and possibly also as a "Completed Flow" webhook). `media_url` and similar fields are already parsed; check what `interakt/parse.ts` does with `flow_response` and extend it. **Dedup:** the same submission must never create two tasks (use the existing `webhook_log` dedup by message id; if both webhooks fire, handle only one).
2. **New flow file** (for example `flows/createTaskForm.ts`) that validates the submitted fields and then creates the task using the **same domain logic as the chat flow** (do not duplicate rules): IST/UTC handling, default 10:00 AM IST, past times rejected, `nextReminderAt = dueAt`, monthly gets `repeatDay`.
3. **Same notifications as the chat flow:** creator gets "✅ Task ban gaya"; the assignee gets template `task_assigned_v1` (skipped for self tasks).
4. **Menu change** in `bot/router.ts` (coordinator-owned): add "Naya task (Form)" for admin and staff menus. Tapping it sends the form template. Also update the menu tests.
5. **Role check:** the admin form is sent only to admins, the staff form only to staff. A staff user must never be able to submit the admin form, and the bot must verify the submitter's role on the server, not only by which form was sent.
6. **New outgoing type** in `bot/outgoing.ts` (contract file) for sending the form template, plus its entry in `TEMPLATE_PARAMS` and `fallbackText` (fallback = a plain message such as "Form nahi khul raha, purana 'Naya task' use karein"). Document it in `docs/TEMPLATES.md`.
7. **Tests:** add tests for valid submission, missing title, past date, invalid person/branch, role mismatch, duplicate webhook, default 10 AM time, and repeat types. Baseline 335 must still pass.
8. Bump `BUILD` in `status.ts` after release. Add a section to `HANDOFF.md`.

---

## 5. Owner-side work (Interakt / Meta) — must happen before the code goes live

Tell the owner each step in simple Hinglish, one at a time:

1. In Interakt, build **two forms** (Admin form, Staff form) with the fields in Section 3. (Difficulty: Medium; the owner may need screenshots/help.)
2. Create **two Flow templates** in Interakt (one per form), category Utility, and submit them to Meta for approval. Earlier templates were approved in 10-30 minutes, but **Flow templates can take longer**; plan for waiting.
3. Subscribe to the needed webhooks in Interakt Developer Settings if required (the "incoming customer messages" webhook already contains `flow_response`; confirm whether the separate "Completed Flow" webhook is needed, and avoid double-processing).
4. Give the final **template names** to the build chat. Names must never change after approval (a change means a new `_v2`).
5. Remember to **update the Person list by hand** in the Admin form whenever staff are added or removed.

---

## 6. Risks and honest notes

- **Medium difficulty overall.** The code part is moderate; the real uncertainty is how Interakt delivers `flow_response` and how long Meta takes to approve Flow templates. Verify with a **real test submission** early and print the raw payload (with phone numbers masked) before writing the full parser.
- **Static Person list goes stale** if staff change. This is a known accepted limitation (Decision 4).
- **Not tested yet:** the form feature is new, which is exactly why the old flow is kept (Decision 1).
- The 24-hour session window rule still applies to non-template messages. Sending the form template when the user taps the menu option is inside their window, but confirm how Interakt requires the form to be sent (as a template or as a session message) and tell the owner.

---

## 7. Build order

| Phase | What | Difficulty |
|---|---|---|
| 1 | Owner builds the 2 forms and submits 2 Flow templates in Interakt (start this first, because approval takes waiting time) | Medium |
| 2 | Capture a **real sample** `flow_response` payload; extend `interakt/parse.ts` and add parse tests | Medium |
| 3 | New flow file: validation, task creation with shared domain logic, notifications, dedup | Medium |
| 4 | Outgoing type for the form template, `TEMPLATE_PARAMS`, fallback text, `docs/TEMPLATES.md` | Easy |
| 5 | Menu option "Naya task (Form)" in `router.ts` for admin and staff, plus tests | Easy |
| 6 | Owner tests on real phones: admin form, staff form, wrong person/branch, past date, double-submit, old flow still works | Easy |
| 7 | Bump `BUILD`, update `HANDOFF.md` | Easy |

---

## 8. Definition of done

- [ ] Admin form creates a task for the chosen person with the right branch, due date/time, and repeat
- [ ] Staff form creates a self task
- [ ] Default time is 10:00 AM IST when time is empty; past dates are rejected with a clear message
- [ ] Server re-validates person, branch, and role; invalid submissions get a clear Hinglish error
- [ ] Same notifications as the chat flow (creator confirmation, assignee template for non-self tasks)
- [ ] Duplicate form submissions do not create duplicate tasks
- [ ] New menu option appears for admin and staff; the old "Naya task" flow still works unchanged
- [ ] Fallback message works if the form template cannot be sent
- [ ] `npx tsc --noEmit` and `npx vitest run` pass (335 baseline plus the new tests)
- [ ] `BUILD` bumped, `HANDOFF.md` updated, no secrets leaked

---

## 9. Open questions

**None remaining.** If something genuinely new comes up while building (for example, Interakt does not support a field type we planned), ask the owner one question at a time, explain the options in simple Hinglish, give a recommendation, and record the answer in Section 2.

---

## 10. Not part of this batch

- Batch 4 (voice notes) and Batch 5 (dashboard, planned separately in `DASHBOARD-BRIEF.md`).
- Auto-updating Person list in the form (needs a data endpoint).
- The Interakt double-reply issue (still pending, owner is checking the automation UI).
- Real-phone testing of `docs/TESTING-batch1.md` A-G (owner is doing this himself).
