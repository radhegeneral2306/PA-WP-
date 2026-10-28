import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/env";
import { createVoiceService } from "../../src/voice";

const env = {
  INTERAKT_API_KEY: "test-interakt-key",
  GROQ_API_KEY: "test-groq-key",
  GEMINI_API_KEY: "test-gemini-key",
} as unknown as Env;
const ctx = { now: new Date("2026-10-27T05:00:00Z"), people: [{ name: "Pinky", label: "Raipur" }] };
const MEDIA = "https://media.example.com/v/1.ogg?sig=abc";

const draft = {
  transcript: "Pinky ko bolo kal shaam paanch baje Sharma ji ka payment ka follow up lena hai",
  title: "Sharma ji ka payment ka follow up lena hai",
  person: "Pinky",
  personHeard: "Pinky",
  date: "2026-10-28",
  time: "17:00",
  repeat: null,
};

function stubAll(over: { media?: () => Response; groq?: () => Response; gemini?: () => Response } = {}) {
  const fn = vi.fn(async (url: string, _init: RequestInit) => {
    if (url.startsWith("https://media.example.com/")) return (over.media ?? (() => new Response(new Uint8Array([1, 2]))))();
    if (url.startsWith("https://api.groq.com/"))
      return (over.groq ?? (() => Response.json({ text: "पिंकी को बोलो कल शाम पांच बजे", duration: 7.5 })))();
    if (url.startsWith("https://generativelanguage.googleapis.com/"))
      return (over.gemini ?? (() => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(draft) }] } }] })))();
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("createVoiceService", () => {
  it("runs download -> Groq -> Gemini and returns the draft with Groq's duration", async () => {
    const f = stubAll();
    const r = await createVoiceService(env).understand(MEDIA, ctx);
    expect(r).toEqual({ ok: true, draft, durationSec: 7.5 });
    expect(f.mock.calls.map((c) => new URL(c[0]).host)).toEqual([
      "media.example.com",
      "api.groq.com",
      "generativelanguage.googleapis.com",
    ]);
    // Groq's (Devanagari) transcript is what Gemini gets to understand.
    const gem = JSON.parse(String(f.mock.calls[2][1].body));
    expect(gem.contents[0].parts[0].text).toContain("पिंकी को बोलो");
  });

  it("stops at the first failing step", async () => {
    let f = stubAll({ media: () => new Response("x", { status: 404 }) });
    expect(await createVoiceService(env).understand(MEDIA, ctx)).toMatchObject({ ok: false, reason: "download" });
    expect(f).toHaveBeenCalledTimes(1);

    f = stubAll({ groq: () => new Response("{}", { status: 429 }) });
    expect(await createVoiceService(env).understand(MEDIA, ctx)).toMatchObject({ ok: false, reason: "limit" });
    expect(f).toHaveBeenCalledTimes(2);

    f = stubAll({ groq: () => Response.json({ text: "x", duration: 75 }) });
    expect(await createVoiceService(env).understand(MEDIA, ctx)).toMatchObject({ ok: false, reason: "too_long" });
    expect(f).toHaveBeenCalledTimes(2);

    f = stubAll({ gemini: () => Response.json({ error: { status: "RESOURCE_EXHAUSTED" } }, { status: 429 }) });
    expect(await createVoiceService(env).understand(MEDIA, ctx)).toMatchObject({ ok: false, reason: "limit" });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("refuses when the time budget is used up before a step", async () => {
    stubAll();
    let t = 0;
    const clock = () => (t += 13_000); // each read moves the clock a lot
    const r = await createVoiceService(env, clock).understand(MEDIA, ctx);
    expect(r).toMatchObject({ ok: false, reason: "failed", detail: "voice time budget used up" });
  });

  it("not_configured without keys or with VOICE=off, and no fetch at all", async () => {
    const f = stubAll();
    const variants: Partial<Env>[] = [
      { GROQ_API_KEY: undefined },
      { GEMINI_API_KEY: "" },
      { GROQ_API_KEY: undefined, GEMINI_API_KEY: undefined },
      { VOICE: "off" },
      { VOICE: " OFF " },
    ];
    for (const v of variants) {
      const r = await createVoiceService({ ...env, ...v } as Env).understand(MEDIA, ctx);
      expect(r).toMatchObject({ ok: false, reason: "not_configured" });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("never puts keys or the media query string in failure details", async () => {
    stubAll({ media: () => new Response("x", { status: 500 }) });
    const r = await createVoiceService(env).understand(MEDIA, ctx);
    const detail = r.ok ? "" : (r.detail ?? "");
    expect(detail).not.toContain("sig=abc");
    expect(detail).not.toContain("test-");
  });
});
