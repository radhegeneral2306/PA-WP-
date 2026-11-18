// Round 5 contract: chatting with the bot in plain words (docs/ROUND5-6-CONTRACT.md).
// The rules layer and the AI both produce a ChatRequest; code (never the AI) checks
// permissions, reads the data and runs the actions.

import type { BranchId, Role, TaskRepeat } from "../domain/types";

export type ChatWhen = "today" | "tomorrow" | "week" | "overdue" | "all";

export interface ChatFilter {
  /** mine = the sender's own tasks; person / branch / all are admin-only (code enforces it). */
  scope: "mine" | "person" | "branch" | "all";
  /** Exact listed user name, for scope "person". */
  person?: string | null;
  branch?: BranchId | null;
  when: ChatWhen;
  urgentOnly?: boolean;
}

export type ChatRequest =
  | { kind: "list"; filter: ChatFilter }
  | { kind: "count"; filter: ChatFilter }
  /** An existing task: done / remark / due / reassign (reassign is admin-only). */
  | {
      kind: "update";
      action: "done" | "remark" | "due" | "reassign";
      person?: string | null;
      taskWords: string[];
      remark?: string | null;
      date?: string | null; // YYYY-MM-DD IST
      time?: string | null; // HH:MM IST
      newPerson?: string | null;
    }
  | {
      kind: "create";
      title: string | null;
      person?: string | null;
      date?: string | null;
      time?: string | null;
      repeat?: TaskRepeat | null;
      urgent?: boolean;
    }
  /** Not about tasks (e.g. "GST kya hai"): the bot politely refuses. */
  | { kind: "other" }
  | { kind: "unclear" };

export interface ChatPerson {
  name: string;
  /** "Admin" or the branch name. */
  label: string;
}

export interface ChatContext {
  now: Date;
  role: Role;
  /** The sender's own name. */
  self: string;
  /** Active people the sender may refer to (staff: only themselves). */
  people: ChatPerson[];
}

export type ChatFailure = "not_configured" | "limit" | "not_understood" | "failed";

export type ChatResult =
  | { ok: true; request: ChatRequest }
  | { ok: false; reason: ChatFailure; detail?: string };

export interface ChatService {
  /** One Gemini call (free tier) for text the rules layer did not recognise. */
  understand(text: string, ctx: ChatContext): Promise<ChatResult>;
}
