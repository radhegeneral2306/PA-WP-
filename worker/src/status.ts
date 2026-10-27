// GET /webhook/<secret>/status: shows which settings are present (never their
// values) and whether Firebase answers, so setup problems can be found without
// digging through logs.

import type { Env } from "./env";
import { checkAccess } from "./firebase/firestore";
import { mask, testNumbers } from "./numbers";

export const BUILD = "voice1c";

export async function statusReport(env: Env) {
  const has = (v: string | undefined) => Boolean(v && v.trim());
  return {
    build: BUILD,
    settings: {
      WEBHOOK_SECRET: has(env.WEBHOOK_SECRET),
      INTERAKT_API_KEY: has(env.INTERAKT_API_KEY),
      INTERAKT_WEBHOOK_KEY: has(env.INTERAKT_WEBHOOK_KEY),
      INTERAKT_ORG_ID: has(env.INTERAKT_ORG_ID),
      TEST_NUMBERS: has(env.TEST_NUMBERS),
      FIREBASE_PROJECT_ID: has(env.FIREBASE_PROJECT_ID),
      FIREBASE_CLIENT_EMAIL: has(env.FIREBASE_CLIENT_EMAIL),
      FIREBASE_PRIVATE_KEY: has(env.FIREBASE_PRIVATE_KEY),
      SHEET_FORWARD_URL: has(env.SHEET_FORWARD_URL),
      DASHBOARD_USER: has(env.DASHBOARD_USER),
      DASHBOARD_PASSWORD: has(env.DASHBOARD_PASSWORD),
      DASHBOARD_PASSWORD_LONG_ENOUGH: (env.DASHBOARD_PASSWORD ?? "").length >= 12,
      DASHBOARD_ORIGINS: has(env.DASHBOARD_ORIGINS),
      GROQ_API_KEY: has(env.GROQ_API_KEY),
      GEMINI_API_KEY: has(env.GEMINI_API_KEY),
      VOICE_OFF: env.VOICE === "off",
    },
    testNumbers: [...testNumbers(env)].map((n) => ({ number: mask(n), digits: n.length })),
    interaktApiKey: interaktKeyShape(env.INTERAKT_API_KEY),
    firebase: await firebaseCheck(env),
  };
}

// Interakt's key is base64 of "<key>:" and goes straight into Basic auth.
function interaktKeyShape(key: string | undefined): string {
  if (!key?.trim()) return "missing";
  if (/\s/.test(key)) return "has spaces inside; paste it again";
  try {
    return atob(key).endsWith(":") ? "looks right" : "decodes, but not the usual Interakt format";
  } catch {
    return "not base64; copy the key exactly as Interakt shows it";
  }
}

async function firebaseCheck(env: Env): Promise<string> {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return "settings missing";
  try {
    await checkAccess(
      { projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY },
      "webhook_log",
    );
    return "ok";
  } catch (err) {
    return `error: ${String(err instanceof Error ? err.message : err).slice(0, 300)}`;
  }
}
