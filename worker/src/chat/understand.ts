// STUB (coordinator): agent A replaces the body, keeps the signature.
import type { ChatContext, ChatResult } from "./types";

export async function understandText(_text: string, _ctx: ChatContext, _opts: { apiKey: string; model?: string; timeoutMs: number }): Promise<ChatResult> {
  return { ok: false, reason: "not_configured", detail: "stub" };
}
