// Builds the VoiceService from env: download (Interakt) -> transcribe (Groq) -> understand (Gemini).
// The audio only lives in memory for this one call; nothing is stored.
import type { Env } from "../env";
import { understandTranscript } from "./gemini";
import { transcribe } from "./groq";
import { downloadMedia } from "./media";
import type { VoicePerson, VoiceResult, VoiceService } from "./types";

/** Whole pipeline budget, and the most any one step may take of what is left. */
export const VOICE_BUDGET_MS = 25_000;
export const STEP_MAX_MS = { download: 8_000, groq: 12_000, gemini: 12_000 } as const;
/** Below this there is no point starting another network call. */
const MIN_STEP_MS = 1_000;

export function createVoiceService(env: Env, clock: () => number = Date.now): VoiceService {
  const groqKey = env.GROQ_API_KEY?.trim();
  const geminiKey = env.GEMINI_API_KEY?.trim();
  const off = (env.VOICE ?? "").trim().toLowerCase() === "off";
  if (off || !groqKey || !geminiKey) {
    const detail = off ? "VOICE=off" : "voice keys missing";
    return { understand: async () => ({ ok: false, reason: "not_configured", detail }) };
  }

  return {
    async understand(mediaUrl: string, ctx: { now: Date; people: VoicePerson[] }): Promise<VoiceResult> {
      const deadline = clock() + VOICE_BUDGET_MS;
      const budget = (max: number) => Math.min(max, deadline - clock());
      try {
        const media = await downloadMedia(mediaUrl, env.INTERAKT_API_KEY, { timeoutMs: budget(STEP_MAX_MS.download) });
        if (!media.ok) return { ok: false, reason: media.reason, detail: media.detail };

        let ms = budget(STEP_MAX_MS.groq);
        if (ms < MIN_STEP_MS) return { ok: false, reason: "failed", detail: "voice time budget used up" };
        const heard = await transcribe(media, { apiKey: groqKey, model: env.GROQ_MODEL, people: ctx.people, timeoutMs: ms });
        if (!heard.ok) return { ok: false, reason: heard.reason, detail: heard.detail };

        ms = budget(STEP_MAX_MS.gemini);
        if (ms < MIN_STEP_MS) return { ok: false, reason: "failed", detail: "voice time budget used up" };
        const got = await understandTranscript(heard.text, ctx, {
          apiKey: geminiKey,
          model: env.GEMINI_MODEL,
          timeoutMs: ms,
        });
        if (!got.ok) return { ok: false, reason: got.reason, detail: got.detail };
        return { ok: true, draft: got.draft, durationSec: heard.durationSec };
      } catch {
        return { ok: false, reason: "failed", detail: "voice unexpected error" };
      }
    },
  };
}
