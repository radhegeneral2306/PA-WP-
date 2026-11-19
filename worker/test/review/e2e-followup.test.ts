// Fix agent F (round 7 review): unusable follow-ups cost no AI call, menu words clear the memory, a new list drops the
// old selection, a typed follow-up works after the 2-minute picker session, bare numbers in odd forms, clip().
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { say, tap, STAFF_DURG } from "../helpers/bot";
import { addTester, removeTester, all, body, mk, rowIds, world } from "./e2e-helpers";
import { chatCountKey } from "../../src/bot/flows/chat";
import { clip } from "../../src/bot/ui";
import { canUseChatMemory, CHAT_TESTERS } from "../../src/bot/router";
import * as flags from "../../src/bot/chatFlags";

// Works with the stub and with the real looksLikeFollowup of agent R.
vi.mock("../../src/chat/rules", async (orig) => {
  const actual = await orig<typeof import("../../src/chat/rules")>();
  return {
    ...actual,
    looksLikeFollowup: (t: string) =>
      actual.looksLikeFollowup(t) || /^\s*(?:#?\d{1,2}|aur dikhao|iski due date kya hai|kitne remark hain|teesra wala kholo)\s*[.)]?\s*$/i.test(t),
  };
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  removeTester(STAFF_DURG.name);
  vi.restoreAllMocks();
});
const own = { assigneePhone: STAFF_DURG.phone, assigneeName: STAFF_DURG.name, branch: "DURG" as const };
const quota = (w: ReturnType<typeof world>) => w.store.bumpDailyCount(chatCountKey(w.user.phone, w.now()), w.now());

describe("unusable follow-ups: fixed answer, no AI, no counter", () => {
  it("no memory: bare number, 'aur dikhao' -> 'Pehle bataiye'; task question -> 'Kaunsa task?'", async () => {
    addTester(STAFF_DURG.name);
    const w = world(STAFF_DURG, mk(3, own, "P"));
    expect(all(await w.send(say("2")))).toContain("Pehle bataiye kya dekhna hai");
    expect(all(await w.send(say("aur dikhao")))).toContain("Pehle bataiye kya dekhna hai");
    expect(all(await w.send(say("iski due date kya hai")))).toContain("Kaunsa task?");
    expect(w.chat.understand).not.toHaveBeenCalled();
    expect(await quota(w)).toBe(1); // only this probe
  });

  it("number out of range: 'Itna number nahi hai. 1 se N tak ...' (N = shown count)", async () => {
    addTester(STAFF_DURG.name);
    const w = world(STAFF_DURG, mk(3, own, "P"));
    await w.send(say("mere pending tasks dikhao"));
    for (const t of ["7", "7.", "#9", "number 12"]) {
      expect(all(await w.send(say(t))), t).toContain("Itna number nahi hai. 1 se 3 tak ka number likhiye.");
    }
    expect(w.chat.understand).not.toHaveBeenCalled();
    expect(await quota(w)).toBe(1);
  });

  it("task question with a list but nothing selected -> 'Kaunsa task?'", async () => {
    addTester(STAFF_DURG.name);
    const w = world(STAFF_DURG, mk(3, own, "P"));
    await w.send(say("mere pending tasks dikhao"));
    expect(all(await w.send(say("kitne remark hain")))).toContain("Kaunsa task?");
    expect(w.chat.understand).not.toHaveBeenCalled();
  });

  it("switch off: a bare number still goes where it went before (courtesy for short text)", async () => {
    const w = world(STAFF_DURG, mk(3, own, "P"));
    expect(all(await w.send(say("2")))).toContain("Menu ke liye *Hi*");
    expect(w.chat.understand).not.toHaveBeenCalled();
    expect(await w.store.getChatMemory(STAFF_DURG.phone)).toBeNull();
  });
});

describe("bare numbers in other forms open the task", () => {
  it.each(["2.", "2)", "#2", "2 ji", "2 number", "number 2", "No 2"])("%s", async (t) => {
    addTester(STAFF_DURG.name);
    const w = world(STAFF_DURG, mk(3, own, "P"));
    const l = await w.send(say("mere pending tasks dikhao"));
    expect(rowIds(l).length).toBeGreaterThan(0);
    const out = await w.send(say(t));
    expect(out[0].kind).toBe("buttons");
    expect(body(out[0])).toContain("P kaam 2");
  });
});

describe("menu / greeting / cancel words clear the memory (only with the switch)", () => {
  it("memory on: Hi, menu, band karo", async () => {
    addTester(STAFF_DURG.name);
    for (const t of ["Hi", "menu", "band karo"]) {
      const w = world(STAFF_DURG, mk(3, own, "P"));
      await w.send(say("mere pending tasks dikhao"));
      expect(await w.store.getChatMemory(STAFF_DURG.phone)).not.toBeNull();
      await w.send(say(t));
      expect(await w.store.getChatMemory(STAFF_DURG.phone), t).toBeNull();
    }
  });
  it("memory switch off: no memory call at all", async () => {
    const w = world(STAFF_DURG, mk(3, own, "P"));
    const clear = vi.spyOn(w.store, "clearChatMemory");
    await w.send(say("Hi"));
    expect(clear).not.toHaveBeenCalled();
  });
  it("a failing clear never breaks the menu", async () => {
    addTester(STAFF_DURG.name);
    const w = world(STAFF_DURG, mk(3, own, "P"));
    vi.spyOn(w.store, "clearChatMemory").mockRejectedValue(new Error("boom"));
    expect(all(await w.send(say("Hi")))).toContain("Namaste");
  });
});

describe("stale selection", () => {
  it("a new list clears the selected task; opening a task sets it again", async () => {
    addTester(STAFF_DURG.name);
    const w = world(STAFF_DURG, mk(3, own, "P"));
    await w.send(say("mere pending tasks dikhao"));
    await w.send(say("2"));
    expect((await w.store.getChatMemory(STAFF_DURG.phone))?.sel).toBe("P2");
    await w.send(say("mere pending tasks dikhao"));
    expect((await w.store.getChatMemory(STAFF_DURG.phone))?.sel).toBeNull();
    expect(all(await w.send(say("iski due date kya hai")))).toContain("Kaunsa task?");
    await w.send(say("3"));
    expect((await w.store.getChatMemory(STAFF_DURG.phone))?.sel).toBe("P3");
  });
});

describe("chat list picker (2 min) vs memory (15 min)", () => {
  it("typed follow-up after 5 min works; the old list's button still expires; after 16 min it expires as today", async () => {
    addTester(STAFF_DURG.name);
    const w = world(STAFF_DURG, mk(3, own, "P"));
    await w.send(say("mere pending tasks dikhao"));
    w.advance(5 * 60_000);
    expect((await w.send(say("pehla wala kholo")))[0].kind).toBe("buttons");

    const w2 = world(STAFF_DURG, mk(3, own, "P"));
    await w2.send(say("mere pending tasks dikhao"));
    w2.advance(5 * 60_000);
    expect(all(await w2.send(tap("tasks:task:P1")))).toContain("Session expire");

    const w3 = world(STAFF_DURG, mk(3, own, "P"));
    await w3.send(say("mere pending tasks dikhao"));
    w3.advance(16 * 60_000);
    expect(all(await w3.send(say("pehla wala kholo")))).toContain("Session expire");
  });

  it("only a chat list (chat=1) is affected: the plain 'Mere tasks' list still expires for typed text", async () => {
    addTester(STAFF_DURG.name);
    const w = world(STAFF_DURG, mk(3, own, "P"));
    await w.send(tap("MENU:my_tasks"));
    w.advance(3 * 60_000);
    expect(all(await w.send(say("pehla wala kholo")))).toContain("Session expire");
  });
});

describe("misc", () => {
  it("clip() never leaves a lone surrogate and stays within the limit", () => {
    for (let n = 3; n < 12; n++) {
      const s = clip("ab😀😀😀😀😀😀😀😀😀", n);
      expect(s.length).toBeLessThanOrEqual(n);
      expect(s).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    expect(clip("short", 10)).toBe("short");
    expect(clip("abcdefghij", 5)).toBe("abcd…");
  });
  it("router re-exports the flags", () => {
    expect(CHAT_TESTERS).toBe(flags.CHAT_TESTERS);
    expect(canUseChatMemory).toBe(flags.canUseChatMemory);
  });
  it("detail hint stays the old one when the detail switch is off", async () => {
    const w = world(STAFF_DURG, mk(2, own, "P"));
    await w.send(say("mere pending tasks dikhao"));
    const out = await w.send(tap("tasks:task:P1"));
    expect(body(out[0])).toContain("seedha likh ke bhej");
  });
});
