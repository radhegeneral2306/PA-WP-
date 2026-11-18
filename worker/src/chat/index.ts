// STUB (coordinator): agent A replaces the body, keeps the signature.
import type { Env } from "../env";
import type { ChatService } from "./types";

export function createChatService(_env: Env): ChatService {
  return { understand: async () => ({ ok: false, reason: "not_configured", detail: "stub" }) };
}
