// End to end through the router: a staff tester asks about their tasks in plain words, taps a row,
// and works on the task. Real rules and answers; only the AI service is a fake.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { CHAT_TESTERS, handleMessage } from "../../src/bot/router";
import type { Inbound } from "../../src/bot/flow";
import type { Outgoing } from "../../src/bot/outgoing";
import type { ChatService } from "../../src/chat/types";
import type { User } from "../../src/domain/types";
import { ADMIN2, NOW, STAFF_DURG, STAFF_RAIPUR, USERS, say, tap, task } from "../helpers/bot";

const body = (o: Outgoing) => (o.kind === "template" ? o.fallbackText : o.body);

function world(user: User = STAFF_DURG) {
  const store = new MemoryStore({
    users: USERS,
    tasks: [
      task({ id: "a", title: "Sharma ji se payment lena" }),
      task({ id: "b", title: "Stock ginna", dueAt: "2026-10-25T04:30:00.000Z", nextReminderAt: "2026-10-25T04:30:00.000Z" }),
      task({ id: "x", title: "Raipur ka private kaam", assigneePhone: STAFF_RAIPUR.phone, assigneeName: STAFF_RAIPUR.name, branch: "RAIPUR" }),
    ],
  });
  const chat: ChatService = { understand: vi.fn(async () => ({ ok: false as const, reason: "failed" as const })) };
  const send = (input: Inbound, now = NOW) => handleMessage({ store, user, now, chat }, input);
  return { store, chat, send };
}

beforeEach(() => {
  (CHAT_TESTERS as Set<string>).add(STAFF_DURG.name);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  (CHAT_TESTERS as Set<string>).delete(STAFF_DURG.name);
  vi.restoreAllMocks();
});

describe("chat scenarios", () => {
  it("staff asks for their tasks, taps one, sees its detail, marks it done", async () => {
    const w = world();
    const out = await w.send(say("mere pending tasks dikhao"));
    const pickers = out.filter((o) => o.kind === "list");
    expect(pickers).toHaveLength(1);
    const rows = pickers[0].kind === "list" ? pickers[0].rows.map((r) => r.id) : [];
    expect(rows).toEqual(expect.arrayContaining(["tasks:task:a", "tasks:task:b"]));
    expect(rows).not.toContain("tasks:task:x");
    expect(w.chat.understand).not.toHaveBeenCalled(); // answered by the rules, free

    const detail = await w.send(tap("tasks:task:a"));
    expect(detail[0].kind).toBe("buttons");
    expect(body(detail[0])).toContain("Sharma ji se payment lena");

    const done = await w.send(tap("tasks:act:done:a"));
    expect(body(done[0])).toContain("done mark ho gaya");
    expect((await w.store.getTask("a"))?.status).toBe("done");
    expect((await w.store.getTask("b"))?.status).toBe("pending");
  });

  it("asking for someone else's tasks is refused and shows nothing of theirs", async () => {
    const w = world();
    const out = await w.send(say("Chikku ke pending tasks"));
    expect(out.map(body).join("\n")).not.toContain("Raipur ka private kaam");
    expect(JSON.stringify(out)).not.toContain("tasks:task:x");
  });

  it("a tap on the list after it expired says so (no silent open)", async () => {
    const w = world();
    await w.send(say("mere pending tasks dikhao"));
    const later = new Date(NOW.getTime() + 3 * 60_000);
    const out = await w.send(tap("tasks:task:a"), later);
    expect(body(out[0])).toContain("Session expire ho gaya");
  });

  it("the same words from a non-tester get the plain menu", async () => {
    const w = world(ADMIN2);
    const out = await w.send(say("mere pending tasks dikhao"));
    expect(out[0].kind).toBe("list");
    expect(body(out[0])).toContain("Namaste");
  });
});
