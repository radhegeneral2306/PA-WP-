export interface Env {
  WEBHOOK_SECRET: string;
  INTERAKT_API_KEY: string;
  INTERAKT_WEBHOOK_KEY?: string;
  INTERAKT_ORG_ID?: string;
  TEST_NUMBERS?: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
  SHEET_FORWARD_URL?: string;
}

/** Pasted dashboard values often carry a stray space or newline; strip them once. */
export function cleanEnv(env: Env): Env {
  const out: Record<string, unknown> = { ...env };
  for (const [k, v] of Object.entries(out)) if (typeof v === "string") out[k] = v.trim();
  return out as unknown as Env;
}
