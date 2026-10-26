import { describe, expect, it } from "vitest";
import { parseWebhook } from "../src/interakt/parse";
import { textWebhook } from "./fixtures";

function message(body: unknown) {
  const parsed = parseWebhook(body);
  if (parsed.kind !== "message") throw new Error(`expected message, got ${parsed.type}`);
  return parsed.message;
}

describe("parseWebhook", () => {
  it("parses a plain text message", () => {
    const m = message(textWebhook(" Hi "));
    expect(m).toMatchObject({
      messageId: "06adcad7-2dc5-77a5-8000-30e895d9dee9",
      phone: "919999999999",
      countryCode: "+91",
      phoneNumber: "9999999999",
      name: "Test Admin",
      contentType: "Text",
      text: "Hi",
      reply: null,
      organizationId: "org-test",
    });
  });

  it("builds the full phone from country code when channel_phone_number is missing", () => {
    const body = textWebhook();
    delete (body.data.customer as Record<string, unknown>).channel_phone_number;
    expect(message(body).phone).toBe("919999999999");
  });

  it.each(["ping", "Webhook Test", "message_api_sent"])("ignores %s events", (type) => {
    expect(parseWebhook({ type })).toEqual({ kind: "ignored", type });
  });

  it("ignores non-objects", () => {
    expect(parseWebhook(null).kind).toBe("ignored");
  });

  it("reads a list reply object", () => {
    const m = message(
      textWebhook({ type: "list_reply", list_reply: { id: "BRANCH_DURG", title: "Durg" } }, {
        message_content_type: "InteractiveListReply",
      }),
    );
    expect(m.reply).toEqual({ kind: "list", id: "BRANCH_DURG", title: "Durg" });
    expect(m.text).toBe("Durg");
  });

  it("reads a button reply sent as a JSON string", () => {
    const m = message(textWebhook(JSON.stringify({ type: "button_reply", button_reply: { id: "TEST_APPROVE", title: "Approve" } })));
    expect(m.reply).toEqual({ kind: "button", id: "TEST_APPROVE", title: "Approve" });
  });

  it("reads replies nested under interactive", () => {
    const m = message(textWebhook({ interactive: { type: "list_reply", list_reply: { id: "X", title: "Y" } } }));
    expect(m.reply).toEqual({ kind: "list", id: "X", title: "Y" });
  });

  it("reads template quick-reply buttons", () => {
    const m = message(textWebhook({ type: "button", button: { payload: "DONE_1", text: "Done" } }));
    expect(m.reply).toEqual({ kind: "button", id: "DONE_1", title: "Done" });
  });

  it("keeps text that merely starts with a brace", () => {
    expect(message(textWebhook("{not json")).text).toBe("{not json");
  });
});
