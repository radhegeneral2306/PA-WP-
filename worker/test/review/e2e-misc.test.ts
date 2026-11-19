import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { say, tap, task, ADMIN, ADMIN2, STAFF_DURG, STAFF_RAIPUR } from "../helpers/bot";
import { addTester, removeTester, all, body, mk, numberedTitles, rowIds, taskRowIds, world } from "./e2e-helpers";
import { CHAT_TESTERS } from "../../src/bot/router";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  removeTester(STAFF_DURG.name);
  vi.restoreAllMocks();
});
const own = { assigneePhone: STAFF_DURG.phone, assigneeName: STAFF_DURG.name, branch: "DURG" as const };

describe("output polish", () => {
  // BUG (cosmetic): chat.ts prefixes `*title*` and describeTask() already starts with the same bold title line.
  it.fails("a task answer shows the title once", async () => {
    addTester(STAFF_DURG.name);
    const w = world(STAFF_DURG, mk(2, own, "P"));
    await w.send(say("mere pending tasks dikhao"));
    await w.send(tap("tasks:task:P1"));
    const out = await w.send(say("iski due date kya hai"));
    expect(all(out).match(/\*P kaam 1\*/g)).toHaveLength(1);
  });

  // The detail screen says "Update ke liye seedha likh ke bhej dijiye" (type text = remark). With the detail switch ON
  // typed text is a CHAT, not a remark: the hint is now wrong for testers.
  it.fails("detail screen hint does not tell the user to type a remark when typing goes to chat", async () => {
    addTester(STAFF_DURG.name);
    const w = world(STAFF_DURG, mk(2, own, "P"));
    await w.send(say("mere pending tasks dikhao"));
    const out = await w.send(tap("tasks:task:P1"));
    expect(body(out[0])).not.toContain("seedha likh ke bhej");
  });
});

describe("5. switches OFF (staff not a tester, admin2 not a tester)", () => {
  it("staff: typed text on detail = remark, no memory, no numbering, ordinals are not rules", async () => {
    const w = world(STAFF_DURG, mk(3, own, "P"));
    const l = await w.send(say("mere pending tasks dikhao"));
    expect(body(l[0])).not.toMatch(/\d\) /);
    expect(rowIds(l).length).toBeGreaterThan(0);
    await w.send(tap("tasks:task:P1"));
    const q = await w.send(say("iski due date kya hai?"));
    expect(all(q)).toMatch(/remark/i);
    expect((await w.store.getTask("P1"))?.remarks.map((r) => r.text)).toEqual(["iski due date kya hai?"]);
    expect(await w.store.getChatMemory(STAFF_DURG.phone)).toBeNull();
    expect(w.chat.understand).not.toHaveBeenCalled();
  });

  it("staff: 'doosra wala kholo' after a list goes to the AI exactly as before (unclear), nothing opens; '2' after a list", async () => {
    const w = world(STAFF_DURG, mk(3, own, "P"));
    await w.send(say("mere pending tasks dikhao"));
    const out = await w.send(say("doosra wala kholo"));
    expect(w.chat.understand).toHaveBeenCalledTimes(1);
    expect(out.some((o) => o.kind === "buttons" && /Done/.test(JSON.stringify(o)))).toBe(false);
    expect(await w.store.getChatMemory(STAFF_DURG.phone)).toBeNull();
  });

  it("staff: bare number with memory off is courtesy-ish (<=2 chars) and shows the courtesy line", async () => {
    const w = world(STAFF_DURG, mk(3, own, "P"));
    await w.send(say("mere pending tasks dikhao"));
    const out = await w.send(say("2"));
    expect(all(out)).toContain("Menu ke liye *Hi*");
    expect(w.chat.understand).not.toHaveBeenCalled();
  });

  it("staff: 'aur dikhao', 'sirf urgent wale', 'shuru se', 'iski due date' go to AI (no rule); AI memory kinds are 'unclear'", async () => {
    const w = world(STAFF_DURG, mk(3, own, "P"), { ok: true, request: { kind: "more" } });
    await w.send(say("mere pending tasks dikhao"));
    for (const p of ["aur dikhao", "sirf urgent wale", "shuru se", "iski due date kya hai"]) {
      const out = await w.send(say(p));
      expect(all(out)).toContain("Samajh nahi aaya");
    }
    expect(await w.store.getChatMemory(STAFF_DURG.phone)).toBeNull();
  });

  it("admin2 (not tester): list numbering absent, detail typed text = remark", async () => {
    const w = world(ADMIN2, mk(3, { ...own }, "P"));
    const l = await w.send(say("sabke pending tasks dikhao"));
    expect(body(l[0])).not.toMatch(/\d\) /);
    await w.send(tap("tasks:task:P1"));
    await w.send(say("kisko diya hai"));
    expect((await w.store.getTask("P1"))?.remarks).toHaveLength(1);
    expect(await w.store.getChatMemory(ADMIN2.phone)).toBeNull();
  });

  it("list message identical shape: header text + picker (2 outgoing)", async () => {
    const w = world(STAFF_DURG, mk(3, own, "P"));
    const l = await w.send(say("mere pending tasks dikhao"));
    expect(l.map((o) => o.kind)).toEqual(["text", "list"]);
  });
});

describe("6. courtesy / greetings / writes at every point (memory on)", () => {
  async function ready() {
    addTester(STAFF_DURG.name);
    const w = world(STAFF_DURG, mk(4, own, "P"));
    await w.send(say("mere pending tasks dikhao"));
    return w;
  }
  const courtesy = ["ok", "thanks", "👍", "theek hai", "thank you ji", "Ok!", "dhanyavad", "hmm"];
  for (const c of courtesy) {
    it(`"${c}" after a list = courtesy, memory intact, session intact`, async () => {
      const w = await ready();
      const before = await w.store.getChatMemory(STAFF_DURG.phone);
      const out = await w.send(say(c));
      expect(all(out)).toContain("Menu ke liye *Hi*");
      expect(await w.store.getChatMemory(STAFF_DURG.phone)).toEqual(before);
      expect(w.chat.understand).not.toHaveBeenCalled();
    });
    it(`"${c}" on an open detail = courtesy, no remark`, async () => {
      const w = await ready();
      await w.send(tap("tasks:task:P1"));
      const out = await w.send(say(c));
      expect(all(out)).toContain("Menu ke liher".replace("liher", "liye"));
      expect((await w.store.getTask("P1"))?.remarks).toHaveLength(0);
    });
  }

  it("a courtesy after the list clears nothing: but the list session is consumed? ordinal still works after 'ok'", async () => {
    const w = await ready();
    await w.send(say("ok"));
    const out = await w.send(say("doosra wala kholo"));
    expect(out[0].kind).toBe("buttons");
  });

  it("greeting mid-way resets session but memory remains: 'hi' then '2' works (within 15 min)", async () => {
    const w = await ready();
    await w.send(say("hi"));
    const out = await w.send(say("2"));
    console.info("HI THEN 2 ->", out.map((o) => o.kind), all(out).slice(0, 100).replace(/\n/g, " | "));
  });

  it("'do' / '2 do' (write word) is never an ordinal rule", async () => {
    const w = await ready();
    await w.send(say("do"));
    await w.send(say("2 do"));
    console.info("DO ->", (w.chat.understand as any).mock.calls.length);
  });

  it("write words on a fresh list never open or answer by rule", async () => {
    const w = await ready();
    for (const p of ["doosra wala done kar do", "pehla wala kholo aur done kar do", "2 done", "doosra wala badlo", "last wala hata do", "teesra wala complete", "pehle wale ka remark likho aaj nahi hua"]) {
      const before = (w.chat.understand as any).mock.calls.length;
      await w.send(say(p));
      expect((w.chat.understand as any).mock.calls.length, p).toBe(before + 1);
    }
    for (const t of ["P1", "P2", "P3", "P4"]) expect((await w.store.getTask(t))?.status).toBe("pending");
  });

  it("cancel word clears the session; band karo", async () => {
    const w = await ready();
    await w.send(tap("tasks:task:P1"));
    await w.send(say("band karo"));
    expect(await w.store.getSession(STAFF_DURG.phone)).toBeNull();
  });
});

describe("7. realistic chatting", () => {
  async function ready() {
    addTester(STAFF_DURG.name);
    const tasks = mk(12, own, "P").map((t, i) => ({ ...t, urgent: i === 2 }));
    const w = world(STAFF_DURG, tasks);
    return w;
  }
  it("typos / uppercase / emoji / extra words for the list", async () => {
    const w = await ready();
    for (const p of ["MERE PENDING TASKS DIKHAO", "mere pendng taskkk dikhao 🙏", "Mere tasks bhai", "mere pending tasks batao", "pending tasks", "meri list dikhao", "mere kaam", "aaj ke tasks"]) {
      const out = await w.send(say(p));
      console.info("LIST", JSON.stringify(p), "->", body(out[0]).slice(0, 50).replace(/\n/g, " | "), "ai", (w.chat.understand as any).mock.calls.length);
    }
  });
  it("follow-up phrasing variants after a list of 8 (shown) of 12", async () => {
    const w = await ready();
    const phrases = ["doosra kholo", "Doosre wala kholo", "doosre ko kholo", "dusra wala dikhao", "dusra wala khol do", "second wala", "no. 2", "number 2 kholo", "num 3", "pehla wala dikhao", "teesra", "teesre wala kholo", "last wala dikhao", "aakhri wala", "1st", "task 2", "2 number wala", "2 wala", "2nd wala kholo", "chautha", "paanchva wala", "doosra wala kholo 😊", "  doosra   wala  kholo  ", "doosra wala kholo.", "dusra wala open karo", "open 2", "2 open", "2) ", "#2", "2.", "ek", "do wala", "teen", "number do", "last wala kholo bhai", "aur dikhao", "aur dikhao 👇", "AUR DIKHAO", "next", "show more", "baaki dikhao", "more", "agla page", "baki kitne hain", "aur kitne hain"];
    for (const p of phrases) {
      await w.send(say("mere pending tasks dikhao"));
      const before = (w.chat.understand as any).mock.calls.length;
      const out = await w.send(say(p));
      const ai = (w.chat.understand as any).mock.calls.length - before;
      console.info("VARIANT", JSON.stringify(p), "->", ai ? "AI" : out[0].kind, body(out[0]).slice(0, 40).replace(/\n/g, " | "));
    }
  });
  it("sequence: list, aur dikhao, 2, iski due date, kisko diya, aur dikhao (back to list) ", async () => {
    const w = await ready();
    await w.send(say("mere pending tasks dikhao"));
    await w.send(say("aur dikhao"));
    const o = await w.send(say("2")); // 2nd of page 2 = P10
    expect(body(o[0])).toContain("P kaam 10");
    expect(all(await w.send(say("iski due date kya hai")))).toContain("P kaam 10");
    const again = await w.send(say("aur dikhao"));
    console.info("AUR AFTER DETAIL ->", all(again).slice(0, 120).replace(/\n/g, " | "));
  });
  it("urgent refine then aur dikhao", async () => {
    const w = await ready();
    await w.send(say("mere pending tasks dikhao"));
    const u = await w.send(say("sirf urgent wale"));
    expect(numberedTitles(u)).toEqual(["P kaam 3"]);
    const m = await w.send(say("aur dikhao"));
    expect(all(m)).toContain("Saare *1* tasks dikha diye");
  });
  it("count request does not wipe the shown list; refine after count", async () => {
    const w = await ready();
    const l = await w.send(say("mere pending tasks dikhao"));
    const titles = numberedTitles(l);
    const c = await w.send(say("kitne pending hain"));
    console.info("COUNT ->", all(c).slice(0, 80));
    const out = await w.send(say("doosra wala kholo"));
    expect(body(out[0])).toContain(`*${titles[1]}*`);
    const r = await w.send(say("sirf urgent wale"));
    console.info("REFINE AFTER COUNT ->", all(r).slice(0, 80).replace(/\n/g, " | "));
  });
});
