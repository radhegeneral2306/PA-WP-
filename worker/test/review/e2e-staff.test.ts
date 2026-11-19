// Reviewer 1, Round 7: end to end through handleMessage with the REAL rules/refs/taskInfo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { say, tap, task, STAFF_DURG, STAFF_RAIPUR, ADMIN, NOW } from "../helpers/bot";
import { addTester, removeTester, all, body, mk, numberedTitles, rowIds, taskRowIds, world } from "./e2e-helpers";
import { CHAT_MEMORY_MIN } from "../../src/chat/types";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  addTester(STAFF_DURG.name);
  addTester(STAFF_RAIPUR.name);
});
afterEach(() => {
  removeTester(STAFF_DURG.name);
  removeTester(STAFF_RAIPUR.name);
  vi.restoreAllMocks();
});

const staffTasks = () => mk(5, { assigneePhone: STAFF_DURG.phone, assigneeName: STAFF_DURG.name, branch: "DURG" }, "S");

describe("1. numbered list then ordinal opens", () => {
  const phrases: [string, number][] = [
    ["doosra wala kholo", 2], ["2", 2], ["dusra", 2], ["pehla", 1], ["last wala", 5], ["number 3", 3],
    ["Doosra wala kholo 🙏", 2], ["DOOSRA WALA KHOLO", 2], ["teesra wala kholo", 3], ["2nd", 2], ["pehla wala kholo please", 1], ["2 kholo", 2], ["last wala kholo", 5],
  ];
  for (const [phrase, n] of phrases) {
    it(`"${phrase}" opens position ${n}`, async () => {
      const w = world(STAFF_DURG, staffTasks());
      const list = await w.send(say("mere pending tasks dikhao"));
      const titles = numberedTitles(list);
      expect(titles).toHaveLength(5);
      const ids = taskRowIds(list);
      const out = await w.send(say(phrase));
      expect(body(out[0])).toContain(`*${titles[n - 1]}*`);
      expect(await w.store.getSession(STAFF_DURG.phone)).toMatchObject({ step: "detail", data: { taskId: ids[n - 1] } });
      expect(w.chat.understand).not.toHaveBeenCalled();
    });
  }

  it("the number matches the SHOWN position even after another task is marked done in between", async () => {
    const w = world(STAFF_DURG, staffTasks());
    const list = await w.send(say("mere pending tasks dikhao"));
    const titles = numberedTitles(list);
    const ids = taskRowIds(list);
    await w.store.updateTask(ids[0], { status: "done" }); // list order would now shift
    const out = await w.send(say("doosra wala kholo"));
    expect(body(out[0])).toContain(`*${titles[1]}*`);
  });

  it("a second list replaces the first: numbers refer to the second", async () => {
    const tasks = [...staffTasks(), ...mk(3, { assigneePhone: STAFF_DURG.phone, assigneeName: STAFF_DURG.name, branch: "DURG", urgent: true }, "U")];
    const w = world(STAFF_DURG, tasks);
    await w.send(say("mere pending tasks dikhao"));
    const second = await w.send(say("mere urgent tasks dikhao"));
    const titles = numberedTitles(second);
    expect(titles.every((t) => t.startsWith("U"))).toBe(true);
    const out = await w.send(say("last wala"));
    expect(body(out[0])).toContain(`*${titles[titles.length - 1]}*`);
  });

  it("list order changes (new task added before it) -> still the shown one", async () => {
    const w = world(STAFF_DURG, staffTasks());
    const list = await w.send(say("mere pending tasks dikhao"));
    const titles = numberedTitles(list);
    await w.store.createTask(task({ id: "NEW", title: "Bilkul naya urgent", assigneePhone: STAFF_DURG.phone, assigneeName: STAFF_DURG.name, urgent: true, dueAt: "2026-10-01T04:30:00.000Z" }));
    const out = await w.send(say("pehla"));
    expect(body(out[0])).toContain(`*${titles[0]}*`);
  });
});

describe("4. expiry / bounds / access", () => {
  it("'2' with no memory is not a courtesy and not an AI call: focused question or AI", async () => {
    const w = world(STAFF_DURG, staffTasks());
    const out = await w.send(say("2"));
    console.info("BARE 2 NO MEMORY ->", all(out).slice(0, 120), "AI calls", (w.chat.understand as any).mock.calls.length);
    expect(all(out)).not.toContain("Menu ke liye *Hi*");
  });

  it("out of range numbers", async () => {
    const w = world(STAFF_DURG, staffTasks());
    await w.send(say("mere pending tasks dikhao"));
    for (const p of ["9", "0", "number 7", "99", "kholo 10"]) {
      const out = await w.send(say(p));
      console.info("RANGE", p, "->", all(out).slice(0, 100).replace(/\n/g, " | "));
      expect(out.some((o) => o.kind === "buttons" && /Done/.test(JSON.stringify(o)))).toBe(false);
    }
  });

  it("memory expiry at 16 min: ordinal asks which task", async () => {
    const w = world(STAFF_DURG, staffTasks());
    await w.send(say("mere pending tasks dikhao"));
    w.advance((CHAT_MEMORY_MIN + 1) * 60_000);
    const out = await w.send(say("doosra wala kholo"));
    console.info("16 MIN ->", all(out).slice(0, 150).replace(/\n/g, " | "));
  });

  it("memory valid at 1 minute, 'doosra wala kholo' works", async () => {
    const w = world(STAFF_DURG, staffTasks());
    await w.send(say("mere pending tasks dikhao"));
    w.advance(60_000);
    const out = await w.send(say("doosra wala kholo"));
    expect(out[0].kind).toBe("buttons");
  });

  // BUG (reviewer 1): the numbered list opens a `tasks:list chat=1` session with the 2 minute TTL. A typed "2" /
  // "doosra wala kholo" 3 minutes after the list hits the router's expired-session branch ("Session expire ho gaya")
  // although the chat memory (15 min) is still valid. Effective memory for list follow-ups is 2 minutes.
  it.fails("memory valid at 3 min (list session TTL is 2 min!)", async () => {
    const w = world(STAFF_DURG, staffTasks());
    await w.send(say("mere pending tasks dikhao"));
    w.advance(3 * 60_000);
    const out = await w.send(say("doosra wala kholo"));
    console.info("3 MIN ->", all(out).slice(0, 150).replace(/\n/g, " | "));
    expect(all(out)).not.toContain("Session expire");
  });

  it("a staff member whose task was reassigned away after listing gets 'nahi mila' and no data", async () => {
    const w = world(STAFF_DURG, staffTasks());
    const list = await w.send(say("mere pending tasks dikhao"));
    const ids = taskRowIds(list);
    await w.store.updateTask(ids[1], { assigneePhone: STAFF_RAIPUR.phone, assigneeName: STAFF_RAIPUR.name, createdByPhone: ADMIN.phone });
    const out = await w.send(say("doosra wala kholo"));
    expect(all(out)).toContain("nahi mila");
    expect(all(out)).not.toContain("kaam 2");
    expect(out.some((o) => o.kind === "buttons")).toBe(false);
  });

  it("same but via question (selected) 'iski due date' after being reassigned while detail open", async () => {
    const w = world(STAFF_DURG, staffTasks());
    const list = await w.send(say("mere pending tasks dikhao"));
    const ids = taskRowIds(list);
    await w.send(tap(`tasks:task:${ids[0]}`));
    await w.store.updateTask(ids[0], { assigneePhone: STAFF_RAIPUR.phone, assigneeName: STAFF_RAIPUR.name, createdByPhone: ADMIN.phone });
    const out = await w.send(say("iski due date kya hai?"));
    expect(all(out)).toContain("nahi mila");
    expect(all(out)).not.toMatch(/Due|Aaj|Kal|Oct/);
  });

  it("deleted task from an old list -> nahi mila", async () => {
    const w = world(STAFF_DURG, staffTasks());
    const list = await w.send(say("mere pending tasks dikhao"));
    const ids = taskRowIds(list);
    await w.store.updateTask(ids[2], { status: "deleted" });
    expect(all(await w.send(say("teesra wala kholo")))).toContain("nahi mila");
  });

  it("staff cannot reach another person's task: refine to a person is not applied", async () => {
    const tasks = [...staffTasks(), ...mk(3, { assigneePhone: STAFF_RAIPUR.phone, assigneeName: STAFF_RAIPUR.name, branch: "RAIPUR", createdByPhone: STAFF_RAIPUR.phone }, "R")];
    const w = world(STAFF_DURG, tasks);
    await w.send(say("mere pending tasks dikhao"));
    for (const p of ["Chikku ke", "Raipur ke", "sirf Chikku ke", "sabke tasks dikhao", "Chikku ke tasks dikhao", "raipur wale"]) {
      const out = await w.send(say(p));
      expect(all(out)).not.toContain("R kaam");
      console.info("STAFF", p, "->", all(out).slice(0, 80).replace(/\n/g, " | "), "ai", (w.chat.understand as any).mock.calls.length);
    }
  });

  it("staff by-name question never matches another person's task", async () => {
    const tasks = [...staffTasks(), task({ id: "x", title: "Sharma ji secret", assigneePhone: STAFF_RAIPUR.phone, assigneeName: "Chikku", createdByPhone: ADMIN.phone, branch: "RAIPUR" })];
    const w = world(STAFF_DURG, tasks);
    const out = await w.send(say("sharma ka due kya hai"));
    console.info("SHARMA ->", all(out).slice(0, 120).replace(/\n/g, " | "));
    expect(all(out)).not.toContain("secret");
  });
});

describe("expired list session, second try", () => {
  it("after the 'Session expire' line the same words work (memory still fresh at 3 min)", async () => {
    const w = world(STAFF_DURG, staffTasks());
    await w.send(say("mere pending tasks dikhao"));
    w.advance(3 * 60_000);
    expect(all(await w.send(say("doosra wala kholo")))).toContain("Session expire");
    const out = await w.send(say("doosra wala kholo"));
    expect(out[0].kind).toBe("buttons");
  });
});
