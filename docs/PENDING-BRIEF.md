# Radhe Tasks — Pending work brief
*Prepared: 17 Nov 2026 · Owner: Bhaskar (super admin)*

Constraint from owner: **everything stays on free plans. No paid AI key, no paid storage.**

## 1. Order of work (first = do first)
1. **Bug round 1:** C4/F1 (double tap makes duplicate task), C3 (old "Haan, hatao" button), C5 (WhatsApp date change / admin remark must notify staff), S5 (monthly task skips or repeats a month), X1 (logging / webhook settings).
2. **Cleanup round:** C8 (Hinglish dates), C9 (past date goes to next year), C11 ("Hi" becomes task title), C17 (bot tells users to type "cancel"), D4 ("pakka?" confirm before Done), D10/F14 (dashboard auto-refresh + overdue badge), V2 (voice transcript as "last remark"), V4 (wrong message on audio download failure).
3. **Small features:** F15 (5-min timeout for typing steps), F5 (urgent flag), F8 (soft delete + recycle bin), F9 (Excel/CSV export), F4 (weekly repeat).
4. **Voice update of tasks by admins** (feature 1 of Group B).
5. **Chat with the bot** (feature 2 of Group B), with its own 5-min timeout.
6. **Dashboard Phase 7** (summary strip, task history, per-staff counts, branch counts), deliberately last.

## 2. Decisions per item
| Item | Decision | Owner's notes |
|---|---|---|
| C4 / F1 double-tap duplicate task | Abhi | "do as you recommend" |
| C3 old remove button | Abhi | same |
| C5 admin WhatsApp date change / remark not told to staff | Abhi | Admin remarks WILL notify the assignee (one template per remark, accepted) |
| D1 fast password guessing | Nahi | "no changes needed" |
| D2 lock-out of all admins | Nahi | "not needed" |
| D3 dashboard security headers | Nahi | "not needed" |
| S5 monthly task skip/repeat | Abhi | "yes fix this as you recommend" |
| C8 Hinglish dates | Abhi | "yes all abhi" |
| C9 past date to next year | Abhi | same |
| C11 "Hi" becomes title | Abhi | same |
| C17 "cancel" triggers Interakt goodbye | Abhi | same |
| D4 Done confirmation | Abhi | "yes fix all 4" |
| D10 / F14 dashboard auto-refresh | Abhi | same |
| V2 voice transcript as last remark | Abhi | same |
| V4 audio download error text | Abhi | same |
| X1 logging / webhook check | Abhi | "okay fix this" |
| S6 holiday false alarm | Nahi | "not needed" |
| V1, V3, V5, V6, S7, S8, S10, S11, C6, C7, C13, C14, C15, C16, D6, D7, D8, D9, D11 | Baad mein | Not discussed one by one; marked "Baad mein" per build chat suggestion, owner did not object |
| D5, C12 | already solved | not discussed |
| Group B-1 voice update by admins | Abhi (first) | "add this feature"; "phele voice update bas" |
| Group B-2 chat with bot | Abhi (after voice) | "add this feature as well, extend the timeout limit" |
| Group B-3 multiple free keys / paid key | Nahi | "no sab abhi hume free tier pe hi rakhna hai" |
| C-1 summary strip | Abhi (last) | "all" |
| C-2 task history | Abhi (last) | "all" |
| C-3 per-staff counts | Abhi (last) | Admins only |
| C-4 branch counts | Abhi (last) | "all" |
| D: Nayan voice task creation | Nahi | "not now" |
| D: WhatsApp Form | Keep | "i will update the form manually, staff frequently change nahi hote" |
| D: Interakt auto-reply to staff | To-do for owner | Needs Interakt screenshot |
| D: real-phone test checklist | Shared | Build chat does what it can; owner does real-phone parts when build chat says so |
| D: dashboard password to Nayan | To-do for owner | Give in person |
| E: housekeeping (4 items) | Baaki | Owner says still pending, all 4 |
| F1 weekly report | Nahi | "not needed" |
| F2 escalation | Nahi | "not needed" |
| F3 holiday/Sunday calendar | Nahi | "not needed" |
| F4 weekly repeat | Abhi | "add this" |
| F5 priority flag | Abhi | "yes add this" |
| F6 photo proof | Nahi | "not needed" |
| F7 undo Done | Nahi | "not needed" |
| F8 delete task | Abhi | Soft delete, then recycle bin with full delete |
| F9 export Excel/CSV | Abhi | "add this" |
| F10 database backup | Nahi | "not needed". Planning chat said once this is a risk (all data in one Firestore); decision stays Nahi |
| F11, F12, F13 | Nahi | "not needed" |
| F15 longer typing timeout | Abhi | "5 min" |

## 3. New ideas the owner added (not in this file)
None. (Recycle bin and its rules, and the 5-min bot chat timeout, came from items already in the file.)

## 4. Settings decided
- Admin remarks notify the assignee: **yes**.
- Timeouts: normal tap steps **2 min**; typing steps (remark/title) **5 min**; bot chat assistant **5 min**.
- AI: **free tier only**, no paid key. Chat must answer common questions from code/database without AI, use per-person daily cap, and show a graceful message when quota is over.
- Voice update: first feature after bug rounds. Open task → voice applies only to it; otherwise short list of matching tasks, admin picks, always confirm.
- Staff performance counts: **admins only**; **weekly and monthly**; "on time" = Done before the end of the due day.
- Recycle bin: soft delete first; **only super admin (Bhaskar)** can delete permanently (with confirm); items **auto-clean after 30 days**.
- Nayan voice task creation: not now.
- WhatsApp Form stays; owner updates it manually.
- Escalation, holiday calendar, weekly report, undo Done, photo proof, backup: all declined.

## 5. Owner to-dos
- Mark old "Bot check" task(s) Done if still open.
- Cancel test tasks created during testing (dashboard → Cancel).
- Send "Hi" from the "Durg Office" phone once.
- Make sure the old dashboard password is not used anywhere (it appeared in a chat screenshot).
- Check in Interakt whether the auto-reply automation allows "skip users tagged staff"; send a screenshot to the build chat.
- Give Nayan the new dashboard password in person.
- Do the real-phone steps of `TESTING-batch1.md` when the build chat says which ones.

## 6. Open questions for the build chat to verify
- Does the owner actually have weekly tasks (F4)? He said add it but did not name any; confirm the design stays simple.
- Free AI quota is shared by Bhaskar's voice task creation, voice update and bot chat: estimate daily use and set per-person caps.
- Firestore Spark limits (50k reads / 20k writes per day) with auto-refresh (D10), export (F9), recycle-bin cleanup and bot chat: check they fit.
- Admin remark notifications (C5): confirm which template is needed and its cost.
- Recycle bin: what happens to reminders and recurring tasks when a task is soft-deleted or restored.
- Interakt condition for skipping staff: depends on owner's screenshot.
- Quoted bot messages to fix: "Voice se task abhi band hai" is not changed (V3 is Baad mein); "Samajh nahi aaya" on audio download failure (V4) must be reworded to ask the user to send it again.
