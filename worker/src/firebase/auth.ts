// Google OAuth access token for a Firebase service account, signed with
// WebCrypto (no firebase-admin SDK in Workers). Cached per isolate.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
}

let cached: { token: string; expiresAt: number; clientEmail: string } | null = null;
/** Parallel callers share one token request (each extra fetch costs a subrequest). */
let inFlight: { clientEmail: string; promise: Promise<string> } | null = null;

export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.clientEmail === sa.clientEmail && cached.expiresAt - 60 > now) {
    return cached.token;
  }
  if (inFlight && inFlight.clientEmail === sa.clientEmail) return inFlight.promise;
  const promise = fetchToken(sa, now).finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { clientEmail: sa.clientEmail, promise };
  return promise;
}

async function fetchToken(sa: ServiceAccount, now: number): Promise<string> {
  const assertion = await signJwt(sa, now);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`Google token error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: now + json.expires_in, clientEmail: sa.clientEmail };
  return json.access_token;
}

export async function signJwt(sa: ServiceAccount, now: number): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: sa.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

function pemToDer(pem: string): ArrayBuffer {
  // Secrets pasted from the JSON key file often keep "\n" as two characters.
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der.buffer;
}

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
