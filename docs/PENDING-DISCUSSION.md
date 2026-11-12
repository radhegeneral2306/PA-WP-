# Radhe Tasks: everything pending + new ideas — discussion guide

*Prepared 12 Nov 2026 by the build chat for a voice/planning chat (any AI). Owner: Bhaskar (super admin, Radhe Tiles World), non-technical.*

> **Hinglish summary:** Is file mein app ke saare pending kaam hain: bache hue bugs, naye features, dashboard Phase 7, setup ke chhote kaam, aur kuch naye ideas. Har item ke saath build chat ki salah hai (abhi karo / baad mein / mat karo), kitna mushkil hai aur kya khatra hai. Planning chat ek-ek group pe tumse faisla lega, aur aakhir mein `PENDING-BRIEF.md` banayega. Wo file wapas build chat ko deni hai.

---

## 0. Instructions for the planning chat (READ FIRST)

1. **This is a voice conversation.** Keep each turn short: one group at a time, at most 3–4 items per turn, plain words. Don't read out IDs or code; say the item in simple words ("purane message ka button", "double tap se do task").
2. Talk in **Hinglish** (Hindi grammar, Roman script, no Devanagari). Be blunt and practical. For each item give: what goes wrong (with a real-life example), the build chat's recommendation, difficulty (Easy / Medium / Hard / Very Hard), and any cost.
3. The owner may say "isko chhodo", "baad mein", or "abhi karo". Record exactly that. Also record any new idea he brings up.
4. **Do not write code.** Do not invent facts about the live system beyond this file; if unsure, write "build chat verify kare".
5. Never ask for or write secrets (passwords, API keys) or phone numbers.
6. At the end, produce **`PENDING-BRIEF.md`** in the format of Section 9 and tell the owner to give it to the build chat.
7. A separate file `NEXT-FEATURES-DISCUSSION.md` covers the two big new features (voice update + chat with the bot) in depth. If the owner has that file, use it for Group B; otherwise use the short version here.

---

## 1. The app today (short)

- **WhatsApp task bot** on the company WhatsApp number via **Interakt** → **Cloudflare Worker** (`pa-wp-bot`) → **Firebase Firestore**. Admin **dashboard** web app "Radhe Tasks" (`radhe-tasks`).
- **Users:** 2 admins (Bhaskar = super admin, Nayan) + ~25 staff in Raipur, Jagdalpur, Durg, Hardware, Office.
- **Tasks:** create (chat, WhatsApp Form, voice note for Bhaskar, dashboard), Done, update/remark, change date (staff > 25 days needs admin approval), reassign/cancel/reopen (dashboard), reminders (once / every 90 min 10 AM–8 PM / monthly), 10 AM daily summary (only people with work due today or overdue), daily health check that alerts Bhaskar.
- **All free plans** (Cloudflare Workers Free, Firebase Spark, Groq + Gemini free). Only real cost: Interakt + WhatsApp template charges.

### Done since 28 Oct (don't re-discuss)
- Shorter WhatsApp flows: staff menu = 3 buttons; date + time in one tap; reminder type changed from the confirm screen; admins can type a name instead of picking branch → person; typing on an open task saves it as an update; the list comes back after Done/Update.
- **Chat timeout 2 minutes** (was 30). After it: "⏱️ Session expire ho gaya … *Hi* bhejiye". Old Done/Approve/Reject buttons also expire.
- Fixed: old-message buttons acting on the wrong task (C1) and wrong approval (C2); reminders on free plans (S1, S2, S4); health-alert loop (S3); clear login error message (D5).
- Dashboard login: tap your name + password (no ID).

---

## 2. Constraints to remember

| Limit | Meaning for new work |
|---|---|
| Cloudflare Free: max 50 outgoing calls per message/cron run, ~30 s background time | Bulk sends (reports, escalations to many people) must be split or small |
| Firebase Spark: 50k reads / 20k writes per day; **no file storage on the free plan** (verify) | Photo proof / attachments would need a paid plan or another storage |
| WhatsApp: outside 24 h only approved templates; each template send costs money (Marketing costs more than Utility) | Every new automatic message type = new template + per-message cost |
| WhatsApp UI: ≤ 3 buttons, list ≤ 10 rows | Keep choices small |
| 2-minute chat timeout | Long multi-step flows will expire more often; keep new flows short |

---

## 3. Group A — bugs still open (from the 28 Oct audit)

Build chat recommendation in **bold**.

### A1. Medium/High (recommend fixing soon)
| ID | What goes wrong (example) | Recommendation | Difficulty |
|---|---|---|---|
| C4 / F1 | **Double tap on "Haan" or form sent twice → the same task is created twice** and the staff member gets two WhatsApp messages. Happens on slow internet when someone taps twice. | **Fix now** | Medium |
| C3 | Staff manage: an old unanswered "Haan, hatao" (remove) message can remove **whoever is selected now**, not the person on that message. With the 2-minute timeout this is now rare. | **Fix now (small, same pattern as C1)** | Easy–Medium |
| C5 | Admin changes a staff member's due date from WhatsApp → **the staff member is not told** (dashboard does tell them). Admin's WhatsApp remark also doesn't reach the staff member. | **Fix now** (decide: should admin remarks notify the assignee? costs one template per remark) | Easy |
| D1 | Dashboard login: someone guessing very fast (many guesses at the same moment) can try more than 5 passwords before lock. | **Fix** (needs an atomic counter) | Medium |
| D2 | Anyone on the internet can lock **all admins** out of the dashboard for 15 min by typing 30 wrong passwords, again and again. | **Fix** (lock per device only, or a longer password is enough?) | Easy–Medium |
| D3 | Dashboard website lacks some standard security settings (another site could show it inside a frame to trick a click). | **Fix** (one config file) | Easy |
| S5 | A **monthly** task whose date was moved by more than ~half a month can **skip or repeat a month** (e.g. due on 1st moved to 20 Oct → next one 1 Dec, November missed). | **Fix** | Medium |

### A2. Low (bundle into one "cleanup" round, or skip)
**Voice (Bhaskar only today):**
- V1: a very slow voice note can end with no reply at all.
- V2: the voice transcript becomes the "last remark" shown in every reminder.
- V3: a short "busy" moment says "Voice se task abhi band hai" (sounds permanent).
- V4: an audio download problem says "Samajh nahi aaya" (sounds like the user's fault).
- V5: long notes (> 60 s) are rejected only after being transcribed (wastes free quota).
- V6: any document ending in .mp3/.m4a is treated as a voice note.

**Reminders and schedule:**
- S6: "no message for 48 h" false alarm on holidays (Diwali, Sundays).
- S7: monthly task marked Done very late → next month's task is already overdue.
- S8: an every-90-min task updated after midnight pauses ~33 h.
- S10: two people acting on the same task at the same second can lose one change.
- S11: cleanup of old logs can fall behind if > 500 messages/day.

**WhatsApp chat:**
- C6: emoji cut in half in list titles.
- C7: task titles with line breaks can break a list.
- C8: Hinglish dates not understood: "kal subah", "monday", "agle hafte", Hindi script, "aaj raat 12".
- C9: a past date like "20/10" silently becomes next year.
- C10: typed "aaj" after 10 AM says "nikal chuka".
- C11: "Hi!" in the middle of a flow becomes the task title.
- C12: was the 30-min timeout counting issue — **mostly solved** by the new 2-minute timeout.
- C13: re-adding a removed number under a new name doesn't update the old tasks.
- C14: two staff with the same name are allowed.
- C15: phone formats starting with 0 / 0091 are rejected.
- C16: the users API allows an admin with a branch and doesn't stop removing the last admin.
- C17: some bot text tells users to type "cancel", which triggers Interakt's customer goodbye message.

**Dashboard:**
- D4: Done has no "are you sure?".
- D6: no way back from the name picker.
- D7: two admins with the same name confuse notifications.
- D8: logout doesn't kill the token (a lost phone keeps read access for 30 days).
- D9: desktop branch chips can't be scrolled with a mouse.
- D10: the list never auto-refreshes.
- D11: odd phone values give a server error instead of a message.

**Security/logging:**
- X1: if two Cloudflare settings go missing, webhook checks silently turn off; the first 40 characters of every customer message are written to logs.

**Build chat suggestion for A2:** fix C8 (Hinglish dates), C9, C11, C17, D4, D10, X1, V2, V4 and S6 in one round (all Easy–Medium, real daily impact). Skip or postpone the rest unless the owner has seen them happen.

---

## 4. Group B — the two big new features (details in `NEXT-FEATURES-DISCUSSION.md`)

1. **Admins update any task by voice note** ("Pinky ka Sharma ji wala task done kar do"). Build chat's safe design:
   - Voice while a task is open applies only to that task.
   - Otherwise the bot shows a short list of matching tasks, the admin picks one, then always confirms.
   - Medium–Hard.
2. **Chat with the bot** (staff: own tasks; admins: everything), e.g. "kal kya hai?", "Durg ke overdue kitne?". Build chat's design: "AI understands, code decides".
   - Common questions answered without AI (free, exact).
   - AI only for the rest.
   - Every change needs a confirm button.
   - Answers come only from the database.
   - Per-person daily limit.
   - Hard.
3. **Multiple free API keys to beat limits:**
   - Doesn't work inside one Google project / Groq org (limits are shared).
   - Separate accounts risk a ban.
   - Build chat recommends **fewer AI calls + one small paid Gemini key with a hard budget cap** instead.

**Questions:**
- Build these now, after the bug round, or later?
- Which first?
- Is a small paid AI budget (₹300–1,000/month, to verify) acceptable?
- Note: the 2-minute timeout matters here. A chat assistant conversation must stay short, or the chat timeout needs a separate, longer value.

---

## 5. Group C — Dashboard Phase 7 (deliberately last)

Ideas already listed:
- **Summary strip:** Pending / Overdue / Aaj due counts; tap to filter. Easy.
- **Task history view:** full timeline of a task (created, remarks, date changes, who did what). Easy–Medium. The data already exists.
- **Per-staff counts / performance:** per person: pending, overdue, done this week/month, on-time %. Medium. Be careful: a "leaderboard" can demotivate staff; the owner decides who sees it (admins only?).
- **Branch view:** same counts per branch. Easy once the above exists.

**Questions:**
- Which of these matter?
- Admins only?
- Weekly/monthly?
- Should "on time" mean Done before the due time, or before the end of that day?

---

## 6. Group D — setup / roll-out items

| Item | Status | Question |
|---|---|---|
| Voice task creation for **Nayan** (and later all admins) | Only Bhaskar today | Give Nayan access now? |
| **WhatsApp Form person list** | Fixed list; every staff change needs a new form + new template version (Meta approval, Marketing cost) | Keep the form? Who updates it when staff change? Or stop the form if staff change often? |
| **Interakt customer auto-replies also reply to staff** (staff get 2 replies, e.g. the Hindi welcome message) | Waiting on the owner: does the Interakt automation allow a condition like "skip users tagged staff"? (screenshot) | Check Interakt; if yes, the bot can tag staff automatically (Medium) |
| Real-phone test checklist (`TESTING-batch1.md`) | Not fully run | Who runs it, when? |
| Dashboard password | Changed and working (12 Nov) | Give Nayan the new password in person |

---

## 7. Group E — owner housekeeping (5 minutes each, no build work)
- Mark the old "Bot check" task(s) Done if still open.
- Cancel the test tasks created during testing (dashboard → Cancel).
- "Durg Office" phone: send "Hi" once (it never got its welcome).
- Make sure the old dashboard password is not used anywhere (it appeared in a chat screenshot).

---

## 8. Group F — new ideas (brainstorm by the build chat; owner picks)

| # | Idea | Value | Difficulty | Cost / risk | Build chat view |
|---|---|---|---|---|---|
| F1 | **Weekly report to Bhaskar on WhatsApp** (Monday 10 AM): done / overdue per staff and branch | High: owner sees everything without opening the dashboard | Easy–Medium | 1 template message/week | **Recommend** |
| F2 | **Escalation:** task overdue by N days → admin (or the creator) gets one WhatsApp alert | High: stuck work gets noticed | Easy–Medium | Template per alert; choose N (2? 3?) | **Recommend** |
| F3 | **Holiday / Sunday calendar:** no reminders on listed holidays (and optionally Sundays) | Medium: fewer annoying reminders, fewer false alarms | Easy | — | **Recommend** if staff work 6 days |
| F4 | **Weekly repeat** ("har Somvar") in addition to once / 90 min / monthly | Medium | Medium | — | Ask if weekly tasks exist |
| F5 | **Priority flag** (🔴 urgent): sorted first, maybe more reminders | Medium | Easy–Medium | More template sends if more reminders | Optional |
| F6 | **Photo proof on Done** (staff sends a photo with Done) | Medium–High for site/delivery work | Hard | Needs file storage → likely paid plan (Firebase Blaze/R2), verify | Later, only if really needed |
| F7 | **Undo Done** (admin can reopen a Done task, like cancelled ones) | Medium: fixes mistakes from wrong taps | Easy | — | **Recommend** (today Done is final) |
| F8 | **Delete task** (admin, for test/junk tasks) | Low–Medium | Easy | Data loss risk → soft delete only | Optional |
| F9 | **Export to Excel/CSV** from the dashboard (tasks, done history) | Medium for monthly review | Easy | — | Optional |
| F10 | **Database backup** (weekly export of Firestore) | High insurance | Medium | Free options limited, verify | **Recommend** some backup |
| F11 | **Multiple people on one task** | Medium | Hard (changes the whole data model) | — | Not now |
| F12 | **Task checklist inside a task** (sub-steps) | Low–Medium | Medium–Hard | — | Not now |
| F13 | **Staff can request a task for someone else** (admin approves) | Low–Medium | Medium | — | Ask if needed |
| F14 | **Dashboard auto-refresh + overdue badge** (D10) | Medium | Easy | — | **Recommend** (bundle with A2) |
| F15 | **Separate, longer timeout for typing steps** (e.g. 2 min for taps, 5 min while typing a remark/title) | Medium: fewer "expired" annoyances | Easy | — | Decide after a week of using the 2-min timeout |

**Things the build chat suggests NOT to do now:**
- Leaderboards visible to staff.
- Multiple assignees.
- Photo proof on the free plan.
- Always-on AI chat without a daily cap.
- Rotating multiple free API keys.

---

## 9. Output: `PENDING-BRIEF.md` (produce at the end)

```
# Radhe Tasks — Pending work brief
*Prepared: <date> · Owner: Bhaskar*

## 1. Order of work (numbered list, first = do first)

## 2. Decisions per item
| Item (ID or name) | Decision: Abhi / Baad mein / Nahi | Owner's notes (exact words where possible) |
(one row for every item in Groups A–F that was discussed; mark undiscussed ones "not discussed")

## 3. New ideas the owner added (not in this file)

## 4. Settings decided
(e.g. escalation after N days, holiday list, who sees performance, AI budget, Nayan voice yes/no, admin remarks notify staff yes/no)

## 5. Owner to-dos (housekeeping, Interakt screenshot, testing)

## 6. Open questions for the build chat to verify
```

Keep it short and concrete. English, with any Hinglish bot messages quoted exactly.
