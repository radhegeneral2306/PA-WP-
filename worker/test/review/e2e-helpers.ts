// Shared helpers for the e2e-* review tests (real rules, refs, taskInfo; only the AI service is a fake).
import { vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { handleMessage, CHAT_TESTERS } from "../../src/bot/router";
import type { Inbound } from "../../src/bot/flow";
import type { Outgoing } from "../../src/bot/outgoing";
import type { ChatResult, ChatService } from "../../src/chat/types";
import type { Task, User } from "../../src/domain/types";
import { ADMIN, NOW, USERS, task } from "../helpers/bot";

export const body = (o: Outgoing) => (o.kind === "template" ? o.fallbackText : o.body);
export const all = (outs: Outgoing[]) => outs.map(body).join("\n");
export const rowIds = (outs: Outgoing[]) => outs.flatMap((o) => (o.kind === "list" ? o.rows.map((r) => r.id) : []));
export const taskRowIds = (outs: Outgoing[]) => rowIds(outs).filter((r) => r.startsWith("tasks:task:")).map((r) => r.slice("tasks:task:".length));
/** Titles of the numbered lines "n) title · due" in the first message, in order. */
export function numberedTitles(outs: Outgoing[]): string[] {
  return body(outs[0])
    .split("\n")
    .map((l) => /^(\d+)\) (?:🔴 )?(.*?)(?: · .*)?$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => m[2]);
}

export function world(user: User, tasks: Task[], ai: ChatResult = { ok: true, request: { kind: "unclear" } }) {
  const store = new MemoryStore({ users: USERS, tasks });
  const chat: ChatService = { understand: vi.fn(async () => ai) };
  let now = NOW;
  const send = (input: Inbound) => handleMessage({ store, user, now, chat }, input);
  return { store, chat, send, setNow: (d: Date) => (now = d), advance: (ms: number) => (now = new Date(now.getTime() + ms)), user, now: () => now };
}
export type World = ReturnType<typeof world>;

export function addTester(name: string) {
  (CHAT_TESTERS as Set<string>).add(name);
}
export function removeTester(name: string) {
  if (name !== ADMIN.name) (CHAT_TESTERS as Set<string>).delete(name);
}

/** n tasks for a person; due dates spread (some overdue, some future). */
export function mk(n: number, over: Partial<Task> = {}, prefix = "T"): Task[] {
  return Array.from({ length: n }, (_, i) => {
    const due = new Date(Date.UTC(2026, 9, 20, 4, 30) + i * 24 * 3600_000).toISOString();
    return task({ id: `${prefix}${i + 1}`, title: `${prefix} kaam ${i + 1}`, dueAt: due, nextReminderAt: due, ...over });
  });
}
