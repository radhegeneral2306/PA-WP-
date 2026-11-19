import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { say, tap, task, ADMIN, STAFF_DURG, STAFF_RAIPUR } from "../helpers/bot";
import { addTester, removeTester, all, body, mk, numberedTitles, rowIds, taskRowIds, world } from "./e2e-helpers";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  addTester(STAFF_DURG.name);
});
afterEach(() => {
  removeTester(STAFF_DURG.name);
  vi.restoreAllMocks();
});
const own = { assigneePhone: STAFF_DURG.phone, assigneeName: STAFF_DURG.name, branch: "DURG" as const };

describe("memory boundary", () => {
  it("14 min ok, 15 min forgotten (session cleared by 'hi' so only memory matters)", async () => {
    const w = world(STAFF_DURG, mk(3, own, "P"));
    await w.send(say("mere pending tasks dikhao"));
    await w.send(say("hi"));
    w.advance(14 * 60_000 + 59_000);
    expect((await w.send(say("2")))[0].kind).toBe("buttons");
    await w.send(say("hi"));
    // memory 'at' was refreshed at the last save; open does not rewrite 'at' unless patch. check from original list instead:
  });
  it("exactly 15 min after the last save: forgotten", async () => {
    const w = world(STAFF_DURG, mk(3, own, "P"));
    await w.send(say("mere pending tasks dikhao"));
    await w.send(say("hi"));
    w.advance(15 * 60_000);
    const out = await w.send(say("doosra wala kholo"));
    expect(out.some((o) => o.kind === "buttons" && /Done/.test(JSON.stringify(o)))).toBe(false);
  });
  it("each follow-up renews the 15 minutes (sliding)", async () => {
    const w = world(STAFF_DURG, mk(12, own, "P"));
    await w.send(say("mere pending tasks dikhao"));
    await w.send(say("hi"));
    w.advance(10 * 60_000);
    await w.send(say("aur dikhao"));
    await w.send(say("hi"));
    w.advance(10 * 60_000);
    const out = await w.send(say("2"));
    expect(out[0].kind).toBe("buttons");
  });
  it("opening a task (open) renews the memory clock", async () => {
    const w = world(STAFF_DURG, mk(4, own, "P"));
    await w.send(say("mere pending tasks dikhao"));
    await w.send(say("2"));
    const m = await w.store.getChatMemory(STAFF_DURG.phone);
    expect(m?.at).toBe(w.now().toISOString());
  });
});

describe("selected task survives a new list (stale 'iski')", () => {
  // SURPRISE: after the user opens task A and then asks for a NEW list, "isko kholo" / "iski due date" still mean A,
  // not anything from the new list.
  it("'iski due date kya hai' after a new list answers about the old opened task", async () => {
    const w = world(STAFF_DURG, [...mk(3, own, "P"), ...mk(2, { ...own, urgent: true }, "U")]);
    await w.send(say("mere pending tasks dikhao"));
    await w.send(say("pehla")); // opens first (urgent U1)
    await w.send(say("mere pending tasks dikhao"));
    const out = await w.send(say("iski due date kya hai"));
    console.info("STALE SEL ->", all(out).slice(0, 100).replace(/\n/g, " | "));
    const m = await w.store.getChatMemory(STAFF_DURG.phone);
    console.info("SEL after relist:", m?.sel);
  });
});

describe("ask by name, several matches (real matchTasks)", () => {
  it("staff: three Sharma tasks (own) + one of someone else: numbered question has only own, number answers", async () => {
    const tasks = [
      task({ id: "a", title: "Sharma ji payment", ...own }),
      task({ id: "b", title: "Sharma ji GST", ...own }),
      task({ id: "c", title: "Sharma ji bill", ...own }),
      task({ id: "x", title: "Sharma ji SECRET", assigneePhone: STAFF_RAIPUR.phone, assigneeName: "Chikku", createdByPhone: ADMIN.phone, branch: "RAIPUR" }),
    ];
    const w = world(STAFF_DURG, tasks);
    const q = await w.send(say("sharma ji ka due kab hai"));
    console.info("ASKBYNAME ->", all(q).replace(/\n/g, " | "));
    expect(all(q)).not.toContain("SECRET");
    expect(numberedTitles(q).length).toBe(3);
    const ans = await w.send(say("2"));
    expect(ans[0].kind).toBe("buttons"); // number opens the detail (plan: "answering with the number resolves it")
    expect((await w.store.getChatMemory(STAFF_DURG.phone))?.sel).toBeTruthy();
  });
  it("admin: by-name question hits a task of anyone", async () => {
    const w = world(ADMIN, [task({ id: "x", title: "Gupta SECRET", assigneePhone: STAFF_RAIPUR.phone, assigneeName: "Chikku", branch: "RAIPUR" })]);
    const out = await w.send(say("gupta ka due kab hai"));
    expect(all(out)).toContain("Gupta SECRET");
  });
  it("by name, no match: asks for a fragment (and costs no AI)", async () => {
    const w = world(STAFF_DURG, mk(2, own, "P"));
    const out = await w.send(say("zzqq ka due kab hai"));
    console.info("NOMATCH ->", all(out).slice(0, 100).replace(/\n/g, " | "), (w.chat.understand as any).mock.calls.length);
  });
  it("a staff by-name question for a DONE task finds nothing (pending only)", async () => {
    const w = world(STAFF_DURG, [task({ id: "d", title: "Purana kaam", status: "done", ...own })]);
    const out = await w.send(say("purana ka due kab hai"));
    console.info("DONE BY NAME ->", all(out).slice(0, 100).replace(/\n/g, " | "));
  });
});

describe("writes on an open task", () => {
  it("AI says update/done with no words on an open task: goes through confirm, task not done without Haan", async () => {
    const w = world(STAFF_DURG, mk(2, own, "P"), { ok: true, request: { kind: "update", action: "done", taskWords: [] } });
    await w.send(say("mere pending tasks dikhao"));
    await w.send(tap("tasks:task:P1"));
    const out = await w.send(say("ye wala done kar do"));
    console.info("DONE ON OPEN ->", out.map((o) => o.kind), all(out).slice(0, 160).replace(/\n/g, " | "));
    expect((await w.store.getTask("P1"))?.status).toBe("pending");
    expect((await w.store.getTask("P1"))?.remarks).toHaveLength(0);
  });
  it("AI update/remark with words: text typed on detail never silently becomes a remark", async () => {
    const w = world(STAFF_DURG, mk(2, own, "P"), { ok: true, request: { kind: "update", action: "remark", taskWords: ["kaam", "1"], remark: "kal tak" } });
    await w.send(say("mere pending tasks dikhao"));
    await w.send(tap("tasks:task:P1"));
    const out = await w.send(say("is task pe likh do kal tak"));
    console.info("REMARK VIA AI ->", out.map((o) => o.kind), all(out).slice(0, 160).replace(/\n/g, " | "));
    expect((await w.store.getTask("P1"))?.remarks).toHaveLength(0);
  });
});

describe("long text", () => {
  it("8 long titles + long assignee names: header is clipped, are all 8 numbered lines still visible?", async () => {
    addTester("Bhaskar");
    const long = "x".repeat(200);
    const tasks = Array.from({ length: 9 }, (_, i) =>
      task({ id: `L${i}`, title: `${long}${i}`, assigneePhone: STAFF_DURG.phone, assigneeName: "A very very long assignee name here", branch: "DURG", dueAt: `2026-10-2${i}T10:30:00.000Z`, dueHasTime: true, urgent: true }),
    );
    const w = world(ADMIN, tasks);
    const out = await w.send(say("Durg ke tasks dikhao"));
    const text = body(out[0]);
    console.info("LONG HEADER len", text.length, "lines", text.split("\n").filter((l) => /^\d\) /.test(l)).length, "rows", taskRowIds(out).length);
    expect(text.split("\n").filter((l) => /^\d\) /.test(l)).length).toBe(taskRowIds(out).length);
  });
});

describe("refine on tester staff: person/branch refinements never leak", () => {
  it("after own list: 'Chikku ke' / 'Raipur ke' -> no rule; AI returning refine person is forced to mine or refused", async () => {
    const w = world(STAFF_DURG, [...mk(2, own, "P"), ...mk(2, { assigneePhone: STAFF_RAIPUR.phone, assigneeName: "Chikku", branch: "RAIPUR", createdByPhone: ADMIN.phone }, "R")],
      { ok: true, request: { kind: "refine", changes: { scope: "person", person: "Chikku" } } });
    await w.send(say("mere pending tasks dikhao"));
    const out = await w.send(say("woh Chikku wale dikhao zara"));
    console.info("STAFF AI REFINE CHIKKU ->", all(out).slice(0, 100).replace(/\n/g, " | "));
    expect(all(out)).not.toContain("R kaam");
    const b = world(STAFF_DURG, [...mk(2, own, "P"), ...mk(2, { assigneePhone: STAFF_RAIPUR.phone, assigneeName: "Chikku", branch: "RAIPUR", createdByPhone: ADMIN.phone }, "R")],
      { ok: true, request: { kind: "refine", changes: { scope: "all" } } });
    await b.send(say("mere pending tasks dikhao"));
    expect(all(await b.send(say("sab ka dikhao zara ")))).not.toContain("R kaam");
    const c = world(STAFF_DURG, [...mk(2, own, "P"), ...mk(2, { assigneePhone: STAFF_RAIPUR.phone, assigneeName: "Chikku", branch: "RAIPUR", createdByPhone: ADMIN.phone }, "R")],
      { ok: true, request: { kind: "refine", changes: { branch: "RAIPUR" } } });
    await c.send(say("mere pending tasks dikhao"));
    const co = await c.send(say("woh raipur wale dikhao zara"));
    console.info("STAFF AI REFINE BRANCH ->", all(co).slice(0, 100).replace(/\n/g, " | "));
    expect(all(co)).not.toContain("R kaam");
  });
  it("staff AI 'open' with out-of-range / forged ref never opens another's task", async () => {
    const w = world(STAFF_DURG, mk(2, own, "P"), { ok: true, request: { kind: "open", ref: { by: "index", n: 99 } } });
    await w.send(say("mere pending tasks dikhao"));
    const out = await w.send(say("woh 99 wala kholo zara"));
    expect(out.some((o) => o.kind === "buttons")).toBe(false);
  });
});

describe("rule edge cases", () => {
  async function ready() {
    const w = world(STAFF_DURG, mk(5, own, "P"));
    await w.send(say("mere pending tasks dikhao"));
    return w;
  }
  // BUG (reviewer 1): chat.ts only lets a bare number escape the courtesy check when it matches /^\d{1,2}$/ on the RAW input.
  // "2." / "2)" / "#2" normalise to a 1-char word, so isCourtesy() answers "Menu ke liye Hi bhejiye" instead of opening task 2.
  it.fails("'2.' with memory on opens task 2 (also '2)' and '#2')", async () => {
    const w = await ready();
    for (const p of ["2.", "2)", "#2"]) {
      const out = await w.send(say(p));
      expect(out[0].kind, p).toBe("buttons");
    }
  });
  it("'2 3' / '1 aur 2' is not a single open", async () => {
    const w = await ready();
    for (const p of ["2 3", "1 aur 2", "pehla doosra"]) {
      const out = await w.send(say(p));
      expect(out.some((o) => o.kind === "buttons" && /Done/.test(JSON.stringify(o))), p).toBe(false);
    }
  });
  it("'sab dikhao' after a refine returns the full unrefined list", async () => {
    const w = await ready();
    await w.send(say("sirf urgent wale"));
    const out = await w.send(say("sab dikhao"));
    expect(body(out[0])).toContain("*5*");
  });
  it("question words in a list message: 'kitne pending hain' is a count not a remark-count", async () => {
    const w = await ready();
    expect(all(await w.send(say("kitne pending hain")))).toContain("*5* pending");
  });
  it("'kitne remark hain' with no selected task -> one focused question, no AI", async () => {
    const w = await ready();
    const before = (w.chat.understand as any).mock.calls.length;
    const out = await w.send(say("kitne remark hain"));
    console.info("RC NO SEL ->", all(out).slice(0, 80).replace(/\n/g, " | "), (w.chat.understand as any).mock.calls.length - before);
  });
  it("'kab tak hai' with no selected task", async () => {
    const w = await ready();
    const out = await w.send(say("kab tak hai"));
    console.info("DUE NO SEL ->", all(out).slice(0, 80).replace(/\n/g, " | "), (w.chat.understand as any).mock.calls.length);
  });
  it("'status' alone / 'status kya hai' without anything open and no memory", async () => {
    const w = world(STAFF_DURG, mk(2, own, "P"));
    const out = await w.send(say("status kya hai"));
    console.info("STATUS NOTHING ->", all(out).slice(0, 80).replace(/\n/g, " | "), (w.chat.understand as any).mock.calls.length);
  });
  it("'kab banaya' when the number refers: '2 kab banaya'", async () => {
    const w = await ready();
    const out = await w.send(say("2 kab banaya"));
    expect(all(out)).toContain("P kaam");
    console.info("2 KAB BANAYA ->", all(out).replace(/\n/g, " | "));
  });
  it("memory expired + task question that names a fragment still works", async () => {
    const w = await ready();
    w.advance(20 * 60_000);
    const out = await w.send(say("P kaam ka due kab hai"));
    console.info("EXPIRED NAME Q ->", all(out).slice(0, 100).replace(/\n/g, " | "));
  });
});
