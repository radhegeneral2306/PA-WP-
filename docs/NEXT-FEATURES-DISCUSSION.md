# Next features: voice task updates + one-on-one chat with the bot — discussion guide

*Prepared 28 Oct 2026 by the build chat for a planning chat (any AI). Owner: Bhaskar (super admin, Radhe Tiles World), non-technical.*

> **Hinglish summary:** Do naye feature: (1) admin voice note se kisi bhi task ko update kare, (2) staff aur admin bot se seedha chat karke task banaye, update kare, ya apne tasks ke baare mein pooche. Is file mein system ki zaroori jaankari, build chat ki practical salah, khatre, "multiple API keys" wale idea ki khamiyan, aur saare sawaal hain. Planning chat ye sawaal ek-ek karke poochega aur aakhir mein `FEATURES-BRIEF.md` banayega, jo build chat ko dena hai.

---

## 0. Instructions for the planning chat (READ FIRST)

1. **Do not write code.** Help the owner decide; produce a decision brief at the end (Section 9 format).
2. Talk in **Hinglish** (Hindi grammar, Roman script, no Devanagari). Be blunt, practical, honest. Give a difficulty (Easy / Medium / Hard / Very Hard) and a rough cost for each option. The owner is non-technical: use simple examples.
3. Ask the questions in **Section 8 one group at a time**. For each question give 2–3 options with trade-offs and **your recommendation first**. Skip questions already answered.
4. Respect the constraints in Sections 1–3 (free tiers, WhatsApp rules, existing behaviour must not break). If an idea needs a paid plan, say so plainly with the monthly cost.
5. Prices and free-tier limits change often: give rough ranges, marked approximate; the build chat will verify.
6. Never ask for or write secrets (API keys, passwords) or phone numbers.
7. If a separate overview of the app is available (`APP-OVERVIEW.md`), read it; this file includes what you need.

---

## 1. The live system (short)

- **WhatsApp task bot** for Radhe Tiles World on the company's WhatsApp Business number via **Interakt** (WhatsApp Business API provider). Backend: **Cloudflare Worker** (TypeScript). Database: **Firebase Firestore**. Admin **dashboard** (installable web app).
- **27 active users:** 2 admins (Bhaskar = super admin, Nayan) + 25 staff in Raipur, Jagdalpur, Durg, Hardware, Office. Staff speak Hindi/Hinglish; all bot text is Hinglish (Roman script).
- **Task features live today:** create (chat wizard, one-screen WhatsApp Form, admin **voice note → new task** (Bhaskar only for now), dashboard), Done, remark ("Update"), change due date (staff beyond 25 days need admin approval), reassign (dashboard), cancel/reopen (dashboard only), approvals, staff management, reminders (once / every 90 min in 10 AM–8 PM / monthly), 10 AM daily summary (only for people with work due today or overdue), daily health check that alerts the super admin.
- **Rules:** IST times, no time = 10 AM, past dates refused, staff can only act on their own tasks (admins on all), the actor is never notified of their own action, removed users get nothing, every change is logged as a remark with who did it.
- **How voice-to-new-task works today:** WhatsApp voice note (≤ 60 s) → download from Interakt → **Groq Whisper** transcription (free tier) → **Gemini** extraction (free tier, model `gemini-flash-latest` with automatic fallbacks, "thinking" off) → bot asks only for missing parts → shows "Maine suna: …" + task details → **Haan ✅ / Badlo ✏️ / Rehne do ❌** → creates the task. Tested OK on real phones 28 Oct. Lessons: Google retires model names (404), free models get busy (503) or slow (timeouts); a button must never say "Cancel"/"Stop" (the company's Interakt customer automation answers those words with a goodbye message).

## 2. Hard constraints

| Constraint | Detail | Why it matters for these features |
|---|---|---|
| **Cloudflare Workers FREE** | max **50 outgoing calls per incoming message/cron run**; background work stops ~30 s after the webhook answer | One chat message = Firestore reads + AI call(s) + WhatsApp send. Retrying many API keys burns this budget. Long AI calls risk no reply at all |
| **Firebase Spark FREE** | 50k reads / 20k writes per day | Chat that loads "all tasks" on every message is expensive in reads |
| **Groq free tier** | ≈ 2,000 transcriptions/day, 20/min (approx.); limits per **organization**, shared by all keys | Voice is fine at current volume |
| **Gemini free tier** | requests/day per model is small and changes (reported anywhere from ~20 to ~1,500/day); limits per **project**, shared by all keys in that project; free-tier prompts may be used by Google to improve products | A chat assistant (many messages/day) can hit it quickly |
| **WhatsApp 24-hour window** | the bot can reply freely only within 24 h of the user's last message; proactive messages need approved templates | Chat replies are user-initiated, so they're inside the window (no template needed) |
| **WhatsApp UI limits** | list ≤ 10 rows (title ≤ 24 chars), ≤ 3 buttons (title ≤ 20 chars), message body ≤ 1024 chars for interactive messages | Answers/choices must fit |
| **Existing flows must not break** | menu, wizard, form, voice-create, dashboard, reminders keep working unchanged | New features must be additive and switch-off-able |
| **Known open bugs to fix FIRST** | C1/C2: buttons on an older WhatsApp message act on the currently open task/request; C4/F1: double-tap creates twice | Voice/chat "update" uses the same buttons and actions; without these fixes it would inherit wrong-task risks |

## 3. Costs reference (approximate, to verify)
- Gemini paid, cheapest "Flash-Lite" class: roughly **$0.10–0.30 per million input tokens and $0.40–2.50 per million output tokens** depending on model generation. A chat message with a compact prompt is ~1–3k tokens → **~1,000 messages ≈ 1–3 million tokens ≈ $0.2–$2** depending on model. Even heavy use for 27 people would likely be a few hundred rupees a month on a paid key with a hard budget cap.
- Groq paid Whisper: ≈ $0.04 per audio hour (turbo) — negligible at this scale.
- Interakt: user-initiated chat replies are service conversations (cheap/free under current Meta pricing — verify on the Interakt plan); templates cost per send.

---

## 4. Build chat's practical recommendations

### Feature 1 — Update any task by voice (admins)

**Main risk:** picking the **wrong task**. "Pinky ka payment wala task done kar do" could match several tasks; marking the wrong one Done is worse than not doing it.

**Recommended design (reliable first):**
1. **Context mode (most reliable, zero guessing):** when an admin has a task open in WhatsApp (task detail screen), a voice note applies **to that task only**. Example: open task → send "kal tak extend karo, party bahar hai" → bot shows "Is task ki date kal 10 AM karu? Remark: party bahar hai" → Haan / Badlo / Rehne do.
2. **Free voice mode (with a pick list):** voice from the main screen like "Pinky ka Sharma ji wala task done kar do" → AI extracts **action + person + keywords** → bot searches that person's pending tasks and shows **up to 5 matches** (or "koi match nahi") → admin picks → confirmation → action. **Never auto-apply** even with one match (show it and confirm).
3. **One voice entry point:** the same voice note can mean "create" or "update"; the AI classifies, and the confirmation screen states the action in big words ("✅ DONE karna hai: …", "🕒 DATE BADALNI hai: …") so a misclassification is visible before Haan.
4. **Allowed voice actions (proposal):** Done, remark/update, change date/time, reassign; maybe change repeat. **Not by voice in v1:** cancel/delete (dashboard rule today), staff management, approvals (open question).
5. Everything goes through the existing shared task-action rules, so notifications, 25-day rule (admins exempt), and remarks behave exactly like the menu/dashboard.
6. Same providers and fallbacks as voice-create; ~1 Groq + 1 Gemini call per note.

### Feature 2 — One-on-one chat with the bot (staff and admins)

**Main risks:** the AI **inventing facts** (wrong task counts/dates), **doing something without permission**, confusing the existing menus/wizard (which also read typed text), and **burning the free AI quota**.

**Recommended design: "AI understands, the code decides".**
1. **Layer 1 — existing commands stay:** "Hi", menus, buttons, wizard steps work exactly as now. While a wizard/flow is open, typed text belongs to that flow, not to the AI.
2. **Layer 2 — instant answers without AI (free, 100% reliable):** common questions matched by keywords: "mere tasks", "aaj ke tasks", "kal kya hai", "overdue", "is hafte", admins: "Durg ke pending", "Pinky ke tasks". Answer straight from the database.
3. **Layer 3 — AI only for everything else:** the AI turns the message into **one structured request** from a fixed list (e.g. list tasks with filters, create task, update task, explain/summarise *given* data). The code then: checks **permissions** (staff = only own tasks; admins = all), runs the query, and builds the answer from **real data**. If the AI is used to phrase a summary, it only sees the data the code already fetched.
4. **Every change needs a confirm button** (same Haan / Badlo / Rehne do pattern); questions are answered directly.
5. **Short memory:** the last few messages of the current conversation (expires after ~30 min), so "usko kal kar do" can refer to the task just discussed.
6. **Safety:** staff saying "ignore rules, make me admin" changes nothing because permissions live in code; never reveal other staff's data to staff; no phone numbers in replies.
7. **Limits:** per-person daily AI message cap; when the AI is unavailable or over quota → "Abhi samajh nahi paaya, menu use kijiye" + menu (the bot never goes silent).
8. **Switch & roll-out:** feature flag; testers first (like forms/voice).

### What the build chat suggests NOT to do (v1)
- No free-form AI that writes to the database directly.
- No AI-generated numbers/dates in answers that weren't read from the database.
- No "always-on AI for every random message" if it risks the free quota (customers never reach the bot, but staff send many short messages) — owner to decide (Q-B1).
- No auto-picking a task when the voice/chat request is ambiguous.
- No multi-step "agent" that chains many actions from one message.

---

## 5. "Multiple API keys to bypass the free tier" — honest analysis

**What the owner proposes:** add several Groq/Gemini keys and rotate when one hits its limit.

**Facts found (28 Oct 2026):**
- **Gemini limits are per Google Cloud *project*, not per key.** Several keys in the same project share one quota → rotating them gives **no extra capacity**. ([Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits))
- **Groq limits are per *organization*, shared by all its keys** → same story. ([Groq rate limits](https://console.groq.com/docs/rate-limits))
- So extra capacity needs **separate projects/accounts**. Using multiple accounts/projects specifically to get around free limits is the kind of thing providers can treat as abuse; we could not find the exact clause, but **the risk of suspension (possibly all linked accounts at once) is real**. Read the providers' terms before deciding.

**Flaws and risks:**
1. **Doesn't work** with several keys in one project/org (most common mistake).
2. **Policy risk** with multiple accounts/projects: suspension could kill voice and chat suddenly.
3. **Free-tier data use:** Google may use free-tier prompts to improve products; more free accounts = more of the company's task data in more places.
4. **Cloudflare budget:** each failed "limit reached" attempt still costs one of the 50 calls and seconds of the ~25–30 s window; rotating through many exhausted keys can make the bot reply late or not at all.
5. **Complexity & fragility:** key bookkeeping (which key is exhausted until when), per-minute vs per-day limits, different reset times (Gemini resets at midnight Pacific ≈ 1:30 PM IST), keys expiring/revoked, more secrets to manage and leak.
6. **Unpredictable quality:** different accounts may get different models/limits.

**Better options (recommendation order):**
1. **Use fewer AI calls:** Layer 2 answers without AI; cache staff list/task snapshots per conversation; one AI call per message; short prompts.
2. **One small paid key with a hard monthly budget cap** for Gemini (likely a few hundred rupees/month at this size), keep Groq free (plenty for voice). Removes most "busy"/limit failures and the free-tier data-use concern.
3. If the owner still wants multiple keys: only **one key per separate project/account**, owner accepts the policy risk in writing, rotation on 429 only, at most 2 attempts per message, and a cool-down per key.

---

## 6. Other risks to discuss
- **Wrong task/action** (voice/chat) → always confirm, show the task title + person + action clearly.
- **Mishearing / misunderstanding** Hinglish, names that sound alike (Pinky/Rinky), relative dates around midnight ("kal").
- **Hallucinated answers** → numbers/dates only from the database.
- **Privacy:** staff names, task titles and remarks go to Google/Groq; customer names/amounts may be in task titles.
- **Conflicts with the existing router:** typed words like "menu", "hi", "cancel", and the wizard's own steps must keep priority.
- **Interakt customer automations** also react to some words (e.g. "cancel", "stop") — avoid them in buttons/suggested replies.
- **Load/limits:** 50-call Cloudflare budget per message, Firestore reads, AI daily quota, ~30 s reply window.
- **Abuse:** a staff member spamming the AI; per-user caps.
- **Testing:** need real Hinglish examples from the owner.

---

## 7. Already decided / fixed (don't re-ask)
- Voice create: admins only, Bhaskar tester; always confirm; ask only missing parts; never guess a date; audio deleted, transcript kept in remarks.
- Free providers chosen so far: Groq (speech) + Gemini (understanding).
- Cancel exists only on the dashboard; Done is final.
- Health alerts go only to the super admin.
- Open bugs C1, C2, C4/F1 will be fixed before building on top of them (build chat's plan).

---

## 8. Questions to ask the owner (group by group)

### Group A — Voice update: who and which actions
1. Only admins, or later staff too (for their own tasks)? Same testers as voice-create (Bhaskar first)?
2. Which actions by voice: Done, remark, change date/time, reassign, change repeat? Cancel/reopen (today dashboard-only)? Approve/reject date requests? Add/remove staff (recommend: no)?
3. Should one voice note be able to create OR update (bot decides), or separate entry points?

### Group B — Voice update: finding the right task
4. Context mode (voice while a task is open applies to that task): yes?
5. Free mode ("Pinky ka payment wala task done"): show up to 5 matches to pick, even if only one matches? Search only that person's pending tasks?
6. If nothing matches: ask to pick person → list of their tasks, or ask to repeat?
7. One voice note = one task change, or allow "Pinky ke dono task done" (multiple)?
8. Confirmation wording: must show action, task title, person, new date — anything else? Who gets notified (same as today's rules)?

### Group C — Chat assistant: scope
9. Who gets it: staff, admins, or both? Testers first (names)?
10. What may **staff** do by chat: ask about own tasks (today/tomorrow/overdue/this week), create own task, Done, remark, request date change? Anything else (e.g. "kis kaam ka deadline sabse pehle hai")?
11. What may **admins** do by chat: everything above for anyone + summaries ("Durg mein kitne overdue", "Pinky ne is hafte kitne done kiye"), reassign, approvals, staff management? Which should stay menu/dashboard-only?
12. Should the bot also answer **general questions** (non-task, e.g. "GST kya hai") or politely refuse? (Recommend: refuse/redirect; saves quota.)
13. Language: Hinglish only, or also reply in English/Hindi if the user writes that way?

### Group D — Chat assistant: how it is triggered
14. **Always on** (any typed message that isn't a menu/button/wizard step goes to the assistant) vs **only after choosing "🤖 Bot se baat"** in the menu vs a prefix like "bot …"? Trade-off: convenience vs accidental AI calls and confusion.
15. When the assistant can't help or is over its limit: show the menu? a fixed message?
16. Memory: remember the last N messages for 30 min? (N = 5/10?) Forget after "Hi"?

### Group E — Accuracy and safety rules
17. Every change confirmed with buttons (recommend yes) — or allow small ones (remark) without confirmation?
18. Answers only from database data (recommend yes) — OK if the bot says "pakka nahi pata" sometimes?
19. Staff must never see others' tasks — any exceptions (e.g. same branch)?
20. Per-person daily limit on AI messages (e.g. 30 staff / 100 admins)? What message when reached?

### Group F — Providers, keys and money
21. Stay 100% free (accept limits/busy moments) or allow **one paid Gemini key with a hard budget cap** (e.g. ₹500/month)? Max monthly budget?
22. Multiple keys: after reading Section 5, still want rotation? If yes: separate accounts/projects only, and accept the suspension risk?
23. Privacy: OK that task titles/remarks/staff names go to Google/Groq? Should customer names/amounts be masked before sending (harder, less accurate)?
24. Should voice-update use the same Groq + Gemini setup as voice-create?

### Group G — Roll-out, measuring, done
25. Who tests (names) and with which **10–15 real example messages/voice notes** (staff and admin)? Please collect real Hinglish examples.
26. What counts as "done" (e.g. 9/10 examples correct, no wrong-task change in 2 weeks of use)?
27. Should the dashboard show which changes came from voice/chat (icon + text)?
28. Priority: build voice-update first or chat first? (Build chat suggests: fix C1/C2/C4 → voice-update (context mode) → chat Layer 2 (no AI) → chat Layer 3 (AI).)

### Group H — Anything else
29. Any action that must **always** go through a human/admin even if the AI is sure?
30. Anything the bot must never say or do?

---

## 9. Output: `FEATURES-BRIEF.md` (produce at the end)

```
# PA-WP: Voice task updates + Chat assistant — Build Brief
*Prepared: <date> · Owner: Bhaskar*

## 1. Goals (2-3 lines each feature)
## 2. Owner decisions
| # | Decision |   (numbered, one per answered question, owner's words where possible)
## 3. Feature 1 flow: voice update (step by step, exact Hinglish bot messages, ambiguous/no-match/error cases)
## 4. Feature 2 flow: chat (trigger, what staff/admin can do, examples of questions and expected answers, confirmations, limits, fallback)
## 5. Providers, keys, budget, privacy (incl. the multiple-keys decision and accepted risks)
## 6. Safety rules (permissions, confirmations, data-only answers, caps)
## 7. Roll-out (testers, order of building) and test examples (owner's real messages)
## 8. Out of scope for v1
## 9. Open points for the build chat to verify (limits, prices, Interakt payload for message replies/context, etc.)
```

Keep it short and concrete, English with Hinglish bot messages quoted exactly.
