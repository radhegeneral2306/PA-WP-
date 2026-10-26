// Turns Outgoing messages into Interakt API calls. Never throws: one bad message
// must not kill the webhook, so failures are logged and reported as false.

import type { Outgoing } from "../bot/outgoing";
import { mask } from "../numbers";
import { buttonsPayload, listPayload, send, textPayload, type Recipient } from "./send";
import { templatePayload } from "./templates";

/** "919999999999" or "9999999999" → { countryCode: "+91", phoneNumber: "9999999999" }. */
export function recipientFromPhone(phone: string): Recipient {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return { countryCode: "+91", phoneNumber: digits };
  if (digits.length > 10 && digits.length <= 15) {
    return { countryCode: `+${digits.slice(0, -10)}`, phoneNumber: digits.slice(-10) };
  }
  throw new Error(`Cannot derive recipient from phone ${mask(digits)}`);
}

export async function deliver(apiKey: string, out: Outgoing): Promise<boolean> {
  try {
    const to = recipientFromPhone(out.to);
    switch (out.kind) {
      case "text":
        return (await send(apiKey, textPayload(to, out.body))).ok;
      case "list":
        return (await send(apiKey, listPayload(to, out))).ok;
      case "buttons":
        return (await send(apiKey, buttonsPayload(to, out))).ok;
      case "template":
        return await deliverTemplate(apiKey, to, out);
    }
  } catch (err) {
    console.error("deliver failed", out.kind, mask(out.to), String(err));
    return false;
  }
}

async function deliverTemplate(
  apiKey: string,
  to: Recipient,
  out: Extract<Outgoing, { kind: "template" }>,
): Promise<boolean> {
  try {
    const res = await send(apiKey, templatePayload(to, out.template, out.bodyValues));
    if (res.ok) return true;
    console.error("Template send failed, using fallback text", out.template, res.status);
  } catch (err) {
    console.error("Template send error, using fallback text", out.template, String(err));
  }
  return (await send(apiKey, textPayload(to, out.fallbackText))).ok;
}

/** Sends in order (chat order matters), continuing past failures. */
export async function deliverAll(apiKey: string, outs: Outgoing[]): Promise<void> {
  for (const out of outs) await deliver(apiKey, out);
}
