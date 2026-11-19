// Round 7, agent C: routing + flow of the chat memory, end to end through the router. The rule layer's
// follow-ups, the reference resolver and the task answers (agent B) are replaced by small fakes here, so these
// tests check the routing, the execution, the permission re-checks and the memory handling only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { CHAT_DETAIL_LIVE, CHAT_MEMORY_LIVE, CHAT_TESTERS, canUseChatDetail, canUseChatMemory, handleMessage } from "../../src/bot/router";
import type { Inbound } from "../../src/bot/flow";
import type { Outgoing } from "../../src/bot/outgoing";
import { CHAT_MEMORY_MIN, type ChatFilter, type ChatMemory, type ChatRequest, type ChatResult, type ChatService } from "../../src/chat/types";
import type { Task, User } from "../../src/domain/types";
import { ADMIN, ADMIN2, NOW, STAFF_DURG, STAFF_RAIPUR, USERS, say, tap, task } from "../helpers/bot";

vi.mock("../../src/chat/rules", async (orig) => {
  const actual = await orig<typeof import("../../src/chat/rules")>();
  return {
    ...actual,
    ruleFollowup: (text: string, _c: unknown, memory: unknown): ChatRequest | null => {
      const t = text.toLowerCase().trim();
      if (t === "durg overdue") return { kind: "list", filter: { scope: "branch", branch: "DURG", when: "overdue" } };
      if (t === "sirf urgent wale") return memory ? { kind: "refine", changes: { urgentOnly: true } } : null;
      if (t === "pinky ke") return { kind: "refine", changes: { scope: "person", person: "Chikku" } };
      if (t === "aur dikhao") return { kind: "more" };
      if (t === "shuru se") return { kind: "reset" };
      if (t === "iski due date") return { kind: "ask_task", field: "due", ref: { by: "selected" } };
      if (t === "sharma ka due") return { kind: "ask_task", field: "due", taskWords: ["sharma"] };
      const m = /^(?:kholo |)(\d+)$/.exec(t);
      if (t === "doosra wala kholo") return { kind: "open", ref: { by: "index", n: 2 } };
      if (m) return { kind: "open", ref: { by: "index", n: Number(m[1]) } };
      return null;
    },
  };
});
vi.mock("../../src/chat/refs", () => ({
  memoryFresh: (m: ChatMemory | null, now: Date) => !!m && now.getTime() - Date.parse(m.at) < 15 * 60_000,
  resolveRef: (memory: ChatMemory | null, ref: { by: string; n?: number }, now: Date) => {
    if (!memory) return { ok: false, reason: "no_memory" };
    if (now.getTime() - Date.parse(memory.at) >= 15 * 60_000) return { ok: false, reason: "expired" };
    if (ref.by === "selected") return memory.sel ? { ok: true, taskId: memory.sel } : { ok: false, reason: "none_selected" };
    const shown = memory.shown ?? [];
    const id = ref.by === "last" ? shown[shown.length - 1] : shown[(ref.n ?? 0) - 1];
    return id ? { ok: true, taskId: id } : { ok: false, reason: "out_of_range" };
  },
  refineFilter: (prev: ChatFilter, ch: Partial<ChatFilter>) => ({ ...prev, ...ch }),
}));
vi.mock("../../src/chat/taskInfo", () => ({
  canSeeTask: (u: User, t: Task) => t.status !== "deleted" && (u.role === "admin" || t.assigneePhone === u.phone || t.createdByPhone === u.phone),
  describeTask: (t: Task, field: string) => `*${t.title}*\nDESCRIBE ${field} ${t.id}`, // the real one starts with the bold title
}));

const body = (o: Outgoing) => (o.kind === "template" ? o.fallbackText : o.body);
const all = (outs: Outgoing[]) => outs.map(body).join("\n");
const rowIds = (outs: Outgoing[]) => outs.flatMap((o) => (o.kind === "list" ? o.rows.map((r) => r.id) : []));

/** 12 overdue Durg tasks d1..d12 (d3 and d5 urgent), due one hour apart, oldest first. */
function durgTasks(): Task[] {
  return Array.from({ length: 12 }, (_, i) => {
    const due = new Date(Date.UTC(2026, 9, 20, 4, 30 + i * 60)).toISOString();
    return task({ id: `d${i + 1}`, title: `Kaam ${i + 1}`, dueAt: due, nextReminderAt: due, urgent: i === 2 || i === 4 });
  });
}
const RAIPUR_TASK = task({ id: "r1", title: "Raipur ka kaam", assigneePhone: STAFF_RAIPUR.phone, assigneeName: "Chikku", branch: "RAIPUR", createdByPhone: ADMIN.phone });

function world(user: User = ADMIN, tasks: Task[] = [...durgTasks(), RAIPUR_TASK], ai: ChatResult = { ok: true, request: { kind: "unclear" } }) {
  const store = new MemoryStore({ users: USERS, tasks });
  const chat: ChatService = { understand: vi.fn(async () => ai) };
  let now = NOW;
  const send = (input: Inbound) => handleMessage({ store, user, now, chat }, input);
  return { store, chat, send, setNow: (d: Date) => (now = d), user };
}

const mem = (w: ReturnType<typeof world>, u: User = w.user) => w.store.getChatMemory(u.phone);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  (CHAT_TESTERS as Set<string>).delete(STAFF_DURG.name);
  vi.restoreAllMocks();
});

describe("switches", () => {
  it("both are false in the committed code; the tester gets both, others do not", () => {
    expect(CHAT_DETAIL_LIVE).toBe(false);
    expect(CHAT_MEMORY_LIVE).toBe(false);
    expect(canUseChatDetail(ADMIN)).toBe(true);
    expect(canUseChatMemory(ADMIN)).toBe(true);
    expect(canUseChatDetail(STAFF_DURG)).toBe(false);
    expect(canUseChatMemory(ADMIN2)).toBe(false);
  });
});

describe("switch off (not a tester): exactly the old behaviour", () => {
  it("typed text on a task detail is a remark; no memory is written; lists are not numbered", async () => {
    const w = world(STAFF_DURG);
    const list = await w.send(say("mere pending tasks dikhao"));
    expect(all(list)).not.toMatch(/\d\) /);
    await w.send(tap("tasks:task:d1"));
    const out = await w.send(say("iski due date"));
    expect(body(out[0])).toMatch(/remark/i);
    expect((await w.store.getTask("d1"))?.remarks).toHaveLength(1);
    expect(await mem(w)).toBeNull();
  });

  it("the memory kinds from the AI are answered as unclear", async () => {
    const w = world(STAFF_DURG, undefined, { ok: true, request: { kind: "more" } });
    const out = await w.send(say("kuch bhi likha hua hai yahan"));
    expect(all(out)).toContain("Samajh nahi aaya");
    expect(await mem(w)).toBeNull();
  });
});

describe("detail text goes to chat (tester)", () => {
  async function openD1(w: ReturnType<typeof world>) {
    await w.send(say("durg overdue"));
    return w.send(tap("tasks:task:d1"));
  }

  it("answers about the open task, the remark count stays, the session stays intact", async () => {
    const w = world();
    const detail = await openD1(w);
    expect(detail[0].kind).toBe("buttons");
    const out = await w.send(say("iski due date"));
    expect(all(out)).toContain("DESCRIBE due d1");
    expect((await w.store.getTask("d1"))?.remarks).toHaveLength(0);
    expect(await w.store.getSession(ADMIN.phone)).toMatchObject({ flow: "tasks", step: "detail", data: { taskId: "d1" } });
    expect((await mem(w))?.sel).toBe("d1");
  });

  it("the Update button still saves the typed text as a remark", async () => {
    const w = world();
    await openD1(w);
    const ask = await w.send(tap("tasks:act:update:d1"));
    expect(body(ask[0])).toMatch(/remark/i);
    await w.send(say("kal tak ho jayega"));
    const t = await w.store.getTask("d1");
    expect(t?.remarks).toHaveLength(1);
    expect(t?.remarks[0].text).toBe("kal tak ho jayega");
  });

  it("courtesy and greetings are still handled first", async () => {
    const w = world();
    await openD1(w);
    expect(all(await w.send(say("ok")))).toContain("Menu ke liye");
    expect((await w.store.getTask("d1"))?.remarks).toHaveLength(0);
    expect(all(await w.send(say("hi")))).toContain("Namaste");
    expect(await w.store.getSession(ADMIN.phone)).toBeNull();
  });

  it("an open input step never reaches chat", async () => {
    const w = world();
    await openD1(w);
    await w.send(tap("tasks:act:update:d1"));
    await w.send(say("durg overdue")); // typed in the remark step: becomes the remark
    expect((await w.store.getTask("d1"))?.remarks[0]?.text).toBe("durg overdue");
  });

  it("an expired detail session is still 'expire ho gaya'", async () => {
    const w = world();
    await openD1(w);
    w.setNow(new Date(NOW.getTime() + 6 * 60_000));
    expect(all(await w.send(say("iski due date")))).toContain("Session expire ho gaya");
  });
});

describe("follow-up chain", () => {
  it("Durg overdue -> sirf urgent wale -> doosra wala kholo opens the 2nd task actually shown", async () => {
    const w = world();
    const first = await w.send(say("durg overdue"));
    expect(body(first[0])).toMatch(/^.*12.*tasks hain\. 1–8 \/ 12 dikhaye\./s);
    expect(body(first[0])).toContain("1) 🔴 Kaam 3");
    const m1 = await mem(w);
    expect(m1?.shown).toEqual(rowIds(first).map((r) => r.replace("tasks:task:", "")));
    expect(m1?.query).toEqual({ scope: "branch", branch: "DURG", when: "overdue" });

    const urgent = await w.send(say("sirf urgent wale"));
    expect(rowIds(urgent)).toEqual(["tasks:task:d3", "tasks:task:d5"]);
    expect(body(urgent[0])).toContain("Durg"); // the branch is kept
    expect((await mem(w))?.query).toMatchObject({ branch: "DURG", when: "overdue", urgentOnly: true });

    const opened = await w.send(say("doosra wala kholo"));
    expect(body(opened[0])).toContain("Kaam 5");
    expect(opened[0].kind).toBe("buttons");
    expect((await mem(w))?.sel).toBe("d5");
    expect(await w.store.getSession(ADMIN.phone)).toMatchObject({ step: "detail", data: { taskId: "d5" } });
    expect(w.chat.understand).not.toHaveBeenCalled();
  });

  it("aur dikhao pages through the same query, then says everything was shown", async () => {
    const w = world();
    await w.send(say("durg overdue"));
    const page2 = await w.send(say("aur dikhao"));
    expect(body(page2[0])).toContain("9–12 / 12 dikhaye");
    expect(body(page2[0])).toContain("1) ");
    expect(rowIds(page2)).toHaveLength(4);
    expect(await mem(w)).toMatchObject({ offset: 8, total: 12 });
    const done = await w.send(say("aur dikhao"));
    expect(all(done)).toContain("Saare *12* tasks dikha diye");
    expect(rowIds(done)).toHaveLength(0);
    expect((await mem(w))?.shown).toHaveLength(4); // unchanged by the empty page
  });

  it("a number answers from the page that was shown last", async () => {
    const w = world();
    await w.send(say("durg overdue"));
    await w.send(say("aur dikhao"));
    const out = await w.send(say("2")); // 2nd of 9..12 = d10
    expect(body(out[0])).toContain("Kaam 10");
  });

  it("no earlier query: one focused line", async () => {
    const w = world();
    const a = world(ADMIN, undefined, { ok: true, request: { kind: "refine", changes: { urgentOnly: true } } });
    expect(all(await a.send(say("kuch alag likha hua")))).toContain("Pehle bataiye");
    // the rule needs a memory; the text looks like a follow-up, so it gets the fixed line (no AI call, no quota)
    expect(all(await w.send(say("sirf urgent wale")))).toContain("Pehle bataiye");
    expect(w.chat.understand).not.toHaveBeenCalled();
  });

  it("an expired memory is forgotten: one question", async () => {
    const w = world();
    await w.send(say("durg overdue"));
    await w.store.clearSession(ADMIN.phone); // (the list session itself expires after 2 minutes)
    w.setNow(new Date(NOW.getTime() + (CHAT_MEMORY_MIN + 1) * 60_000));
    const out = await w.send(say("doosra wala kholo"));
    expect(all(out)).toContain("Kaunsa task?");
    expect(rowIds(out)).toHaveLength(0);
  });

  it("a number out of range says how many there are", async () => {
    const w = world();
    await w.send(say("durg overdue"));
    expect(all(await w.send(say("kholo 9")))).toContain("1 se 8 tak");
    expect(all(await w.send(say("kholo 0")))).toContain("1 se 8 tak");
  });

  it("reset clears the memory", async () => {
    const w = world();
    await w.send(say("durg overdue"));
    expect(all(await w.send(say("shuru se")))).toContain("naye sire se");
    expect(await mem(w)).toBeNull();
    expect(all(await w.send(say("2")))).toContain("Kaunsa task?");
  });

  it("a task deleted after it was listed is 'not found' and never opens", async () => {
    const w = world();
    await w.send(say("durg overdue"));
    await w.store.updateTask("d3", { status: "deleted" }); // the first row (urgent tasks come first)
    const out = await w.send(say("kholo 1"));
    expect(all(out)).toContain("nahi mila");
    expect(out.some((o) => o.kind === "buttons")).toBe(false);
  });
});

describe("asking about a task", () => {
  it("by name: one match is answered without changing anything", async () => {
    const tasks = [task({ id: "s1", title: "Sharma ji payment" }), task({ id: "o1", title: "Stock ginna" })];
    const w = world(ADMIN, tasks);
    const out = await w.send(say("sharma ka due"));
    expect(all(out)).toContain("DESCRIBE due s1");
    expect(all(out)).toContain("Sharma ji payment");
    expect(await w.store.getTask("s1")).toEqual(tasks[0]);
    expect((await mem(w))?.sel).toBe("s1");
  });

  it("by name: several matches -> one numbered question (max 5), the number then opens that task", async () => {
    const tasks = Array.from({ length: 7 }, (_, i) => task({ id: `s${i + 1}`, title: `Sharma ji kaam ${i + 1}` }));
    const w = world(ADMIN, tasks);
    const out = await w.send(say("sharma ka due"));
    const lines = body(out[0]).split("\n").filter((l) => /^\d\) /.test(l));
    expect(lines).toHaveLength(5);
    expect(body(out[0])).toContain("Number likhiye");
    const shown = (await mem(w))?.shown ?? [];
    expect(shown).toHaveLength(5);
    const opened = await w.send(say("2"));
    expect(body(opened[0])).toContain(`kaam ${shown[1].slice(1)}`);
  });

  it("no match asks for a fragment", async () => {
    const w = world(ADMIN, [task({ id: "o1", title: "Stock ginna" })]);
    expect(all(await w.send(say("sharma ka due")))).toContain("ek hissa");
  });

  it("no selected task: asks which one", async () => {
    const w = world();
    expect(all(await w.send(say("iski due date")))).toContain("Kaunsa task?");
  });
});

describe("staff can never reach another person's task (tester staff)", () => {
  beforeEach(() => {
    (CHAT_TESTERS as Set<string>).add(STAFF_DURG.name);
  });

  it("a number that points to someone else's task (forged memory) is 'not found'", async () => {
    const w = world(STAFF_DURG);
    await w.store.saveChatMemory(STAFF_DURG.phone, { v: 0, at: NOW.toISOString(), shown: ["r1"], offset: 0, total: 1, sel: "r1" });
    const out = await w.send(say("1"));
    expect(all(out)).toContain("nahi mila");
    expect(out.some((o) => o.kind === "buttons")).toBe(false);
    const ask = await w.send(say("iski due date"));
    expect(all(ask)).toContain("nahi mila");
    expect(all(ask)).not.toContain("DESCRIBE");
  });

  it("a name only matches the staff member's own tasks", async () => {
    const w = world(STAFF_DURG, [...durgTasks(), RAIPUR_TASK]);
    const out = await w.send(say("sharma ka due"));
    expect(all(out)).toContain("ek hissa"); // nothing visible matched
    expect(all(out)).not.toContain("Raipur");
  });

  it("a refine towards another person is refused by the read layer", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks dikhao"));
    const out = await w.send(say("pinky ke"));
    expect(all(out)).toContain("Aap sirf apne tasks");
    expect(all(out)).not.toContain("Raipur");
  });

  it("their own list is numbered and the picker has only their tasks", async () => {
    const w = world(STAFF_DURG);
    const out = await w.send(say("mere pending tasks dikhao"));
    expect(body(out[0])).toContain("1) ");
    expect(rowIds(out)).not.toContain("tasks:task:r1");
  });
});

describe("memory store behaviour", () => {
  it("a list costs one read and one write of the memory", async () => {
    const w = world();
    const get = vi.spyOn(w.store, "getChatMemory");
    const save = vi.spyOn(w.store, "saveChatMemory");
    await w.send(say("durg overdue"));
    expect(get).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a version conflict: re-read once and apply on top of the other write", async () => {
    const w = world();
    const real = w.store.saveChatMemory.bind(w.store);
    let first = true;
    vi.spyOn(w.store, "saveChatMemory").mockImplementation(async (phone, m) => {
      if (first) {
        first = false;
        await real(phone, { v: 0, at: new Date(NOW.getTime() - 1000).toISOString(), sel: "d9" }); // another message got there first
        return false;
      }
      return real(phone, m);
    });
    await w.send(say("durg overdue"));
    const m = await mem(w);
    expect(m?.shown?.length).toBe(8);
    expect(m?.sel).toBeNull(); // a new list replaces the shown tasks, so an old selection (from the other write) is dropped
  });

  it("an older message never overwrites a newer memory", async () => {
    const w = world();
    const real = w.store.saveChatMemory.bind(w.store);
    let first = true;
    vi.spyOn(w.store, "saveChatMemory").mockImplementation(async (phone, m) => {
      if (first) {
        first = false;
        await real(phone, { v: 0, at: new Date(NOW.getTime() + 5000).toISOString(), shown: ["newer"], offset: 0, total: 1 });
        return false;
      }
      return real(phone, m);
    });
    await w.send(say("durg overdue"));
    expect((await mem(w))?.shown).toEqual(["newer"]);
  });

  it("two messages at once end with one valid memory and no crash", async () => {
    const w = world();
    const [a, b] = await Promise.all([w.send(say("durg overdue")), w.send(say("durg overdue"))]);
    expect(rowIds(a).length).toBeGreaterThan(0);
    expect(rowIds(b).length).toBeGreaterThan(0);
    expect((await mem(w))?.shown).toHaveLength(8);
  });

  it("a failing memory store never breaks the answer", async () => {
    const w = world();
    vi.spyOn(w.store, "getChatMemory").mockRejectedValue(new Error("boom"));
    vi.spyOn(w.store, "saveChatMemory").mockRejectedValue(new Error("boom"));
    const out = await w.send(say("durg overdue"));
    expect(body(out[0])).toContain("1) ");
  });

  it("the AI gets a compact summary (no ids) and its memory kinds are executed in code", async () => {
    const w = world(ADMIN, undefined, { ok: true, request: { kind: "open", ref: { by: "index", n: 1 } } });
    await w.send(say("durg overdue"));
    const out = await w.send(say("jo sabse upar hai wo dikhao zara"));
    expect(w.chat.understand).toHaveBeenCalledTimes(1);
    const ctx = (w.chat.understand as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(ctx.memory).toEqual({ query: { scope: "branch", branch: "DURG", when: "overdue" }, shown: 8, selectedTitle: null });
    expect(body(out[0])).toContain("Kaam 3"); // first row = urgent first
  });
});
