// End to end through the router: an admin opens a task from the menu and speaks; or speaks cold.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { handleMessage } from "../../src/bot/router";
import type { Inbound } from "../../src/bot/flow";
import type { Outgoing } from "../../src/bot/outgoing";
import type { VoiceDraft, VoiceService } from "../../src/voice/types";
import { ADMIN, ADMIN2, NOW, STAFF_DURG, USERS, say, tap, task } from "../helpers/bot";

const body = (o: Outgoing) => (o.kind === "template" ? o.fallbackText : o.body);
const templates = (out: Outgoing[]) => out.filter((o): o is Extract<Outgoing, { kind: "template" }> => o.kind === "template");
const VOICE: Inbound = { text: "", reply: null, voice: { mediaUrl: "https://media.example/v.ogg" } };

function world(draft: Partial<VoiceDraft>) {
  const store = new MemoryStore({
    users: USERS,
    tasks: [
      task({ id: "a", title: "Sharma ji se payment lena", createdByPhone: ADMIN2.phone, createdByName: ADMIN2.name }),
      task({ id: "b", title: "Stock ginna", createdByPhone: ADMIN2.phone, createdByName: ADMIN2.name }),
    ],
  });
  const full: VoiceDraft = {
    transcript: "ye ho gaya",
    title: null,
    person: null,
    personHeard: null,
    date: null,
    time: null,
    repeat: null,
    intent: "update",
    action: "done",
    taskWords: [],
    ...draft,
  };
  const understand = vi.fn<VoiceService["understand"]>(async () => ({ ok: true, draft: full, durationSec: 4 }));
  const send = (input: Inbound, user = ADMIN, now = NOW) => handleMessage({ store, user, now, voice: { understand } }, input);
  return { store, send, understand };
}

beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("voice update scenarios", () => {
  it("open a task from the menu, say 'ho gaya', tap Haan: done, creator told, nothing else touched", async () => {
    const w = world({});
    await w.send(tap("MENU:staff_tasks"));
    await w.send(tap("tasks:branch:DURG"));
    await w.send(tap(`tasks:user:${STAFF_DURG.phone}`));
    const detail = await w.send(tap("tasks:task:a"));
    expect(detail[0].kind).toBe("buttons");
    const confirm = await w.send(VOICE);
    expect(body(confirm[0])).toContain("✅ DONE karna hai:");
    expect(w.understand.mock.calls[0][1].task?.title).toBe("Sharma ji se payment lena");
    const out = await w.send(tap("voice_update:confirm:yes"));
    expect(body(out[0])).toBe("✅ Done ho gaya: *Sharma ji se payment lena*");
    expect(templates(out).map((t) => [t.template, t.to])).toEqual([["task_done_v1", ADMIN2.phone]]);
    expect((await w.store.getTask("a"))?.status).toBe("done");
    expect((await w.store.getTask("b"))?.status).toBe("pending");
    expect(await w.store.getSession(ADMIN.phone)).toBeNull();
  });

  it("cold note: pick the task, change the date, staff + creator told; Hi afterwards gives the menu", async () => {
    const w = world({ person: "Hardware", personHeard: "Hardware", action: "due", date: "2026-10-30", taskWords: ["stock"] });
    const list = await w.send(VOICE);
    expect(list[0].kind).toBe("list");
    const confirm = await w.send(tap("voice_update:task:b"));
    expect(body(confirm[0])).toContain("🕒 DATE BADALNI hai:");
    const out = await w.send(tap("voice_update:confirm:yes"));
    expect(templates(out).map((t) => t.to).sort()).toEqual([ADMIN2.phone, STAFF_DURG.phone].sort());
    expect((await w.store.getTask("b"))?.dueAt).toBe("2026-10-30T04:30:00.000Z");
    expect((await w.send(say("Hi")))[0].kind).toBe("list");
  });

  it("'Rehne do' leaves the task and the open chat is over", async () => {
    const w = world({ person: "Hardware", personHeard: "Hardware", taskWords: ["stock"] });
    await w.send(VOICE);
    await w.send(tap("voice_update:task:b"));
    await w.send(tap("voice_update:confirm:no"));
    expect((await w.store.getTask("b"))?.status).toBe("pending");
    expect(await w.store.getSession(ADMIN.phone)).toBeNull();
  });

  it("a note that is not about any task changes nothing", async () => {
    const w = world({ taskWords: ["zzzz"] });
    const out = await w.send(VOICE);
    expect(body(out[0])).toContain("Koi task nahi mila");
    expect((await w.store.listTasks({ status: "pending" })).length).toBe(2);
  });
});
