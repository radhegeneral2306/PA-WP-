import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLOW_TEMPLATES, TEMPLATE_PARAMS, type TemplateName } from "../src/bot/outgoing";
import { deliver } from "../src/interakt/deliver";
import { templatePayload } from "../src/interakt/templates";

const to = { countryCode: "+91", phoneNumber: "9999999999" };

describe("templatePayload for form (flow) templates", () => {
  it.each(["task_form_admin_v1", "task_form_staff_v1"] as const)("%s carries the flow token on button 0", (name) => {
    expect(templatePayload(to, name, [], "form:abc")).toEqual({
      ...to,
      type: "Template",
      template: {
        name,
        languageCode: "en",
        bodyValues: [],
        is_flow_template: true,
        buttonPayload: { "0": ["flow_token"] },
        buttonValues: { "0": ["form:abc"] },
      },
    });
  });

  it("defaults the flow token to \"unused\" when none (or an empty one) is given", () => {
    expect(templatePayload(to, "task_form_admin_v1", []).template).toMatchObject({ buttonValues: { "0": ["unused"] } });
    expect(templatePayload(to, "task_form_staff_v1", [], "").template).toMatchObject({ buttonValues: { "0": ["unused"] } });
  });

  it("still enforces zero body values", () => {
    expect(() => templatePayload(to, "task_form_admin_v1", ["x"])).toThrow(/needs 0/);
  });

  it("only the form templates are flow templates", () => {
    expect([...FLOW_TEMPLATES].sort()).toEqual(["task_form_admin_v1", "task_form_admin_v2", "task_form_staff_v1"]);
  });
});

describe("templatePayload for ordinary templates", () => {
  const ordinary = (Object.keys(TEMPLATE_PARAMS) as TemplateName[]).filter((n) => !FLOW_TEMPLATES.has(n));

  it.each(ordinary)("%s has no flow fields, even if a token is passed", (name) => {
    const values = TEMPLATE_PARAMS[name].map((_, i) => `v${i}`);
    const p = templatePayload(to, name, values, "form:abc");
    expect(Object.keys(p.template).sort()).toEqual(["bodyValues", "languageCode", "name"]);
  });
});

describe("deliver with a form template", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const sent = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("passes the Outgoing flowToken through to Interakt", async () => {
    const ok = await deliver("key", {
      to: "919999999999",
      kind: "template",
      template: "task_form_staff_v1",
      bodyValues: [],
      fallbackText: "Form abhi available nahi",
      flowToken: "form:xyz",
    });
    expect(ok).toBe(true);
    expect(sent()[0].template).toMatchObject({ is_flow_template: true, buttonValues: { "0": ["form:xyz"] } });
  });

  it("falls back to text when the form template is rejected", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    await deliver("key", { to: "919999999999", kind: "template", template: "task_form_admin_v1", bodyValues: [], fallbackText: "Fallback" });
    const calls = sent();
    expect(calls).toHaveLength(2);
    expect(calls[1].type).toBe("Text");
    expect(JSON.stringify(calls[1])).toContain("Fallback");
  });
});
