// Round 7 adversarial review (reviewer 2): existing flows through their normal entry points with BOTH switches on.
// Typed text in an open input step never reaches chat; logs never carry task titles or message text.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { CHAT_TESTERS, handleMessage } from "../../src/bot/router";
import { createChatService } from "../../src/chat";
import { runReminders } from "../../src/scheduler/reminders";
import { markDone } from "../../src/bot/taskActions";
import type { Inbound } from "../../src/bot/flow";
import type { Outgoing } from "../../src/bot/outgoing";
import type { ChatResult, ChatService } from "../../src/chat/types";
import type { Task, User } from "../../src/domain/types";
import type { VoiceDraft, VoiceService } from "../../src/voice/types";
import { ADMIN, ADMIN2, NOW, STAFF_DURG, STAFF_RAIPUR, USERS, say, tap, task } from "../helpers/bot";

const text = (o: Outgoing) => (o.kind === "template" ? o.fallbackText : o.body);
const all = (outs: Outgoing[]) => outs.map((o) => JSON.stringify(o)).join("\n");

const TITLE = "ZEBRAKAAM payment";
const MINE = task({ id: "m1", title: TITLE, assigneePhone: STAFF_DURG.phone, assigneeName: "Hardware", branch: "DURG", urgent: true });
const OTHER = task({ id: "o1", title: "Stock ginna", assigneePhone: STAFF_RAIPUR.phone, assigneeName: "Chikku", branch: "RAIPUR" });

function world(user: User, opts: { tasks?: Task[]; ai?: ChatResult; voice?: VoiceService } = {}) {
  const store = new MemoryStore({ users: USERS, tasks: opts.tasks ?? [MINE, OTHER] });
  const understand = vi.fn(async () => opts.ai ?? ({ ok: true, request: { kind: "unclear" } } as ChatResult));
  const chat: ChatService = { understand };
  let now = NOW;
  const send = (input: Inbound, u: User = user) => handleMessage({ store, user: u, now, chat, voice: opts.voice }, input);
  return { store, understand, send, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}
const mem = (w: ReturnType<typeof world>, u: User) => w.store.getChatMemory(u.phone);

let logs: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  (CHAT_TESTERS as Set<string>).add(STAFF_DURG.name);
  logs = [vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];
});
afterEach(() => {
  (CHAT_TESTERS as Set<string>).delete(STAFF_DURG.name);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const logged = () => JSON.stringify(logs.flatMap((l) => l.mock.calls));

describe("menu and greetings", () => {
  it("Hi clears the session and shows the menu; the memory write of an earlier list is untouched by menu taps", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    const out = await w.send(say("Hi"));
    expect(text(out[0])).toContain("Namaste");
    expect(await w.store.getSession(STAFF_DURG.phone)).toBeNull();
    expect(w.understand).not.toHaveBeenCalled();
  });

  // Plan 3.3 says: "'Shuru se' / 'reset' / any menu word clears it." The implementation only clears the SESSION on
  // Hi/menu/band karo; the chat memory survives. Low severity (15 min, same person, still re-authorised), but
  // it contradicts the plan sentence. Fix: clearChatMemory in router's greeting / cancel branches (1 request).
  it.fails("FINDING (plan 3.3): a menu word (Hi / menu / band karo) clears the chat memory", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    expect(await mem(w, STAFF_DURG)).not.toBeNull();
    await w.send(say("Hi"));
    expect(await mem(w, STAFF_DURG)).toBeNull();
  });

  it("menu taps (My tasks / staff tasks) work and never call the AI", async () => {
    const w = world(ADMIN);
    expect((await w.send(tap("MENU:my_tasks")))[0]).toBeTruthy();
    expect((await w.send(tap("MENU:staff_tasks")))[0]).toBeTruthy();
    expect(w.understand).not.toHaveBeenCalled();
  });

  it("typed text in the plain 'Mere tasks' list (not a chat list) goes to the tasks flow, not chat, and writes no memory", async () => {
    const w = world(STAFF_DURG);
    await w.send(tap("MENU:my_tasks"));
    await w.send(say("2"));
    await w.send(say("sirf urgent wale"));
    expect(w.understand).not.toHaveBeenCalled();
    expect(await mem(w, STAFF_DURG)).toBeNull();
  });
});

describe("create wizard", () => {
  it("staff: typed title that looks like a chat request is the title; typed custom date; confirm creates exactly one task", async () => {
    const w = world(STAFF_DURG);
    const before = w.store.tasks.size;
    await w.send(tap("MENU:create_task"));
    await w.send(say("aur dikhao"));
    expect((await w.store.getSession(STAFF_DURG.phone))?.data.title).toMatch(/aur dikhao/i);
    await w.send(say("29/10 4pm"));
    const s = await w.store.getSession(STAFF_DURG.phone);
    expect(s?.step).toBe("confirm");
    const out = await w.send(tap("create_task:confirm:yes"));
    expect(w.store.tasks.size).toBe(before + 1);
    expect(all(out)).toMatch(/Task ban gaya|ban gaya|✅/);
    expect(w.understand).not.toHaveBeenCalled();
    expect(await mem(w, STAFF_DURG)).toBeNull();
  });

  it("admin: custom date step takes typed text, not chat", async () => {
    const w = world(ADMIN);
    await w.send(tap("MENU:create_task"));
    const s0 = await w.store.getSession(ADMIN.phone);
    expect(s0?.flow).toBe("create_task");
    await w.send(say("sirf urgent wale"));
    expect(w.understand).not.toHaveBeenCalled();
  });

  it("chat-created staff task (AI create) still needs the Haan button; typed 'haan' or text does not create", async () => {
    const w = world(STAFF_DURG, { ai: { ok: true, request: { kind: "create", title: "Stock check", date: "2026-10-30", time: "10:00" } } });
    const before = w.store.tasks.size;
    const out = await w.send(say("kuch ajeeb sa sawal jo rules nahi samajhte abhi"));
    expect(out[0].kind).toBe("buttons");
    expect(w.store.tasks.size).toBe(before);
    await w.send(say("haan"));
    expect(w.store.tasks.size).toBe(before);
  });
});

describe("remarks, date change, done", () => {
  it("detail open: typed question = chat (no remark); Update then ANY text = remark (even a chat-like one)", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    await w.send(tap("tasks:task:m1"));
    const q = await w.send(say("iski due date kya hai"));
    expect(all(q)).toContain(TITLE);
    expect((await w.store.getTask("m1"))?.remarks).toHaveLength(0);
    await w.send(tap("tasks:act:update:m1"));
    await w.send(say("iski due date kya hai"));
    expect((await w.store.getTask("m1"))?.remarks.map((r) => r.text)).toEqual(["iski due date kya hai"]);
  });

  it("detail open, typed write-ish text ('done kar do') goes to chat/AI and still needs a confirm, not a silent remark", async () => {
    const w = world(STAFF_DURG, { ai: { ok: true, request: { kind: "update", action: "done", taskWords: ["zebrakaam"] } } });
    await w.send(say("mere pending tasks"));
    await w.send(tap("tasks:task:m1"));
    const out = await w.send(say("ye done kar do"));
    expect((await w.store.getTask("m1"))?.status).toBe("pending");
    expect((await w.store.getTask("m1"))?.remarks).toHaveLength(0);
    expect(out.length).toBeGreaterThan(0);
  });

  it("date change: quick pick, then the typed reason is the reason (not chat), date saved", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    await w.send(tap("tasks:task:m1"));
    await w.send(tap("tasks:act:date:m1"));
    await w.send(tap("tasks:quick:tom14"));
    await w.send(say("aur dikhao"));
    const t = await w.store.getTask("m1");
    expect(t?.remarks.at(-1)?.text).toContain("aur dikhao");
    expect(t?.dueAt).not.toBe(MINE.dueAt);
    expect(w.understand).not.toHaveBeenCalled();
  });

  it("Done button on the detail still completes only that task", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    await w.send(tap("tasks:task:m1"));
    await w.send(tap("tasks:act:done:m1"));
    expect((await w.store.getTask("m1"))?.status).toBe("done");
    expect((await w.store.getTask("o1"))?.status).toBe("pending");
  });

  it("a Done tap on an older message for someone else's task is refused for staff (existing rule, memory on)", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    await w.send(tap("tasks:act:done:o1"));
    expect((await w.store.getTask("o1"))?.status).toBe("pending");
  });

  it("task done from elsewhere (dashboard / other person) after listing: the number now answers 'done', no crash, no write", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    await markDone(w.store, (await w.store.getTask("m1"))!, { phone: ADMIN.phone, name: ADMIN.name }, NOW);
    const remarksBefore = (await w.store.getTask("m1"))!.remarks.length;
    const out = await w.send(say("1"));
    expect(out.length).toBeGreaterThan(0);
    expect((await w.store.getTask("m1"))?.status).toBe("done");
    expect((await w.store.getTask("m1"))?.remarks.length).toBe(remarksBefore);
  });
});

describe("approvals and forms", () => {
  it("admin approvals: typed text in the open approvals flow is not chat", async () => {
    const withReq = task({ id: "p1", title: "Payment lena", dateRequest: { dueAt: "2026-12-05T04:30:00.000Z", hasTime: false, remark: "r", byPhone: STAFF_DURG.phone, byName: "Hardware", requestedAt: "2026-10-25T04:30:00.000Z" } });
    const w = world(ADMIN, { tasks: [withReq] });
    await w.send(tap("MENU:approvals"));
    await w.send(say("sirf urgent wale"));
    await w.send(say("2"));
    expect(w.understand).not.toHaveBeenCalled();
    expect((await w.store.getTask("p1"))?.dueAt).toBe(withReq.dueAt);
  });

  it("a submitted form with a chat memory present creates a task for the right person and ignores memory", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    const before = w.store.tasks.size;
    const out = await w.send({ text: "", reply: null, form: { flow_token: "task_form_staff", title: "Stock check", date: "2026-10-30", time: "11:00 AM", repeat: "Ek baar" } });
    expect(w.store.tasks.size).toBe(before + 1);
    expect(out.length).toBeGreaterThan(0);
    expect(w.understand).not.toHaveBeenCalled();
  });
});

describe("voice with memory on", () => {
  function voiceFor(draft: Partial<VoiceDraft>): VoiceService {
    const full: VoiceDraft = { transcript: "x", title: null, person: null, personHeard: null, date: null, time: null, repeat: null, ...draft };
    return { understand: vi.fn(async () => ({ ok: true, draft: full, durationSec: 3 })) } as unknown as VoiceService;
  }
  const VOICE: Inbound = { text: "", reply: null, voice: { mediaUrl: "https://media.example/v.ogg" } };

  it("admin: voice note with a task detail open is about that task (context mode); chat memory untouched; confirm needed", async () => {
    const adminTask = task({ id: "a1", title: "Sharma ji se payment lena", createdByPhone: ADMIN2.phone, createdByName: ADMIN2.name });
    const w = world(ADMIN, { tasks: [adminTask], voice: voiceFor({ intent: "update", action: "done", taskWords: [] }) });
    await w.send(say("sabke pending tasks"));
    await w.send(tap("tasks:task:a1"));
    const memBefore = JSON.stringify(await mem(w, ADMIN));
    const confirm = await w.send(VOICE);
    expect(all(confirm)).toContain("DONE");
    expect((await w.store.getTask("a1"))?.status).toBe("pending");
    expect(JSON.stringify(await mem(w, ADMIN))).toBe(memBefore);
    await w.send(tap("voice_update:confirm:yes"));
    expect((await w.store.getTask("a1"))?.status).toBe("done");
  });

  it("admin: cold voice create still previews first (no task before Haan)", async () => {
    const w = world(ADMIN, { voice: voiceFor({ intent: "create", title: "Stock check", person: "Hardware", personHeard: "Hardware", date: "2026-10-30", time: "10:00" }) });
    const before = w.store.tasks.size;
    await w.send(VOICE);
    expect(w.store.tasks.size).toBe(before);
  });

  it("staff voice note falls through to the menu (voice is admin-only), not to chat", async () => {
    const w = world(STAFF_DURG);
    const out = await w.send(VOICE);
    expect(out.length).toBe(1);
    expect(w.understand).not.toHaveBeenCalled();
  });
});

describe("reminders cron and dashboard-style actions with memory present", () => {
  it("runReminders is unaffected by chat memory and writes none", async () => {
    const due = task({ id: "r1", nextReminderAt: "2026-10-26T09:00:00.000Z" });
    const w = world(STAFF_DURG, { tasks: [due] });
    await w.send(say("mere pending tasks"));
    const m0 = JSON.stringify(await mem(w, STAFF_DURG));
    const out = await runReminders(w.store, NOW);
    expect(out.length).toBe(1);
    expect(JSON.stringify(await mem(w, STAFF_DURG))).toBe(m0);
  });
});

describe("logs carry no task titles or message text", () => {
  it("through lists, follow-ups, questions, AI failures (real service, Gemini 500 / 429 / network), limit and memory failures", async () => {
    const MSG = "SECRETMESSAGE kuch ajeeb sa sawal jo rules nahi samajhte";
    for (const status of [500, 429, 200]) {
      vi.stubGlobal("fetch", vi.fn(async () => (status === 200 ? new Response("not json at all " + TITLE) : new Response(JSON.stringify({ error: { status: "X", message: MSG + TITLE } }), { status }))));
      const store = new MemoryStore({ users: USERS, tasks: [MINE] });
      const chat = createChatService({ GEMINI_API_KEY: "k" } as never);
      const run = (t: string) => handleMessage({ store, user: STAFF_DURG, now: NOW, chat }, say(t));
      for (const t of ["mere pending tasks", "1", "iski due date kya hai", "last update kya tha", MSG, `${MSG} 2`]) await run(t);
    }
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(MSG + TITLE); }));
    const store = new MemoryStore({ users: USERS, tasks: [MINE] });
    const chat = createChatService({ GEMINI_API_KEY: "k" } as never);
    await handleMessage({ store, user: STAFF_DURG, now: NOW, chat }, say(MSG));
    // a chat service that throws with the text inside (defence in depth: flow logs String(err))
    const evil: ChatService = { understand: async () => { throw new Error("boom"); } };
    await handleMessage({ store, user: STAFF_DURG, now: NOW, chat: evil }, say(MSG));
    const l = logged();
    expect(l).not.toContain("SECRETMESSAGE");
    expect(l).not.toContain("ZEBRAKAAM");
    expect(l).not.toContain("mere pending");
  });

  it("memory store failures log without titles or message text", async () => {
    const store = new MemoryStore({ users: USERS, tasks: [MINE] });
    store.getChatMemory = async () => { throw new Error("read failed"); };
    store.saveChatMemory = async () => { throw new Error("save failed"); };
    store.clearChatMemory = async () => { throw new Error("clear failed"); };
    const chat: ChatService = { understand: vi.fn(async () => ({ ok: true, request: { kind: "unclear" } }) as ChatResult) };
    for (const t of ["mere pending tasks", "shuru se", "iski due date kya hai"]) {
      const out = await handleMessage({ store, user: STAFF_DURG, now: NOW, chat }, say(t));
      expect(out.length).toBeGreaterThan(0);
    }
    expect(logged()).not.toMatch(/ZEBRAKAAM|mere pending/);
  });
});
