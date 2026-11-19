# Round 7 contract: open-task chat, chat memory, follow-ups

*19 Nov 2026. Source of truth: `docs/CHAT-HYBRID-PLAN.md` (read §1, §2, §3.1–3.5 and the Round 7 part of §4). The coordinator owns this file and `worker/src/chat/types.ts` (final; report a missing field instead of editing it). Stubs with the final signatures already exist so everything compiles; agents replace the bodies.*

## What this round delivers

1. **Task detail + typed text = chat about that task.** Open a task (detail screen), type "iski due date kya hai?" → the bot answers, the remark count stays the same. The **Update ✏️** button still opens the remark prompt and saves the typed text as a remark.
2. **Chat memory** (`chat_ctx/<phone>`, 15 min): last query, the task IDs shown in order, the selected task.
3. **Follow-ups without AI** (rules): "sirf urgent wale", "kal wale", "overdue wale", "doosra wala kholo", "2", "pehla", "last wala", "aur dikhao", "shuru se / reset"; and **task questions** ("iski due date", "kisko diya hai", "last update kya tha", "kab banaya", "kitne remark hain", "status").
4. **Numbered chat lists:** every list message shows "1) title · due" lines in its text; the same order is saved in memory.
5. AI fallback gets a compact memory summary and can return the new request kinds.

## Switches (in `worker/src/bot/router.ts`, owner C)

```ts
export const CHAT_DETAIL_LIVE = false;   // detail-screen text → chat (row 5)
export const CHAT_MEMORY_LIVE = false;   // memory read/write + follow-ups
export function canUseChatDetail(user: User): boolean { return CHAT_DETAIL_LIVE || CHAT_TESTERS.has(user.name); }
export function canUseChatMemory(user: User): boolean { return CHAT_MEMORY_LIVE || CHAT_TESTERS.has(user.name); }
```
- **Switch off = exactly today's behaviour** (detail text → remark; no memory read or write; no numbering; none of the new kinds is produced or handled).
- Both stay `false` in the committed code; the coordinator flips them after the owner's test.

## Routing (router.ts, owner C)

Plan §3.1 rows 5 and 7:
- **Row 5:** a typed message (no reply, voice or form) while a **fresh** session is `tasks` / `detail` with `data.taskId`, and `canUseChatDetail(user)` → `handleChat(ctx, text, { selectedTaskId })`. **The session stays intact** (so Update / Done / Date buttons still work, and the 5-minute typing TTL for `detail` still applies). Courtesy words, greetings/menu/cancel words are checked **before** this (as now).
- With the switch off, typed text on the detail goes to the remark exactly as today.
- Rows 1–4 and 6 (buttons, forms, voice, open input steps, draft confirms, expired sessions) are **unchanged**. Typed text in an open input step never reaches chat.
- Row 7 (nothing open) is as today; with memory on, `handleChat` loads and saves memory.

## Chat flow (`worker/src/bot/flows/chat.ts`, owner C)

New signature: `handleChat(ctx, raw, opts?: { selectedTaskId?: string })`.

Order inside:
1. courtesy (unchanged) → 2. **if `canUseChatMemory`: load memory** (`store.getChatMemory`), treat it as null when older than `CHAT_MEMORY_MIN` (use `resolveRef`'s rule / a shared helper) → 3. set `sel` from `opts.selectedTaskId` when given → 4. `ruleFollowup(text, cctx, memory)` (new, from `rules.ts`) → 5. `ruleRequest` (unchanged) → 6. AI (unchanged limit and counting; sends `cctx.memory` summary) → 7. execute → 8. **save memory** (version-checked; on `false` re-read once and re-apply, else skip silently).

Execution of the new kinds (all permission checks in code; never trust IDs from the AI):
- `refine`: previous `memory.query` + `refineFilter` → run the list/count again → save new query/shown/offset. No previous query → "Pehle bataiye kya dekhna hai, jaise *mere pending tasks*."
- `more`: same query, `offset` advanced by what was shown; says "9–16 / 23 dikhaye"; nothing left → friendly line.
- `open`: `resolveRef` → reload the task with `getTask` → `canSeeTask` and not deleted → open its detail in the `tasks` flow (same trick as `staffDate`: `tasksFlow.handle` with a `tasks:task:<id>` tap on a stub session) and set `sel`. Failure reasons → one focused question ("Kaunsa task? Pehle list dekhne ke liye *mere tasks* likhiye").
- `ask_task`: target = `ref` (default `selected`) or `taskWords` matched with `matchTasks` among the tasks the user may see (staff: own; admin: all pending). Reload, `canSeeTask`, answer with `describeTask`. Several matches → one numbered question with ≤ 5 choices (answering with the number resolves it via memory `shown`). No task → ask for a fragment.
- `reset`: clear memory, "Theek hai, naye sire se 🙂".
- When a list/count answer contains a task picker, memory is saved with `shown` = the task IDs in the order of the numbered lines.
- With `canUseChatMemory` false: the new kinds are never produced (rules skipped, AI told nothing) and a stray one is answered with the unclear text.

Reads and numbering (`worker/src/chat/answer.ts`, owner C):
- Add `answerQueryDetailed(store, user, request, now, opts?: { offset?: number }) → { outs: Outgoing[]; shown: string[]; offset: number; total: number }` and keep `answerQuery` as a thin wrapper with the same output as today when numbering is off.
- With numbering on (a flag argument `numbered: boolean`, true only when memory is on) the header text lists "1) <title> · <due>" lines (urgent 🔴, assignee for branch/all scopes) for the shown tasks, in the same order as the picker rows; ≤ 1024 chars, ≤ 8 rows per page.

Detail-screen answers (`tasks.ts`, owner C, only if needed): none required; routing is in the router.

## Memory store (owner A)

Implement for real in `worker/src/data/memoryStore.ts` (already behaves) and **`firestoreStore.ts`** (stub is read-then-write): `saveChatMemory` must be **atomic**: use the Firestore `updateTime` precondition (`currentDocument.updateTime`) for existing docs and `currentDocument.exists=false` for the first save; a 409/412 = return false. Collection `chat_ctx` (const `CHAT_CTX`), doc id = phone, plain fields (`query` as a map, `shown` as an array of strings). Add `deleteDoc`-style helpers in `worker/src/firebase/firestore.ts` if needed.
- **Daily cleanup** (`worker/src/scheduler/cleanup.ts`): also delete `chat_ctx` docs whose `at` is older than 1 day (one more query + at most one commit; update the header comment and budget; `CleanupResult` gets `chatCtx`). Keep the existing results and tests working.
- Never read a memory for an empty phone.

## References and task answers (owner B)

- `refs.ts`: `resolveRef(memory, ref, now)`: `index` → `memory.shown[n-1]` (1-based; also reject n out of range), `selected` → `memory.sel` (or `none_selected`), `last` → last element of `shown`. A memory older than `CHAT_MEMORY_MIN` minutes → `expired`; no memory → `no_memory`. `refineFilter(previous, changes)` merges (missing keys keep the old value; `scope` person/branch keeps the matching `person`/`branch`; changing `branch` sets scope "branch", `person` sets scope "person").
- `taskInfo.ts`: `canSeeTask(user, task)`: admin → any task whose status is not `deleted`; others → assignee or creator, not deleted. `describeTask(task, field, now)` → short Hinglish from the task's own data: due (IST via `formatDue`, with overdue note), assignee, creator, status (+ Done/Cancel time), urgent, repeat (weekly weekday / monthly day), `last_remark` (text clipped, with its time, ignoring the "Voice se banaya …" note), `remark_count`, created, done_at, and `all` (title, kisko, due, status, urgent, last remark in ≤ 6 lines). Missing data says so plainly ("Abhi koi remark nahi hai."). No phone numbers.
- `rules.ts` `ruleFollowup(text, { role, self, people, now }, memory)`: deterministic, strict vocabulary like `ruleRequest` (an unknown word → null):
  - follow-ups only when the memory exists and is fresh (except `reset` and task questions that name a task or use "iski/uski/is task" with a selected task)
  - `refine`: "sirf urgent wale", "urgent wale", "kal wale", "aaj wale", "overdue wale", "is hafte wale", "sab dikhao", "Durg ke" (admin), "Pinky ke" (admin; staff → null)
  - `open`: "doosra wala kholo", "2", "dusra", "pehla wala", "teesra", "last wala", "isko kholo", "number 3"
  - `more`: "aur dikhao", "aur", "next", "show more", "baaki dikhao"
  - `ask_task`: "iski due date kya hai", "kab tak hai", "kisko diya hai", "kisne diya", "status kya hai", "last update kya tha", "kitne remark hain", "kab banaya", "kab done hua"
  - `reset`: "shuru se", "reset", "naya", "clear"
  - write words (done, kar do, likh do, badlo, de do, bana…) always → null
  - bare numbers resolve only when memory has `shown` and the number is within range.
- Keep `ruleRequest` behaviour unchanged (existing tests pass).

## AI service (owner D)

- `types.ts` already has the new request kinds and `ChatContext.memory`. Extend the schema/prompt/validation in `understand.ts` so the fallback can return `refine`, `open`, `more`, `ask_task`, `reset` (with `ref` as `{by, n}` and `changes`). The prompt gets the compact `memory` summary only when present (last query in words, how many shown, selected task title as quoted data) and says: references are resolved by the server; never output task ids.
- Without `ctx.memory` the new kinds are not allowed (validation turns them into `unclear`). Staff: a `refine` with person/branch/scope other than mine is forced back to mine; `ask_task` is allowed.
- Keep one call, same fallbacks, injection tests extended to the new kinds.

## Rules for everyone

- Free tier: ≤ 50 subrequests per message. Memory = 1 read + 1 write (+1 retry). No loops over users or tasks beyond what `answer.ts` already does.
- Never cancel/stop as button titles; Hinglish; button titles ≤ 20, list row titles ≤ 24, descriptions ≤ 72, body ≤ 1024.
- No task text or message text in logs; no phone numbers in any reply.
- Existing tests must keep passing; list any you change and why.
- Only the coordinator commits, pushes and updates docs.

## Agents and files

| Agent | Owns |
|---|---|
| **A: memory store** | `worker/src/data/memoryStore.ts`, `firestoreStore.ts`, `store.ts` (only if the interface needs a fix), `worker/src/firebase/firestore.ts`, `worker/src/scheduler/cleanup.ts`, tests: `worker/test/firestoreStore.test.ts`, `worker/test/scheduler/cleanup.test.ts`, new `worker/test/chat/memory.test.ts` |
| **B: refs + task answers** | `worker/src/chat/refs.ts`, `taskInfo.ts`, `rules.ts` (add `ruleFollowup`; `ruleRequest` untouched), tests: `worker/test/chat/refs.test.ts`, `taskInfo.test.ts`, `rules.test.ts` (extend) |
| **C: routing + flow** | `worker/src/bot/router.ts`, `worker/src/bot/flows/chat.ts`, `worker/src/chat/answer.ts`, `worker/src/bot/flows/tasks.ts` and `voiceUpdate.ts` only if truly needed, tests: `worker/test/router.test.ts`, `worker/test/flows/chat.test.ts`, `worker/test/chat/answer.test.ts`, `worker/test/scenarios/chat.test.ts` (extend or add `chatMemory.test.ts`) |
| **D: AI service** | `worker/src/chat/understand.ts`, `worker/src/chat/index.ts`, `worker/test/chat/understand.test.ts` |

## Acceptance (the first milestone of the hybrid plan)

- Open a task, type "iski due date kya hai?" → answer; remark count unchanged. Tap **Update** and type a remark → saved as a remark.
- "Durg ke overdue tasks dikhao" → "sirf urgent wale" → "doosra wala kholo": Durg and overdue are kept, and the 2nd task actually shown opens.
- "aur dikhao" shows the next page of the same query.
- Expired or inaccessible reference → one focused question. A staff member can never reach another person's task through a number, a name or a count.
- Two messages arriving together: an older one cannot overwrite a newer memory.
- With both switches off, the bot behaves exactly as before this round.
