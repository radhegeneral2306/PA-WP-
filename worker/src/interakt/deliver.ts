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

/** Outcome of one message, for the health counters. `problem` never holds phone numbers or message text. */
interface DeliveryResult {
  ok: boolean;
  templateFallback: boolean;
  problem: string | null;
}

export async function deliver(apiKey: string, out: Outgoing): Promise<boolean> {
  return (await deliverOne(apiKey, out)).ok;
}

async function deliverOne(apiKey: string, out: Outgoing): Promise<DeliveryResult> {
  try {
    const to = recipientFromPhone(out.to);
    switch (out.kind) {
      case "text":
        return plain(out.kind, await send(apiKey, textPayload(to, out.body)));
      case "list":
        return plain(out.kind, await send(apiKey, listPayload(to, out)));
      case "buttons":
        return plain(out.kind, await send(apiKey, buttonsPayload(to, out)));
      case "template":
        return await deliverTemplate(apiKey, to, out);
    }
  } catch (err) {
    console.error("deliver failed", out.kind, mask(out.to), String(err));
    // The error text can contain a (masked) number, so it is not copied into the problem.
    return { ok: false, templateFallback: false, problem: `${out.kind} send error` };
  }
}

function plain(kind: string, res: { ok: boolean; status: number }): DeliveryResult {
  return { ok: res.ok, templateFallback: false, problem: res.ok ? null : `${kind} send failed ${res.status}` };
}

async function deliverTemplate(
  apiKey: string,
  to: Recipient,
  out: Extract<Outgoing, { kind: "template" }>,
): Promise<DeliveryResult> {
  let why: string;
  try {
    const res = await send(apiKey, templatePayload(to, out.template, out.bodyValues, out.flowToken));
    if (res.ok) return { ok: true, templateFallback: false, problem: null };
    console.error("Template send failed, using fallback text", out.template, res.status);
    why = `failed ${res.status}`;
  } catch (err) {
    console.error("Template send error, using fallback text", out.template, String(err));
    why = "error";
  }
  if (out.noFallback) return { ok: false, templateFallback: false, problem: `template ${out.template} ${why}, no fallback` };
  let fallback: string;
  let ok = false;
  try {
    const res = await send(apiKey, textPayload(to, out.fallbackText));
    ok = res.ok;
    fallback = res.ok ? "fell back to text" : `fallback text failed ${res.status}`;
  } catch (err) {
    // Same as before: the caller's catch logs it; here we only need the summary.
    console.error("deliver failed", out.kind, mask(out.to), String(err));
    fallback = "fallback text error";
  }
  return { ok, templateFallback: true, problem: `template ${out.template} ${why}, ${fallback}` };
}

export interface DeliverySummary {
  sent: number;
  failed: number;
  /** Templates that failed and were retried as plain text (counted whether or not the text got through). */
  templateFallbacks: number;
  /** Latest problem in this batch, short and without phone numbers or message text. */
  lastProblem: string | null;
}

/** Sends in order (chat order matters), continuing past failures. */
export async function deliverAll(apiKey: string, outs: Outgoing[]): Promise<DeliverySummary> {
  const summary: DeliverySummary = { sent: 0, failed: 0, templateFallbacks: 0, lastProblem: null };
  for (const out of outs) {
    const r = await deliverOne(apiKey, out);
    if (r.ok) summary.sent++;
    else summary.failed++;
    if (r.templateFallback) summary.templateFallbacks++;
    if (r.problem) summary.lastProblem = r.problem;
  }
  return summary;
}
