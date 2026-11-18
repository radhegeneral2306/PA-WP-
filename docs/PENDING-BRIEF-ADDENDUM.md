# Radhe Tasks — Pending brief addendum (round 2)
*Prepared: 17 Nov 2026 · Owner: Bhaskar*

Fixed rule stays: everything on free plans. This addendum overrides `PENDING-BRIEF.md` wherever they differ (see Sections 3 and 4).

## 1. Answers
| Q | Topic | Answer | Owner's words (translated from Hindi voice) |
|---|---|---|---|
| Q1 | Dashboard auto-refresh | **Default.** Refresh when the app is reopened or brought back to the screen, and every 5 minutes while open; manual refresh button stays. | "Yes, that's fine, because the free tier must not be exceeded. You are right." |
| Q2 | Free Gemini and company data | **Default.** Stay on free tier; remarks are sent to the AI too. Owner accepts knowingly. | "I'm totally comfortable. The data going is fine, no problem. There is nothing that confidential in this." |
| Q3 | Daily AI limit | **Default.** Staff 20 AI questions/day, admins 50/day. Common questions (my tasks, today, tomorrow, overdue) are answered without AI and not counted. At the limit: "Aaj ki limit poori ho gayi, menu use kijiye" + menu. | "This sounds perfect." |
| Q4 | Performance counts look-back | **Changed: staff performance counts dropped** (see Section 4). The 3-month / Monday–Sunday settings are therefore not needed. | "Performance counts don't matter much. It's better not to include them, it will complicate things." Then agreed to: keep summary strip, task history and branch counts; drop only staff performance. |
| Q5 | Who can use voice update | **Default.** Bhaskar only for now. | "Yes, keep it like that." |
| Q6 | Actions by voice | **Default.** Done, remark, change date/time, reassign. Not by voice: Cancel, Delete, staff add/remove, approvals. | "Yes, that looks right." |
| Q7 | One voice note = one task | **Default.** "Pinky ke dono task done" asks the admin to pick one at a time. | "Yes, it will be safer, let's do that." |
| Q8 | How chat with the bot starts | **Changed: always on, not a menu button.** The normal (non-AI) bot looks at every message first. Anything it recognises (menus, buttons, known questions, an open step) is handled there. Only a message outside its context goes to the AI bot. Q3 daily limits still apply. Note from planning chat: while a step is open (typing a title, a remark), the typed text must stay in the old flow and never go to the AI; AI only when no step is open and the message is not recognised. Build chat to verify how to do this safely. | "No, keep anytime access. Add an identification layer: if a message goes outside the context of the normal bot without AI, transfer it to the AI bot; if inside, the normal bot does the work. Free tier only. The app isn't used that much, so no big tension." |
| Q9 | What staff can do by chat | **Default.** Ask about own tasks (today, tomorrow, overdue, this week), mark Done, add remark, create a task for themselves, request a date change (25-day rule stays). Never see others' tasks. | "Yes, looks right." |
| Q10 | What admins cannot do by chat | **Default.** Staff add/remove/edit and Delete stay in the menu/dashboard only. Everything else allowed, with confirm buttons. | "Right, okay." |
| Q11 | Non-task questions (e.g. GST) | **Default.** Bot politely refuses and shows the menu. | "This is right too." |
| Q12 | Urgent flag | **Default.** 🔴 mark, shown first in WhatsApp lists and dashboard. No extra reminders. Admins can set it on any task; staff only on their own. Set from dashboard, chat wizard (confirm screen) and voice ("urgent hai"); not the WhatsApp Form. | (agreed) |
| Q13 | Weekly repeat | **Default design, keep the feature.** Repeats on the same weekday as the due date. Overdue gets a daily 11 AM reminder (like monthly). Marking Done creates next week's task. Owner gave no example task, only said such tasks exist. | "No no, keep it, there are such tasks." |
| Q14 | WhatsApp Form and new options | **Default.** Form stays as is. Weekly repeat and urgent only from chat wizard, voice and dashboard. | "Yes, that's fine, it works for now." |
| Q15 | Delete / recycle bin | **Default.** Cancel = no longer needed (stays in Archive, can be reopened). Delete = mistake/test/junk, goes to recycle bin. Any admin can soft-delete, dashboard only. Permanent delete: Bhaskar only (30-day auto-clean already decided). No WhatsApp message to staff on delete. Restore: reminders restart from the due date; if that date has passed, admin picks a new date. Deleted weekly/monthly task: no next occurrence is created. Pending date request on a deleted task: cleared. | "Yes, this much is fine." / "Yes, keep this." |
| Q16 | Excel/CSV export | **Default.** CSV (opens in Excel), admins only, from the dashboard. Choose date range and status (pending / done / cancelled / all). Columns: title, assignee, branch, created by, due, status, done date, urgent, repeat, last remark. No phone numbers. | "Looks right." |
| Q17 | 5-minute typing timeout | **Default.** 5 min for: task title, remark/update, reason for date change, custom date typing, staff name/number. Button and list taps stay at 2 min. Bot chat 5 min (already decided). | "Yes, looks right." |
| Q18 | "Pakka?" before Done | **Default.** Only on dashboard Done. WhatsApp Done stays one tap. | "Perfect." |
| Q19 | Hinglish time words | **Default.** subah = 10 AM, dopahar = 2 PM, shaam = 6 PM, raat = 8 PM. "Monday/Somvar" = coming Monday 10 AM. "agle hafte" = 7 days later, 10 AM. | "No, this looks right." |
| Q20 | Word instead of "cancel" | **Default.** "band karo" in bot messages. | "Oh, perfect." |
| Q21 | Security check failure behaviour | **Changed: the bot keeps working and only alerts.** If a Cloudflare security setting goes missing, the bot keeps accepting messages and the daily health check alerts Bhaskar. (The default was: bot stops accepting messages.) Planning chat warned once: while the setting is missing, an outsider could send fake messages. Owner still chose to keep it running. | First said "yes, first one, it's better; it should keep running, flow should not break", then, when asked to clarify, answered: "it keeps running." |
| Q22 | Cost of admin remark / date change messages | **Default.** Staff get a WhatsApp template on every admin remark and also when an admin changes the date from WhatsApp. An admin who is himself the assignee is not notified (the actor is never notified anyway). No other exceptions. | "No no, this is right." |

## 2. Real examples given by the owner
- Weekly tasks: owner said "there are such tasks" but gave **no example**. Build chat should not wait for one; build it as designed in Q13.
- No new Hinglish phrases beyond the ones listed in Q19.

## 3. Anything new the owner raised
- **Always-on chat with an identification layer (Q8).** Normal bot first; AI only for messages outside its context. See Q8 for the careful part.
- Owner said usage of the app is occasional ("kabhi kabhi hi use hota hai"), so he is not worried about AI quota; Q3 limits still apply.

## 4. Changes to the order of work
- **Dashboard Phase 7 is smaller:** staff performance counts (pending/overdue/done per person, on-time %) are **dropped**. Phase 7 now has three items: summary strip, task history, branch counts. Still built last. This cancels the earlier Group C decision on per-staff counts, weekly and monthly counts and the "on time" rule.
- Order otherwise unchanged: bug round 1 → cleanup round → small features (5-min typing timeout, urgent flag, recycle bin, CSV export, weekly repeat) → voice update → chat with the bot → Phase 7.
- **Open point for build chat:** Q21 differs from the safe default; mention the risk once in the health-check alert text or notes, then follow the owner's choice.
