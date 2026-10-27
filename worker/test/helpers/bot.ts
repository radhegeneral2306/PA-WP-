// Shared fixtures for flow tests. Read-only for flow agents.

import { MemoryStore } from "../../src/data/memoryStore";
import type { Task, User } from "../../src/domain/types";
import type { BotContext, Inbound } from "../../src/bot/flow";

/** 2026-10-26 15:00 IST */
export const NOW = new Date("2026-10-26T09:30:00Z");

const created = "2026-10-01T00:00:00.000Z";

export const ADMIN: User = { phone: "919000000001", name: "Bhaskar", role: "admin", branch: null, active: true, createdAt: created };
export const ADMIN2: User = { phone: "919000000002", name: "Partner Two", role: "admin", branch: null, active: true, createdAt: created };
export const STAFF_DURG: User = { phone: "919000000011", name: "Hardware", role: "staff", branch: "DURG", active: true, createdAt: created };
export const STAFF_RAIPUR: User = { phone: "919000000012", name: "Chikku", role: "staff", branch: "RAIPUR", active: true, createdAt: created };
export const STAFF_JAG: User = { phone: "919000000013", name: "Jag Staff", role: "staff", branch: "JAGDALPUR", active: true, createdAt: created };
export const INACTIVE: User = { phone: "919000000099", name: "Old Staff", role: "staff", branch: "DURG", active: false, createdAt: created };

export const USERS = [ADMIN, ADMIN2, STAFF_DURG, STAFF_RAIPUR, STAFF_JAG, INACTIVE];

export function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task1",
    title: "Sharma ji se payment lena",
    assigneePhone: STAFF_DURG.phone,
    assigneeName: STAFF_DURG.name,
    branch: "DURG",
    createdByPhone: ADMIN.phone,
    createdByName: ADMIN.name,
    dueAt: "2026-10-27T04:30:00.000Z", // 27 Oct 10:00 IST
    dueHasTime: false,
    status: "pending",
    repeat: "none",
    nextReminderAt: "2026-10-27T04:30:00.000Z",
    remarks: [],
    createdAt: created,
    updatedAt: created,
    doneAt: null,
    ...overrides,
  };
}

export function makeCtx(user: User, store = new MemoryStore({ users: USERS }), now = NOW): BotContext {
  return { store, user, now };
}

export const say = (text: string): Inbound => ({ text, reply: null });
export const tap = (id: string, title = id): Inbound => ({ text: title, reply: { kind: "list", id, title } });
