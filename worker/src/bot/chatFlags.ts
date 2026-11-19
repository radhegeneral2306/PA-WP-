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
 * Round 7 (docs/ROUND7-CONTRACT.md). Both stay false until the owner's test is done; the testers above get them now.
 * DETAIL: typed text on an open task detail is a chat about that task (the Update button still saves a remark).
 * MEMORY: the chat remembers what it showed (chat_ctx, 15 min): follow-ups, numbered lists, task questions.
 */
export const CHAT_DETAIL_LIVE = false;
export const CHAT_MEMORY_LIVE = false;

export function canUseChatDetail(user: User): boolean {
  return CHAT_DETAIL_LIVE || CHAT_TESTERS.has(user.name);
}

export function canUseChatMemory(user: User): boolean {
  return CHAT_MEMORY_LIVE || CHAT_TESTERS.has(user.name);
}
