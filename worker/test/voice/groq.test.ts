import { afterEach, describe, expect, it, vi } from "vitest";
import { GROQ_URL, transcribe, whisperPrompt } from "../../src/voice/groq";

const people = [
  { name: "Pinky", label: "Raipur" },
  { name: "Gopeshwari", label: "Rajim" },
  { name: "Bhaskar", label: "Admin" },
];
const audio = { bytes: new Uint8Array([1, 2, 3]), contentType: "audio/ogg; codecs=opus", filename: "voice.ogg" };
const opts = { apiKey: "test-key", people, timeoutMs: 1000 };

function stub(res: () => Response) {
  const fn = vi.fn(async (_url: string, _init: RequestInit) => res());
  vi.stubGlobal("fetch", fn);
  return fn;
}
const ok = (body: object) => () => Response.json(body);

afterEach(() => vi.unstubAllGlobals());

describe("Groq transcription", () => {
  it("sends the expected multipart request", async () => {
    const f = stub(ok({ text: "Pinky ko bolo kal follow up", duration: 4.2 }));
    const r = await transcribe(audio, opts);
    expect(r).toEqual({ ok: true, text: "Pinky ko bolo kal follow up", durationSec: 4.2 });

    const [url, init] = f.mock.calls[0];
    expect(url).toBe(GROQ_URL);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-key");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model")).toBe("whisper-large-v3");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.get("temperature")).toBe("0");
    expect(form.has("language")).toBe(false);
    const prompt = String(form.get("prompt"));
    for (const p of people) expect(prompt).toContain(p.name);
    const file = form.get("file") as File;
    expect(file.name).toBe("voice.ogg");
    expect(file.type).toContain("audio/ogg");
    expect(file.size).toBe(3);
  });

  it("uses GROQ_MODEL when given", async () => {
    const f = stub(ok({ text: "hi", duration: 1 }));
    await transcribe(audio, { ...opts, model: "whisper-large-v3-turbo" });
    expect((f.mock.calls[0][1].body as FormData).get("model")).toBe("whisper-large-v3-turbo");
  });

  it("maps 429 to limit and other errors to failed with the status", async () => {
    stub(() => new Response("{}", { status: 429 }));
    expect(await transcribe(audio, opts)).toMatchObject({ ok: false, reason: "limit" });
    stub(() => Response.json({ error: { code: "invalid_api_key", message: "bad key test-key" } }, { status: 401 }));
    const r = await transcribe(audio, opts);
    expect(r).toMatchObject({ ok: false, reason: "failed", detail: "groq 401 invalid_api_key" });
  });

  it("refuses notes longer than 60 seconds", async () => {
    stub(ok({ text: "lamba", duration: 61.5 }));
    expect(await transcribe(audio, opts)).toMatchObject({ ok: false, reason: "too_long" });
    stub(ok({ text: "theek", duration: 60 }));
    expect(await transcribe(audio, opts)).toMatchObject({ ok: true, durationSec: 60 });
  });

  it("passes a Devanagari transcript through unchanged", async () => {
    const hindi = "पिंकी को बोलो कल शाम पांच बजे शर्मा जी का पेमेंट फॉलो अप लेना है";
    stub(ok({ text: ` ${hindi} `, duration: 5 }));
    expect(await transcribe(audio, opts)).toEqual({ ok: true, text: hindi, durationSec: 5 });
  });

  it("empty or punctuation-only transcript is not_understood", async () => {
    stub(ok({ text: " ... ", duration: 2 }));
    expect(await transcribe(audio, opts)).toMatchObject({ ok: false, reason: "not_understood" });
    stub(ok({ duration: 2 }));
    expect(await transcribe(audio, opts)).toMatchObject({ ok: false, reason: "not_understood" });
  });

  it("missing duration is reported as null", async () => {
    stub(ok({ text: "hello" }));
    expect(await transcribe(audio, opts)).toEqual({ ok: true, text: "hello", durationSec: null });
  });

  it("whisper prompt stays short even with many names", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ name: `Staffname${i}`, label: "X" }));
    expect(whisperPrompt(many).length).toBeLessThanOrEqual(600);
  });
});
