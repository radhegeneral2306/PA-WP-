// Batch 4 contract: what the voice service returns to the voice-task flow.
// Audio is downloaded, transcribed (Groq) and understood (Gemini) inside the service;
// the flow only sees this result and re-checks everything against the real data.

import type { TaskRepeat } from "../domain/types";

/** What the model understood. Every field may be missing; the flow asks for what's needed. */
export interface VoiceDraft {
  /** What was heard, in Roman script (Hinglish), for "Maine suna: ...". */
  transcript: string;
  /** Task text without the person/date words, e.g. "Sharma ji ka payment follow up". */
  title: string | null;
  /** Exactly one `name` from the people list given to the service, or null if unclear. */
  person: string | null;
  /** Spoken name as heard (for "Ye naam nahi mila" messages). */
  personHeard: string | null;
  /** "YYYY-MM-DD" in IST, resolved from words like "kal" / "parso"; null if no date was said. */
  date: string | null;
  /** "HH:MM" 24h IST, or null if no time was said. */
  time: string | null;
  /** null if no repeat was said (the flow then uses "none"). */
  repeat: TaskRepeat | null;
}

export type VoiceFailure =
  | "not_configured" // keys missing or VOICE=off
  | "too_long" // more than MAX_VOICE_SECONDS
  | "limit" // free-tier quota/rate limit hit (429)
  | "download" // could not fetch the audio from Interakt
  | "not_understood" // empty transcript or nothing usable
  | "failed"; // anything else

export type VoiceResult =
  | { ok: true; draft: VoiceDraft; durationSec: number | null }
  | { ok: false; reason: VoiceFailure; /** short, no secrets/phone numbers, for logs */ detail?: string };

export interface VoicePerson {
  /** Exact user name as stored (what `person` must equal). */
  name: string;
  /** "Admin" or the branch name, to help the model. */
  label: string;
}

export interface VoiceService {
  understand(mediaUrl: string, ctx: { now: Date; people: VoicePerson[] }): Promise<VoiceResult>;
}

export const MAX_VOICE_SECONDS = 60;
