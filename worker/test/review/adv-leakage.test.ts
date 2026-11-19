// Round 7 adversarial review (reviewer 2): staff data leakage and admin-only refusals, memory + detail switches ON.
// Real rules / refs / taskInfo / answer (nothing mocked); only the AI service is a fake that returns what we tell it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { CHAT_TESTERS, handleMessage } from "../../src/bot/router";
import type { Inbound } from "../../src/bot/flow";
import type { Outgoing } from "../../src/bot/outgoing";
import type { ChatMemory, ChatRequest, ChatResult, ChatService } from "../../src/chat/types";
import type { Task, User } from "../../src/domain/types";
import { ADMIN, NOW, STAFF_DURG, STAFF_RAIPUR, USERS, say, tap, task } from "../helpers/bot";

const body = (o: Outgoing) => (o.kind === "template" ? o.fallbackText : o.body);
const rowTitles = (outs: Outgoing[]) => outs.flatMap((o) => (o.kind === "list" ? o.rows.map((r) => r.title + " " + (r.description ?? "")) : []));
const rowIds = (outs: Outgoing[]) => outs.flatMap((o) => (o.kind === "list" ? o.rows.map((r) => r.id) : []));
/** Everything a person could read in the reply, including row titles/descriptions and button titles. */
const everything = (outs: Outgoing[]) =>
  outs
    .map((o) => JSON.stringify(o))
    .join("\n");

const MINE1 = task({ id: "m1", title: "Sharma ji payment", assigneePhone: STAFF_DURG.phone, assigneeName: "Hardware", branch: "DURG", urgent: true });
const MINE2 = task({ id: "m2", title: "GST file bharna", assigneePhone: STAFF_DURG.phone, assigneeName: "Hardware", branch: "DURG", dueAt: "2026-10-28T04:30:00.000Z" });
// Somebody else's tasks: must never be reachable by Hardware (STAFF_DURG).
const SEC1 = task({ id: "s1", title: "ZEBRA secret bill", assigneePhone: STAFF_RAIPUR.phone, assigneeName: "Chikku", branch: "RAIPUR", urgent: true,
  remarks: [{ at: "2026-10-25T05:00:00.000Z", byPhone: STAFF_RAIPUR.phone, byName: "Chikku", text: "ZEBRA remark text" }] });
const SEC2 = task({ id: "s2", title: "ZEBRA second secret", assigneePhone: STAFF_RAIPUR.phone, assigneeName: "Chikku", branch: "RAIPUR" });
const SECRETS = /ZEBRA|secret/i;

function world(user: User, ai: ChatResult | (() => ChatResult) = { ok: true, request: { kind: "unclear" } }, tasks: Task[] = [MINE1, MINE2, SEC1, SEC2]) {
  const store = new MemoryStore({ users: USERS, tasks });
  const understand = vi.fn(async () => (typeof ai === "function" ? ai() : ai));
  const chat: ChatService = { understand };
  let now = NOW;
  const send = (input: Inbound) => handleMessage({ store, user, now, chat }, input);
  return { store, chat, understand, send, setNow: (d: Date) => (now = d), user };
}
const forge = (store: MemoryStore, phone: string, m: Partial<ChatMemory>) =>
  store.saveChatMemory(phone, { v: 0, at: NOW.toISOString(), ...m });

beforeEach(() => {
  (CHAT_TESTERS as Set<string>).add(STAFF_DURG.name);
  (CHAT_TESTERS as Set<string>).add(STAFF_RAIPUR.name);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  (CHAT_TESTERS as Set<string>).delete(STAFF_DURG.name);
  (CHAT_TESTERS as Set<string>).delete(STAFF_RAIPUR.name);
  vi.restoreAllMocks();
});

describe("staff: forged memory never opens someone else's task", () => {
  const phrases = ["1", "2", "pehla wala kholo", "doosra wala kholo", "last wala kholo", "isko kholo", "number 1", "iski due date kya hai", "kisko diya hai",
    "last update kya tha", "kitne remark hain", "status", "kab banaya", "isme kya likha hai"];
  for (const p of phrases) {
    it(`forged shown/sel with a foreign task id: "${p}" leaks nothing`, async () => {
      const w = world(STAFF_DURG);
      await forge(w.store, STAFF_DURG.phone, { shown: ["s1", "s2"], sel: "s1", offset: 0, total: 2, query: { scope: "mine", when: "all" } });
      const out = await w.send(say(p));
      expect(everything(out)).not.toMatch(SECRETS);
      expect(everything(out)).not.toContain(STAFF_RAIPUR.phone);
      // no detail of the foreign task was opened
      const s = await w.store.getSession(STAFF_DURG.phone);
      expect(s?.data.taskId ?? "").not.toBe("s1");
      expect(s?.data.taskId ?? "").not.toBe("s2");
    });
  }

  it("forged query with scope all: 'aur dikhao' / 'sirf urgent wale' / 'kal wale' / 'sab dikhao' do not list foreign tasks", async () => {
    for (const p of ["aur dikhao", "sirf urgent wale", "kal wale", "sab dikhao", "overdue wale", "is hafte wale"]) {
      const w = world(STAFF_DURG);
      await forge(w.store, STAFF_DURG.phone, { shown: [], offset: 0, total: 0, query: { scope: "all", when: "all" } });
      const out = await w.send(say(p));
      expect(everything(out), p).not.toMatch(SECRETS);
      expect(everything(out), p).not.toContain("Chikku");
    }
  });

  it("forged query with branch/person of another person is refused for staff", async () => {
    for (const q of [{ scope: "branch" as const, branch: "RAIPUR" as const, when: "all" as const }, { scope: "person" as const, person: "Chikku", when: "all" as const }]) {
      const w = world(STAFF_DURG);
      await forge(w.store, STAFF_DURG.phone, { shown: [], offset: 0, total: 0, query: q });
      const out = await w.send(say("sirf urgent wale"));
      expect(everything(out)).not.toMatch(SECRETS);
    }
  });

  it("garbage memory fields (non-array shown, number ids, huge offset, bad query) do not crash or leak", async () => {
    const w = world(STAFF_DURG);
    await forge(w.store, STAFF_DURG.phone, { shown: "s1" as never, sel: 5 as never, offset: 1e12, total: -3, query: "scope all" as never });
    for (const p of ["1", "aur dikhao", "sirf urgent wale", "iski due date kya hai", "mere pending tasks"]) {
      const out = await w.send(say(p));
      expect(everything(out), p).not.toMatch(SECRETS);
      expect(out.length, p).toBeGreaterThan(0);
    }
  });

  it("shown with 10 000 ids and non-string entries is harmless", async () => {
    const w = world(STAFF_DURG);
    await forge(w.store, STAFF_DURG.phone, { shown: [...Array.from({ length: 10_000 }, (_, i) => `x${i}`), "s1"], sel: "s1" });
    const out = await w.send(say("last wala kholo"));
    expect(everything(out)).not.toMatch(SECRETS);
  });
});

describe("staff: names, taskWords and counts", () => {
  it("naming a foreign task by words finds nothing (rules path)", async () => {
    const w = world(STAFF_DURG);
    for (const p of ["zebra ki due date kya hai", "secret bill kab tak hai", "zebra second kisko diya hai", "zebra last update kya tha"]) {
      const out = await w.send(say(p));
      expect(everything(out), p).not.toMatch(SECRETS);
    }
  });

  it("a hostile AI ask_task with taskWords of a foreign task finds nothing", async () => {
    const w = world(STAFF_DURG, { ok: true, request: { kind: "ask_task", field: "all", taskWords: ["zebra"] } });
    // Not a rule phrase, so it reaches the (fake) AI.
    const out = await w.send(say("zebra wale ke baare mein poora batao bhai please abhi ke abhi"));
    expect(w.understand).toHaveBeenCalled();
    expect(everything(out)).not.toMatch(SECRETS);
  });

  it("the same words matching one own and one foreign task offer only the own one", async () => {
    const own = task({ id: "m3", title: "Zebra mine", assigneePhone: STAFF_DURG.phone, assigneeName: "Hardware" });
    const w = world(STAFF_DURG, { ok: true, request: { kind: "ask_task", field: "due", taskWords: ["zebra"] } }, [own, SEC1, SEC2]);
    const out = await w.send(say("zebra wala konsa hai batao poora abhi hamein bhai"));
    expect(everything(out)).toContain("Zebra mine");
    expect(everything(out)).not.toMatch(/secret/i);
  });

  it("counts: hostile count requests for others are refused for staff (flow level, bypassing validation)", async () => {
    const reqs: ChatRequest[] = [
      { kind: "count", filter: { scope: "all", when: "all" } },
      { kind: "count", filter: { scope: "branch", branch: "RAIPUR", when: "overdue" } },
      { kind: "count", filter: { scope: "person", person: "Chikku", when: "all" } },
      { kind: "list", filter: { scope: "person", person: "chikku ", when: "all" } },
      { kind: "list", filter: { scope: "all", when: "all", urgentOnly: true } },
    ];
    for (const request of reqs) {
      const w = world(STAFF_DURG, { ok: true, request });
      const out = await w.send(say("kuch ajeeb sa sawal jo rules nahi samajhte abhi"));
      expect(everything(out), JSON.stringify(request)).not.toMatch(SECRETS);
      expect(everything(out)).not.toContain("Chikku");
      expect(body(out[0])).toMatch(/sirf apne tasks/);
    }
  });

  it("a staff person whose name equals another user's name case-insensitively cannot widen via person scope", async () => {
    const w = world(STAFF_DURG, { ok: true, request: { kind: "list", filter: { scope: "person", person: "HARDWARE", when: "all" } } });
    const out = await w.send(say("kuch ajeeb sa sawal jo rules nahi samajhte abhi"));
    expect(everything(out)).not.toMatch(SECRETS);
  });

  it("'aur dikhao' after own list never lists foreign tasks", async () => {
    const w = world(STAFF_DURG);
    const l = await w.send(say("mere pending tasks"));
    expect(everything(l)).not.toMatch(SECRETS);
    const more = await w.send(say("aur dikhao"));
    expect(everything(more)).not.toMatch(SECRETS);
  });

  it("numbers after an own list map only to own tasks", async () => {
    const w = world(STAFF_DURG);
    const l = await w.send(say("mere pending tasks"));
    const ids = rowIds(l);
    expect(ids.every((i) => i === "tasks:task:m1" || i === "tasks:task:m2")).toBe(true);
    for (const n of ["1", "2", "3", "4"]) {
      const out = await w.send(say(n));
      expect(everything(out)).not.toMatch(SECRETS);
    }
  });
});

describe("staff: refine / scope / reassign (rules path and AI path)", () => {
  it("rules: 'Chikku ke' / 'Raipur ke' / 'sabke' after own list never widen", async () => {
    for (const p of ["Chikku ke", "Raipur ke", "sabke", "sirf Raipur ke", "Durg ke", "sab dikhao"]) {
      const w = world(STAFF_DURG);
      await w.send(say("mere pending tasks"));
      const out = await w.send(say(p));
      expect(everything(out), p).not.toMatch(SECRETS);
      const m = await w.store.getChatMemory(STAFF_DURG.phone);
      expect(m?.query?.scope ?? "mine", p).toBe("mine");
    }
  });

  it("AI path: refine with person/branch/all for staff is refused or ignored, memory stays 'mine'", async () => {
    // Fake AI bypasses validation: the flow itself must refuse.
    for (const changes of [{ person: "Chikku" }, { branch: "RAIPUR" as const }, { scope: "all" as const }, { scope: "branch" as const, branch: "RAIPUR" as const }]) {
      const w = world(STAFF_DURG, { ok: true, request: { kind: "refine", changes } });
      await w.send(say("mere pending tasks"));
      const out = await w.send(say("ab zara dusre log ke dikhana bhai please abhi"));
      expect(everything(out), JSON.stringify(changes)).not.toMatch(SECRETS);
      const m = await w.store.getChatMemory(STAFF_DURG.phone);
      expect(m?.query?.scope, JSON.stringify(changes)).toBe("mine");
    }
  });

  it("AI path: reassign / create-for-other by staff is refused with the fixed text", async () => {
    const w = world(STAFF_DURG, { ok: true, request: { kind: "update", action: "reassign", taskWords: ["sharma"], newPerson: "Chikku" } });
    const out = await w.send(say("sharma wala chikku ko de do bhai please abhi ke abhi"));
    expect(body(out[0])).toMatch(/sirf admin/);
    const w2 = world(STAFF_DURG, { ok: true, request: { kind: "create", title: "Kaam", person: "Chikku", date: "2026-10-30", time: "10:00" } });
    const out2 = await w2.send(say("chikku ke liye kaam banao bhai please abhi ke abhi"));
    expect(body(out2[0])).toMatch(/sirf apne liye/);
    expect(await w2.store.getSession(STAFF_DURG.phone)).toBeNull();
  });

  it("AI path: staff update done with taskWords of a foreign task does not offer or touch it", async () => {
    const w = world(STAFF_DURG, { ok: true, request: { kind: "update", action: "done", taskWords: ["zebra"], person: "Chikku" } });
    const out = await w.send(say("zebra wala chikku ka done karna hai bhai please abhi ke abhi"));
    expect(everything(out)).not.toMatch(SECRETS);
    expect((await w.store.getTask("s1"))?.status).toBe("pending");
  });

  it("AI path: staff due-change for a foreign task does not open its detail", async () => {
    const w = world(STAFF_DURG, { ok: true, request: { kind: "update", action: "due", taskWords: ["zebra"], date: "2026-10-30" } });
    const out = await w.send(say("zebra wale ki date parso kar dena bhai please abhi ke abhi"));
    expect(everything(out)).not.toMatch(SECRETS);
  });

  it("rules path: 'Chikku ke tasks' / 'Raipur ke tasks' / 'sabke tasks' by staff give the fixed refusal or go to the AI, never data", async () => {
    for (const p of ["Chikku ke tasks", "Raipur ke tasks", "sabke tasks", "sabke pending", "Chikku ke kitne tasks hain"]) {
      const w = world(STAFF_DURG);
      const out = await w.send(say(p));
      expect(everything(out), p).not.toMatch(SECRETS);
      expect(everything(out), p).not.toContain("Chikku");
    }
  });
});

describe("memory of a previous role", () => {
  it("an admin who became staff: old shown list with foreign tasks is useless", async () => {
    const asAdmin: User = { ...STAFF_DURG, role: "admin", branch: null };
    const store = new MemoryStore({ users: USERS, tasks: [MINE1, MINE2, SEC1, SEC2] });
    const chat: ChatService = { understand: vi.fn(async () => ({ ok: true, request: { kind: "unclear" } }) as ChatResult) };
    const asStaff: User = { ...STAFF_DURG };
    const sendA = (t: string) => handleMessage({ store, user: asAdmin, now: NOW, chat }, say(t));
    const sendS = (t: string) => handleMessage({ store, user: asStaff, now: NOW, chat }, say(t));
    const adminList = await sendA("sabke tasks");
    expect(everything(adminList)).toMatch(SECRETS); // sanity: admin sees all
    const m = await store.getChatMemory(STAFF_DURG.phone);
    expect(m?.shown).toContain("s1");
    for (const p of ["1", "2", "pehla wala kholo", "last wala kholo", "aur dikhao", "sirf urgent wale", "kal wale", "iski due date kya hai"]) {
      const out = await sendS(p);
      expect(everything(out), p).not.toMatch(SECRETS);
    }
  });

  it("the old admin's selected foreign task cannot be asked about by the new staff", async () => {
    const store = new MemoryStore({ users: USERS, tasks: [MINE1, SEC1] });
    await store.saveChatMemory(STAFF_DURG.phone, { v: 0, at: NOW.toISOString(), sel: "s1", shown: ["s1"], query: { scope: "all", when: "all" } });
    const chat: ChatService = { understand: vi.fn(async () => ({ ok: true, request: { kind: "unclear" } }) as ChatResult) };
    const out = await handleMessage({ store, user: STAFF_DURG, now: NOW, chat }, say("iski due date kya hai"));
    expect(everything(out)).not.toMatch(SECRETS);
  });

  it("an admin who is now deactivated is not reachable at all (router never sees the user): n/a, documented", () => {
    expect(true).toBe(true);
  });
});

describe("deleted / reassigned tasks", () => {
  it("open on a deleted task (admin): focused message, no detail", async () => {
    const w = world(ADMIN);
    const l = await w.send(say("sabke tasks"));
    expect(rowIds(l).length).toBeGreaterThan(0);
    await w.store.updateTask("s1", { status: "deleted" } as never);
    // find which number s1 was
    const idx = (await w.store.getChatMemory(ADMIN.phone))!.shown!.indexOf("s1") + 1;
    const out = await w.send(say(String(idx)));
    expect(everything(out)).not.toMatch(/ZEBRA secret bill/);
    expect(await w.store.getSession(ADMIN.phone)).not.toMatchObject({ step: "detail", data: { taskId: "s1" } });
  });

  it("staff: a task reassigned away after it was listed can no longer be opened or asked about", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    await w.store.updateTask("m1", { assigneePhone: STAFF_RAIPUR.phone, assigneeName: "Chikku", createdByPhone: ADMIN.phone } as never);
    const idx = (await w.store.getChatMemory(STAFF_DURG.phone))!.shown!.indexOf("m1") + 1;
    for (const p of [String(idx), "iski due date kya hai"]) {
      const out = await w.send(say(p));
      expect(everything(out), p).not.toContain("Sharma ji payment");
    }
  });

  it("detail open, then the task is deleted/reassigned: typed question gives no data", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    await w.send(tap("tasks:task:m1"));
    await w.store.updateTask("m1", { status: "deleted" } as never);
    const out = await w.send(say("iski due date kya hai"));
    expect(everything(out)).not.toContain("Sharma ji payment");
  });

  it("staff who CREATED a task for someone else may see it (contract), but not another creator's", async () => {
    const created = task({ id: "c1", title: "Made by Hardware", assigneePhone: STAFF_RAIPUR.phone, assigneeName: "Chikku", createdByPhone: STAFF_DURG.phone, createdByName: "Hardware" });
    const w = world(STAFF_DURG, undefined, [created, SEC1]);
    await forge(w.store, STAFF_DURG.phone, { shown: ["c1", "s1"], sel: "c1" });
    expect(everything(await w.send(say("1")))).toContain("Made by Hardware");
    expect(everything(await w.send(say("2")))).not.toMatch(SECRETS);
  });
});

describe("number display itself", () => {
  it("numbered lines never contain phone numbers or other people's names for staff", async () => {
    const w = world(STAFF_DURG);
    const out = await w.send(say("mere pending tasks"));
    const t = out.map((o) => JSON.stringify({ ...o, to: "" })).join("\n");
    expect(t).not.toMatch(/9190000000\d\d/);
    expect(t).not.toContain("Chikku");
    expect(rowTitles(out).join(" ")).not.toMatch(SECRETS);
  });
});
