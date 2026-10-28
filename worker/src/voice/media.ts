// Downloads a WhatsApp voice note from Interakt's `media_url`, in memory only (never stored).
// Interakt's docs don't say whether the URL needs auth: try plain GET first, and on 401/403
// retry once with the same Basic key the bot uses for Interakt's send API.

/** Hard cap while reading: anything bigger is refused without reading further. */
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
/** A 60 s Opus voice note is ~100-300 KB; anything above this is far too long to be one. */
export const TOO_LONG_MEDIA_BYTES = 2.5 * 1024 * 1024;

export type MediaResult =
  | { ok: true; bytes: Uint8Array; contentType: string; filename: string }
  | { ok: false; reason: "download" | "too_long"; detail: string };

const EXT_TYPES: Record<string, string> = {
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  mp3: "audio/mpeg",
  mpeg: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  amr: "audio/amr",
  wav: "audio/wav",
  webm: "audio/webm",
  flac: "audio/flac",
};

const TYPE_EXT: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "application/ogg": "ogg",
  "video/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/flac": "flac",
};

/** WhatsApp voice notes are Ogg/Opus; used when neither header nor URL tells us. */
const DEFAULT_TYPE = "audio/ogg; codecs=opus";

/** Host + path only, for logs: the query string may carry access tokens. */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return "(bad url)";
  }
}

function typeFromUrl(url: URL): string | null {
  const m = /\.([a-z0-9]{2,5})$/i.exec(url.pathname);
  return m ? EXT_TYPES[m[1].toLowerCase()] ?? null : null;
}

/** Header type when it is a real audio type, else by URL extension, else Ogg/Opus. */
export function resolveContentType(header: string | null, url: URL): string {
  const h = (header ?? "").trim();
  const base = h.split(";")[0].trim().toLowerCase();
  if (base && TYPE_EXT[base]) return h;
  if (base.startsWith("audio/")) return h;
  return typeFromUrl(url) ?? DEFAULT_TYPE;
}

export function filenameFor(contentType: string): string {
  const base = contentType.split(";")[0].trim().toLowerCase();
  return `voice.${TYPE_EXT[base] ?? "ogg"}`;
}

async function readCapped(res: Response): Promise<Uint8Array | "too_big"> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > MAX_MEDIA_BYTES ? "too_big" : buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MEDIA_BYTES) {
      await reader.cancel().catch(() => {});
      return "too_big";
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export async function downloadMedia(
  mediaUrl: string,
  apiKey: string | undefined,
  opts: { timeoutMs: number },
): Promise<MediaResult> {
  let url: URL;
  try {
    url = new URL(mediaUrl);
  } catch {
    return { ok: false, reason: "download", detail: "bad media url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "download", detail: "media url not https" };
  const where = safeUrl(mediaUrl);
  const signal = AbortSignal.timeout(opts.timeoutMs);

  try {
    let res = await fetch(url.toString(), { method: "GET", signal });
    // Send the Interakt key only to Interakt's own hosts, never to an unknown media host.
    if ((res.status === 401 || res.status === 403) && apiKey && isInteraktHost(url.hostname)) {
      await res.body?.cancel().catch(() => {});
      res = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: `Basic ${apiKey}` },
        signal,
      });
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: "download", detail: `media ${res.status} from ${where}` };
    }
    const len = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(len) && len > TOO_LONG_MEDIA_BYTES) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: "too_long", detail: `media ${len} bytes` };
    }
    const bytes = await readCapped(res);
    if (bytes === "too_big") return { ok: false, reason: "too_long", detail: "media over 5 MB" };
    if (bytes.byteLength > TOO_LONG_MEDIA_BYTES) {
      return { ok: false, reason: "too_long", detail: `media ${bytes.byteLength} bytes` };
    }
    if (bytes.byteLength === 0) return { ok: false, reason: "download", detail: "media empty" };
    const contentType = resolveContentType(res.headers.get("content-type"), url);
    return { ok: true, bytes, contentType, filename: filenameFor(contentType) };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    const what = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network error";
    return { ok: false, reason: "download", detail: `media ${what} from ${where}` };
  }
}

/** interakt.ai / interakt.shop and their subdomains. */
export function isInteraktHost(host: string): boolean {
  const h = host.toLowerCase();
  return ["interakt.ai", "interakt.shop"].some((d) => h === d || h.endsWith(`.${d}`));
}
