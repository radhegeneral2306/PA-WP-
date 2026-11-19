// Switches of the chat features and who may use them. Lives in its own file so flows (tasks.ts) can read
// them without importing the router. router.ts re-exports everything here, so existing imports keep working.

import type { User } from "../domain/types";

/** Round 5: typed free text that nothing else recognised goes to the chat (rules, then AI). Admins and staff. */
export const CHAT_LIVE = true;
export const CHAT_TESTERS: ReadonlySet<string> = new Set(["Bhaskar"]);

export function canUseChat(user: User): boolean {
  return CHAT_LIVE || CHAT_TESTERS.has(user.name);
}

/**
 * Round 7 (docs/ROUND7-CONTRACT.md). Opened to everyone on 19 Nov after the owner's test. They must always be
 * flipped together: detail routing without memory could not answer "iski due date".
 * DETAIL: typed text on an open task detail is a chat about that task (the Update button still saves a remark).
 * MEMORY: the chat remembers what it showed (chat_ctx, 15 min): follow-ups, numbered lists, task questions.
 */
export const CHAT_DETAIL_LIVE = true;
export const CHAT_MEMORY_LIVE = true;

// The effective values. Production never changes them; tests switch them (the older tests describe the
// switches-off behaviour, see test/setup.ts) through setChatFlagsForTest.
let state = { detail: CHAT_DETAIL_LIVE, memory: CHAT_MEMORY_LIVE };

export function setChatFlagsForTest(over: Partial<typeof state>): void {
  state = { ...state, ...over };
}

export function resetChatFlagsForTest(): void {
  state = { detail: CHAT_DETAIL_LIVE, memory: CHAT_MEMORY_LIVE };
}

export function canUseChatDetail(user: User): boolean {
  return state.detail || CHAT_TESTERS.has(user.name);
}

export function canUseChatMemory(user: User): boolean {
  return state.memory || CHAT_TESTERS.has(user.name);
}
