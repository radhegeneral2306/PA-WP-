// End to end: an Interakt webhook carrying a WhatsApp Form submission reaches handleTaskForm,
// and the webhook_log dedup (by message id) stops a redelivery from being handled twice.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processWebhook } from "../src/index";
import type { Env } from "../src/env";
import { MemoryStore } from "../src/data/memoryStore";
import { textWebhook } from "./fixtures";

const env: Env = {
  WEBHOOK_SECRET: "s3cret",
  INTERAKT_API_KEY: "key",
  INTERAKT_ORG_ID: "org-test",
  TEST_NUMBERS: "919999999999",
  FIREBASE_PROJECT_ID: "proj",
  FIREBASE_CLIENT_EMAIL: "bot@proj.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: "unused",
};

// A stand-in for Firestore's create-if-absent: remembers which message ids were logged.
const logged = new Set<string>();
vi.mock("../src/firebase/firestore", () => ({
  createIfAbsent: vi.fn(async (_cfg: unknown, _col: string, id: string) => {
    if (logged.has(id)) return false;
    logged.add(id);
    return true;
  }),
  checkAccess: vi.fn(async () => undefined),
}));

vi.mock("../src/bot/flows/createTaskForm", () => ({
  taskFormFlow: { id: "task_form", start: vi.fn(async () => []), handle: vi.fn(async () => []) },
  handleTaskForm: vi.fn(async (ctx: any) => [{ to: ctx.user.phone, kind: "text", body: "Task ban gaya (form)" }]),
}));

import { handleTaskForm } from "../src/bot/flows/createTaskForm";

const admin = { phone: "919999999999", name: "Test Admin", role: "admin" as const, branch: null, active: true, createdAt: "2026-10-01T00:00:00.000Z" };
const answers = { flow_token: "task_form_admin", title: "Stock check", assignee: "919999999999" };

function formWebhook(id = "wamid-form-1") {
  return textWebhook(
    { type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { response_json: JSON.stringify(answers), body: "Sent", name: "flow" } } },
    { id, message_content_type: "Interactive" },
  );
}

let calls: { url: string; body: any }[];

beforeEach(() => {
  logged.clear();
  vi.mocked(handleTaskForm).mockClear();
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response("{}", { status: 200 });
    }),
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const interaktCalls = () => calls.filter((c) => c.url.includes("interakt"));

describe("processWebhook with a form submission", () => {
  it("hands an nfm_reply from a registered user to handleTaskForm and delivers its reply", async () => {
    const store = new MemoryStore({ users: [admin] });
    await store.saveSession({ phone: admin.phone, flow: "create_task", step: "ask_title", data: {}, updatedAt: "2026-10-26T09:29:00.000Z" });
    await processWebhook(env, formWebhook(), "{}", { store, now: new Date("2026-10-26T09:30:00Z") });

    expect(handleTaskForm).toHaveBeenCalledTimes(1);
    const [ctx, form] = vi.mocked(handleTaskForm).mock.calls[0];
    expect(ctx.user.phone).toBe(admin.phone);
    expect(form).toEqual(answers);
    expect(await store.getSession(admin.phone)).toBeNull();
    expect(interaktCalls()).toHaveLength(1);
    expect(JSON.stringify(interaktCalls()[0].body)).toContain("Task ban gaya (form)");
  });

  it("handles the same submission only once when Interakt redelivers it", async () => {
    const store = new MemoryStore({ users: [admin] });
    await processWebhook(env, formWebhook("wamid-dup"), "{}", { store });
    await processWebhook(env, formWebhook("wamid-dup"), "{}", { store });
    expect(handleTaskForm).toHaveBeenCalledTimes(1);
    expect(interaktCalls()).toHaveLength(1);

    // A different submission (new message id) is handled.
    await processWebhook(env, formWebhook("wamid-other"), "{}", { store });
    expect(handleTaskForm).toHaveBeenCalledTimes(2);
  });

  it("stays silent for unregistered numbers", async () => {
    await processWebhook(env, formWebhook(), "{}", { store: new MemoryStore() });
    expect(handleTaskForm).not.toHaveBeenCalled();
    expect(interaktCalls()).toHaveLength(0);
  });
});
