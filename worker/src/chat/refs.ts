// STUB (coordinator): agent B replaces the bodies, keeps the signatures.
import type { ChatFilter, ChatMemory, ChatRef, FilterChanges } from "./types";

export type RefResult = { ok: true; taskId: string } | { ok: false; reason: "no_memory" | "expired" | "out_of_range" | "none_selected" };

/** The task a reference means, from the memory, only if it is still fresh (CHAT_MEMORY_MIN). */
export function resolveRef(_memory: ChatMemory | null, _ref: ChatRef, _now: Date): RefResult {
  return { ok: false, reason: "no_memory" };
}

/** The last query with the changes applied (missing keys keep the old value). */
export function refineFilter(previous: ChatFilter, changes: FilterChanges): ChatFilter {
  return { ...previous, ...changes } as ChatFilter;
}
