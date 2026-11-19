// Round 7, Agent B: turning "doosra wala", "isko", "last wala" into a task id, using only the chat memory.
// The AI and the rules never produce task ids; code resolves references against what was really shown.
import { CHAT_MEMORY_MIN, type ChatFilter, type ChatMemory, type ChatRef, type FilterChanges } from "./types";

export type RefResult = { ok: true; taskId: string } | { ok: false; reason: "no_memory" | "expired" | "out_of_range" | "none_selected" };

/** True only when the memory exists and its last activity is less than CHAT_MEMORY_MIN minutes old. */
export function memoryFresh(memory: ChatMemory | null | undefined, now: Date): boolean {
  if (!memory) return false;
  const at = Date.parse(memory.at);
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at < CHAT_MEMORY_MIN * 60_000;
}

/** The task a reference means, from the memory, only if it is still fresh (CHAT_MEMORY_MIN). */
export function resolveRef(memory: ChatMemory | null, ref: ChatRef, now: Date): RefResult {
  if (!memory) return { ok: false, reason: "no_memory" };
  if (!memoryFresh(memory, now)) return { ok: false, reason: "expired" };
  const shown = Array.isArray(memory.shown) ? memory.shown : [];
  if (ref.by === "selected") {
    return memory.sel ? { ok: true, taskId: memory.sel } : { ok: false, reason: "none_selected" };
  }
  if (ref.by === "last") {
    const id = shown[shown.length - 1];
    return id ? { ok: true, taskId: id } : { ok: false, reason: "out_of_range" };
  }
  const n = ref.n;
  if (!Number.isInteger(n) || n < 1 || n > shown.length) return { ok: false, reason: "out_of_range" };
  const id = shown[n - 1];
  return id ? { ok: true, taskId: id } : { ok: false, reason: "out_of_range" };
}

/** The last query with the changes applied (missing keys keep the old value). */
export function refineFilter(previous: ChatFilter, changes: FilterChanges): ChatFilter {
  let scope = changes.scope ?? previous.scope;
  let person = previous.person ?? null;
  let branch = previous.branch ?? null;

  if (changes.person !== undefined && changes.person !== null) {
    person = changes.person;
    branch = null;
    scope = "person";
  } else if (changes.branch !== undefined && changes.branch !== null) {
    branch = changes.branch;
    person = null;
    scope = "branch";
  } else if (changes.scope !== undefined) {
    // An explicit scope keeps only the matching extra; mine / all drop both.
    if (scope !== "person") person = null;
    if (scope !== "branch") branch = null;
  }

  const out: ChatFilter = {
    scope,
    when: changes.when ?? previous.when,
  };
  if (scope === "person" && person) out.person = person;
  if (scope === "branch" && branch) out.branch = branch;
  const urgent = changes.urgentOnly ?? previous.urgentOnly;
  if (urgent) out.urgentOnly = true;
  return out;
}
