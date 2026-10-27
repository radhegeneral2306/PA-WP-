// Interakt signs each webhook with the "Secret key" set next to the webhook URL:
//   Interakt-Signature: sha256=<hex HMAC-SHA256 of the raw request body>

export async function interaktSignature(secretKey: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return "sha256=" + Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyInteraktSignature(
  secretKey: string,
  rawBody: string,
  header: string | null,
): Promise<boolean> {
  if (!header) return false;
  const expected = await interaktSignature(secretKey, rawBody);
  return safeEqual(header.trim().toLowerCase(), expected);
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
