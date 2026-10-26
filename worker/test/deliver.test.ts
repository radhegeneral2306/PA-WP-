import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Outgoing } from "../src/bot/outgoing";
import { deliver, deliverAll, recipientFromPhone } from "../src/interakt/deliver";
import { sanitizeParam, templatePayload } from "../src/interakt/templates";

const KEY = "test-key";
const PHONE = "919999999999";
const to = { countryCode: "+91", phoneNumber: "9999999999" };

let fetchMock: ReturnType<typeof vi.fn>;

function sent(): any[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

function respondWith(...statuses: number[]) {
  for (const s of statuses) fetchMock.mockResolvedValueOnce(new Response("{}", { status: s }));
}

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const assigned: Outgoing = {
  to: PHONE,
  kind: "template",
  template: "task_assigned_v1",
  bodyValues: ["Chikku", "Bhaskar", "Stock check", "27 Oct, 10:00 AM", "27 Oct, 10:00 AM"],
  fallbackText: "Naya task: Stock check",
};

describe("recipientFromPhone", () => {
  it("splits 12-digit Indian numbers", () => {
    expect(recipientFromPhone("919999999999")).toEqual(to);
  });

  it("treats 10 digits as +91", () => {
    expect(recipientFromPhone("9999999999")).toEqual(to);
  });

  it("ignores formatting characters", () => {
    expect(recipientFromPhone("+91 99999-99999")).toEqual(to);
  });

  it("handles other country codes", () => {
    expect(recipientFromPhone("14155550123")).toEqual({ countryCode: "+1", phoneNumber: "4155550123" });
  });

  it("rejects numbers that are too short", () => {
    expect(() => recipientFromPhone("12345")).toThrow();
  });
});

describe("templatePayload", () => {
  it("builds the Interakt template body", () => {
    expect(templatePayload(to, "welcome_user_v1", ["Chikku", "Bhaskar", "Staff"])).toEqual({
      countryCode: "+91",
      phoneNumber: "9999999999",
      type: "Template",
      template: { name: "welcome_user_v1", languageCode: "en", bodyValues: ["Chikku", "Bhaskar", "Staff"] },
    });
  });

  it("rejects a wrong number of body values", () => {
    expect(() => templatePayload(to, "welcome_user_v1", ["Chikku"])).toThrow(/needs 3/);
  });

  it("sanitizes values", () => {
    const p = templatePayload(to, "welcome_user_v1", ["Line 1\nLine 2", "a\t\tb      c", "  "]);
    expect(p.template.bodyValues).toEqual(["Line 1 | Line 2", "a b c", "-"]);
  });
});

describe("sanitizeParam", () => {
  it("collapses newline runs and strips edge separators", () => {
    expect(sanitizeParam("\nA\r\n\r\nB\n")).toBe("A | B");
    expect(sanitizeParam("")).toBe("-");
    expect(sanitizeParam("ok")).toBe("ok");
  });
});

describe("deliver", () => {
  it("sends text", async () => {
    expect(await deliver(KEY, { to: PHONE, kind: "text", body: "Namaste" })).toBe(true);
    expect(sent()).toEqual([{ ...to, type: "Text", data: { message: "Namaste" } }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.interakt.ai/v1/public/message/");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Basic ${KEY}` });
  });

  it("sends a list without leaking to/kind into the payload", async () => {
    await deliver(KEY, {
      to: PHONE,
      kind: "list",
      body: "Chuniye",
      button: "Menu",
      sectionTitle: "Options",
      rows: [{ id: "m:1", title: "Mere tasks" }],
    });
    const [p] = sent();
    expect(p).toMatchObject({ ...to, type: "InteractiveList" });
    expect(p.data.message.action.sections[0].rows).toEqual([{ id: "m:1", title: "Mere tasks" }]);
    expect(p.data.message.body).toEqual({ text: "Chuniye" });
  });

  it("sends buttons", async () => {
    await deliver(KEY, { to: PHONE, kind: "buttons", body: "Ok?", buttons: [{ id: "y", title: "Haan" }] });
    const [p] = sent();
    expect(p.type).toBe("InteractiveButton");
    expect(p.data.message.action.buttons).toEqual([{ type: "reply", reply: { id: "y", title: "Haan" } }]);
  });

  it("sends a template", async () => {
    expect(await deliver(KEY, assigned)).toBe(true);
    const [p] = sent();
    expect(p).toEqual({
      ...to,
      type: "Template",
      template: { name: "task_assigned_v1", languageCode: "en", bodyValues: (assigned as any).bodyValues },
    });
  });

  it("falls back to text when the template send fails", async () => {
    respondWith(400, 200);
    expect(await deliver(KEY, assigned)).toBe(true);
    const calls = sent();
    expect(calls).toHaveLength(2);
    expect(calls[0].type).toBe("Template");
    expect(calls[1]).toEqual({ ...to, type: "Text", data: { message: "Naya task: Stock check" } });
  });

  it("returns false when both template and fallback fail", async () => {
    respondWith(400, 500);
    expect(await deliver(KEY, assigned)).toBe(false);
  });

  it("uses the fallback text when the param count is wrong", async () => {
    const bad = { ...assigned, bodyValues: ["only one"] } as Outgoing;
    expect(await deliver(KEY, bad)).toBe(true);
    expect(sent()).toEqual([{ ...to, type: "Text", data: { message: "Naya task: Stock check" } }]);
    expect(console.error).toHaveBeenCalled();
  });

  it("returns false instead of throwing on invalid messages", async () => {
    expect(await deliver(KEY, { to: PHONE, kind: "buttons", body: "b", buttons: [] })).toBe(false);
    expect(await deliver(KEY, { to: "123", kind: "text", body: "x" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns false when fetch itself throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect(await deliver(KEY, { to: PHONE, kind: "text", body: "x" })).toBe(false);
  });

  it("returns false on a non-2xx text send", async () => {
    respondWith(401);
    expect(await deliver(KEY, { to: PHONE, kind: "text", body: "x" })).toBe(false);
  });
});

describe("deliverAll", () => {
  it("sends in order and continues after a failure", async () => {
    respondWith(500, 200, 200);
    await deliverAll(KEY, [
      { to: PHONE, kind: "text", body: "one" },
      { to: PHONE, kind: "buttons", body: "bad", buttons: [] },
      { to: PHONE, kind: "text", body: "two" },
      { to: "9888888888", kind: "text", body: "three" },
    ]);
    const calls = sent();
    expect(calls.map((c) => c.data.message)).toEqual(["one", "two", "three"]);
    expect(calls[2].phoneNumber).toBe("9888888888");
  });

  it("waits for each send before starting the next", async () => {
    const order: string[] = [];
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const msg = JSON.parse(init.body as string).data.message;
      order.push(`start ${msg}`);
      await new Promise((r) => setTimeout(r, msg === "a" ? 20 : 0));
      order.push(`end ${msg}`);
      return new Response("{}", { status: 200 });
    });
    await deliverAll(KEY, [
      { to: PHONE, kind: "text", body: "a" },
      { to: PHONE, kind: "text", body: "b" },
    ]);
    expect(order).toEqual(["start a", "end a", "start b", "end b"]);
  });
});
