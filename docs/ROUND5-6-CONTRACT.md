# Round 5 (chat with the bot) and Round 6 (dashboard Phase 7): contract for the parallel agents

*Decisions: `docs/PENDING-BRIEF.md` + `docs/PENDING-BRIEF-ADDENDUM.md`. The coordinator owns this file and `worker/src/chat/types.ts` (final; report a missing field instead of editing it).*

## Round 5: owner rules

- **Always on, no menu button.** The normal bot looks at every message first. Anything it recognises is handled there: greetings, menu words, buttons, an open step (typed text belongs to the open flow, never to the AI), and the rule layer below. Only a typed message with **no open chat** that nothing recognised goes to the AI. After a session expired the old "Session expire ho gaya" reply stays.
- **Rollout flag:** `CHAT_LIVE = false` and `CHAT_TESTERS = {"Bhaskar"}` in `router.ts` (like voice). Flip later.
- **Free tier only.** Gemini free, one call per message that reaches the AI. Rules answers cost **no** AI call and are not counted.
- **Daily AI limit per person:** staff 20, admins 50 (IST day). At the limit: "Aaj ki limit poori ho gayi, menu use kijiye" + the menu. AI down / not configured / not understood: "Abhi samajh nahi paaya, menu use kijiye" + the menu. The bot never goes silent.
- **Staff can:**
  - ask about **their own** tasks (today, tomorrow, overdue, this week)
  - mark Done, add a remark, create a task for themselves
  - date change: open that task's detail in the existing `tasks` flow, so its 25-day approval rule applies
  - never see others' tasks; asking for others → "Aap sirf apne tasks dekh sakte hain".
- **Admins can** do all of that for anyone (list/count by person, branch, all) plus reassign. **Not** via chat: staff add/remove/edit, Delete, cancel, approvals (menu/dashboard only).
- **Non-task questions** (e.g. "GST kya hai"): polite refusal + menu.
- **Every change needs confirm buttons.** Reuse the existing confirm flows:
  - updates → `voice_update` (`worker/src/bot/flows/voiceUpdate.ts`: `startUpdateFromDraft`, pick task, confirm, shared actions), with the wording for typed text ("Aapne likha" instead of "Maine suna")
  - create → `voice_task` (`startFromDraft`, admins) or the wizard-style confirm for a staff self task
  - no new write paths: only `taskActions.ts` actions
  - answers contain **only database data**; the AI never writes facts.
- Chat steps follow the timeouts: tap steps 2 min, typing steps 5 min (`TYPING_STEPS`).
- Never `cancel`/`stop` as button titles. Hinglish replies. Button titles ≤ 20, list row titles ≤ 24, descriptions ≤ 72, body ≤ 1024.
- Cloudflare free: ≤ 50 subrequests per message. A chat message may use: 1 store read for the user's tasks (or all pending for admin queries), at most 1 Gemini call, a few writes. Don't loop over users.

## Round 5: agents and files

| Agent | Owns | Must not touch |
|---|---|---|
| **A: AI service** | `worker/src/chat/understand.ts`, `worker/src/chat/index.ts` (`createChatService(env)`), `worker/test/chat/understand.test.ts` | everything else |
| **B: Rules + answers** | `worker/src/chat/rules.ts`, `worker/src/chat/answer.ts`, `worker/test/chat/rules.test.ts`, `worker/test/chat/answer.test.ts` | everything else |
| **C: Flow + wiring** | `worker/src/bot/flows/chat.ts` (new), `worker/src/bot/router.ts`, `worker/src/bot/flow.ts` (`BotContext.chat?`), `worker/src/index.ts` (wire `createChatService`), `worker/src/data/store.ts` + `memoryStore.ts` + `firestoreStore.ts` (daily counter), small wording hooks in `voiceUpdate.ts` / `voiceTask.ts` (create/update behaviour must not change), their tests incl. `worker/test/flows/chat.test.ts` and `worker/test/scenarios/chat.test.ts` | `worker/src/chat/**` except importing |

**A (AI service):**
- `understand(text, ctx)` → `ChatResult`.
- One Gemini call: reuse the helpers, fallback models, timeouts and thinking-off setting from `worker/src/voice/gemini.ts` (import what is exported; don't edit that file).
- Response schema = `ChatRequest` flattened (kind + the optional fields) and validated field by field in code.
- Names must be exactly listed people else null; `scope` for staff is always forced to "mine" in validation; `when` etc. only from the allowed values; text capped at 500 chars before sending.
- Prompt-injection: the user text is quoted data. Nothing the model returns can create an action outside `list/count/update(done|remark|due|reassign)/create/other/unclear`.
- The prompt knows today's IST date, the people list and the sender's role. Include Hinglish examples for each kind.
- `createChatService(env)`: not configured if `GEMINI_API_KEY` missing or `CHAT=off`.

**B (rules + answers):**
- `rules.ts`: `ruleRequest(text, ctx: { role, self, people, now }): ChatRequest | null`.
  - Deterministic Hinglish rules for the common questions, no AI:
    - own tasks: "mere tasks", "aaj kya hai", "kal ka kaam", "overdue", "is hafte", "urgent kaam", "mera kya pending hai"
    - admin: "Durg ke pending", "Pinky ke tasks", "sabke overdue", "kitne overdue hain", "Raipur mein kitne pending"
  - Person/branch names match case-insensitively against the given people / known branches (fuzzy-lite).
  - Returns null when unsure (never guess).
- `answer.ts`: `answerQuery(store, user, request: list|count, now): Promise<Outgoing[]>`.
  - Enforces permissions in code: staff are always scoped to their own tasks (asking for others → refusal text).
  - Reads with the cheapest filter (`assigneePhone` / `branch` / `status`).
  - Buckets by IST day: today, tomorrow, this week (Mon–Sun), overdue. Counts exclude closed/deleted tasks.
  - Output: a text summary (counts, then up to 8 task lines with due, urgent mark 🔴) or a `taskList` picker (reuse `worker/src/bot/ui.ts`; ids are those of the `tasks` flow so a tap opens the task detail). Choose one consistently, keep within WhatsApp limits.
  - Say "Koi task nahi" in a friendly way when empty.

**C (flow + wiring):**
- In `router.ts`, at the point where a typed message with no open chat falls through to the menu (the last branches of `handleMessage`), call the chat handler when `CHAT_LIVE || CHAT_TESTERS.has(user.name)`. Typed text in an open flow, buttons, voice, forms stay exactly as now.
- `chat.ts` `handleChat(ctx, text)`:
  1. Courtesy filter: "ok", "thanks", "dhanyavad", emoji-only, ≤2 letters → a short friendly reply, no AI.
  2. `ruleRequest` (from `worker/src/chat/rules.ts`; until agent B delivers, import it anyway: a stub file exists, see below).
  3. Else the daily limit check, then `ctx.chat.understand`. Health counting for failures, like voice.
  4. Execute by kind: list/count → `answerQuery`; update → build a `VoiceDraft` and hand to `startUpdateFromDraft` (staff: candidates limited to their own tasks, actions done/remark only; staff "due" → open the task detail in `tasks` flow); create → admin: `startFromDraft`; staff: self task only; reassign for staff → refused; other → refusal + menu; unclear → short help text + menu.
- Daily counter: add `Store.bumpDailyCount(key: string, now: Date): Promise<number>` (MemoryStore + FirestoreStore). Use the existing `claims` collection with an ISO `createdAt` so the daily cleanup removes old docs. Key e.g. `ai:<phone>:<IST date>`.
- Wire `createChatService(env)` into the deps like `voice` (see `index.ts` `Deps.voice`), `BotContext.chat?`.
- Stubs exist so everything compiles: `worker/src/chat/rules.ts`, `answer.ts`, `understand.ts`, `index.ts` are created by the coordinator now with the final signatures and trivial bodies; agents A and B replace them.

## Round 6: dashboard Phase 7 (owner: summary strip, task history, branch counts; staff performance DROPPED)

The summary strip (Pending / Overdue / Aaj due) already exists in the dashboard.

| Agent | Owns | Must not touch |
|---|---|---|
| **D: History API** | `worker/src/dashboard/**` (new route file + registration), tests under `worker/test/dashboard/` | everything else |
| **E: Dashboard UI** | everything under `dashboard/` | `worker/**` |

**API (D implements, E consumes)**
`GET /api/tasks/:id/history` (session auth) returns:

```json
{
  "task": { "id", "title", "assigneeName", "createdByName", "status", "createdAt", "dueAt", "dueHasTime" },
  "events": [ { "at": "ISO", "kind": "created|remark|done|cancelled|deleted|restored", "by": "Name or null", "text": "…" } ]
}
```
- Built from the task itself: `createdAt` (kind created, by createdByName, text "Task bana"), each remark (kind remark, `byName`, text), `doneAt`, `cancelledAt` (+ `cancelledByName`), `deletedAt` (+ `deletedByName`).
- Oldest first. One read (`getTask`). Unknown id → 404 `not_found`. Admin session only, like the other reads.
- No phone numbers anywhere in the response.

**UI (E)**
1. **Task history:** in the task detail (all views: pending, archive, bin) a "History" section that loads the endpoint **only when the admin opens it** (lazy, one read). Shows a vertical timeline: date/time, who, what. Hinglish labels, no emoji (see `docs/DASHBOARD-DESIGN.md`), accessible, 44px targets.
2. **Branch counts:** per branch Pending / Overdue / Aaj due, computed from the already loaded pending list (**zero extra reads**). Put them where it fits the Tasks screen naturally (e.g. a compact "Branch-wise" card or counts on the branch chips). Tapping a branch filters the list like the chips do. Include "Admins" if the list has tasks for admins.
3. Pure helpers with unit tests in `dashboard/src/lib/*.test.ts` (branch counting, event labels/sorting). Build, typecheck and tests must pass.

## Shared rules

- Only the coordinator commits, pushes and updates docs.
- Free plans: Firebase 50k reads/day, Cloudflare 50 subrequests per run. No new hot-path reads.
