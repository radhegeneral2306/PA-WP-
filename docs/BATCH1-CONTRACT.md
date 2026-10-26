# Batch 1: Work Split (for parallel agents)

Each agent owns **only** the files listed for it. Shared contract files are
read-only for agents; if a contract change is needed, report it instead of
editing. Nobody commits; the coordinator commits after review.

## Shared contract (coordinator owns, read-only for agents)

| File | What it defines |
|---|---|
| `worker/src/domain/types.ts` | `User`, `Task`, `Session`, `BranchId`, `BRANCHES`, `SESSION_TTL_MINUTES` |
| `worker/src/data/store.ts` | `Store` interface (users, tasks, sessions) |
| `worker/src/data/memoryStore.ts` | In-memory `Store` for tests |
| `worker/src/bot/outgoing.ts` | `Outgoing` message union, `TEMPLATE_PARAMS`, `TemplateName` |
| `worker/src/bot/flow.ts` | `Flow`, `BotContext`, `Inbound` interfaces, session helpers |
| `worker/src/bot/ui.ts` | Shared list/button builders (menus, branch/user/task lists, paging, due-date buttons) |
| `worker/src/bot/router.ts` | Picks the flow for each message; main menus |
| `worker/src/numbers.ts` | Phone helpers |
| `worker/src/index.ts` | Webhook entry, wiring |

## Phase 1 (parallel)

| Agent | Owns | Delivers |
|---|---|---|
| **A: Dates** | `src/domain/dates.ts`, `test/dates.test.ts` | IST date/time parsing and formatting |
| **B: Firestore store** | `src/firebase/firestore.ts`, `src/data/firestoreStore.ts`, `test/firestoreStore.test.ts` | `FirestoreStore implements Store` over the REST API |
| **C: Templates** | `docs/TEMPLATES.md`, `src/interakt/templates.ts`, `src/interakt/deliver.ts`, `test/deliver.test.ts` | Meta template drafts; `deliver()` for every `Outgoing` kind with template→text fallback |

## Phase 2 (parallel, after Phase 1)

| Agent | Owns | Delivers |
|---|---|---|
| **D1: Create + manage** | `src/bot/flows/createTask.ts`, `src/bot/flows/manageStaff.ts`, `test/flows/createTask.test.ts`, `test/flows/manageStaff.test.ts` | "Naya task" wizard and "Staff manage" (add / remove / list) |
| **D2: View + act** | `src/bot/flows/tasks.ts`, `test/flows/tasks.test.ts` | "Mere tasks", "Staff ke tasks", task detail, Done / Update / Date badlo |

## Rules everyone follows

- Times are stored as ISO UTC strings; shown to users in IST.
- No time given → 10:00 AM IST.
- Staff may not move a due date more than 25 days ahead (Batch 1: reject with a warning; approval flow is Batch 2).
- All bot text is Hinglish (Roman script).
- Reply ids are namespaced `<flowId>:<...>` so stale taps from old lists can be detected.
