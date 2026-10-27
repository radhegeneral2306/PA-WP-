import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { DAILY_CRON, processWebhook, runCron } from "../src/index";
import type { Env } from "../src/env";
import { textWebhook } from "./fixtures";
import { interaktSignature } from "../src/interakt/signature";
import { MemoryStore } from "../src/data/memoryStore";

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

  it("tolerates a stray newline around the configured secret", async () => {
    const res = await worker.fetch(
      new Request("https://x/webhook/s3cret", { method: "POST", body: JSON.stringify({ type: "ping" }) }),
      { ...env, WEBHOOK_SECRET: " s3cret\n" },
      ctx,
    );
    expect(res.status).toBe(200);
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

  it("routes /api to the dashboard API without touching the webhook", async () => {
    const res = await worker.fetch(new Request("https://x/api/me"), env, ctx);
    expect(res.status).toBe(401);
    const login = await worker.fetch(
      new Request("https://x/api/login", { method: "POST", body: JSON.stringify({ user: "a", password: "b" }) }),
      env,
      ctx,
    );
    expect(login.status).toBe(503); // dashboard login not configured in this env
  });

  it("answers health checks", async () => {
    const res = await worker.fetch(new Request("https://x/"), env, ctx);
    expect(await res.text()).toBe("pa-wp-bot ok");
  });
});

describe("processWebhook", () => {
  // Fixture sender 919999999999 registered as an admin.
  const admin = { phone: "919999999999", name: "Test Admin", role: "admin" as const, branch: null, active: true, createdAt: "2026-10-01T00:00:00.000Z" };
  const deps = () => ({ store: new MemoryStore({ users: [admin] }), now: new Date("2026-10-26T09:30:00Z") });

  it("answers Hi from a registered user with the main menu", async () => {
    await processWebhook(env, textWebhook("Hi"), "{}", deps());
    expect(interaktCalls()).toHaveLength(1);
    expect(interaktCalls()[0].body.type).toBe("InteractiveList");
    expect(interaktCalls()[0].body.phoneNumber).toBe("9999999999");
    expect(JSON.stringify(interaktCalls()[0].body)).toContain("MENU:manage_staff");
  });

  it("stays silent for unregistered or removed numbers", async () => {
    await processWebhook(env, textWebhook("Hi"), "{}", { store: new MemoryStore() });
    await processWebhook(env, textWebhook("Hi"), "{}", { store: new MemoryStore({ users: [{ ...admin, active: false }] }) });
    expect(interaktCalls()).toHaveLength(0);
  });

  it("stays silent for numbers outside TEST_NUMBERS when that list is set", async () => {
    const body = textWebhook("Hi");
    body.data.customer.channel_phone_number = "915555555555";
    await processWebhook(env, body, "{}", { store: new MemoryStore({ users: [{ ...admin, phone: "915555555555" }] }) });
    expect(interaktCalls()).toHaveLength(0);
  });

  it("ignores other organizations", async () => {
    const body = textWebhook("Hi");
    body.data.organization_id = "someone-else";
    await processWebhook(env, body, "{}", deps());
    expect(interaktCalls()).toHaveLength(0);
  });

  it("skips duplicate deliveries", async () => {
    const { createIfAbsent } = await import("../src/firebase/firestore");
    vi.mocked(createIfAbsent).mockResolvedValueOnce(false);
    await processWebhook(env, textWebhook("Hi"), "{}", deps());
    expect(interaktCalls()).toHaveLength(0);
  });

  it("starts a flow from a menu tap", async () => {
    const d = deps();
    await processWebhook(env, textWebhook({ type: "list_reply", list_reply: { id: "MENU:create_task", title: "Naya task" } }), "{}", d);
    expect(interaktCalls()).toHaveLength(1);
    expect(await d.store.getSession(admin.phone)).toMatchObject({ flow: "create_task" });
  });
});

describe("TEST_NUMBERS outgoing guard", () => {
  it("does not message assignees outside TEST_NUMBERS", async () => {
    const admin = { phone: "919999999999", name: "Test Admin", role: "admin" as const, branch: null, active: true, createdAt: "2026-10-01T00:00:00.000Z" };
    const dummy = { phone: "910000000011", name: "Dummy", role: "staff" as const, branch: "DURG" as const, active: true, createdAt: "2026-10-01T00:00:00.000Z" };
    const store = new MemoryStore({ users: [admin, dummy] });
    await store.saveSession({
      phone: admin.phone,
      flow: "create_task",
      step: "confirm",
      data: {
        assigneePhone: dummy.phone, assigneeName: dummy.name, assigneeBranch: "DURG", assigneeRole: "staff",
        title: "Test", dueAt: "2026-10-27T04:30:00.000Z", dueHasTime: "false",
      },
      updatedAt: "2026-10-26T09:29:00.000Z",
    });
    await processWebhook(env, textWebhook({ type: "button_reply", button_reply: { id: "create_task:confirm:yes", title: "Haan" } }), "{}", {
      store,
      now: new Date("2026-10-26T09:30:00Z"),
    });
    expect(interaktCalls().map((c) => c.body.phoneNumber)).toEqual(["9999999999"]);
  });
});

describe("users endpoint", () => {
  it("rejects bad input", async () => {
    const { handleUsersEndpoint } = await import("../src/admin");
    const store = new MemoryStore();
    const put = (body: unknown) =>
      handleUsersEndpoint(new Request("https://x/", { method: "PUT", body: JSON.stringify(body) }), store, new Date());
    expect((await put({})).status).toBe(400);
    expect((await put([{ phone: "123", name: "A", role: "staff", branch: "DURG" }])).status).toBe(400);
    expect((await put([{ phone: "9000000011", name: "A", role: "staff" }])).status).toBe(400);
    expect((await put([{ phone: "9000000011", name: "A", role: "staff", branch: "PUNE" }])).status).toBe(400);
    expect(store.users.size).toBe(0);
  });

  it("accepts the Hardware and Office branches", async () => {
    const { handleUsersEndpoint } = await import("../src/admin");
    const store = new MemoryStore();
    const res = await handleUsersEndpoint(
      new Request("https://x/", {
        method: "PUT",
        body: JSON.stringify([
          { phone: "0000000501", name: "Hw", role: "staff", branch: "hardware" },
          { phone: "0000000502", name: "Of", role: "staff", branch: "OFFICE" },
        ]),
      }),
      store,
      new Date(),
    );
    expect(res.status).toBe(200);
    expect((await store.getUser("910000000501"))?.branch).toBe("HARDWARE");
    expect((await store.getUser("910000000502"))?.branch).toBe("OFFICE");
  });

  it("can deactivate users and carries renames over to their tasks", async () => {
    const { handleUsersEndpoint } = await import("../src/admin");
    const created = "2026-10-01T00:00:00.000Z";
    const store = new MemoryStore({
      users: [
        { phone: "919000000011", name: "Hardware", role: "staff", branch: "DURG", active: true, createdAt: created },
        { phone: "910000000201", name: "Dummy", role: "staff", branch: "DURG", active: true, createdAt: created },
      ],
    });
    const t = await store.createTask({
      title: "x", assigneePhone: "919000000011", assigneeName: "Hardware", branch: "DURG", createdByPhone: "919000000001",
      createdByName: "Bhaskar", dueAt: created, dueHasTime: false, status: "pending", repeat: "none", nextReminderAt: null,
      remarks: [], createdAt: created, updatedAt: created, doneAt: null,
    });
    const res = await handleUsersEndpoint(
      new Request("https://x/", {
        method: "PUT",
        body: JSON.stringify([
          { phone: "9000000011", name: "Ofc Hardware", role: "staff", branch: "DURG" },
          { phone: "0000000201", name: "Dummy", role: "staff", branch: "DURG", active: false },
        ]),
      }),
      store,
      new Date(),
    );
    expect(await res.json()).toEqual({ saved: 2, tasksUpdated: 1 });
    expect((await store.getUser("910000000201"))?.active).toBe(false);
    expect((await store.getTask(t.id))?.assigneeName).toBe("Ofc Hardware");
    expect((await store.getUser("919000000011"))?.createdAt).toBe(created);
  });

  it("sends welcome templates to active users only", async () => {
    const { handleUsersEndpoint } = await import("../src/admin");
    const created = "2026-10-01T00:00:00.000Z";
    const store = new MemoryStore({
      users: [
        { phone: "919000000011", name: "Roshni", role: "staff", branch: "HARDWARE", active: true, createdAt: created },
        { phone: "919000000012", name: "Gone", role: "staff", branch: "DURG", active: false, createdAt: created },
      ],
    });
    const sent: any[] = [];
    const post = (body: unknown) =>
      handleUsersEndpoint(
        new Request("https://x/", { method: "POST", body: JSON.stringify(body) }),
        store,
        new Date(),
        async (outs) => void sent.push(...outs),
        true,
      );
    expect((await post({ phones: ["9000000011"] })).status).toBe(400);
    const res = await post({ phones: ["9000000011", "9000000012", "9000000099"], addedBy: "Bhaskar" });
    expect(await res.json()).toEqual({ sent: 1, skipped: ["0012", "0099"] });
    expect(sent).toEqual([expect.objectContaining({ to: "919000000011", template: "welcome_user_v1", bodyValues: ["Roshni", "Bhaskar", "Staff (Hardware)"] })]);
  });

  it("upserts users and keeps createdAt", async () => {
    const { handleUsersEndpoint } = await import("../src/admin");
    const store = new MemoryStore();
    const put = (body: unknown, now: string) =>
      handleUsersEndpoint(new Request("https://x/", { method: "PUT", body: JSON.stringify(body) }), store, new Date(now));
    await put([{ phone: "+91 90000 00011", name: "Hardware", role: "staff", branch: "durg" }], "2026-10-01T00:00:00Z");
    await put([{ phone: "9000000011", name: "Hardware 2", role: "staff", branch: "DURG" }], "2026-10-02T00:00:00Z");
    expect(await store.getUser("919000000011")).toMatchObject({
      name: "Hardware 2",
      branch: "DURG",
      active: true,
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    const res = await handleUsersEndpoint(new Request("https://x/"), store, new Date());
    expect(((await res.json()) as unknown[]).length).toBe(1);
  });
});

describe("cron", () => {
  const staff = { phone: "919999999999", name: "Hardware", role: "staff" as const, branch: "DURG" as const, active: true, createdAt: "2026-10-01T00:00:00.000Z" };
  const due = {
    title: "Payment lena", assigneePhone: staff.phone, assigneeName: staff.name, branch: "DURG" as const,
    createdByPhone: "919000000001", createdByName: "Bhaskar", dueAt: "2026-10-26T09:00:00.000Z", dueHasTime: true,
    status: "pending" as const, repeat: "none" as const, nextReminderAt: "2026-10-26T09:00:00.000Z", remarks: [],
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", doneAt: null,
  };

  it("sends due reminders as templates on the 5-minute cron", async () => {
    const store = new MemoryStore({ users: [staff] });
    const t = await store.createTask(due);
    await runCron(env, "*/5 * * * *", new Date("2026-10-26T09:30:00Z"), { store });
    expect(interaktCalls().map((c) => [c.body.type, c.body.template?.name])).toEqual([["Template", "task_reminder_v1"]]);
    expect((await store.getTask(t.id))?.nextReminderAt).toBe("2026-10-27T05:30:00.000Z");
  });

  it("sends the daily summary unless switched off", async () => {
    const store = new MemoryStore({ users: [staff] });
    await store.createTask(due);
    await runCron({ ...env, DAILY_SUMMARY: "off" }, DAILY_CRON, new Date("2026-10-26T04:30:00Z"), { store });
    expect(interaktCalls()).toHaveLength(0);
    await runCron(env, DAILY_CRON, new Date("2026-10-26T04:30:00Z"), { store });
    expect(interaktCalls().map((c) => c.body.template?.name)).toEqual(["daily_summary_v1"]);
  });

  it("daily cron: summary first, then the health check alerts admins (and never blocks the summary)", async () => {
    const admin = { phone: "917777777777", name: "Bhaskar", role: "admin" as const, branch: null, active: true, createdAt: "2026-10-01T00:00:00.000Z" };
    const store = new MemoryStore({ users: [staff, admin] });
    await store.createTask(due);
    store.lastWebhookAt = null; // no incoming message on record -> "webhook silent" problem
    await runCron(env, DAILY_CRON, new Date("2026-10-26T04:30:00Z"), { store });
    const sent = interaktCalls().map((c) => c.body.template?.name);
    expect(sent[0]).toBe("daily_summary_v1");
    expect(sent).toContain("task_assigned_v1");
    const alert = (await store.listTasks({ status: "pending" })).find((t) => t.title.startsWith("Bot check:"));
    expect(alert).toMatchObject({ assigneePhone: admin.phone, createdByName: "Bot" });
    expect((await store.getHealth())?.lastCheckAt).toBe("2026-10-26T04:30:00.000Z");
  });

  it("daily cron with a healthy bot creates no alert", async () => {
    const admin = { phone: "917777777777", name: "Bhaskar", role: "admin" as const, branch: null, active: true, createdAt: "2026-10-01T00:00:00.000Z" };
    const store = new MemoryStore({ users: [staff, admin] });
    store.lastWebhookAt = new Date("2026-10-26T03:00:00Z");
    await runCron(env, DAILY_CRON, new Date("2026-10-26T04:30:00Z"), { store });
    expect((await store.listTasks({})).filter((t) => t.title.startsWith("Bot check:"))).toEqual([]);
  });
});
