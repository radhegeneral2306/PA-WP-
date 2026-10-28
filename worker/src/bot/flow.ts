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
