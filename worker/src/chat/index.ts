// Builds the ChatService from env: one Gemini call per typed message (free tier).
import type { Env } from "../env";
import { understandText } from "./understand";
import type { ChatContext, ChatResult, ChatService } from "./types";

/** Whole understand budget (the models inside it get at most 9 s each). */
export const CHAT_BUDGET_MS = 20_000;

export function createChatService(env: Env): ChatService {
  const e = env as unknown as Record<string, string | undefined>;
  const geminiKey = e.GEMINI_API_KEY?.trim();
  const off = (e.CHAT ?? "").trim().toLowerCase() === "off";
  if (off || !geminiKey) {
    const detail = off ? "CHAT=off" : "GEMINI_API_KEY missing";
    return { understand: async () => ({ ok: false, reason: "not_configured", detail }) };
  }
  return {
    async understand(text: string, ctx: ChatContext): Promise<ChatResult> {
      try {
        return await understandText(text, ctx, { apiKey: geminiKey, model: e.GEMINI_MODEL, timeoutMs: CHAT_BUDGET_MS });
      } catch {
        return { ok: false, reason: "failed", detail: "chat unexpected error" };
      }
    },
  };
}
