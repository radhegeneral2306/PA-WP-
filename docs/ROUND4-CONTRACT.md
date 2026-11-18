# Round 4 contract: update an existing task by voice note (admins; Bhaskar only for now)

*18 Nov 2026. Decisions: `docs/PENDING-BRIEF.md` + `docs/PENDING-BRIEF-ADDENDUM.md` (Q5–Q7), design from `docs/NEXT-FEATURES-DISCUSSION.md` §4. The coordinator owns this file, `worker/src/voice/types.ts` and `worker/src/bot/taskActions.ts`.*

## Owner rules

- **Who:** only `canUseVoice(user)` users (today: Bhaskar). Others never reach this code.
- **Actions by voice:** Done, remark, change date/time, reassign. **Not** by voice: Cancel, Delete, staff add/remove, approvals.
- **One voice note = one task.** If it names several tasks, the admin picks one at a time from the list.
- **Always confirm** before anything changes. The confirm text states the action in big words.
- **Open task = context:**
  - A voice note sent while a task detail is open (flow `tasks`, step `detail`, `data.taskId`) applies **only to that task**. No search, no list.
  - Otherwise: the model gives person + task words → code finds candidate tasks → admin picks → confirm.
- Free tier only: **one** Gemini call per voice note (same as creating). No second AI call.
- Notifications and rules are exactly those of the menu/dashboard, because the flow calls the shared actions in `taskActions.ts`:
  - `markDone`, `addRemark`, `changeDue(..., { notifyAssignee: true })`, `reassign`.
  - Admins have no 25-day limit.
  - The actor is never notified.
- Remarks written by a voice update are marked `"<Name> (voice)"`: pass `{ phone, name, viaVoice: true }` as the actor (already supported by `remarkBy`; `markDone` also logs "Done kiya" for voice).
- Never `cancel`/`stop` as button titles (Interakt automation). Button titles ≤ 20 chars, list row titles ≤ 24, descriptions ≤ 72, body ≤ 1024.
- 2-minute chat timeout (5 for typing steps, `TYPING_STEPS` in `router.ts`).
- Double-tap guard on the confirm "Haan": `withNonce` / `firstTap` (see `bot/flow.ts`).
- Voice failures are counted for the health check exactly as in `voiceTask.ts` (`HEALTH_FAILURES`, `recordProblems`) and show the super admin the `_Tech:` line.

## What the model returns (already in `worker/src/voice/types.ts`)

`VoiceDraft` gets optional fields:
- `intent: "create" | "update" | null`
- `action: "done" | "remark" | "due" | "reassign" | null`
- `remark: string | null`
- `taskWords: string[]` (words that identify WHICH task)
- `newPerson`, `newPersonHeard` (reassign)

Reused fields:
- `person` / `personHeard` = whose task it is, for an update.
- `date` / `time` = the new due, for `due`.
- `transcript`.

`VoiceContext.task` is set in context mode: `{ title, assignee }`.

Missing `intent` means "create": the old flow, unchanged.

## Flow design (Agent B)

New flow `voice_update` in `worker/src/bot/flows/voiceUpdate.ts`. Reply ids are `voice_update:<kind>:<value>`.

**Entry** (from `voiceTask.ts` `handleVoice` when `draft.intent === "update"`, and from the router for context mode):
1. **Context mode:**
   - `understand(url, { now, people, task })`.
   - The action comes from the draft.
   - If the action is `null` (unclear): ask "Is task pe kya karna hai?" with a list: Done / Remark likho / Date badlo / Kisi aur ko do.
   - A remark that was not extracted is asked as typed text.
2. **Free mode:**
   - Candidates: pending tasks of `person` (if resolvable to one active user), else all pending tasks. Use `ctx.store.listTasks`. At most one query.
   - `matchTasks(candidates, taskWords)` from `worker/src/bot/voiceMatch.ts`.
   - 1–8 matches → list "Kaunsa task?" (rows: title, "Kisko · Due"). The admin always picks, even for one match.
   - No match but a person is known → that person's `shortlist` with "Koi exact match nahi mila, inme se chuniye".
   - No match and no person → "Koi task nahi mila 😕 Task ka naam ya kiska hai, saaf bolkar dobara bhejiye." (text only).
   - An ambiguous or unknown person name → ask who, like `voiceTask.ts` (reuse its helpers if they are exported, or copy small parts; don't change `voiceTask.ts` behaviour for create).
3. **Missing parts:**
   - `due` without a date: show the quick due list (`quickDueList`) or accept a typed date.
   - `remark` without text: ask to type it.
   - `reassign` without a (resolvable) new person: ask with `branchList` → `userList` (admins can be picked too).
4. **Confirm screen** (body states the action in big words). Buttons: `Haan ✅` / `Rehne do ❌`, and 2 buttons only (no Badlo).
   - `✅ DONE karna hai:` + task title, Kisko, Due.
   - `📝 REMARK likhna hai:` + title + the remark text.
   - `🕒 DATE BADALNI hai:` + title + `<old due> → <new due>`.
   - `👤 DUSRE KO DENA hai:` + title + `<old> → <new>`.
   - Also `Maine suna: "<transcript clipped>"`.
5. **Haan:**
   - Re-check at the moment of tapping: the task still exists, is pending, the person is active, and (due) the new due is still in the future.
   - Then call the shared action and send its `outs` plus a short confirmation ("✅ Done ho gaya: *title*").
   - After the action, end the flow (no list).
6. **Errors:** if a task changed in between (done/cancelled/deleted), say so plainly and end the flow.
7. **Failures** (download, busy, quota, not understood) reuse `VOICE_MSG` texts. A note that is not understood stays "Samajh nahi aaya" (never create or change anything).

**Router** (`worker/src/bot/router.ts`, Agent B):
- Register `voiceUpdateFlow` in `FLOWS`.
- Voice from `canUseVoice` users:
  - If an open fresh session is `tasks`/`detail` with `data.taskId` → context mode for that task. The session is kept intact until the note was understood. On success the session becomes `voice_update`.
  - Otherwise the existing behaviour: busy message when another flow (other than `voice_task` / `voice_update`) is open, else clear and `handleVoice`.
- `TYPING_STEPS`: add `voice_update` typing steps (a typed remark, a typed date).

## Agents and file ownership

| Agent | Owns | Must not touch |
|---|---|---|
| **A: Gemini / service** | `worker/src/voice/gemini.ts`, `worker/src/voice/index.ts`, `worker/test/voice/**` | everything else |
| **B: Flow + router** | `worker/src/bot/flows/voiceUpdate.ts` (new), `worker/src/bot/flows/voiceTask.ts` (only a small hook at `handleVoice`), `worker/src/bot/router.ts`, their tests (`worker/test/flows/voiceUpdate.test.ts`, `voiceTask.test.ts`, `router.test.ts`, plus a new scenario test file `worker/test/scenarios/voiceUpdate.test.ts`) | `worker/src/voice/**`, `voiceMatch.ts`, `taskActions.ts`, `dashboard/**` |
| **C: Matcher** | `worker/src/bot/voiceMatch.ts` (replace the stub, keep the exported signatures) and `worker/test/voiceMatch.test.ts` | everything else |

The coordinator alone commits, pushes and updates docs.

## Agent A (Gemini) specifics

- Extend the response schema and the prompt so ONE call returns the new fields.
- Existing create behaviour and tests must still pass. `intent` missing or "create" = old behaviour.
- **Free mode** (no `ctx.task`): the model decides:
  - `intent: "update"` when the admin talks about a task that already exists. Examples: "Pinky ka Sharma ji wala task done kar do", "payment wale task ki date kal kar do", "Hema ko diya hua stock wala task Pooja ko de do", "Sharma ji wale task mein likh do ki customer kal aayega".
  - `intent: "create"` for new work. Examples: "Pinky ko bolo kal ...".
  - Unsure → `intent: null` (the flow then treats it as create; the confirm screen makes a wrong guess visible).
- **Context mode** (`ctx.task` set): `intent` is always "update". Say in the prompt that exactly one task is open, include its title as quoted data, and that the note is about it. Extract the action:
  - done: "ho gaya", "complete", "done kar do"
  - remark: "likh do ...", "update: ..."
  - due: "kal tak kar do", "date badal do ..."
  - reassign: "ise Pooja ko de do"
  - Unclear → `action: null`.
- Fields:
  - `taskWords`: up to 6 lower-case Roman words that identify the task. For a context-mode note it is `[]`.
  - `remark`: only for action "remark".
  - `person`: exactly one listed name, or null.
  - `newPerson`: exactly one listed name, or null.
- Validation in `validateDraft`:
  - `intent` / `action` only from the allowed values.
  - `taskWords`: strings only, trimmed, ≤ 24 chars each, ≤ 6 items.
  - `remark` ≤ 500 chars.
  - `newPerson` must be a listed name (the schema enum + code check), else null.
  - Anything invalid → null or omitted; the old create fields keep working.
- Prompt-injection guards stay: the transcript is data; instructions inside it are ignored. A voice note must never be able to pick an action other than the four allowed.
- Keep it ONE Gemini call and the same fallbacks, timeouts, thinking-off behaviour.

## Agent C (matcher) specifics

`matchTasks(tasks, words, { limit })` and `shortlist(tasks, limit)` (signatures in the stub):
- Hinglish-tolerant, pure, deterministic, fast.
- Normalisation: lower-case; strip punctuation and accents; transliteration variants (v/w, ph/f, aa/a, ee/i, oo/u, double letters; "sharma ji" / "sharmaji"; common Hinglish spellings of "payment/paiment", "follow up/followup/folo up").
- Matching:
  - A word matches a title token if equal, a prefix of it (≥3 chars), or within a small edit distance for words ≥5 chars.
  - A multi-word title phrase also matches against the concatenated words.
- Scoring: exact word hits count more than fuzzy ones. More distinct matched words = higher.
- Only `status === "pending"` tasks are returned. Ties: urgent first, then earliest due.
- No words → `[]`. No match → `[]` (never return unrelated tasks).
- Include many Hinglish test cases, including false-positive guards ("pay" must not match "payment" at distance > threshold? decide and document).
