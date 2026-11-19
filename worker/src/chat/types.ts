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

/** How long the bot remembers what it last showed (docs/CHAT-HYBRID-PLAN.md §3.3). */
export const CHAT_MEMORY_MIN = 15;

/** A reference to a task the user already saw: "doosra wala" (index), "isko" (selected), "last wala". */
export type ChatRef = { by: "index"; n: number } | { by: "selected" } | { by: "last" };

/** What a question about one task asks for. "all" = a short summary of the task. */
export type TaskField = "due" | "assignee" | "creator" | "status" | "urgent" | "repeat" | "last_remark" | "remark_count" | "created" | "done_at" | "all";

/** Changes to the last query ("sirf urgent wale", "kal wale", "Durg ke"). Missing keys keep the old value. */
export interface FilterChanges {
  when?: ChatWhen;
  urgentOnly?: boolean;
  branch?: BranchId | null;
  person?: string | null;
  scope?: ChatFilter["scope"];
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
  /** Round 7 follow-ups, resolved against the chat memory (never the AI's task ids): */
  | { kind: "refine"; changes: FilterChanges }
  | { kind: "open"; ref: ChatRef }
  | { kind: "more" }
  | { kind: "ask_task"; field: TaskField; ref?: ChatRef | null; taskWords?: string[] }
  | { kind: "reset" }
  /** Not about tasks (e.g. "GST kya hai"): the bot politely refuses. */
  | { kind: "other" }
  | { kind: "unclear" };

export interface ChatPerson {
  name: string;
  /** "Admin" or the branch name. */
  label: string;
}

/**
 * One small document per person (collection `chat_ctx`, doc id = phone). IDs and filters only, never task text.
 * `v` is the version that was read (0 = new): a save succeeds only if the stored version still equals it.
 */
export interface ChatMemory {
  v: number;
  /** Last activity (ISO). Older than CHAT_MEMORY_MIN minutes = forgotten. */
  at: string;
  /** Last resolved list/count query. */
  query?: ChatFilter | null;
  /** Task IDs in the exact order displayed (what "doosra wala" means) and how many were skipped before them. */
  shown?: string[];
  offset?: number;
  total?: number;
  /** Selected task: the open detail or the last one picked/opened. */
  sel?: string | null;
}

/** What the AI is told about the memory: compact, no ids. */
export interface ChatMemorySummary {
  query?: ChatFilter | null;
  shown: number;
  selectedTitle?: string | null;
}

export interface ChatContext {
  now: Date;
  /** Round 7: compact summary of the chat memory, when there is one. */
  memory?: ChatMemorySummary | null;
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
