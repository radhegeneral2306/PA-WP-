import { describe, expect, it } from "vitest";
import { extractForm, parseWebhook } from "../src/interakt/parse";
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

describe("WhatsApp Form submissions", () => {
  const answers = { flow_token: "tok-1", title: "Sharma ji payment", assignee: "919000000011", due: "2026-10-28" };
  const nfm = { type: "nfm_reply", nfm_reply: { response_json: JSON.stringify(answers), body: "Sent", name: "flow" } };

  function expectForm(body: unknown, expected: Record<string, unknown> = answers) {
    const m = message(body);
    expect(m.form).toEqual(expected);
    expect(m.reply).toBeNull();
    expect(m.text).toBe("");
    return m;
  }

  it("reads Meta's standard interactive nfm_reply", () => {
    expectForm(textWebhook({ type: "interactive", interactive: nfm }, { message_content_type: "Interactive" }));
  });

  it("reads the same payload sent as a JSON string", () => {
    expectForm(textWebhook(JSON.stringify({ type: "interactive", interactive: nfm })));
  });

  it("reads nfm_reply at the top of the message content", () => {
    expectForm(textWebhook(nfm));
    expectForm(textWebhook(JSON.stringify(nfm)));
  });

  it("reads response_json given as an object", () => {
    expectForm(textWebhook({ interactive: { type: "nfm_reply", nfm_reply: { response_json: answers, body: "Sent" } } }));
  });

  it("reads nfm_reply given as a JSON string", () => {
    expectForm(textWebhook({ interactive: { type: "nfm_reply", nfm_reply: JSON.stringify({ response_json: JSON.stringify(answers) }) } }));
  });

  it("reads a flow_response inside the message content (object or JSON string)", () => {
    expectForm(textWebhook({ flow_response: answers }));
    expectForm(textWebhook({ flow_response: JSON.stringify(answers) }));
    expectForm(textWebhook({ flow_response: { response_json: JSON.stringify(answers) } }));
  });

  it("reads flow_response next to the message (data.message.flow_response)", () => {
    expectForm(textWebhook("Sent", { flow_response: answers }));
    expectForm(textWebhook(null, { flow_response: JSON.stringify(answers) }));
  });

  it("reads flow_response at data.flow_response", () => {
    const body: any = textWebhook("Sent");
    body.data.flow_response = JSON.stringify(answers);
    expectForm(body);
  });

  it("accepts an explicit flow_response whose answers lack the flow token", () => {
    const { flow_token: _drop, ...noToken } = answers;
    expectForm(textWebhook("Sent", { flow_response: noToken }), noToken);
  });

  it("reads a bare decoded answers object carrying flow_token", () => {
    expectForm(textWebhook(answers));
    expectForm(textWebhook(JSON.stringify(answers)));
  });

  describe("never treats ordinary messages as forms", () => {
    it.each([
      ["plain text", "Hi"],
      ["text starting with a brace", "{not json"],
      ["JSON text without form keys", '{"hello":"world"}'],
      ["list reply", { type: "list_reply", list_reply: { id: "MENU:my_tasks", title: "Mere tasks" } }],
      ["button reply", { interactive: { type: "button_reply", button_reply: { id: "X", title: "Y" } } }],
      ["template quick reply", { type: "button", button: { payload: "Approvals dekhein", text: "Approvals dekhein" } }],
      ["media (no content)", null],
      ["media caption", "photo caption"],
    ])("%s", (_label, content) => {
      const m = message(textWebhook(content, { media_url: content == null ? "https://example.invalid/m.jpg" : null }));
      expect(m.form).toBeNull();
    });

    it("keeps reply and text behaviour for a list reply", () => {
      const m = message(textWebhook({ type: "list_reply", list_reply: { id: "BRANCH_DURG", title: "Durg" } }));
      expect(m).toMatchObject({ form: null, text: "Durg", reply: { kind: "list", id: "BRANCH_DURG", title: "Durg" } });
    });

    it("ignores empty or null flow_response fields on ordinary messages", () => {
      for (const fr of [null, "", "{}", {}, { a: null, b: "" }]) {
        const m = message(textWebhook("Hi", { flow_response: fr }));
        expect(m.form).toBeNull();
        expect(m.text).toBe("Hi");
      }
    });
  });

  it.each([
    ["not valid JSON", "{broken"],
    ["a JSON array", JSON.stringify([answers])],
    ["a plain string", "hello"],
    ["an array object", [answers]],
    ["null", null],
  ])("returns null when response_json is %s", (_label, response_json) => {
    expect(extractForm({ interactive: { type: "nfm_reply", nfm_reply: { response_json, body: "Sent" } } })).toBeNull();
  });

  it("returns null for an nfm_reply without answers", () => {
    expect(extractForm({ interactive: { type: "nfm_reply", nfm_reply: { body: "Sent", name: "flow" } } })).toBeNull();
    expect(extractForm({ nfm_reply: null })).toBeNull();
    const m = message(textWebhook({ interactive: { type: "nfm_reply", nfm_reply: { body: "Sent" } } }));
    expect(m.form).toBeNull();
  });

  it("does not take a non-string flow_token as a bare answers object", () => {
    expect(extractForm({ flow_token: 5, title: "x" })).toBeNull();
  });
});
