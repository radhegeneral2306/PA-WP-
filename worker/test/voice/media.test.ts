import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadMedia, MAX_MEDIA_BYTES, safeUrl, TOO_LONG_MEDIA_BYTES } from "../../src/voice/media";

const URL_WITH_TOKEN = "https://media.interakt.ai/files/abc123.ogg?token=SECRET-TOKEN";
const OTHER_HOST_URL = "https://media.example.com/files/abc123.ogg?token=SECRET-TOKEN";

function stub(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => handler(url, init));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("downloadMedia", () => {
  it("downloads plainly without auth when the URL is public", async () => {
    const f = stub(() => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/ogg; codecs=opus" } }));
    const r = await downloadMedia(URL_WITH_TOKEN, "test-key", { timeoutMs: 1000 });
    expect(r).toMatchObject({ ok: true, contentType: "audio/ogg; codecs=opus", filename: "voice.ogg" });
    if (r.ok) expect([...r.bytes]).toEqual([1, 2, 3]);
    expect(f).toHaveBeenCalledTimes(1);
    const init = f.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBeNull();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries once with Interakt Basic auth on 401/403", async () => {
    for (const status of [401, 403]) {
      const f = stub((_u, init) =>
        new Headers(init.headers).get("authorization") ? new Response(new Uint8Array([9])) : new Response("no", { status }),
      );
      const r = await downloadMedia(URL_WITH_TOKEN, "test-key", { timeoutMs: 1000 });
      expect(r.ok).toBe(true);
      expect(f).toHaveBeenCalledTimes(2);
      expect(new Headers((f.mock.calls[1][1] as RequestInit).headers).get("authorization")).toBe("Basic test-key");
    }
  });

  it("gives up after the single auth retry, without leaking the query string", async () => {
    const f = stub(() => new Response("no", { status: 403 }));
    const r = await downloadMedia(URL_WITH_TOKEN, "test-key", { timeoutMs: 1000 });
    expect(r).toMatchObject({ ok: false, reason: "download" });
    expect(f).toHaveBeenCalledTimes(2);
    if (!r.ok) {
      expect(r.detail).toContain("403");
      expect(r.detail).not.toContain("SECRET-TOKEN");
    }
  });

  it("never sends the Interakt key to a non-Interakt host", async () => {
    const f = stub(() => new Response("no", { status: 401 }));
    const r = await downloadMedia(OTHER_HOST_URL, "test-key", { timeoutMs: 1000 });
    expect(r).toMatchObject({ ok: false, reason: "download" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(new Headers((f.mock.calls[0][1] as RequestInit).headers).get("authorization")).toBeNull();
  });

  it("does not retry other errors", async () => {
    const f = stub(() => new Response("gone", { status: 404 }));
    const r = await downloadMedia(URL_WITH_TOKEN, "test-key", { timeoutMs: 1000 });
    expect(r).toMatchObject({ ok: false, reason: "download" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("refuses non-https and malformed URLs without fetching", async () => {
    const f = stub(() => new Response("x"));
    expect(await downloadMedia("http://media.example.com/a.ogg", "k", { timeoutMs: 1000 })).toMatchObject({ ok: false, reason: "download" });
    expect(await downloadMedia("not a url", "k", { timeoutMs: 1000 })).toMatchObject({ ok: false, reason: "download" });
    expect(f).not.toHaveBeenCalled();
  });

  it("treats a large Content-Length as too_long without reading", async () => {
    stub(() => new Response("x", { headers: { "content-length": String(TOO_LONG_MEDIA_BYTES + 1) } }));
    expect(await downloadMedia(URL_WITH_TOKEN, "k", { timeoutMs: 1000 })).toMatchObject({ ok: false, reason: "too_long" });
  });

  it("caps the streamed size (over 2.5 MB = too_long, over 5 MB stops reading)", async () => {
    stub(() => new Response(new Uint8Array(TOO_LONG_MEDIA_BYTES + 10)));
    expect(await downloadMedia(URL_WITH_TOKEN, "k", { timeoutMs: 1000 })).toMatchObject({ ok: false, reason: "too_long" });

    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        if (pulled > 20) c.close();
        else c.enqueue(chunk);
      },
    });
    stub(() => new Response(stream));
    const r = await downloadMedia(URL_WITH_TOKEN, "k", { timeoutMs: 1000 });
    expect(r).toMatchObject({ ok: false, reason: "too_long", detail: "media over 5 MB" });
    expect(pulled).toBeLessThanOrEqual(MAX_MEDIA_BYTES / chunk.byteLength + 2);
  });

  it("falls back to the URL extension, then Ogg/Opus, for the content type", async () => {
    stub(() => new Response(new Uint8Array([1]), { headers: { "content-type": "application/octet-stream" } }));
    let r = await downloadMedia("https://m.example.com/v.mp3?x=1", "k", { timeoutMs: 1000 });
    expect(r).toMatchObject({ ok: true, contentType: "audio/mpeg", filename: "voice.mp3" });
    r = await downloadMedia("https://m.example.com/media/12345", "k", { timeoutMs: 1000 });
    expect(r).toMatchObject({ ok: true, contentType: "audio/ogg; codecs=opus", filename: "voice.ogg" });
  });

  it("reports network errors and timeouts as download failures", async () => {
    stub(() => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    });
    expect(await downloadMedia(URL_WITH_TOKEN, "k", { timeoutMs: 1000 })).toMatchObject({
      ok: false,
      reason: "download",
      detail: "media timeout from media.interakt.ai/files/abc123.ogg",
    });
  });

  it("safeUrl drops the query string", () => {
    expect(safeUrl(URL_WITH_TOKEN)).toBe("media.interakt.ai/files/abc123.ogg");
  });
});
