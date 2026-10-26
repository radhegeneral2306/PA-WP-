import { cleanEnv, type Env } from "./env";
import { parseWebhook, type IncomingMessage } from "./interakt/parse";
import { createIfAbsent, type FirestoreConfig } from "./firebase/firestore";
import { handleBatch0 } from "./batch0";
import { safeEqual, verifyInteraktSignature } from "./interakt/signature";
import { statusReport } from "./status";
import { mask, testNumbers } from "./numbers";

export default {
  async fetch(request: Request, rawEnv: Env, ctx: ExecutionContext): Promise<Response> {
    const env = cleanEnv(rawEnv);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("pa-wp-bot ok");
    }
    const match = url.pathname.match(/^\/webhook\/([^/]+)(\/status)?$/);
    if (!match || !env.WEBHOOK_SECRET || !safeEqual(match[1], env.WEBHOOK_SECRET)) {
      console.warn("Rejected request: unknown path or wrong webhook secret", request.method, url.pathname.slice(0, 12));
      return new Response("Not found", { status: 404 });
    }
    if (match[2]) {
      if (request.method !== "GET") return new Response("Not found", { status: 404 });
      return Response.json(await statusReport(env), { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method !== "POST") return new Response("Not found", { status: 404 });

    const rawBody = await request.text();
    if (
      env.INTERAKT_WEBHOOK_KEY &&
      !(await verifyInteraktSignature(env.INTERAKT_WEBHOOK_KEY, rawBody, request.headers.get("Interakt-Signature")))
    ) {
      console.warn("Rejected webhook with missing or invalid Interakt-Signature");
      return new Response("Invalid signature", { status: 401 });
    }
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
  if (parsed.kind === "ignored") {
    console.log("Webhook event ignored:", parsed.type);
    return;
  }
  const msg = parsed.message;
  console.log("Message received", { from: mask(msg.phone), type: msg.contentType, text: msg.text.slice(0, 40) });

  if (env.INTERAKT_ORG_ID && msg.organizationId !== env.INTERAKT_ORG_ID) {
    console.warn("Ignoring webhook from unknown organization", msg.organizationId);
    return;
  }
  // The business number also serves customers; only test numbers talk to the bot.
  if (!testNumbers(env).has(msg.phone)) {
    console.log("Not a test number, no reply:", mask(msg.phone));
    return;
  }

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
