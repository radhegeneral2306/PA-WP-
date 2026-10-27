import { cleanEnv, type Env } from "./env";
import { parseWebhook, type IncomingMessage } from "./interakt/parse";
import { createIfAbsent, type FirestoreConfig } from "./firebase/firestore";
import { safeEqual, verifyInteraktSignature } from "./interakt/signature";
import { statusReport } from "./status";
import { mask, testNumbers } from "./numbers";
import { FirestoreStore } from "./data/firestoreStore";
import type { Store } from "./data/store";
import { handleMessage } from "./bot/router";
import { text } from "./bot/ui";
import type { Outgoing } from "./bot/outgoing";
import { deliverAll } from "./interakt/deliver";
import { handleUsersEndpoint } from "./admin";
import { addRoutes, handleApi } from "./dashboard/api";
import { createRoutes } from "./dashboard/routes/create";
import { readRoutes } from "./dashboard/routes/read";

addRoutes(readRoutes);
addRoutes(createRoutes);
import { runReminders } from "./scheduler/reminders";
import { runDailySummary } from "./scheduler/daily";

/** Must match the second cron in wrangler.toml (10:00 AM IST). */
export const DAILY_CRON = "30 4 * * *";

export default {
  async fetch(request: Request, rawEnv: Env, ctx: ExecutionContext): Promise<Response> {
    const env = cleanEnv(rawEnv);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("pa-wp-bot ok");
    }
    if (url.pathname.startsWith("/api/")) {
      const deliver = (outs: Outgoing[]) => deliverAll(env.INTERAKT_API_KEY, onlyAllowed(outs, testNumbers(env)));
      return handleApi(request, env, storeFor(env), new Date(), deliver);
    }
    const match = url.pathname.match(/^\/webhook\/([^/]+)(\/status|\/users|\/users\/welcome)?$/);
    if (!match || !env.WEBHOOK_SECRET || !safeEqual(match[1], env.WEBHOOK_SECRET)) {
      console.warn("Rejected request: unknown path or wrong webhook secret", request.method, url.pathname.slice(0, 12));
      return new Response("Not found", { status: 404 });
    }
    if (match[2] === "/status") {
      if (request.method !== "GET") return new Response("Not found", { status: 404 });
      return Response.json(await statusReport(env), { headers: { "Cache-Control": "no-store" } });
    }
    if (match[2] === "/users" || match[2] === "/users/welcome") {
      const deliver = (outs: Outgoing[]) => deliverAll(env.INTERAKT_API_KEY, onlyAllowed(outs, testNumbers(env)));
      return handleUsersEndpoint(request, storeFor(env), new Date(), deliver, match[2] === "/users/welcome");
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

  async scheduled(controller: ScheduledController, rawEnv: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(cleanEnv(rawEnv), controller.cron, new Date(controller.scheduledTime)));
  },
};

/** Every 5 minutes: due reminders. Daily at 10 AM IST: pending-task summary (DAILY_SUMMARY=off disables). */
export async function runCron(env: Env, cron: string, now: Date, deps: Deps = {}): Promise<void> {
  const store = deps.store ?? storeFor(env);
  try {
    let outs: Outgoing[];
    if (cron === DAILY_CRON) {
      outs = env.DAILY_SUMMARY === "off" ? [] : await runDailySummary(store, now);
    } else {
      outs = await runReminders(store, now);
    }
    if (outs.length) console.log(`Cron ${cron}: sending ${outs.length} message(s)`);
    await deliverAll(env.INTERAKT_API_KEY, onlyAllowed(outs, testNumbers(env)));
  } catch (err) {
    console.error(`Cron ${cron} failed`, err);
  }
}

export interface Deps {
  store?: Store;
  now?: Date;
}

export async function processWebhook(env: Env, body: unknown, rawBody: string, deps: Deps = {}): Promise<void> {
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
  // Optional extra gate while testing; registered users are the real gate below.
  const allow = testNumbers(env);
  if (allow.size > 0 && !allow.has(msg.phone)) {
    console.log("Not in TEST_NUMBERS, no reply:", mask(msg.phone));
    return;
  }

  // The business number also serves customers: only registered, active users talk to the bot.
  const store = deps.store ?? storeFor(env);
  const user = await store.getUser(msg.phone);
  if (!user?.active) {
    console.log("Unregistered number, no reply:", mask(msg.phone));
    return;
  }

  if (!(await isFirstDelivery(env, msg, rawBody))) {
    console.log("Duplicate webhook skipped", msg.messageId);
    return;
  }

  const ctx = { store, user, now: deps.now ?? new Date() };
  try {
    const outs = await handleMessage(ctx, { text: msg.text, reply: msg.reply });
    await deliverAll(env.INTERAKT_API_KEY, onlyAllowed(outs, allow));
  } catch (err) {
    console.error("Bot failed", err);
    await store.clearSession(user.phone).catch(() => undefined);
    await deliverAll(env.INTERAKT_API_KEY, [text(user.phone, "Maaf kijiye, kuch gadbad ho gayi 🙏 Dobara *Hi* bhejiye.")]);
  }
}

/** While TEST_NUMBERS is set, never message anyone outside it (dummy users can't reach real phones). */
function onlyAllowed(outs: Outgoing[], allow: Set<string>): Outgoing[] {
  if (allow.size === 0) return outs;
  return outs.filter((o) => {
    if (allow.has(o.to)) return true;
    console.log("Skipped message to number outside TEST_NUMBERS:", mask(o.to), o.kind);
    return false;
  });
}

function storeFor(env: Env): Store {
  return new FirestoreStore(firestoreConfig(env));
}

function firestoreConfig(env: Env): FirestoreConfig {
  return {
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
  };
}

/** Logs the raw webhook to Firestore; false means this message id was already handled. */
async function isFirstDelivery(env: Env, msg: IncomingMessage, rawBody: string): Promise<boolean> {
  if (!msg.messageId) return true;
  try {
    return await createIfAbsent(firestoreConfig(env), "webhook_log", msg.messageId, {
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
