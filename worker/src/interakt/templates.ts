// Interakt Send Template API. Templates work outside the 24-hour window but must
// be approved by Meta first; wording lives in docs/TEMPLATES.md.

import { FLOW_TEMPLATES, TEMPLATE_PARAMS, type TemplateName } from "../bot/outgoing";
import type { Recipient } from "./send";

export function templatePayload(to: Recipient, name: TemplateName, bodyValues: string[], flowToken?: string) {
  const expected = TEMPLATE_PARAMS[name].length;
  if (bodyValues.length !== expected) {
    throw new Error(`Template ${name} needs ${expected} body values, got ${bodyValues.length}`);
  }
  return {
    countryCode: to.countryCode,
    phoneNumber: to.phoneNumber,
    type: "Template",
    template: {
      name,
      languageCode: "en",
      bodyValues: bodyValues.map(sanitizeParam),
      // Interakt's Send Template API for form templates: button 0 carries the flow token.
      ...(FLOW_TEMPLATES.has(name) ? { is_flow_template: true, buttonPayload: { "0": ["flow_token"] }, buttonValues: { "0": [flowToken || "unused"] } } : {}),
    },
  };
}

/** WhatsApp rejects params with newlines, tabs or more than 4 consecutive spaces, and empty params. */
export function sanitizeParam(value: string): string {
  const clean = value
    .replace(/\s*[\r\n]+\s*/g, " | ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\|\s*|\s*\|$/g, "")
    .trim();
  return clean || "-";
}
