import { describe, expect, it } from "vitest";
import { buttonsPayload, listPayload, textPayload } from "../src/interakt/send";

const to = { countryCode: "+91", phoneNumber: "9999999999" };

describe("Interakt payloads", () => {
  it("builds a text message", () => {
    expect(textPayload(to, "hello")).toEqual({
      countryCode: "+91",
      phoneNumber: "9999999999",
      type: "Text",
      data: { message: "hello" },
    });
  });

  it("builds a list message and enforces WhatsApp length limits", () => {
    const p = listPayload(to, {
      body: "Pick",
      button: "A very long button label here",
      sectionTitle: "Section title longer than 24",
      rows: [{ id: "R1", title: "A title that is far too long for WhatsApp", description: "d" }],
    });
    expect(p.type).toBe("InteractiveList");
    expect(p.data.message.type).toBe("list");
    expect(p.data.message.action.button).toHaveLength(20);
    expect(p.data.message.action.sections[0].title).toHaveLength(24);
    expect(p.data.message.action.sections[0].rows[0]).toEqual({
      id: "R1",
      title: "A title that is far too ",
      description: "d",
    });
  });

  it("rejects lists with more than 10 rows", () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ id: `R${i}`, title: `Row ${i}` }));
    expect(() => listPayload(to, { body: "b", button: "b", sectionTitle: "s", rows })).toThrow(/1-10/);
  });

  it("builds reply buttons", () => {
    const p = buttonsPayload(to, { body: "Ok?", buttons: [{ id: "Y", title: "Yes" }] });
    expect(p.type).toBe("InteractiveButton");
    expect(p.data.message.action.buttons).toEqual([{ type: "reply", reply: { id: "Y", title: "Yes" } }]);
  });

  it("rejects more than 3 buttons", () => {
    const buttons = ["a", "b", "c", "d"].map((id) => ({ id, title: id }));
    expect(() => buttonsPayload(to, { body: "b", buttons })).toThrow(/1-3/);
  });
});
