// Speech to text via Groq's OpenAI-compatible Whisper endpoint (free tier).
// No `language` is forced: notes mix Hindi and English. Staff names go in `prompt`
// so Whisper spells them the way the staff list does.

import { MAX_VOICE_SECONDS, type VoicePerson } from "./types";

export const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
/** whisper-large-v3 is noticeably better on Hindi than the turbo variant. */
export const DEFAULT_GROQ_MODEL = "whisper-large-v3";
/** Whisper only reads ~224 tokens of prompt; keep it well under that. */
const MAX_PROMPT_CHARS = 600;

export type TranscribeResult =
  | { ok: true; text: string; durationSec: number | null }
  | { ok: false; reason: "limit" | "too_long" | "not_understood" | "failed"; detail: string };

export function whisperPrompt(people: VoicePerson[]): string {
  const head = "Task assign karna hai. Staff names: ";
  const tail = ". Kal, parso, baje, har mahine, har 90 minute, update dena.";
  const names: string[] = [];
  let len = head.length + tail.length;
  for (const p of people) {
    const n = p.name.trim();
    if (!n || names.includes(n)) continue;
    if (len + n.length + 2 > MAX_PROMPT_CHARS) break;
    names.push(n);
    len += n.length + 2;
  }
  return head + names.join(", ") + tail;
}

export async function transcribe(
  audio: { bytes: Uint8Array; contentType: string; filename: string },
  opts: { apiKey: string; model?: string; people: VoicePerson[]; timeoutMs: number },
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append("file", new Blob([audio.bytes], { type: audio.contentType }), audio.filename);
  form.append("model", opts.model || DEFAULT_GROQ_MODEL);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  form.append("prompt", whisperPrompt(opts.people));

  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    return { ok: false, reason: "failed", detail: name === "TimeoutError" ? "groq timeout" : "groq network error" };
  }

  if (res.status === 429) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, reason: "limit", detail: "groq 429" };
  }
  if (!res.ok) {
    const code = await errorCode(res);
    return { ok: false, reason: "failed", detail: `groq ${res.status}${code ? ` ${code}` : ""}` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "failed", detail: "groq bad json" };
  }
  const b = (body ?? {}) as { text?: unknown; duration?: unknown };
  const durationSec = typeof b.duration === "number" && Number.isFinite(b.duration) ? b.duration : null;
  if (durationSec !== null && durationSec > MAX_VOICE_SECONDS) {
    return { ok: false, reason: "too_long", detail: `duration ${Math.round(durationSec)}s` };
  }
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text || !/[\p{L}\p{N}]/u.test(text)) {
    return { ok: false, reason: "not_understood", detail: "empty transcript" };
  }
  return { ok: true, text, durationSec };
}

/** Short machine code from an OpenAI-style error body (never the full body). */
async function errorCode(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { code?: unknown; type?: unknown } };
    const c = j?.error?.code ?? j?.error?.type;
    return typeof c === "string" ? c.replace(/[^\w.-]/g, "").slice(0, 40) : "";
  } catch {
    return "";
  }
}
