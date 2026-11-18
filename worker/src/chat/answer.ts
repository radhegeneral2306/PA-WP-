// STUB (coordinator): agent B replaces the body, keeps the signature.
import type { Outgoing } from "../bot/outgoing";
import type { Store } from "../data/store";
import type { User } from "../domain/types";
import type { ChatRequest } from "./types";

export async function answerQuery(_store: Store, user: User, _request: Extract<ChatRequest, { kind: "list" | "count" }>, _now: Date): Promise<Outgoing[]> {
  return [{ to: user.phone, kind: "text", body: "Abhi ye jawab nahi de sakta." }];
}
