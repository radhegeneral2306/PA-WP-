import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { processWebhook } from "../src/index";
import type { Env } from "../src/env";
import { textWebhook } from "./fixtures";
import { interaktSignature } from "../src/interakt/signature";

const env: Env = {
  WEBHOOK_SECRET: "s3cret",
  INTERAKT_API_KEY: "key",
  INTERAKT_ORG_ID: "org-test",
  TEST_NUMBERS: "+91 99999 99999, 917777777777",
  FIREBASE_PROJECT_ID: "proj",
  FIREBASE_CLIENT_EMAIL: "bot@proj.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: "unused",
};

// Skip Google auth: pretend the Firestore log write succeeded unless a test overrides it.
vi.mock("../src/firebase/firestore", () => ({
  createIfAbsent: vi.fn(async () => true),
  checkAccess: vi.fn(async () => undefined),
}));

let calls: { url: string; body: any }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response("{}", { status: 200 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const interaktCalls = () => calls.filter((c) => c.url.includes("interakt"));

describe("fetch handler", () => {
  const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

  it("returns 404 for a wrong secret", async () => {
    const res = await worker.fetch(new Request("https://x/webhook/nope", { method: "POST", body: "{}" }), env, ctx);
    expect(res.status).toBe(404);
  });

  it("accepts the right secret", async () => {
    const res = await worker.fetch(
      new Request("https://x/webhook/s3cret", { method: "POST", body: JSON.stringify({ type: "ping" }) }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it("checks Interakt-Signature when a webhook key is set", async () => {
    const signed = { ...env, INTERAKT_WEBHOOK_KEY: "interakt-key" };
    const body = JSON.stringify({ type: "ping" });
    const post = (sig?: string) =>
      worker.fetch(
        new Request("https://x/webhook/s3cret", {
          method: "POST",
          body,
          headers: sig ? { "Interakt-Signature": sig } : {},
        }),
        signed,
        ctx,
      );

    expect((await post()).status).toBe(401);
    expect((await post("sha256=" + "0".repeat(64))).status).toBe(401);
    expect((await post(await interaktSignature("interakt-key", body))).status).toBe(200);
  });

  it("reports settings presence on the status page without leaking values", async () => {
    const res = await worker.fetch(new Request("https://x/webhook/s3cret/status"), env, ctx);
    const json = (await res.json()) as any;
    expect(json.settings.INTERAKT_API_KEY).toBe(true);
    expect(json.settings.SHEET_FORWARD_URL).toBe(false);
    expect(json.testNumbers).toEqual([
      { number: "***9999", digits: 12 },
      { number: "***7777", digits: 12 },
    ]);
    expect(JSON.stringify(json)).not.toContain("919999999999");
    expect((await worker.fetch(new Request("https://x/webhook/nope/status"), env, ctx)).status).toBe(404);
  });

  it("answers health checks", async () => {
    const res = await worker.fetch(new Request("https://x/"), env, ctx);
    expect(await res.text()).toBe("pa-wp-bot ok");
  });
});

describe("processWebhook", () => {
  it("sends the list and the buttons for Hi from a test number", async () => {
    await processWebhook(env, textWebhook("Hi"), "{}");
    expect(interaktCalls().map((c) => c.body.type)).toEqual(["InteractiveList", "InteractiveButton"]);
    expect(interaktCalls()[0].body.phoneNumber).toBe("9999999999");
  });

  it("stays silent for numbers outside TEST_NUMBERS", async () => {
    const body = textWebhook("Hi");
    body.data.customer.channel_phone_number = "915555555555";
    await processWebhook(env, body, "{}");
    expect(interaktCalls()).toHaveLength(0);
  });

  it("ignores other organizations", async () => {
    const body = textWebhook("Hi");
    body.data.organization_id = "someone-else";
    await processWebhook(env, body, "{}");
    expect(interaktCalls()).toHaveLength(0);
  });

  it("skips duplicate deliveries", async () => {
    const { createIfAbsent } = await import("../src/firebase/firestore");
    vi.mocked(createIfAbsent).mockResolvedValueOnce(false);
    await processWebhook(env, textWebhook("Hi"), "{}");
    expect(interaktCalls()).toHaveLength(0);
  });

  it("echoes a list reply", async () => {
    await processWebhook(env, textWebhook({ type: "list_reply", list_reply: { id: "BRANCH_DURG", title: "Durg" } }), "{}");
    expect(interaktCalls()[0].body.data.message).toContain("Durg");
  });
});
