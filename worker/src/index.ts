import type { Env } from "./env";
import { parseWebhook, type IncomingMessage } from "./interakt/parse";
import { createIfAbsent, type FirestoreConfig } from "./firebase/firestore";
import { handleBatch0 } from "./batch0";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("pa-wp-bot ok");
    }

    const match = url.pathname.match(/^\/webhook\/([^/]+)$/);
    if (request.method !== "POST" || !match || !env.WEBHOOK_SECRET || !safeEqual(match[1], env.WEBHOOK_SECRET)) {
      return new Response("Not found", { status: 404 });
    }

    const rawBody = await request.text();
    if (env.SHEET_FORWARD_URL) ctx.waitUntil(forwardToSheet(env.SHEET_FORWARD_URL, rawBody));

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    // Reply 200 straight away; Interakt retries slow or failed deliveries.
    ctx.waitUntil(processWebhook(env, body, rawBody));
    return new Response("ok");
  },
};

export async function processWebhook(env: Env, body: unknown, rawBody: string): Promise<void> {
  const parsed = parseWebhook(body);
  if (parsed.kind === "ignored") return;
  const msg = parsed.message;

  if (env.INTERAKT_ORG_ID && msg.organizationId !== env.INTERAKT_ORG_ID) {
    console.warn("Ignoring webhook from unknown organization", msg.organizationId);
    return;
  }
  // The business number also serves customers; only test numbers talk to the bot.
  if (!testNumbers(env).has(msg.phone)) return;

  if (!(await isFirstDelivery(env, msg, rawBody))) {
    console.log("Duplicate webhook skipped", msg.messageId);
    return;
  }
  await handleBatch0(env.INTERAKT_API_KEY, msg);
}

/** Logs the raw webhook to Firestore; false means this message id was already handled. */
async function isFirstDelivery(env: Env, msg: IncomingMessage, rawBody: string): Promise<boolean> {
  if (!msg.messageId) return true;
  const cfg: FirestoreConfig = {
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
  };
  try {
    return await createIfAbsent(cfg, "webhook_log", msg.messageId, {
      phone: msg.phone,
      contentType: msg.contentType,
      text: msg.text,
      replyId: msg.reply?.id ?? null,
      receivedAt: msg.receivedAt,
      loggedAt: new Date(),
      raw: rawBody,
    });
  } catch (err) {
    // Firebase down or not set up yet: still answer, at the risk of a rare double reply.
    console.error("Webhook log failed", err);
    return true;
  }
}

export function testNumbers(env: Env): Set<string> {
  return new Set(
    (env.TEST_NUMBERS ?? "")
      .split(",")
      .map((n) => n.replace(/\D/g, ""))
      .filter(Boolean),
  );
}

async function forwardToSheet(sheetUrl: string, rawBody: string): Promise<void> {
  try {
    // Apps Script runs doPost before answering with a 302, so the redirect needn't be followed.
    await fetch(sheetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
      redirect: "manual",
    });
  } catch (err) {
    console.error("Sheet forward failed", err);
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
