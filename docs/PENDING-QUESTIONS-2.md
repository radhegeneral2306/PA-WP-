# Radhe Tasks — follow-up questions on PENDING-BRIEF (round 2)

*Prepared 17 Nov 2026 by the build chat for a voice/planning chat (any AI). Owner: Bhaskar (super admin, Radhe Tiles World), non-technical.*

> **Hinglish summary:** `PENDING-BRIEF.md` mein faisle ho gaye hain, lekin kuch sawaal chhoot gaye the. Is file mein wo 17 sawaal hain. Har sawaal ke saath build chat ki **default salah** hai. Jo default theek lage uspe "haan" bolo, jo nahi lage use badlo. Aakhir mein planning chat `PENDING-BRIEF-ADDENDUM.md` banayega, wo file build chat ko deni hai.

---

## 0. Instructions for the planning chat (READ FIRST)

1. **Voice conversation:** ask one group at a time, 2–4 questions per turn, short and in plain words. No code, no IDs read aloud.
2. **Hinglish** (Hindi grammar, Roman script, no Devanagari). Be blunt; give a real-life example when a question is abstract.
3. For every question say the **default** first. If the owner says "default", record the default. If he changes it, record his exact words.
4. Respect the owner's fixed rule: **everything stays on free plans** (no paid AI key, no paid storage). If an answer would break a free limit, say so plainly.
5. Never ask for or write secrets or phone numbers.
6. At the end, produce `PENDING-BRIEF-ADDENDUM.md` in the format of Section 6.

### Context (short)
- WhatsApp task bot (Interakt → Cloudflare Worker → Firebase Firestore) + admin dashboard "Radhe Tasks".
- 2 admins (Bhaskar, Nayan) + ~25 staff.
- Free plans:
  - Firebase allows **50,000 reads per day**. If it runs out, **the WhatsApp bot and the dashboard both stop until the next day** (same database).
  - Cloudflare allows max 50 outgoing calls per message.
  - Gemini and Groq run on their free tiers.
- Already decided (`PENDING-BRIEF.md`):
  - Order of work: bug round 1 → cleanup → small features (5-min typing timeout, urgent flag, recycle bin, CSV export, weekly repeat) → voice update → chat with the bot → dashboard Phase 7.
  - Admin remarks notify staff.

---

## 1. Group 1 — free-limit and privacy risks (most important)

**Q1. Dashboard auto-refresh speed (D10)**
- Every refresh reads all pending tasks, about 100 reads.
- Refresh every minute with 2 admins keeping the app open all day ≈ 120,000 reads/day. That is over the free 50,000, and the bot would stop.
- **Default:** refresh when the app is opened again or brought back to the screen, and **every 5 minutes** while it stays open. A manual refresh button stays.
- Alternative: every 2 minutes, which is riskier.

**Q2. Free Gemini and company data**
- On the free tier, Google may use the text sent to it to improve its products.
- Voice update and the chat bot will send task titles, staff names and remarks (sometimes customer names or amounts).
- **Default:** stay free and the owner **accepts this knowingly**.
- Alternatives: don't send remarks to the AI, only titles and names (slightly less smart); or skip the AI features.

**Q3. Daily AI limit per person (chat bot)**
- Common questions ("mere tasks", "aaj kya hai", "kal kya hai", "overdue") are answered without AI and are not counted.
- **Default:** staff **20** AI questions/day, admins **50**/day.
- When the limit is reached: "Aaj ki limit poori ho gayi, menu use kijiye" + menu.

**Q4. How far back the performance counts look (Phase 7)**
- Counting all old Done tasks gets more expensive every month (reads).
- **Default:** count only the **last 3 months**; week = **Monday to Sunday**; month = calendar month.
- "On time" = Done before the end of the due day (already decided).

---

## 2. Group 2 — voice update (admins update tasks by voice)

**Q5. Who can use it?** Nayan's voice task creation is "not now".
- **Default:** voice update is also **Bhaskar only** for now.

**Q6. Which actions by voice?**
- **Default:**
  - **Done, remark, change date/time, give to someone else (reassign)**.
  - **Not** by voice: Cancel, Delete, staff add/remove, approvals.

**Q7. One voice note = one task?**
- **Default:** yes. "Pinky ke dono task done" asks the admin to pick one at a time.

---

## 3. Group 3 — chat with the bot

**Q8. How does the chat start?**
- **Default:** a menu button **"🤖 Bot se baat"**; the chat then stays open (5-min timeout) until "Hi"/menu.
- Alternative "always on": every typed message goes to the bot. Easier for staff, but it burns the free AI quota faster and can clash with the old menus.

**Q9. What can staff do by chat?**
- **Default:**
  - Ask about their own tasks (today, tomorrow, overdue, this week).
  - Mark Done, add a remark, create a task for themselves, request a date change (the 25-day rule stays).
- They never see others' tasks.

**Q10. What can admins NOT do by chat?**
- **Default:** staff add/remove/edit and Delete stay in the menu/dashboard only. Everything else is allowed (with confirm buttons).

**Q11. Questions not about tasks** (e.g. "GST kya hai")
- **Default:** the bot politely refuses and shows the menu (saves quota).

---

## 4. Group 4 — small features

**Q12. Urgent flag (F5)**
- *What does "urgent" do?* **Default:**
  - A 🔴 mark, shown first in WhatsApp lists and the dashboard.
  - **No extra reminders**, because each reminder is a paid template.
- *Who can set it?* **Default:** admins on any task; staff only on their own tasks.
- *Where?* **Default:** dashboard, chat wizard (confirm screen), voice ("urgent hai"). Not the WhatsApp Form (see Q14).

**Q13. Weekly repeat (F4)**
- **Default:** repeats on the **same weekday as the due date**. Overdue → daily 11 AM reminder (like monthly). Marking Done creates next week's task.
- **Please give 1–2 real weekly tasks** (e.g. "har Somvar stock report"). If there are none, should we still build it?

**Q14. WhatsApp Form and the new options**
- New options (weekly, urgent) in the Form need a **new form + new template approval** (Marketing cost).
- **Default:** the Form stays as it is; weekly and urgent only from the chat wizard, voice and dashboard.

**Q15. Delete / recycle bin (F8)**
- *Cancel vs Delete:* **Default:**
  - **Cancel** = work no longer needed (stays in Archive, can be reopened).
  - **Delete** = mistake/test/junk task (goes to the recycle bin).
- *Who can delete (soft)?* **Default:** any admin, **dashboard only**. Permanent delete: Bhaskar only (already decided).
- *Does the staff member get a WhatsApp message on delete?* **Default:** no.
- *Restore from the bin:* **Default:** reminders start again from its due date; if that date has passed, the admin must pick a new date.
- *Monthly/weekly task deleted:* **Default:** no next occurrence is created.
- *A pending date request on a deleted task:* **Default:** cleared.

**Q16. Excel/CSV export (F9)**
- **Default:**
  - A CSV file (opens in Excel) from the dashboard, admins only.
  - Choose a date range and status (pending / done / cancelled / all).
  - Columns: title, assignee, branch, created by, due, status, done date, urgent, repeat, last remark.
  - **No phone numbers** (privacy).

**Q17. Which steps get the 5-minute "typing" timeout (F15)?**
- **Default (5 min):** typing a task title, a remark/update, the reason for a date change, a custom date, a staff name/number (staff manage).
- **Everything else** (button and list taps) stays **2 min**. The chat bot gets 5 min (already decided).

---

## 5. Group 5 — quick confirmations (bug rounds)

**Q18. "Pakka?" before Done (D4)**
- **Default:** only on the **dashboard** Done. WhatsApp Done stays one tap (flows were just shortened).

**Q19. Hinglish times (C8): what do these words mean?**
- **Default:**
  - subah = **10 AM**, dopahar = **2 PM**, shaam = **6 PM**, raat = **8 PM**.
  - "Monday/Somvar" = the coming Monday at 10 AM.
  - "agle hafte" = 7 days later at 10 AM.
- Change any of these?

**Q20. Word to use instead of "cancel" in bot messages (C17)**
- **Default:** "band karo". The words "cancel"/"stop" trigger Interakt's customer goodbye message.

**Q21. Security check failure behaviour (X1)**
- **Default:** if a Cloudflare security setting goes missing, the bot **stops accepting messages** (safe), and the daily health check alerts Bhaskar.
- Today it silently skips the check.
- Alternative: keep working but alert.

**Q22. Cost confirmation (C5)**
- Every admin remark on a staff task now sends a WhatsApp template to that staff member (small per-message cost; already decided "yes").
- **Default:** also when the admin changes the date from WhatsApp.
- Any exception (e.g. no message if the admin is also the assignee)? The actor is never notified anyway.

---

## 6. Output: `PENDING-BRIEF-ADDENDUM.md` (produce at the end)

```
# Radhe Tasks — Pending brief addendum (round 2)
*Prepared: <date> · Owner: Bhaskar*

## 1. Answers
| Q | Topic | Answer (Default / changed to …) | Owner's words |
(one row for each of Q1–Q22; "not discussed" if skipped)

## 2. Real examples given by the owner
(weekly tasks, Hinglish phrases, anything else)

## 3. Anything new the owner raised

## 4. Changes to the order of work (if any)
```

Keep it short; English, Hinglish bot messages quoted exactly.
