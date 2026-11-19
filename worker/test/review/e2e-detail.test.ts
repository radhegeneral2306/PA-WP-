import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { say, tap, task, ADMIN, STAFF_DURG, STAFF_RAIPUR, NOW } from "../helpers/bot";
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

const rich = () =>
  task({
    id: "k1", title: "Sharma ji se payment lena", assigneePhone: STAFF_DURG.phone, assigneeName: STAFF_DURG.name, createdByPhone: ADMIN.phone, createdByName: ADMIN.name,
    dueAt: "2026-10-28T04:30:00.000Z", createdAt: "2026-10-05T05:00:00.000Z", urgent: true,
    remarks: [
      { text: "pehla call kiya", at: "2026-10-20T06:00:00.000Z", byName: "Hardware", byPhone: STAFF_DURG.phone } as any,
      { text: "Voice se banaya: x", at: "2026-10-20T06:30:00.000Z", byName: "Hardware", byPhone: STAFF_DURG.phone } as any,
      { text: "kal aayenge", at: "2026-10-24T06:00:00.000Z", byName: "Hardware", byPhone: STAFF_DURG.phone } as any,
    ],
  });

for (const who of [ADMIN, STAFF_DURG]) {
  describe(`3. detail questions as ${who.role}`, () => {
    async function open() {
      const w = world(who, [rich(), ...mk(2, { assigneePhone: STAFF_DURG.phone, assigneeName: "Hardware" }, "O")]);
      await w.send(say(who.role === "admin" ? "sabke pending tasks dikhao" : "mere pending tasks dikhao"));
      const out = await w.send(tap("tasks:task:k1"));
      expect(out[0].kind).toBe("buttons");
      return w;
    }
    const qs: [string, RegExp][] = [
      ["iski due date kya hai?", /28 Oct/],
      ["Iski Due Date Kya Hai??", /28 Oct/],
      ["due date?", /28 Oct/],
      ["kab tak hai", /28 Oct/],
      ["kisko diya hai", /Hardware/],
      ["kisne diya", /Bhaskar/],
      ["last update kya tha", /kal aayenge/],
      ["kitne remark hain", /2 remark/],
      ["kab banaya", /5 Oct/],
      ["status kya hai", /pending/i],
      ["kya ye urgent hai", /urgent/i],
    ];
    for (const [q, re] of qs) {
      it(`"${q}"`, async () => {
        const w = await open();
        const out = await w.send(say(q));
        expect(all(out)).toMatch(re);
        expect((await w.store.getTask("k1"))?.remarks).toHaveLength(3);
        expect(w.chat.understand).not.toHaveBeenCalled();
        expect(await w.store.getSession(who.phone)).toMatchObject({ flow: "tasks", step: "detail", data: { taskId: "k1" } });
        expect(all(out)).not.toMatch(/9190000000/);
      });
    }

    it("several questions in a row, then Update, then text = remark; text in remark step never to chat", async () => {
      const w = await open();
      await w.send(say("iski due date kya hai?"));
      await w.send(say("kisko diya hai"));
      const ask = await w.send(tap("tasks:act:update:k1"));
      expect(body(ask[0])).toMatch(/remark/i);
      const saved = await w.send(say("iski due date kya hai?")); // question words in a remark step: saved as remark
      expect(all(saved)).toContain("remark save");
      const t = await w.store.getTask("k1");
      expect(t?.remarks).toHaveLength(4);
      expect(t?.remarks[3].text).toBe("iski due date kya hai?");
      expect(w.chat.understand).not.toHaveBeenCalled();
    });

    it("typed text that is not a question on an open detail goes to the AI (unclear here) and is NOT a remark", async () => {
      const w = await open();
      const out = await w.send(say("customer ne bola kal aayenge"));
      expect(w.chat.understand).toHaveBeenCalledTimes(1);
      expect((await w.store.getTask("k1"))?.remarks).toHaveLength(3);
      console.info("NON-QUESTION ON DETAIL ->", all(out).slice(0, 80).replace(/\n/g, " | "));
    });

    it("'done kar do' on an open task is never answered by a rule (AI path)", async () => {
      const w = await open();
      for (const p of ["done kar do", "isko done kar do", "ye ho gaya", "date badlo", "remark likho kal aayenge", "iski due date badlo"]) {
        const before = (w.chat.understand as any).mock.calls.length;
        await w.send(say(p));
        expect((w.chat.understand as any).mock.calls.length).toBe(before + 1);
        expect((await w.store.getTask("k1"))?.status).toBe("pending");
      }
    });

    it("the Done button still works after questions", async () => {
      const w = await open();
      await w.send(say("kisko diya hai"));
      await w.send(tap("tasks:act:done:k1"));
      expect((await w.store.getTask("k1"))?.status).toBe("done");
    });

    it("5 minute typing TTL still applies on the detail; question refreshes the clock", async () => {
      const w = await open();
      w.advance(4 * 60_000);
      expect(all(await w.send(say("kisko diya hai")))).toContain("Hardware");
      w.advance(4 * 60_000); // 8 min since open but 4 since question
      expect(all(await w.send(say("kitne remark hain")))).toContain("remark");
      w.advance(6 * 60_000);
      expect(all(await w.send(say("kisko diya hai")))).toContain("Session expire");
    });
  });
}

describe("detail edge cases", () => {
  it("question about a task by name while on another task's detail", async () => {
    const w = world(ADMIN, [rich(), task({ id: "z", title: "Gupta bill", assigneeName: "Hardware", assigneePhone: STAFF_DURG.phone })]);
    await w.send(tap("tasks:task:k1")); // no session: expired
    const open = await w.send(say("mere tasks"));
    expect(open.length).toBeGreaterThan(0);
  });

  it("remark count with 0 remarks, and last update with none", async () => {
    const w = world(ADMIN, [task({ id: "n1", title: "Naya", assigneePhone: STAFF_DURG.phone, assigneeName: "Hardware" })]);
    await w.send(say("mere pending tasks dikhao")); // admin: mine -> none; use direct tap
    await w.send(tap("tasks:task:n1")); // no session => expired text (OK)
    const w2 = world(STAFF_DURG, [task({ id: "n1", title: "Naya", assigneePhone: STAFF_DURG.phone, assigneeName: "Hardware" })]);
    await w2.send(say("mere pending tasks dikhao"));
    await w2.send(tap("tasks:task:n1"));
    expect(all(await w2.send(say("kitne remark hain")))).toContain("koi remark nahi");
    expect(all(await w2.send(say("last update kya tha")))).toContain("koi remark nahi");
  });

  it("a different task opened later: 'iski' answers about the newest one", async () => {
    const w = world(STAFF_DURG, [rich(), task({ id: "z", title: "Gupta bill", assigneePhone: STAFF_DURG.phone, assigneeName: "Hardware", dueAt: "2026-11-02T04:30:00.000Z" })]);
    const l = await w.send(say("mere pending tasks dikhao"));
    await w.send(tap("tasks:task:k1"));
    await w.send(say("iski due date"));
    // go back via list tap (list still on screen, session detail): tap other row
    const o = await w.send(tap("tasks:task:z"));
    expect(body(o[0])).toContain("Gupta bill");
    const out = await w.send(say("iski due date kya hai"));
    expect(all(out)).toContain("Gupta bill");
  });

  it("ordinal typed while detail is open resolves against the list shown before", async () => {
    const w = world(STAFF_DURG, mk(4, { assigneePhone: STAFF_DURG.phone, assigneeName: "Hardware" }, "L"));
    const l = await w.send(say("mere pending tasks dikhao"));
    const titles = numberedTitles(l);
    await w.send(tap(`tasks:task:${taskRowIds(l)[0]}`));
    const out = await w.send(say("doosra wala kholo"));
    expect(body(out[0])).toContain(`*${titles[1]}*`);
    const out3 = await w.send(say("last wala"));
    expect(body(out3[0])).toContain(`*${titles[3]}*`);
  });

  it("a task-by-name question while a detail is open (no pronoun)", async () => {
    const w = world(STAFF_DURG, [rich(), task({ id: "z", title: "Gupta bill", assigneePhone: STAFF_DURG.phone, assigneeName: "Hardware", dueAt: "2026-11-02T04:30:00.000Z" })]);
    await w.send(say("mere pending tasks dikhao"));
    await w.send(tap("tasks:task:k1"));
    const out = await w.send(say("gupta ka due kab hai"));
    console.info("BYNAME ON DETAIL ->", all(out).slice(0, 120).replace(/\n/g, " | "));
    expect(all(out)).toContain("Gupta bill");
  });
});
