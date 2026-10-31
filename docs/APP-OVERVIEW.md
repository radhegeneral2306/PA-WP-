# Radhe Task Bot: complete app overview

*Snapshot: 28 Oct 2026 · live bot build `s3fix` · 731 automated tests (bot) + 36 (dashboard) passing*

> **Hinglish summary (owner ke liye):** Ye file batati hai ki humne kya banaya, har workflow kaise chalta hai, kaunse niyam hain, security kaise hai, free plan ki seemayein kya hain, kya baaki hai aur kaunsi galtiyan abhi khuli hain. Isme koi password, key, secret link ya phone number nahi hai, isliye ise kisi bhi doosre AI ya chat ko de sakte ho. Body English mein hai taaki koi bhi AI aasaani se samjhe.

**How to use this file (for another AI / chat):** this is a self-contained description of a live system you cannot see. Treat it as the source of truth. The owner (Bhaskar) is non-technical: talk to him in Hinglish (Hindi grammar, Roman script, no Devanagari), be blunt and honest, state difficulty (Easy / Medium / Hard), and explain step by step. Do not ask for secrets.

---

## 1. What this is

**Radhe Tiles World** (a tiles & sanitary business in Chhattisgarh, India, with branches in Raipur, Jagdalpur, Durg plus a Hardware unit and a back Office) needed a simple way to give staff tasks, chase them, and see what is pending, without a new app to install.

The solution is a **WhatsApp task bot on the company's existing WhatsApp Business number**, plus an **admin web dashboard (PWA)**:

- Staff and admins send **"Hi"** to the business number and get a menu.
- Admins give tasks to anyone; staff create tasks for themselves.
- The bot **reminds** people on WhatsApp until the task is done.
- Tasks can be created by **chat wizard**, **one-screen WhatsApp Form**, **voice note** (admins), or the **dashboard**.
- Admins track everything (pending, overdue, archive, approvals) on the dashboard.

Customers also message the same number; **the bot ignores everyone who is not a registered, active user.** The company's existing customer automations (in Interakt) keep running for customers.

### People
- **27 active users** (Oct 2026): 2 admins (Bhaskar = owner and **super admin**, the person who builds and maintains the bot; Nayan = admin) and 25 staff: Raipur 2, Jagdalpur 8, Durg 8, Hardware 3, Office 4.
- A few staff accounts are shared office phones named like "Durg Office" / "Ofc Hardware".
- Staff speak Hindi / Hinglish; every bot message is **Hinglish in Roman script**.

### Roles
| Role | Can do |
|---|---|
| **Staff** | See own tasks, create tasks for themselves, mark Done, add remarks, change own due dates (beyond 25 days needs admin approval) |
| **Admin** | Everything staff can, plus: give tasks to anyone, see everyone's tasks, approve/reject date requests, add/edit/remove staff, use the dashboard, voice-note tasks (testers only for now) |
| **Super admin** (Bhaskar) | Admin + receives the bot's health alerts |

---

## 2. Building blocks (tech stack)

| Part | What | Why |
|---|---|---|
| WhatsApp API | **Interakt** (Advance plan; an official Meta WhatsApp Business API provider) | Sends/receives WhatsApp; templates; WhatsApp Forms |
| Backend | **Cloudflare Worker** (TypeScript, no frameworks, no runtime npm deps) | Always on, fast, free tier; handles webhooks, crons and the dashboard API |
| Scheduler | Cloudflare **Cron Triggers** | Reminders every 5 min; daily jobs |
| Database | **Firebase Firestore** (Mumbai region), accessed over REST with a service account | Free tier, simple documents |
| Dashboard | **PWA**: Vite + React 18 + TypeScript + Tailwind 4 + Phosphor icons, hosted as a Cloudflare Worker static site | Installable on phones, no app store |
| Voice | **Groq** (Whisper speech-to-text) + **Google Gemini** (understanding), both **free tiers** | Owner chose zero-cost providers |
| Deploys | Every push to the project branch on GitHub is built and deployed by **Cloudflare Workers Builds** | No manual deploys |
| Tests | vitest (731 bot tests, 36 dashboard tests) | Nothing ships without passing tests + type check |

**Plans in use: Cloudflare Workers FREE and Firebase Spark FREE.** The design deliberately fits their limits (Section 9).

---

## 3. How a message flows (architecture)

```
Staff WhatsApp ──► Interakt ──(signed webhook)──► Cloudflare Worker
                                                   1. secret URL path check
                                                   2. HMAC signature check
                                                   3. answer Interakt 200 immediately, keep working in background
                                                   4. only "message received" events; same Interakt organisation only
                                                   5. sender must be a registered, ACTIVE user (else silence)
                                                   6. de-duplicate by Interakt message id (retries ignored)
                                                   7. router → the right conversation ("flow")
                                                   8. flows return messages as data → one delivery module calls Interakt
Cloudflare Cron ──► every 5 min: reminders · 10:00 IST: daily summary · 10:15 IST: health check + cleanup
Admin browser ──► dashboard PWA ──(login token)──► same Worker under /api/*
```

**Design rules:** conversations and the scheduler never talk to WhatsApp directly; they return messages as plain data and a single delivery module sends them (easy to test). One shared "task actions" module holds the rules for Done / remark / date change / reassign / cancel / reopen / approve / create, so WhatsApp, Forms, Voice and the Dashboard behave identically.

---

## 4. Core rules (apply everywhere)

- **Times:** stored in UTC, shown in **IST** (UTC+5:30, no daylight saving). A task with a date but no time is due at **10:00 AM IST**.
- **Past dates/times are refused** when creating or changing a task.
- **Task fields:** title (≤ 200 chars), assignee, branch (copied from the assignee), creator, due date/time, repeat, status, remarks history, timestamps. Optional: pending date request, cancelled info, `source: voice`.
- **Status:** `pending` → `done` (final, never reopened) or `cancelled` (dashboard only; can be **reopened** with a new date).
- **Repeat types:**
  | Type | Reminders |
  |---|---|
  | **Ek baar** (once) | at the due time; if still pending, **daily at 11:00 AM IST** (at least 6 h after the previous one) |
  | **Har 90 min** | at the due time, then every 90 min, **only 10 AM–8 PM IST** (a night time waits till 10 AM); any remark pauses it until 10 AM next day |
  | **Har mahine** (monthly) | like "once"; when marked **Done**, next month's task is created automatically on the same day (31 → 30/28/29 in short months, back to 31 after) |
- **25-day rule:** staff can move their own due date up to 25 days ahead; beyond that the bot creates an **approval request** for admins (date unchanged until approved).
- **Notifications:** the person who did the action is never notified of their own action; removed (inactive) users are never messaged; an inactive assignee's reminders pause and resume on reactivation.
- **Remarks** are never deleted (full history). Tasks are never deleted (done or cancelled stay in the archive).

---

## 5. WhatsApp workflows (all live)

Send **"Hi"** (or hello / menu / namaste / start) → menu as a WhatsApp list.

- **Admin menu (6):** 📋 Mere tasks · 👥 Staff ke tasks · ➕ Naya task · 📝 Naya task (Form) · ⏳ Approvals · ⚙️ Staff manage
- **Staff menu (3):** 📋 Mere tasks · ➕ Naya task · 📝 Naya task (Form), shown as 3 plain buttons (one tap; admins get a list because they have 6 options)
- Typing "cancel / band / ruko / stop / exit" ends the current conversation. Unfinished conversations expire after **30 minutes**. Taps on old buttons from another conversation get "Ye option purana hai".

### 5.1 ➕ Naya task (chat wizard)
*Shortened 31 Oct: staff 3 steps (title → one date tap → Haan), admin 4–5 steps (was 5 and 7).*
1. Admin: **type the person's name** (e.g. "chikku") to skip the lists, or pick branch (or "Admins") → pick person (paged list). Staff: skips straight to step 2 (self task).
2. "Task kya hai?" → type the title.
3. One-tap due list: **Aaj shaam 6 PM** (only while it's ≥ 30 min away) · **Kal 10 AM** · **Kal 2 PM** · **Kal 5 PM** · **Parso 10 AM** · **1 hafte baad 10 AM** · **✍️ Date / time likho**. Typed Hinglish dates work at the same step: `28/10`, `28/10 4pm`, `kal 11am`, `kal shaam 6`, `12 baje`, `dopahar 2`.
4. Summary → **Haan ✅ / 🔔 Reminder badlo / Nahi ❌**. Reminder starts as **Ek baar**; "Reminder badlo" shows **Ek baar / Har 90 min / Har mahine** and returns to the summary. On Haan: task saved, creator gets "✅ Task ban gaya!" with details and first reminder time; the assignee gets the **task_assigned_v1** WhatsApp template (not for self tasks).

### 5.2 📝 Naya task (Form) — WhatsApp Forms (Batch 3)
- Tapping it sends a template with a **"Form kholo"** button that opens a one-screen form inside WhatsApp.
- **Admin form:** Kisko dena hai (dropdown of all 27 people as "Name (Branch)"), Task kya hai, Due date (date picker), Time (optional dropdown 9:00 AM–8:00 PM in 30-min steps; empty = 10 AM), Reminder (Ek baar / Har 90 min / Har mahine).
- **Staff form:** same without the person (always self).
- The bot **re-checks everything on the server**: person must exist, be active and match the branch in the label; staff can't submit admin fields; past date/time refused. Errors come back as one message listing every problem; success gives "✅ Task ban gaya!" + the assignee template.
- **Limitation (owner's decision):** the person list inside the form is fixed. Interakt forms can't be edited after publishing, so **every staff change needs a new form + a new template version** (`task_form_admin_v3`, then v4…). Interakt limits: option text ≤ 30 chars (hence a short "(Hdw)" tag for one long name).
- Meta classified both form templates as **Marketing** (costlier per send than Utility).

### 5.3 🎤 Voice note se task (Batch 4; admins only; live for Bhaskar as tester)
1. Admin sends any WhatsApp voice note (≤ 60 s), e.g. "Pinky ko bolo kal shaam paanch baje Sharma ji ka payment ka follow up lena hai".
2. Bot downloads the audio from Interakt → **Groq Whisper** transcribes (staff names given as hints) → **Gemini** extracts person, task text, date, time, repeat using today's IST date and the real staff list. Audio is never stored.
3. Bot asks **only what is missing**: person unclear / two similar names / unknown → short list to pick from (never defaults to the sender); no date → "Date nahi suni. Ye task kab tak ka hai?" with buttons; no time → 10 AM; no repeat → Ek baar.
4. Confirmation: `Maine suna: "…"` + Task / Kisko / Kab / Repeat → buttons **Haan ✅ / Badlo ✏️ / Rehne do ❌**. Badlo lets you change any one field.
5. Haan → task created (marked as voice; transcript saved as the first remark), assignee gets the template.
- Failures tell the user plainly ("Voice note bahut lamba hai", "Voice service abhi busy hai…", "Samajh nahi aaya…"); Bhaskar also sees a short technical line while testing. Google's free models change often, so the bot falls back to newer models automatically and has "thinking" switched off for speed.
- Real-phone test 28 Oct: names, dates, times and spoken repeats were understood correctly (including "Bhaarti" → Bharti).
- Button text must **never be "Cancel"/"Stop"**: the company's Interakt customer automation replies to those words with a Hindi goodbye message.

### 5.4 📋 Mere tasks / 👥 Staff ke tasks
- Pending tasks, earliest due first, ⚠️ marks overdue, 8 per page. Admin view: branch → person, or "everyone".
- Admin "Staff ke tasks": **type a name** to jump straight to that person's tasks, or branch → person.
- Task detail shows title, assignee, creator, due, reminder type, pending date request, last remark, with buttons **Done ✅ / Update ✏️ / Date badlo 🕒** (assignee, creator or any admin). The buttons carry the task id, so a button on an **older** task message acts on its own task (fixes audit C1).
- After Done / Update / Date badlo the **remaining list comes back** (next task in one tap); after the last one: "🎉 Aapke koi pending task nahi hain!".
- **Done:** reminders stop; creator gets **task_done_v1**; monthly → next month's task created.
- **Update:** tap Update, or **just type the update while the task is open**. Remark (≤ 500 chars) added; creator gets **task_updated_v1**; every90 pauses till next morning.
- **Date badlo:** one tap on the same due list as above (or type a date) + reason (still required). Staff > 25 days → approval request (**date_approval_request_v1** to the creating admin, else all admins). Otherwise date changes, reminders restart from the new date, creator informed.

### 5.5 ⏳ Approvals (admins)
List of pending date requests → **Approve ✅ / Reject ❌** (buttons carry the request, so an older message decides its own request, fixes audit C2). Requester gets **date_approval_result_v1**. A request that changed meanwhile, already handled, or whose requested date has passed is refused safely.

### 5.6 ⚙️ Staff manage (admins)
- **Add:** name → 10-digit number → Staff/Admin → branch → confirm; the new person gets **welcome_user_v1** (Meta classified it Marketing).
- **Edit:** name / branch / role; changes are copied onto their existing tasks.
- **Remove:** soft delete (inactive); their pending tasks stay; you can't remove yourself or demote the last admin.
- **List:** everyone by branch.

---

## 6. Scheduled jobs

| When | Job |
|---|---|
| Every 5 min | **Reminders**: reads only tasks whose reminder time is due (oldest first), at most **7 per run**; each is claimed, sent (template **task_reminder_v1**: name, task, due + "(overdue)", last remark), then marked. Failed sends retry after 30 min (never lost). Bigger bursts drain 7 per 5 min (40 overdue ≈ 30 min). |
| 10:00 AM IST | **Daily summary** (**daily_summary_v1**: name, total pending, overdue) **only to people who have a task due today or overdue** (owner decision 28 Oct, saves cost). |
| 10:15 AM IST | **Health check** + **cleanup** (Section 8). |

---

## 7. Admin dashboard (PWA)

Mobile-first web app, installable on the home screen; one shared admin login (long password), then "**Aap kaun ho?**" (pick your admin name; it's recorded on every action as "Name (dashboard)"). Session lasts 30 days.

**Screens**
- **Tasks:** summary cards (Pending / Overdue / Aaj due), branch chips (incl. Admins), staff picker, search, list with overdue highlight and icons (monthly, date request, 🎤 voice). Big **"Naya task"** button.
- **Task detail actions:** **Done karo**, **Remark**, **Date badlo** (date + optional time + reason), **Assign badlo** (pick person → confirm), **Cancel** (confirm "Pakka cancel karna hai?"). Same notifications as WhatsApp (cancel uses **task_cancelled_v1** to assignee + creator). Admins have no 25-day limit.
- **Naya task form:** task, person (pre-picked from the current staff filter), due date, optional time, reminder type with a one-line explanation; closing a filled form asks first.
- **Archive:** done + cancelled tasks, filterable; cancelled ones can be **"Wapas chalu karo"** (reopened) with a new date.
- **Approvals:** pending date requests with old → new date and reason; Approve/Reject with confirmation.
- **Settings:** theme (light/dark), change name, logout.
- Works offline-aware (actions disabled without internet), dark mode, 44 px tap targets, no caching of live data.

---

## 8. Safety pack (self-monitoring)

- **Failure counters:** every failed WhatsApp send, template fallback, and crash in webhook/cron handling is counted (no phone numbers or message text stored).
- **Daily health check (10:15 IST):** raises an alarm if (a) anything failed since the last check, (b) **no incoming message from any user for 48 h** (catches a broken webhook), or (c) reminders are stuck > 60 min. The alarm is a task **"Bot check: …"** assigned **only to the super admin (Bhaskar)** with a WhatsApp notice and normal reminders; no duplicate while one is open. Fallback: all admins if Bhaskar's account isn't found.
- **Cleanup:** message logs older than 30 days and stale login-lock records are deleted daily (max 500/day). Tasks, users and sessions are never touched.
- Honest limit: if Interakt itself is down, the WhatsApp alarm can't be delivered (the task still shows on the dashboard). Testing sessions with deliberate failures produce an alarm the next morning (seen 28 Oct; it was testing noise).

---

## 9. Free-tier design (important for any change)

| Limit | Value | How the app fits |
|---|---|---|
| Cloudflare Workers Free: outgoing calls per run | 50 | Reminders ≤ 7 per run (worst case 46 calls); summary 1 call per person (~45 people max); health/cleanup in their own run |
| Firestore Spark: reads per day | 50,000 | Reminder runs read only due tasks (≈ 2–4k reads/day instead of ≈ 46k) |
| Firestore Spark: writes per day | 20,000 | Far below current use |
| Groq / Gemini free tiers | per-minute and per-day limits (Gemini's exact free quota is not documented clearly) | Voice falls back between models; on limit the user is told and the form/wizard still work |
| WhatsApp 24-hour window | Plain messages only within 24 h of the user's last message | Anything proactive uses approved **templates** |
| Interakt message costs | per template sent (Marketing costs more than Utility) | Daily summary limited to people with work today/overdue |

---

## 10. WhatsApp templates (approved in Interakt)

| Template | Category | Sent when |
|---|---|---|
| task_assigned_v1 | Utility | a task is given/reassigned/reopened to someone (not self) |
| task_reminder_v1 | Utility | reminders |
| task_done_v1 | Utility | done by someone other than the creator |
| task_updated_v1 | Utility | remark / date change by someone other than the creator |
| date_approval_request_v1 | Utility | staff asks for > 25 days |
| date_approval_result_v1 | Utility | approved / rejected |
| daily_summary_v1 | Utility | 10 AM summary |
| welcome_user_v1 | Marketing | new user added |
| task_cancelled_v1 | Utility | cancel from the dashboard |
| task_form_staff_v1 / task_form_admin_v2 | Marketing | opening the WhatsApp Form (admin v1 retired) |

Template names never change after approval; any edit means a new `_vN` and a code update.

---

## 11. Security

- Webhook only accepted on a secret URL, with Interakt's **HMAC signature** verified, and only from the company's Interakt organisation.
- **Only registered, active users** get any reply; customers never see the bot.
- Role checks on every step; button ids are namespaced per conversation (old/foreign taps can't trigger actions); permissions re-checked on the server for forms and voice.
- Duplicate deliveries ignored (message-id log).
- Dashboard: long shared password, login lockout (5 wrong per device / 30 overall per 15 min), signed 30-day tokens, only the dashboard's own website may call the API, every data-changing call needs a picked admin name.
- Secrets live only in Cloudflare settings; logs mask phone numbers; the repo and its history contain **no keys or real phone numbers** (verified by audit 28 Oct).
- Voice: API keys only in request headers; the transcript is treated as data (prompt-injection safe); audio never stored.

---

## 12. Owner decisions log (highlights)

1. Tasks via WhatsApp first; dashboard second; old to-do web app stays separate.
2. Working hours 10 AM–8 PM IST for every90; default time 10 AM.
3. Staff create only self tasks; admins can assign to anyone, including other admins and themselves.
4. 25-day rule with admin approval for staff date moves.
5. Cancel exists only on the dashboard and can be undone (reopen with a new date); Done is final.
6. Dashboard actions notify like WhatsApp; the actor is never notified.
7. WhatsApp Form kept optional; fixed person list accepted; Branch field removed later (person label already shows branch).
8. Voice: admins only, Bhaskar first; always confirm before creating; ask only missing parts; never guess a date; free providers only; audio deleted, transcript kept in remarks.
9. Health alerts only to the super admin.
10. Daily summary only to people with a task due today or overdue, showing all their pending count.
11. Dashboard "Phase 7" extras (summary cards/history/per-staff counts) deliberately **last**.

---

## 13. Known open issues (from the full audit of 28 Oct)

**Fixed already:** reminder loss on the free Cloudflare plan (S1), Firestore read quota exhaustion (S2), daily run over budget (S4), health-alert task error loop (S3), token re-fetching (S9).

**Still open (proposed next fixes, in order):**
| ID | Severity | Problem |
|---|---|---|
| C1 | High | WhatsApp "Mere tasks": Done/Update/Date buttons on an older message act on the task currently open (wrong task can be marked Done) |
| C2 | High | Approvals: Approve/Reject on an older message decides the request currently open |
| D1 | High | Dashboard login lockout can be bypassed with many parallel guesses (counter not atomic) |
| C3 | Medium | Staff manage: an old unanswered "remove/edit" confirmation applies to whoever is currently selected |
| C4 / F1 | Medium | Double-tapping "Haan" or submitting the same form twice creates the task twice |
| S5 | Medium | A monthly task whose date was moved a lot can skip or repeat a month |
| C5 | Medium | Admin changing a staff member's date from WhatsApp doesn't notify that staff member (dashboard does) |
| D2 / D3 | Medium | Anyone can lock all admins out of the dashboard for 15 min with 30 bad logins; dashboard site lacks security headers |
| Low (≈30) | Low | e.g. voice transcript appears as "last remark" in every reminder; "Hi!" mid-conversation becomes a task title; "20/10" typed after the date becomes next year; dashboard Done has no confirmation; list doesn't auto-refresh; some Hinglish phrases ("kal subah", "monday") not understood; desktop chip row needs horizontal scrolling |

---

## 14. Costs today
- Cloudflare: free plan. Firebase: free plan. Groq/Gemini: free tiers. Dashboard hosting: free.
- **Only real cost: Interakt plan + per-template WhatsApp charges** (Marketing templates — the two forms and the welcome message — cost more than Utility ones).
- Upgrade paths if the business grows: Cloudflare Workers Paid (~$5/month, 1000 calls per run), Firebase Blaze (pay as you go, likely near-zero at this size), paid Gemini (removes "busy" moments).

---

## 15. What's next / ideas
- Fix the open issues in Section 13 (C-series first).
- Give Nayan voice access, then decide on all admins.
- Dashboard Phase 7 (last): richer summary cards, task history view, per-staff counts / performance.
- Keep the WhatsApp Form's person list in sync whenever staff change (new form + template version each time).
- Possible later ideas (not decided): priority flags, stuck-task detection, staff leaderboards, voice for other actions ("task done" by voice), auto-updating form lists (needs a data endpoint), handling Interakt's customer automations replying to staff.

## 16. Glossary
- **Interakt:** the company's WhatsApp Business API provider (sends/receives messages, templates, forms).
- **Template:** a Meta-approved message format; the only kind that can be sent proactively outside the 24-hour window. Categories: Utility (cheaper) / Marketing (costlier).
- **WhatsApp Form (Flow):** a one-screen form opened from a template button inside WhatsApp.
- **Cloudflare Worker:** the always-on backend code; **Cron:** its timer.
- **Firestore:** the database. **PWA:** a website that installs like an app.
- **IST:** India Standard Time (UTC+5:30).
