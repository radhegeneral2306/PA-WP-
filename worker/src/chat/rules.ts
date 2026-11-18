// STUB (coordinator): agent B replaces the body, keeps the signature.
import type { Role } from "../domain/types";
import type { ChatPerson, ChatRequest } from "./types";

export function ruleRequest(_text: string, _ctx: { role: Role; self: string; people: ChatPerson[]; now: Date }): ChatRequest | null {
  return null;
}
