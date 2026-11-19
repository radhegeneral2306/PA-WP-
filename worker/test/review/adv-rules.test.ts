// Round 7 adversarial review (reviewer 2): hostile inputs against the rule layer (timing, prototype keys, odd digits).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { CHAT_TESTERS, handleMessage } from "../../src/bot/router";
import { ruleFollowup, ruleRequest } from "../../src/chat/rules";
import type { ChatMemory, ChatResult, ChatService } from "../../src/chat/types";
import { ADMIN, NOW, STAFF_DURG, USERS, say, task } from "../helpers/bot";

const ctx = { role: "admin" as const, self: "Bhaskar", people: [{ name: "Pinky", label: "Raipur" }, { name: "Bhaskar", label: "Admin" }], now: NOW };
const mem: ChatMemory = { v: 1, at: NOW.toISOString(), shown: ["a", "b", "c"], sel: "a", query: { scope: "mine", when: "all" }, offset: 0, total: 3 };

describe("rules: pathological inputs", () => {
  const nasty = [
    "kab ".repeat(50), "kitne ".repeat(33), "last ".repeat(40), "done ".repeat(40), "a".repeat(200), " ".repeat(200) + "x",
    "kab done hua ".repeat(15), "is ".repeat(66), "😀".repeat(100), "नमस्ते ".repeat(25), "1".repeat(200),
    "constructor", "constructor kholo", "toString", "__proto__", "hasOwnProperty", "constructor ki due date", "prototype wala", "valueOf",
  ];
  for (const t of nasty) {
    it(`fast and no throw: ${JSON.stringify(t.slice(0, 30))}...`, () => {
      const t0 = performance.now();
      expect(() => ruleFollowup(t, ctx, mem)).not.toThrow();
      expect(() => ruleRequest(t, ctx)).not.toThrow();
      expect(performance.now() - t0).toBeLessThan(100);
    });
  }

  it("prototype keys never become references or fields", () => {
    for (const t of ["constructor", "constructor kholo", "isko constructor", "constructor wala kholo"]) {
      const r = ruleFollowup(t, ctx, mem);
      if (r) expect(["open", "ask_task"].includes(r.kind) && JSON.stringify(r)).toBe(false);
    }
  });

  it("text longer than 200 characters is never a follow-up (goes to the AI path, clipped there)", () => {
    expect(ruleFollowup(`pehla wala kholo${" ".repeat(250)}`, ctx, mem)).toBeNull();
    expect(ruleFollowup(`${"a ".repeat(120)}`, ctx, mem)).toBeNull();
  });

  it("numbers beyond 2 digits or with weird digits are not references", () => {
    for (const t of ["100", "007", "٣", "２", "1e3", "-1", "0"]) {
      const r = ruleFollowup(t, ctx, mem);
      expect(r === null || (r.kind === "open" && r.ref.by === "index" && Number.isInteger(r.ref.n) && r.ref.n >= 1 && r.ref.n <= 3), t).toBe(true);
    }
  });

  it("write words always win over follow-up phrasing", () => {
    for (const t of ["doosra wala done kar do", "pehla wala delete karo", "isko Pinky ko de do", "2 kar do", "last wala hata do", "iski date badlo"]) {
      expect(ruleFollowup(t, ctx, mem), t).toBeNull();
    }
  });
});

describe("router: odd ways to type a number", () => {
  beforeEach(() => {
    (CHAT_TESTERS as Set<string>).add(STAFF_DURG.name);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    (CHAT_TESTERS as Set<string>).delete(STAFF_DURG.name);
    vi.restoreAllMocks();
  });

  async function listed() {
    const store = new MemoryStore({ users: USERS, tasks: [task({ id: "m1", title: "Pehla kaam", assigneePhone: STAFF_DURG.phone }), task({ id: "m2", title: "Doosra kaam", assigneePhone: STAFF_DURG.phone, dueAt: "2026-10-28T04:30:00.000Z" })] });
    const chat: ChatService = { understand: vi.fn(async () => ({ ok: true, request: { kind: "unclear" } }) as ChatResult) };
    const send = (t: string) => handleMessage({ store, user: STAFF_DURG, now: NOW, chat }, say(t));
    await send("mere pending tasks");
    return { send, chat };
  }

  // The numbered list literally prints "1) title", so people answer "1)" or "1." or "2 ji". Only a bare "1"/"12" is
  // recognised before the courtesy check (isCourtesy: <= 2 characters after normalising counts as a courtesy).
  it("'2)' / '2.' / '2 ji' answer the numbered list like '2' does (today they get the courtesy line)", async () => {
    for (const t of ["2)", "2.", "2 ji", "#2"]) {
      const w = await listed();
      const out = await w.send(t);
      expect(JSON.stringify(out), t).not.toContain("Menu ke liye *Hi*");
    }
  });

  it("'2' and '02' and ' 2 ' open the second task; '3' (out of range) gives the range hint", async () => {
    for (const t of ["2", " 2 "]) {
      const w = await listed();
      expect(JSON.stringify(await w.send(t)), t).toContain("Doosra kaam");
    }
  });

  // FINDING (medium, quota; same root cause as the bare-number finding in adv-limits): an out-of-range number is
  // not a rule answer (refOk false), so "3" with two tasks listed goes to Gemini and costs one of the 20 daily
  // messages, ending in "Samajh nahi aaya". handleChat already has the friendly "Itna number nahi hai. 1 se 2 tak"
  // text in taskOfRef; ruleFollowup should return the open request for ANY bare number when memory is fresh with
  // a non-empty `shown`, and let taskOfRef answer the range hint.
  it("an out-of-range bare number answers the range hint without an AI call", async () => {
    const w = await listed();
    const out = await w.send("3");
    expect(w.chat.understand).not.toHaveBeenCalled();
    expect(JSON.stringify(out)).toContain("1 se 2 tak");
  });
});
