import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import type { BotContext } from "../../src/bot/flow";
import type { Outgoing } from "../../src/bot/outgoing";
import type { ChatRequest, ChatResult, ChatService } from "../../src/chat/types";
import { list, text } from "../../src/bot/ui";
import { CHAT_LIVE, CHAT_TESTERS, handleMessage } from "../../src/bot/router";
import { CHAT_LIMIT, CHAT_MSG, chatCountKey, handleChat, isCourtesy } from "../../src/bot/flows/chat";
import type { User } from "../../src/domain/types";
import { ADMIN, ADMIN2, NOW, STAFF_DURG, STAFF_RAIPUR, USERS, say, tap, task } from "../helpers/bot";

const rule = vi.hoisted(() => ({ fn: vi.fn() }));
const ans = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../src/chat/rules", () => ({ ruleRequest: (...a: unknown[]) => rule.fn(...a) }));
vi.mock("../../src/chat/answer", () => ({ answerQuery: (...a: unknown[]) => ans.fn(...a) }));

const body = (o: Outgoing) => (o.kind === "template" ? o.fallbackText : o.body);
const first = (out: Outgoing[]) => body(out[0]);

type Fake = ChatService & { understand: ReturnType<typeof vi.fn<ChatService["understand"]>> };
const fakeChat = (result: ChatResult): Fake => ({ understand: vi.fn<ChatService["understand"]>(async () => result) });
const ok = (request: ChatRequest): ChatResult => ({ ok: true, request });
const WEEK: ChatRequest = { kind: "list", filter: { scope: "mine", when: "week" } };

function setup(user: User = ADMIN, result: ChatResult = ok({ kind: "unclear" }), tasks = [task({ id: "t1", title: "Sharma ji se payment lena" })]) {
  const store = new MemoryStore({ users: USERS, tasks });
  const chat = fakeChat(result);
  const ctx: BotContext = { store, user, now: NOW, chat };
  return { store, chat, ctx, send: (t: string) => handleChat(ctx, t) };
}

// These tests describe the behaviour with the Round 7 switches off (no memory, no detail chat), also for the tester.
beforeEach(() => {
  (CHAT_TESTERS as Set<string>).delete(ADMIN.name);
  rule.fn.mockReset().mockReturnValue(null);
  ans.fn.mockReset().mockImplementation(async (_s: unknown, u: User) => [text(u.phone, "ANSWER")]);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  (CHAT_TESTERS as Set<string>).add(ADMIN.name);
  vi.restoreAllMocks();
});

describe("courtesy", () => {
  it.each(["ok", "Thanks!", "thank you", "dhanyavad", "Shukriya ji", "👍", "haan", "theek hai", "hm", "🙏🙏", "k"])("%s: friendly line, no rules, no AI, no count", async (t) => {
    const w = setup();
    const out = await w.send(t);
    expect(first(out)).toBe(CHAT_MSG.courtesy);
    expect(rule.fn).not.toHaveBeenCalled();
    expect(w.chat.understand).not.toHaveBeenCalled();
    expect(await w.store.bumpDailyCount(chatCountKey(ADMIN.phone, NOW), NOW)).toBe(1);
  });

  it("real sentences are not courtesies", () => {
    for (const t of ["mere tasks kya hain", "GST kya hai", "ok kal 5 baje"]) expect(isCourtesy(t)).toBe(false);
  });
});

describe("rules first", () => {
  it("a rules answer costs no AI call and is not counted", async () => {
    rule.fn.mockReturnValue(WEEK);
    const w = setup();
    const out = await w.send("is hafte ka kaam");
    expect(first(out)).toBe("ANSWER");
    expect(ans.fn).toHaveBeenCalledOnce();
    expect(w.chat.understand).not.toHaveBeenCalled();
    expect(await w.store.bumpDailyCount(chatCountKey(ADMIN.phone, NOW), NOW)).toBe(1);
  });

  it("the rules get role, self and the people (staff only themselves, admin everyone active)", async () => {
    const s = setup(STAFF_DURG);
    await s.send("kuch bhi likha hua");
    expect(rule.fn.mock.calls[0][1]).toMatchObject({ role: "staff", self: "Hardware", people: [{ name: "Hardware", label: "Durg" }] });
    const a = setup(ADMIN);
    await a.send("kuch bhi likha hua");
    const names = (rule.fn.mock.calls[1][1] as { people: { name: string }[] }).people.map((p) => p.name);
    expect(names).toContain("Chikku");
    expect(names).not.toContain("Old Staff");
  });
});

describe("AI path, count and limit", () => {
  it("one AI call counts +1 per message", async () => {
    const w = setup(ADMIN, ok({ kind: "other" }));
    await w.send("GST kya hai");
    await w.send("Aur ek sawal");
    expect(w.chat.understand).toHaveBeenCalledTimes(2);
    expect(await w.store.bumpDailyCount(chatCountKey(ADMIN.phone, NOW), NOW)).toBe(3);
  });

  it("the AI gets the typed text and the context", async () => {
    const w = setup(STAFF_DURG, ok({ kind: "other" }));
    await w.send("  GST   kya hai  ");
    const [txt, c] = w.chat.understand.mock.calls[0];
    expect(txt).toBe("GST kya hai");
    expect(c).toMatchObject({ role: "staff", self: "Hardware", now: NOW });
  });

  it.each([
    [STAFF_DURG, CHAT_LIMIT.staff],
    [ADMIN, CHAT_LIMIT.admin],
  ])("%s: limit %i: the next message gets the limit text and the menu, no AI call", async (user, limit) => {
    expect(limit).toBe(user.role === "admin" ? 50 : 20);
    const w = setup(user, ok({ kind: "other" }));
    for (let i = 0; i < limit; i++) await w.send(`sawal ${i} kuch`);
    expect(w.chat.understand).toHaveBeenCalledTimes(limit);
    const out = await w.send("ek aur sawal");
    expect(w.chat.understand).toHaveBeenCalledTimes(limit);
    expect(first(out)).toContain("Aaj ki limit poori ho gayi, menu use kijiye");
    expect(out).toHaveLength(1);
    expect(out[0].kind).toMatch(/list|buttons/);
  });

  it("rules answers still work at the limit", async () => {
    const w = setup(STAFF_DURG, ok({ kind: "other" }));
    for (let i = 0; i < 25; i++) await w.send(`sawal ${i} kuch`);
    rule.fn.mockReturnValue(WEEK);
    expect(first(await w.send("is hafte"))).toBe("ANSWER");
  });

  it("the counter is per day (IST) and per person", async () => {
    const w = setup(ADMIN, ok({ kind: "other" }));
    await w.send("sawal ek");
    expect(chatCountKey(ADMIN.phone, NOW)).toBe(`ai:${ADMIN.phone}:2026-10-26`);
    expect(chatCountKey(ADMIN.phone, new Date("2026-10-26T19:00:00Z"))).toBe(`ai:${ADMIN.phone}:2026-10-27`);
    expect(await w.store.bumpDailyCount(chatCountKey(ADMIN2.phone, NOW), NOW)).toBe(1);
  });
});

describe("failures", () => {
  it.each(["not_configured", "failed", "not_understood", "limit"] as const)("%s: menu with the standard line", async (reason) => {
    const w = setup(ADMIN2, { ok: false, reason, detail: "boom" });
    const out = await w.send("kuch bhi likha");
    expect(first(out)).toContain("Abhi samajh nahi paaya, menu use kijiye");
    expect(first(out)).not.toContain("_Tech");
    expect(out[0].kind).toMatch(/list|buttons/);
    const h = await w.store.getHealth();
    expect(h?.errors ?? 0).toBe(reason === "failed" || reason === "limit" ? 1 : 0);
  });

  it("no chat service: same reply, nothing counted", async () => {
    const w = setup(ADMIN2);
    const out = await handleChat({ ...w.ctx, chat: undefined }, "kuch bhi likha");
    expect(first(out)).toContain("Abhi samajh nahi paaya");
    expect(await w.store.bumpDailyCount(chatCountKey(ADMIN2.phone, NOW), NOW)).toBe(1);
  });

  it("a throwing service is a failure, not a crash", async () => {
    const w = setup(ADMIN2);
    w.chat.understand.mockRejectedValue(new Error("x"));
    expect(first(await w.send("kuch bhi likha"))).toContain("Abhi samajh nahi paaya");
    expect((await w.store.getHealth())?.errors).toBe(1);
  });

  it("the super admin also sees the technical reason", async () => {
    const w = setup(ADMIN, { ok: false, reason: "failed", detail: "503" });
    expect(first(await w.send("kuch bhi likha"))).toContain("_Tech: failed: 503_");
  });
});

describe("other and unclear", () => {
  it("other: polite refusal + menu", async () => {
    const out = await setup(ADMIN2, ok({ kind: "other" })).send("GST kya hai");
    expect(first(out)).toContain("Main sirf tasks mein madad kar sakta hoon 🙂");
    expect(out[0].kind).toBe("list");
  });

  it("unclear: help with three examples + menu", async () => {
    const out = await setup(ADMIN2, ok({ kind: "unclear" })).send("hmmm kya karun");
    expect(first(out)).toContain("Mere pending tasks");
    expect((first(out).match(/•/g) ?? []).length).toBe(3);
    expect(out[0].kind).toBe("list");
  });
});

describe("list / count", () => {
  it("answers through answerQuery with the user and the request", async () => {
    const w = setup(STAFF_DURG, ok(WEEK));
    await w.send("is hafte ka kya hai bhai");
    expect(ans.fn).toHaveBeenCalledWith(w.store, STAFF_DURG, WEEK, NOW);
  });

  it("a task picker opens a tasks list session marked chat; a picker-less answer does not", async () => {
    const w = setup(STAFF_DURG, ok(WEEK));
    await w.send("is hafte ka kya hai bhai");
    expect(await w.store.getSession(STAFF_DURG.phone)).toBeNull();
    ans.fn.mockImplementation(async (_s: unknown, u: User) => [list(u.phone, "x", "Task chuno", [{ id: "tasks:task:t1", title: "a" }])]);
    await w.send("is hafte ka kya hai bhai");
    expect(await w.store.getSession(STAFF_DURG.phone)).toMatchObject({ flow: "tasks", step: "list", data: { chat: "1" } });
  });
});

describe("update hand-offs", () => {
  const done = (over: Partial<Extract<ChatRequest, { kind: "update" }>> = {}): ChatRequest => ({ kind: "update", action: "done", taskWords: ["sharma"], ...over });

  it("admin: voice_update confirm that says Aapne likha", async () => {
    const w = setup(ADMIN, ok(done({ person: "Hardware" })));
    const out = await w.send("hardware ka sharma wala ho gaya");
    expect(first(out)).toBe("Kaunsa task?");
    const confirm = await handleMessage(w.ctx, tap("voice_update:task:t1"));
    expect(first(confirm)).toContain('Aapne likha: "hardware ka sharma wala ho gaya"');
    expect(first(confirm)).not.toContain("Maine suna");
    expect(first(confirm)).toContain("DONE karna hai");
    const yes = await handleMessage(w.ctx, tap("voice_update:confirm:yes"));
    expect(first(yes)).toContain("Done ho gaya");
    expect((await w.store.getTask("t1"))?.status).toBe("done");
    // typed, so no "(voice)" mark
    expect((await w.store.getTask("t1"))?.remarks).toEqual([]);
  });

  it("staff: done on own task goes through the same confirm", async () => {
    const w = setup(STAFF_DURG, ok(done()));
    const out = await w.send("sharma wala ho gaya");
    expect(out[0].kind).toBe("list");
    const confirm = await handleMessage(w.ctx, tap("voice_update:task:t1"));
    expect(first(confirm)).toContain("Aapne likha");
    await handleMessage(w.ctx, tap("voice_update:confirm:yes"));
    expect((await w.store.getTask("t1"))?.status).toBe("done");
  });

  it("staff: another person's task is never offered or touched", async () => {
    const other = task({ id: "t9", title: "Sharma ji ka bill", assigneePhone: STAFF_RAIPUR.phone, assigneeName: STAFF_RAIPUR.name, branch: "RAIPUR", createdByPhone: ADMIN.phone });
    const w = setup(STAFF_DURG, ok(done()), [other]);
    const out = await w.send("sharma wala ho gaya");
    expect(first(out)).toBe("Aapke koi pending task nahi hain.");
    // a forged tap on the other task
    await w.store.saveSession({ phone: STAFF_DURG.phone, flow: "voice_update", step: "pick_task", data: { src: "typed", mode: "free", action: "done", cands: "t9" }, updatedAt: NOW.toISOString() });
    const forged = await handleMessage(w.ctx, tap("voice_update:task:t9"));
    expect(first(forged)).toBe("Ye task aapka nahi hai.");
    expect((await w.store.getTask("t9"))?.status).toBe("pending");
  });

  it("staff: a voice_update session without the typed mark is refused", async () => {
    const w = setup(STAFF_DURG);
    await w.store.saveSession({ phone: STAFF_DURG.phone, flow: "voice_update", step: "confirm", data: { mode: "ctx", taskId: "t1", action: "done" }, updatedAt: NOW.toISOString() });
    const out = await handleMessage(w.ctx, tap("voice_update:confirm:yes"));
    expect(first(out)).toContain("dobara bhejiye");
    expect((await w.store.getTask("t1"))?.status).toBe("pending");
  });

  it("staff: reassign is refused", async () => {
    const w = setup(STAFF_DURG, ok(done({ action: "reassign", newPerson: "Chikku" })));
    const out = await w.send("sharma wala chikku ko de do");
    expect(first(out)).toContain("sirf admin");
    expect(await w.store.getSession(STAFF_DURG.phone)).toBeNull();
  });

  it("staff: due opens that task's detail (25-day rule stays in the tasks flow)", async () => {
    const w = setup(STAFF_DURG, ok(done({ action: "due", date: "2026-12-30" })));
    const out = await w.send("sharma wale ki date badal do");
    expect(first(out)).toContain("Date badlo");
    expect(out[1].kind).toBe("buttons");
    expect(body(out[1])).toContain("Sharma ji se payment lena");
    expect(await w.store.getSession(STAFF_DURG.phone)).toMatchObject({ flow: "tasks", step: "detail", data: { taskId: "t1" } });
    expect((await w.store.getTask("t1"))?.dueAt).toBe("2026-10-27T04:30:00.000Z");
  });

  it("staff: due with no matching own task points to the menu", async () => {
    const w = setup(STAFF_DURG, ok(done({ action: "due", taskWords: ["zzzz"] })));
    expect(first(await w.send("zzzz ki date badal do"))).toBe(CHAT_MSG.dateHint);
  });

  it("staff: due with several matches shows a picker that opens details", async () => {
    const w = setup(STAFF_DURG, ok(done({ action: "due", taskWords: ["sharma"] })), [
      task({ id: "t1", title: "Sharma ji se payment lena" }),
      task({ id: "t2", title: "Sharma ji ka bill bhejna" }),
    ]);
    const out = await w.send("sharma wale ki date badal do");
    expect(out[0].kind).toBe("list");
    expect(await w.store.getSession(STAFF_DURG.phone)).toMatchObject({ flow: "tasks", step: "list", data: { chat: "1" } });
  });
});

describe("create hand-offs", () => {
  const make = (over: Partial<Extract<ChatRequest, { kind: "create" }>> = {}): ChatRequest => ({ kind: "create", title: "GST file karna", date: "2026-10-28", time: "17:00", ...over });

  it("admin: voice create flow, Aapne likha, person asked when missing", async () => {
    const w = setup(ADMIN, ok(make({ person: "Hardware" })));
    const out = await w.send("hardware ko kal 5 baje gst file karna");
    expect(first(out)).toContain('Aapne likha: "hardware ko kal 5 baje gst file karna"');
    expect(first(out)).toContain("Kisko: Hardware");
    const saved = await handleMessage(w.ctx, tap("voice_task:confirm:yes"));
    expect(first(saved)).toContain("💬 Chat se banaya");
    const t = [...w.store.tasks.values()].find((x) => x.title === "GST file karna")!;
    expect(t.assigneePhone).toBe(STAFF_DURG.phone);
    expect(t.source).toBeUndefined();
    const noPerson = setup(ADMIN, ok(make({ person: null })));
    expect(first(await noPerson.send("gst file karna kal 5 baje"))).toContain("Naam nahi suna");
  });

  it("staff: a self-task confirm; the person is always the sender", async () => {
    const w = setup(STAFF_DURG, ok(make()));
    const out = await w.send("kal 5 baje gst file karna hai");
    expect(first(out)).toContain("Kisko: *Aap khud*");
    expect(first(out)).toContain("Aapne likha");
    expect(out[0].kind).toBe("buttons");
    expect(await w.store.getSession(STAFF_DURG.phone)).toMatchObject({ flow: "create_task", step: "confirm" });
    const saved = await handleMessage(w.ctx, tap("create_task:confirm:yes"));
    expect(first(saved)).toContain("Task ban gaya");
    const t = [...w.store.tasks.values()].find((x) => x.title === "GST file karna")!;
    expect([t.assigneePhone, t.createdByPhone]).toEqual([STAFF_DURG.phone, STAFF_DURG.phone]);
  });

  it("staff: naming someone else is refused, nothing is created", async () => {
    const w = setup(STAFF_DURG, ok(make({ person: "Chikku" })));
    const out = await w.send("chikku ko gst file karna hai");
    expect(first(out)).toContain("sirf apne liye");
    expect(w.store.tasks.size).toBe(1);
    expect(await w.store.getSession(STAFF_DURG.phone)).toBeNull();
  });

  it("staff: missing date asks for it, missing title asks for it, a past date asks again", async () => {
    const noDate = setup(STAFF_DURG, ok(make({ date: null, time: null })));
    const a = await noDate.send("gst file karna hai");
    expect(a[0].kind).toBe("list");
    expect(await noDate.store.getSession(STAFF_DURG.phone)).toMatchObject({ flow: "create_task", step: "ask_due", data: { title: "GST file karna" } });
    const noTitle = setup(STAFF_DURG, ok(make({ title: null })));
    expect(first(await noTitle.send("ek task banana hai"))).toBe(CHAT_MSG.askTitle);
    expect(await noTitle.store.getSession(STAFF_DURG.phone)).toMatchObject({ flow: "create_task", step: "ask_title" });
    const past = setup(STAFF_DURG, ok(make({ date: "2026-10-20" })));
    await past.send("gst file karna hai");
    expect((await past.store.getSession(STAFF_DURG.phone))?.step).toBe("ask_due");
  });
});

describe("router hook", () => {
  const added: string[] = [];
  afterEach(() => {
    for (const n of added.splice(0)) (CHAT_TESTERS as Set<string>).delete(n);
  });
  const makeTester = (u: User) => {
    (CHAT_TESTERS as Set<string>).add(u.name);
    added.push(u.name);
  };

  it("chat is open to everyone (owner 18 Nov); the tester list is only used while CHAT_LIVE is false", () => {
    expect(CHAT_LIVE).toBe(true);
    expect([...CHAT_TESTERS, ADMIN.name].sort()).toEqual(["Bhaskar"]); // (removed for these tests, see beforeEach)
  });

  it("any user (not only a tester): typed text reaches the chat", async () => {
    const w = setup(ADMIN2, ok({ kind: "other" }));
    const out = await handleMessage(w.ctx, say("GST kya hai"));
    expect(first(out)).toContain("Main sirf tasks");
    expect(w.chat.understand).toHaveBeenCalledOnce();
  });

  it("a tester: typed text reaches the chat", async () => {
    const w = setup(ADMIN, ok({ kind: "other" }));
    const out = await handleMessage(w.ctx, say("GST kya hai"));
    expect(first(out)).toContain("Main sirf tasks");
    expect(w.chat.understand).toHaveBeenCalledOnce();
  });

  it("greetings, cancel words and menu words never reach the chat", async () => {
    const w = setup(ADMIN, ok({ kind: "other" }));
    for (const t of ["Hi", "menu", "band karo", "Mere tasks"]) await handleMessage(w.ctx, say(t));
    expect(w.chat.understand).not.toHaveBeenCalled();
    expect(rule.fn).not.toHaveBeenCalled();
  });

  it("typed text inside an open flow stays in that flow", async () => {
    const w = setup(ADMIN, ok({ kind: "other" }));
    await handleMessage(w.ctx, tap("MENU:create_task"));
    await handleMessage(w.ctx, say("hardware"));
    expect((await w.store.getSession(ADMIN.phone))?.flow).toBe("create_task");
    expect(w.chat.understand).not.toHaveBeenCalled();
    expect(rule.fn).not.toHaveBeenCalled();
    // a task detail open: typed text is a remark
    await w.store.saveSession({ phone: ADMIN.phone, flow: "tasks", step: "detail", data: { taskId: "t1" }, updatedAt: NOW.toISOString() });
    const out = await handleMessage(w.ctx, say("customer ne kal bola"));
    expect(first(out)).toContain("remark save ho gaya");
    expect(w.chat.understand).not.toHaveBeenCalled();
  });

  it("an expired session still says so; the chat is not asked", async () => {
    const w = setup(ADMIN, ok({ kind: "other" }));
    await w.store.saveSession({ phone: ADMIN.phone, flow: "create_task", step: "ask_title", data: {}, updatedAt: "2026-10-26T08:00:00.000Z" });
    const out = await handleMessage(w.ctx, say("GST kya hai"));
    expect(first(out)).toContain("Session expire ho gaya");
    expect(w.chat.understand).not.toHaveBeenCalled();
  });

  it("taps, voice and forms are not chat input", async () => {
    const w = setup(ADMIN, ok({ kind: "other" }));
    expect(first(await handleMessage(w.ctx, tap("tasks:task:t1")))).toContain("Session expire ho gaya");
    await handleMessage(w.ctx, { text: "", reply: null, voice: { mediaUrl: "https://x/v.ogg" } });
    expect(w.chat.understand).not.toHaveBeenCalled();
  });

  it("an open chat list: a tap opens the detail; typed text goes back to the chat; another person's task is refused", async () => {
    ans.fn.mockImplementation(async (_s: unknown, u: User) => [list(u.phone, "x", "Task chuno", [{ id: "tasks:task:t1", title: "a" }])]);
    const w = setup(STAFF_DURG, ok(WEEK), [task({ id: "t1" }), task({ id: "t9", title: "Raipur ka kaam", assigneePhone: STAFF_RAIPUR.phone, assigneeName: "Chikku", branch: "RAIPUR", createdByPhone: ADMIN.phone })]);
    await handleMessage(w.ctx, say("is hafte ka kya hai"));
    // typed follow-up goes to the chat again (and the old list session is dropped)
    await handleMessage(w.ctx, say("aur kal ka kya hai"));
    expect(w.chat.understand).toHaveBeenCalledTimes(2);
    // forged tap on another person's task
    const bad = await handleMessage(w.ctx, tap("tasks:task:t9"));
    expect(first(bad)).toBe("Ye task aapka nahi hai.");
    await handleMessage(w.ctx, say("phir se is hafte ka"));
    const detail = await handleMessage(w.ctx, tap("tasks:task:t1"));
    expect(detail[0].kind).toBe("buttons");
    expect(first(detail)).toContain("Sharma ji se payment lena");
    // now the detail is open: typed text is a remark, not chat
    const calls = w.chat.understand.mock.calls.length;
    await handleMessage(w.ctx, say("kal tak ho jayega"));
    expect(w.chat.understand.mock.calls.length).toBe(calls);
  });
});

describe("daily counter in the stores", () => {
  it("MemoryStore counts per key", async () => {
    const s = new MemoryStore();
    expect(await s.bumpDailyCount("ai:1:2026-10-26", NOW)).toBe(1);
    expect(await s.bumpDailyCount("ai:1:2026-10-26", NOW)).toBe(2);
    expect(await s.bumpDailyCount("ai:2:2026-10-26", NOW)).toBe(1);
    expect(await s.bumpDailyCount("ai:1:2026-10-27", NOW)).toBe(1);
  });
});
