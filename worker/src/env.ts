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
  /** "off" disables the 10 AM daily summary. */
  DAILY_SUMMARY?: string;
  /** Shared dashboard login (Secrets). The password must be at least 12 characters. */
  DASHBOARD_USER?: string;
  DASHBOARD_PASSWORD?: string;
  /** Comma-separated origins allowed to call /api (the Cloudflare Pages URL). */
  DASHBOARD_ORIGINS?: string;
  /** Batch 4 voice notes (Secrets). Missing keys = voice replies "abhi band hai". */
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  /** Optional model overrides (defaults live in src/voice). */
  GROQ_MODEL?: string;
  GEMINI_MODEL?: string;
  /** "off" switches voice task creation off without a deploy. */
  VOICE?: string;
}

/** Pasted dashboard values often carry a stray space or newline; strip them once. */
export function cleanEnv(env: Env): Env {
  const out: Record<string, unknown> = { ...env };
  for (const [k, v] of Object.entries(out)) if (typeof v === "string") out[k] = v.trim();
  return out as unknown as Env;
}
