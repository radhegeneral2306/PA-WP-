# Radhe Tasks: real one-on-one chat, the hybrid plan

*19 Nov 2026. Based on `PA-WP-chat-improvement-handoff.md`, checked against the live code (`main` = deployed). Decisions below are final unless the owner changes them.*

> **Hinglish summary:** Bot ab "button wala bot" se "asli baat-cheet" wala banega. Teen cheezein milake: (1) **yaad-dasht**: bot yaad rakhta hai ki abhi kya dikhaya, (2) **rules pehle, AI baad mein**: common baatein bina AI ke, (3) **code hi faisla karta hai**: permission, date, approval sab code ke haath mein. Buttons aur menu hamesha saath rahenge. Kuch bhi purana kaam nahi tootega, kyunki har naya hissa alag switch ke peeche hai.

---

## 1. Decisions (owner, 19 Nov)

1. Text typed on an **open task detail** goes to chat (about that task). Adding a remark = the **Update ✏️** button (explicit), or asking chat "isme likh do …" which shows a preview first.
2. Text typed on an **open chat draft / confirm** is a correction ("kal nahi, parso 4 baje", "Pinky nahi, Pooja", "urgent bhi kar do"). Typing steps that ask for plain input (title, remark text, reason, custom date, staff name/number) **stay in their flow** and never go to chat.
3. **No AI-written replies.** Every answer is built by code from real records (fixed Hinglish templates). Gemini only *understands* (one call, structured JSON), as today. "Aaj pehle kya karun?" uses an explicit ranking rule.
4. Free plans only. Buttons and menus stay everywhere.

## 2. What "real chat" means here (the feel)

- The bot **remembers the last thing it showed** for 15 minutes: "sirf urgent wale", "doosra wala kholo", "uska last update", "aur dikhao" all work.
- It **asks one short question** when unsure ("Payment follow-up ya bill bhejne wala?") and accepts a **number, a typed name, or a tap**.
- You can **correct** a proposal in plain words; the preview updates every time.
- Short, natural Hinglish replies; every reply ends with the obvious next step (a button or an example).
- A task being discussed stays "selected": "iski due date kya hai", "ise Pooja ko de do", "kal kar do".
- It never does anything silently: **every change shows a preview and needs Haan** (button or a plain "haan" tied to that preview).

## 3. Architecture: rules first, memory second, AI third, code always decides

### 3.1 Routing order (strict, first match wins)

| # | Situation | Goes to |
|---|---|---|
| 1 | Courtesy word (ok, thanks, 👍) | One-line reply, no AI |
| 2 | Greeting / menu / cancel words ("Hi", "band karo") | Menu / cancel (unchanged) |
| 3 | Button tap, form, voice note | Their flows (unchanged) |
| 4 | Open **input step** (title, remark text, date-change reason, custom date, staff name/number) | That step (unchanged; never chat) |
| 5 | Open **task detail** (`tasks`/`detail`) and typed text | **Chat with the selected task** (new) |
| 6 | Open **chat draft / confirm** and typed text | **Draft correction** (new) |
| 7 | Nothing open | **Chat** (as today, now with memory) |

Expired sessions still answer "Session expire ho gaya" (owner rule). Old buttons still expire after 2 minutes. Chat memory (below) is separate and only serves typed follow-ups.

### 3.2 Chat pipeline for every typed message that reaches chat

1. **Normalise** (lower-case, punctuation, Hinglish spellings).
2. **Resolve references from memory** (no AI): "doosra / 2 / dusra / pehla / last wala", "isko / ise / uska", "sirf urgent", "kal wale", "overdue wale", "aur dikhao", "wapas / shuru se". Server code maps numbers to the **exact task IDs shown**, reloads those tasks, re-checks access.
3. **Rules** (`ruleRequest`, extended) for the common questions.
4. **AI only if still unsure**: one Gemini call, sent the sentence plus a *compact* memory summary (last filter, how many shown, selected task title, pending question). Returns a typed request. Task IDs never come from the AI; code resolves them.
5. **Execute in code**: permission check → read/answer, or build a draft → preview → confirm → shared action.
6. **Save memory** (version-checked), reply.

### 3.3 Chat memory (new store, own lifecycle)

New Firestore collection `chat_ctx/<phone>` (one small document per person):

| Field | Meaning |
|---|---|
| `v` | version number; every write bumps it |
| `at` | last activity (ISO) |
| `query` | last resolved filter (scope, person, branch, when, status, urgentOnly) |
| `shown` | task IDs in the exact order displayed, plus `offset` (for "aur dikhao") |
| `sel` | selected task ID (open detail or last picked) |
| `ask` | pending clarification: kind, candidate IDs/names, expires in 5 min |
| `draft` | draft reference: kind, fields, `dv` (draft version), `at`; confirmation valid 2 min |

- **Read memory expires after 15 min** of inactivity (constant `CHAT_MEMORY_MIN`). **Drafts/confirmations: 2 min.** **Clarifications: 5 min.**
- Memory stores **IDs and filters, never task text**, so nothing private is duplicated. Referenced tasks are always reloaded and re-authorised.
- **Concurrency:** write with the Firestore `updateTime` precondition; on conflict re-read once and apply, else drop the older write. An older message can never overwrite a newer draft.
- **Cleanup:** the daily cleanup also deletes `chat_ctx` docs older than 1 day (one more query, ≤ 1 commit).
- "Shuru se" / "reset" / any menu word clears it.

### 3.4 Number display

Every chat list message shows numbered lines in its text ("1) Sharma ji payment · aaj 5 PM 🔴"), and the same order is saved in memory. The picker rows stay (tap still works). "doosra wala" maps to that order.

### 3.5 Answering about a task (deterministic, no AI when possible)

With a task selected or named: due date, who it is assigned to / created by, status, urgent, repeat, **last remark with time**, how many remarks, when created/done. Rules cover "iski due date kya hai", "kisko diya hai", "last update kya tha", "kab banaya". Staff only for tasks they may act on; admins for all.

### 3.6 Clarify, then correct

- **One focused question** at a time. Candidates are shown with identifying details (title, assignee, branch, due). Accepts: a **number**, a **typed name/fragment**, or a **tap**. No useful match → asks for a fragment or another detail.
- **Draft corrections** (rules first, AI fallback): replace date/time ("kal nahi, parso 4 baje"), replace person ("Pinky nahi, Pooja"), toggle urgent ("urgent bhi kar do"), change repeat, change title ("title badlo: …"). Each correction shows a **fresh preview**.
- **Distinctions the request type must express** (validated in code):
  - "myself" / person omitted / unknown name / ambiguous name
  - date omitted vs invalid vs unclear
- **Confirmation binding:** the confirm buttons carry the **draft version** and the task/assignee. An older button, a duplicate delivery, or a superseded draft says "Naya preview dekhiye" and changes nothing. At "Haan" everything is **re-checked** (task exists and pending, assignee unchanged and active, new due still in the future, permissions) and an **idempotent claim** (`claimOnce`) makes sure it applies once. The final message is built from the action's real result.

### 3.7 Staff date change by chat

The parsed date/time is **carried into the existing tasks flow** (prefilled draft), so the staff member only types the **reason**, and the existing rules decide: ≤ 25 days applies directly (reply shows the actual saved date); beyond it sends an approval request and **keeps the current deadline** (reply says so). No new approval logic.

### 3.8 Richer reads

- Filters combine: scope, status, due range, overdue, urgent, plus "since" (e.g. "overdue since Monday") and **by completion date** for done tasks.
- "Is hafte kitne complete kiye?" counts by **done date (IST, Mon–Sun)**; "kitne due hain?" counts by **due date**.
- New store query for completions: `listDoneBetween(filter, fromIso, toIso, limit)` using a single-field range on `doneAt` (automatic index, bounded window, limit 200), so old history is never read in full.
- **"Aur dikhao":** uses `offset` in memory, stable order, says "9–16 / 23 dikhaye".
- **"Aaj pehle kya karun?"** explicit rule: (1) urgent and overdue, (2) overdue, oldest due first, (3) urgent due today, (4) due today, earliest first. Reply names the top task and the reason from real fields ("Ye urgent hai aur 2 din se overdue hai"), with a button to open it.
- All reads keep the permission rules of `answer.ts` (staff: own tasks only, also for counts and references).

### 3.9 Real-chat extras (small, safe)

- **Small talk** by rules: "hello", "kaise ho", "kya kar sakte ho" → a short friendly line plus 3 example sentences. No AI.
- "Help" / "kya puch sakta hoon" → the example list.
- Name used in greetings; replies stay short (≤ 6 lines).
- An unknown message never ends in silence: one clarification or the menu.

## 4. Build rounds (agent swarm; file ownership keeps agents from colliding)

Each round: the coordinator writes a contract + shared types, 3–5 agents build disjoint files, then 2 review agents try to break it, then tests, push, merge, live check.

### Round 7: open-task chat + memory + follow-ups

| Agent | Owns |
|---|---|
| A: memory store | `worker/src/chat/memory.ts`, `data/store.ts` + both stores (`getChatCtx`, `saveChatCtx` with version check), cleanup of `chat_ctx`, tests |
| B: references and task answers | `worker/src/chat/refs.ts` (resolve "doosra/2/isko/sirf urgent/aur dikhao"), `worker/src/chat/taskInfo.ts` (deterministic task Q&A), extend `rules.ts`, tests |
| C: routing + flow | `bot/router.ts` (rows 5 and 7), `bot/flows/chat.ts`, `flows/tasks.ts` (detail text → chat; Update button unchanged), numbered list text in `answer.ts`, tests |
| D: AI service | `chat/understand.ts`, `chat/types.ts` (new request kinds: `followup`, `ask_task`, `more`, `refine`), compact-context prompt, tests |

**Acceptance:** open a task, type "iski due date kya hai?" → answer, remark count unchanged. Tap **Update** and type → saved as a remark. "Durg ke overdue" → "sirf urgent wale" → "doosra wala kholo" keeps Durg + overdue and opens the 2nd task shown. Expired/inaccessible reference → one focused question.

### Round 8: clarify, correct, staff date

| Agent | Owns |
|---|---|
| A: drafts | `chat/draft.ts` (versioned draft, corrections via rules), confirm ids with `dv`, tests |
| B: clarification | `chat/clarify.ts` (one question, number/name/tap answers), candidate display, tests |
| C: flow wiring | `flows/chat.ts`, `router.ts` row 6, `voiceUpdate.ts`/`voiceTask.ts` typed-mode hooks, staff date hand-off into `tasks.ts` (prefilled draft) |
| D: AI service | `chat/understand.ts` (edit/correction kinds, "myself/omitted/unknown/ambiguous", date states) |

**Acceptance:** "Sharma ji wala kal kar do" → "Payment follow-up ya bill bhejne wala?" → "Payment wala, aur kal 4 baje" → right task + IST deadline in the preview; "Pinky nahi, Pooja" updates the preview; an old button or duplicate delivery cannot apply a different or repeated change; staff beyond 25 days sends an approval with the intended date and reason.

### Round 9: richer reads and prioritisation

| Agent | Owns |
|---|---|
| A: store | `listDoneBetween` (both stores), tests |
| B: answers | `chat/answer.ts` (combined filters, completions, history timestamps, `aur dikhao`), `chat/priority.ts` ("aaj pehle kya karun" rule), tests |
| C: rules/AI | `rules.ts` + `understand.ts` extensions for the new phrases |
| D: wiring | `flows/chat.ts`, small-talk and help |

**Acceptance:** "Pinky ne is hafte kya complete kiya?" returns the right authorised completions; "Sharma payment pe last update kya tha?" returns the latest remark + time; "aur dikhao" advances the filtered list; staff never see another person's task through queries, references or counts.

## 5. Free-tier and limit budget (per typed message)

| Resource | Cost | Limit |
|---|---|---|
| Cloudflare subrequests | ≈ 10–16 (memory read/write 2, task reads 1–2, Gemini 0–1 (up to 4 only on fallback), sends 1–3, claims 1–2) | 50 per message |
| Firestore | ≈ 3–5 reads, 2–3 writes | 50k / 20k per day; 27 users × 30 messages ≈ 3k reads/day |
| Gemini | **0 calls** for rules, courtesies, follow-ups, task answers; **1 call** otherwise | caps unchanged: staff 20, admin 50 AI messages/day |
| Time | one elapsed budget of ~20 s for AI interpretation; total must stay under the ~30 s background limit | n/a |
| Completions query | bounded window + limit 200 | never reads full history |

If Gemini is down or the quota is gone, every rule-based path (most traffic) still works; the rest says "Abhi samajh nahi paaya" + menu, as now.

## 6. Switches, rollout, safety

- New constants in `router.ts` (same pattern as `CHAT_LIVE`): `CHAT_DETAIL_LIVE`, `CHAT_MEMORY_LIVE`, `CHAT_DRAFT_LIVE`, `CHAT_READS_LIVE`, each with `CHAT_TESTERS = {Bhaskar}` first, then everyone after the owner tests. **Each switch off = today's behaviour.**
- Everything that changes data still goes through `taskActions.ts` and the existing confirm flows. No new write path.
- Logs never contain task text or message text; only counts, kinds and reasons.
- Regression suite per round: menus, explicit remarks, forms, voice create/update, reminders, approvals, dashboard actions.
- Tests use fake Gemini responses; plus a live pilot with Bhaskar for real Hinglish, typos, short replies, similar names.

## 7. Explicitly NOT in this plan

- AI-written replies (can be added later behind a flag if wanted).
- General Q&A ("GST kya hai"): stays politely refused.
- Bulk writes ("saare tasks done kar do"), staff add/remove/edit, Delete or approvals by chat.
- Native WhatsApp "quoted reply" mapping, until the pilot proves Interakt exposes the quoted message ID. Typed references work meanwhile.
- Replacing buttons/menus (they stay).

## 8. To verify during the pilot (cannot be known from code)

- Whether Interakt sends the quoted-message ID for replies.
- The real daily quota of the free Gemini project (check Google AI Studio) against 27 users.
- Real Hinglish phrasing from staff; add the frequent ones to the rules.
