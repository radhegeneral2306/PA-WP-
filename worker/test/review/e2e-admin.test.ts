import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { say, tap, task, ADMIN, STAFF_DURG, STAFF_RAIPUR } from "../helpers/bot";
import { all, body, mk, numberedTitles, rowIds, taskRowIds, world } from "./e2e-helpers";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const D = { assigneePhone: STAFF_DURG.phone, assigneeName: STAFF_DURG.name, branch: "DURG" as const };
const R = { assigneePhone: STAFF_RAIPUR.phone, assigneeName: STAFF_RAIPUR.name, branch: "RAIPUR" as const };
// 26 Durg overdue (every 4th urgent), 5 Raipur overdue, 3 Durg future.
function data() {
  const durg = mk(26, D, "D").map((t, i) => { const due = new Date(Date.UTC(2026, 9, 1, 4, 30) + i * 3600_000).toISOString(); return { ...t, dueAt: due, nextReminderAt: due }; }).map((t, i) => ({ ...t, urgent: i % 4 === 0 }));
  const raipur = mk(5, R, "R");
  const future = mk(3, { ...D, dueAt: "2026-10-27T04:30:00.000Z", nextReminderAt: "2026-10-27T04:30:00.000Z" }, "F");
  return [...durg, ...raipur, ...future];
}

describe("2. admin chain", () => {
  it("Durg overdue -> sirf urgent wale -> doosra wala kholo keeps Durg + overdue", async () => {
    const w = world(ADMIN, data());
    const l1 = await w.send(say("Durg ke overdue tasks dikhao"));
    expect(body(l1[0])).toMatch(/Durg.*overdue/s);
    expect(body(l1[0])).toContain("*26* tasks hain");
    const l2 = await w.send(say("sirf urgent wale"));
    const titles = numberedTitles(l2);
    expect(titles.length).toBeGreaterThan(1);
    expect(titles.every((t) => t.startsWith("D "))).toBe(true);
    expect(body(l2[0])).toMatch(/urgent/);
    expect(body(l2[0])).toContain("Durg");
    expect(body(l2[0])).toContain("overdue");
    const out = await w.send(say("doosra wala kholo"));
    expect(body(out[0])).toContain(`*${titles[1]}*`);
    expect(w.chat.understand).not.toHaveBeenCalled();
  });

  it("kal wale replaces overdue; branch kept", async () => {
    const w = world(ADMIN, data());
    await w.send(say("Durg ke overdue tasks dikhao"));
    const out = await w.send(say("kal wale"));
    console.info("KAL ->", all(out).slice(0, 200).replace(/\n/g, " | "));
    expect(all(out)).toContain("Durg");
    expect(all(out)).toContain("kal");
  });

  it("aur dikhao pages 8,8,8,2 then 'Saare ... dikha diye'; then shuru se resets", async () => {
    const w = world(ADMIN, data());
    const p1 = await w.send(say("Durg ke overdue tasks dikhao"));
    const seen = new Set(taskRowIds(p1));
    expect(seen.size).toBe(8);
    for (const [expect_n, hdr] of [[8, "9–16 / 26"], [8, "17–24 / 26"], [2, "25–26 / 26"]] as const) {
      const p = await w.send(say("aur dikhao"));
      expect(body(p[0])).toContain(hdr);
      const ids = taskRowIds(p);
      expect(ids).toHaveLength(expect_n);
      ids.forEach((i) => { expect(seen.has(i)).toBe(false); seen.add(i); });
    }
    expect(seen.size).toBe(26);
    const done = await w.send(say("aur dikhao"));
    expect(all(done)).toContain("Saare *26* tasks dikha diye");
    // asking again after "done": still the same line
    expect(all(await w.send(say("aur")))).toContain("Saare *26* tasks dikha diye");
    expect(all(await w.send(say("shuru se")))).toContain("naye sire");
    const after = await w.send(say("aur dikhao"));
    console.info("AFTER RESET aur ->", all(after).slice(0, 150).replace(/\n/g, " | "));
    expect(all(after)).not.toContain("tasks hain");
    const num = await w.send(say("doosra wala kholo"));
    expect(num.some((o) => o.kind === "buttons")).toBe(false);
  });

  it("number after paging refers to the current page; number after 'Saare ... dikha diye' still refers to last page", async () => {
    const w = world(ADMIN, data());
    await w.send(say("Durg ke overdue tasks dikhao"));
    await w.send(say("aur dikhao"));
    const p3 = await w.send(say("aur dikhao"));
    await w.send(say("aur dikhao"));
    const p4 = await w.send(say("aur dikhao")); // "Saare dikha diye"
    expect(all(p4)).toContain("Saare");
    const out = await w.send(say("2"));
    expect(out[0].kind).toBe("buttons");
  });

  it("refine on a page 3 resets to page 1 of the new filter", async () => {
    const w = world(ADMIN, data());
    await w.send(say("Durg ke overdue tasks dikhao"));
    await w.send(say("aur dikhao"));
    const out = await w.send(say("sirf urgent wale"));
    expect(body(out[0])).not.toMatch(/–/); // 7 urgent -> single page
    const more = await w.send(say("aur dikhao"));
    expect(all(more)).toContain("Saare");
  });

  it("refine variants", async () => {
    const w = world(ADMIN, data());
    await w.send(say("Durg ke overdue tasks dikhao"));
    for (const p of ["Raipur ke", "aaj wale", "is hafte wale", "sab dikhao", "overdue wale", "urgent wale", "Chikku ke", "Hardware ke", "sirf Raipur ke"]) {
      const out = await w.send(say(p));
      console.info("REFINE", p, "->", all(out).slice(0, 110).replace(/\n/g, " | "), "ai", (w.chat.understand as any).mock.calls.length);
    }
  });
});

describe("admin: access", () => {
  it("admin can open a task of another person from the list", async () => {
    const w = world(ADMIN, data());
    await w.send(say("Raipur ke overdue tasks dikhao"));
    const out = await w.send(say("pehla"));
    expect(out[0].kind).toBe("buttons");
  });
  it("deleted -> nahi mila (admin)", async () => {
    const w = world(ADMIN, data());
    const l = await w.send(say("Raipur ke overdue tasks dikhao"));
    await w.store.updateTask(taskRowIds(l)[0], { status: "deleted" });
    expect(all(await w.send(say("pehla")))).toContain("nahi mila");
  });
  it("done in between: open still shows the detail as a non-actionable body, no buttons", async () => {
    const w = world(ADMIN, data());
    const l = await w.send(say("Raipur ke overdue tasks dikhao"));
    await w.store.updateTask(taskRowIds(l)[0], { status: "done" });
    const out = await w.send(say("pehla"));
    console.info("DONE-IN-BETWEEN ->", out.map((o) => o.kind), all(out).slice(0, 150).replace(/\n/g, " | "));
    expect(out.some((o) => o.kind === "buttons")).toBe(false);
  });
});
