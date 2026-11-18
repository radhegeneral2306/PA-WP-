// Contract for chat flows. A flow owns the session while the user is inside
// it and returns the messages to send; it never talks to Interakt directly.

import type { Store } from "../data/store";
import type { Session, User } from "../domain/types";
import type { Reply } from "../interakt/parse";
import type { Outgoing } from "./outgoing";
import type { VoiceService } from "../voice/types";

export interface Inbound {
  /** Trimmed text; for list/button taps this is the option title. */
  text: string;
  reply: Reply | null;
  /** A submitted WhatsApp Form: answers keyed by field name (see interakt/parse extractForm). */
  form?: Record<string, unknown> | null;
  /** A WhatsApp voice note / audio message (Batch 4). */
  voice?: { mediaUrl: string } | null;
}

export interface BotContext {
  store: Store;
  /** The registered, active sender. */
  user: User;
  now: Date;
  /** Batch 4: transcription + understanding. Absent when not configured (and in most tests). */
  voice?: VoiceService;
}

export interface Flow {
  /** Also the prefix of every reply id this flow emits: `${id}:...`. */
  id: string;
  /** Entered from the main menu (arg distinguishes menu entries sharing a flow). */
  start(ctx: BotContext, arg?: string): Promise<Outgoing[]>;
  /** Called for every message while session.flow === id. */
  handle(ctx: BotContext, session: Session, input: Inbound): Promise<Outgoing[]>;
}

export async function setStep(
  ctx: BotContext,
  flow: string,
  step: string,
  data: Record<string, string> = {},
): Promise<void> {
  await ctx.store.saveSession({ phone: ctx.user.phone, flow, step, data, updatedAt: ctx.now.toISOString() });
}

export async function endFlow(ctx: BotContext): Promise<void> {
  await ctx.store.clearSession(ctx.user.phone);
}

/** Double-tap guard window (audit C4): a second "Haan" within this time does nothing. */
export const DOUBLE_TAP_MS = 10 * 60_000;

/**
 * Gives a confirm step a one-off id (kept in session data) so two taps on the same "Haan"
 * claim the same key and only the first one acts. Keeps an id that is already there.
 */
export function withNonce(data: Record<string, string>): Record<string, string> {
  return data.nonce ? data : { ...data, nonce: crypto.randomUUID() };
}

/** True for the first tap on this confirm step; false for a repeat (double tap / duplicate delivery). */
export async function firstTap(ctx: BotContext, flow: string, data: Record<string, string>): Promise<boolean> {
  // Sessions saved before the guard existed have no nonce: act as before.
  if (!data.nonce) return true;
  return ctx.store.claimOnce(`${flow}:${ctx.user.phone}:${data.nonce}`, ctx.now, DOUBLE_TAP_MS);
}

/** For reply id `${flow}:${kind}:${value}` returns value, else null. */
export function replyValue(input: Inbound, flow: string, kind: string): string | null {
  const prefix = `${flow}:${kind}:`;
  const id = input.reply?.id;
  return id?.startsWith(prefix) ? id.slice(prefix.length) : null;
}

/** True for reply id exactly `${flow}:${kind}`. */
export function isReply(input: Inbound, flow: string, kind: string): boolean {
  return input.reply?.id === `${flow}:${kind}`;
}
