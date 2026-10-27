// Builds the VoiceService from env (Groq transcription + Gemini understanding). Placeholder.
import type { Env } from "../env";
import type { VoiceService } from "./types";

export function createVoiceService(_env: Env): VoiceService {
  return { understand: async () => ({ ok: false, reason: "not_configured" }) };
}
