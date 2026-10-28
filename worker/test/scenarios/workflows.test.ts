// Adversarial end-to-end scenarios across the WhatsApp flows, the dashboard task actions
// and the scheduler (reminders + daily summary). All times: IST = UTC+5:30.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { handleMessage } from "../../src/bot/router";
import { cancelTask, decideDateRequest, markDone, reopenTask, type Actor } from "../../src/bot/taskActions";
import { runReminders } from "../../src/scheduler/reminders";
import { runDailySummary } from "../../src/scheduler/daily";
import { afterResponse, nextMonthlyDue } from "../../src/domain/schedule";
import type { Inbound } from "../../src/bot/flow";
import type { Outgoing } from "../../src/bot/outgoing";
import type { DateRequest, Task, User } from "../../src/domain/types";
import { ADMIN, ADMIN2, NOW, STAFF_DURG, USERS, makeCtx, say, tap, task } from "../helpers/bot";

const DASH: Actor = { phone: ADMIN2.phone, name: ADMIN2.name, viaDashboard: true };
const at = (iso: string) => new Date(iso);
const all = (out: Outgoing[]) => JSON.stringify(out);
const templates = (out: Outgoing[]) => out.filter((o) => o.kind === "template") as Extract<Outgoing, { kind: "template" }>[];

function store(tasks: Task[] = [], users: User[] = USERS) {
  return new MemoryStore({ users, tasks });
}

function req(o: Partial<DateRequest> = {}): DateRequest {
  return {
    dueAt: "2026-12-05T04:30:00.000Z",
    hasTime: false,
    remark: "Customer bahar hai",
    byPhone: STAFF_DURG.phone,
    byName: STAFF_DURG.name,
    requestedAt: "2026-10-25T04:30:00.000Z",
    ...o,
  };
}

/** Sends one message through the router as `user` at `now`. */
function chat(s: MemoryStore, user: User, now: Date = NOW) {
  return (input: Inbound | string) => handleMessage(makeCtx(user, s, now), typeof input === "string" ? say(input) : input);
}

async function openTask(s: MemoryStore, user: User, id: string, now: Date = NOW) {
  const send = chat(s, user, now);
  await send(tap("MENU:my_tasks"));
  return send(tap(`tasks:task:${id}`));
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------

describe("dashboard cancel while the staff member is mid-flow", () => {
  it("Done tap after cancel is refused, no done notice, no monthly copy", async () => {
    const s = store([task({ id: "m", repeat: "monthly", repeatDay: 27 })]);
    await openTask(s, STAFF_DURG, "m");
    await cancelTask(s, (await s.getTask("m"))!, DASH, NOW);
    const out = await chat(s, STAFF_DURG)(tap("tasks:act:done"));
    expect(all(out)).toContain("cancel ho chuka hai");
    expect(templates(out)).toHaveLength(0);
    expect((await s.getTask("m"))!.status).toBe("cancelled");
    expect(s.tasks.size).toBe(1);
    expect(await s.getSession(STAFF_DURG.phone)).toBeNull();
  });

  it("typed remark after cancel is refused and not saved", async () => {
    const s = store([task({ id: "p" })]);
    await openTask(s, STAFF_DURG, "p");
    await chat(s, STAFF_DURG)(tap("tasks:act:update"));
    await cancelTask(s, (await s.getTask("p"))!, DASH, NOW);
    const out = await chat(s, STAFF_DURG)("customer ne kal bola");
    expect(all(out)).toContain("cancel ho chuka hai");
    const t = (await s.getTask("p"))!;
    expect(t.remarks.map((r) => r.text)).toEqual(["Cancel kiya"]);
    expect(t.nextReminderAt).toBeNull();
  });

  it("date change (and >25-day approval request) after cancel is refused", async () => {
    const s = store([task({ id: "p" })]);
    await openTask(s, STAFF_DURG, "p");
    const send = chat(s, STAFF_DURG);
    await send(tap("tasks:act:date"));
    await send("25/12"); // > 25 days → approval remark step
    await cancelTask(s, (await s.getTask("p"))!, DASH, NOW);
    const out = await send("customer bahar gaya hai");
    expect(all(out)).toContain("cancel ho chuka hai");
    expect(templates(out)).toHaveLength(0);
    expect((await s.getTask("p"))!.dateRequest).toBeNull();
  });

  it("task reopened while the flow was open: the flow simply continues on the reopened task", async () => {
    const s = store([task({ id: "p" })]);
    await openTask(s, STAFF_DURG, "p");
    await cancelTask(s, (await s.getTask("p"))!, DASH, NOW);
    await reopenTask(s, (await s.getTask("p"))!, DASH, { dueAt: at("2026-10-28T04:30:00Z"), hasTime: false }, null, NOW);
    const out = await chat(s, STAFF_DURG)(tap("tasks:act:done"));
    expect(all(out)).toContain("done mark ho gaya");
    expect((await s.getTask("p"))!.status).toBe("done");
  });
});

describe("reopen then remind", () => {
  it("reminds at the new due time even if the last reminder was 1 hour ago, then daily 11 AM", async () => {
    // Reminded at 14:00 IST, cancelled, reopened at 15:00 for 16:00 today.
    const s = store([task({ id: "r", lastReminderAt: "2026-10-26T08:30:00.000Z" })]);
    await cancelTask(s, (await s.getTask("r"))!, DASH, NOW);
    const due = { dueAt: at("2026-10-26T10:30:00Z"), hasTime: true };
    const r = await reopenTask(s, (await s.getTask("r"))!, DASH, due, "customer wapas aaya", NOW);
    expect(r.ok).toBe(true);
    expect(await runReminders(s, at("2026-10-26T10:25:00Z"))).toEqual([]);
    const out = await runReminders(s, at("2026-10-26T10:30:00Z"));
    expect(out).toHaveLength(1);
    expect(templates(out)[0].bodyValues[2]).toBe("26 Oct, 4:00 PM");
    expect((await s.getTask("r"))!.nextReminderAt).toBe("2026-10-27T05:30:00.000Z");
  });

  it("a reopened task keeps its repeat and is in the daily summary; cancelled ones are not", async () => {
    const s = store([
      task({ id: "c", status: "cancelled", nextReminderAt: null, dueAt: "2026-10-20T04:30:00.000Z" }),
      task({ id: "x", status: "cancelled", nextReminderAt: null, repeat: "every90" }),
    ]);
    await reopenTask(s, (await s.getTask("x"))!, DASH, { dueAt: at("2026-10-27T04:30:00Z"), hasTime: false }, null, NOW);
    expect((await s.getTask("x"))!.repeat).toBe("every90");
    const outs = await runDailySummary(s, at("2026-10-27T04:30:00Z"));
    expect(outs).toHaveLength(1);
    expect(templates(outs)[0].bodyValues).toEqual([STAFF_DURG.name, "1", "0"]);
  });

  it("cannot reopen for an inactive assignee", async () => {
    const s = store([task({ id: "c", status: "cancelled" })], USERS.map((u) => (u.phone === STAFF_DURG.phone ? { ...u, active: false } : u)));
    const r = await reopenTask(s, (await s.getTask("c"))!, DASH, { dueAt: at("2026-10-28T04:30:00Z"), hasTime: false }, null, NOW);
    expect(r.ok).toBe(false);
  });
});

describe("every90 with a night due time", () => {
  it("scheduler holds a 10 PM every90 reminder until 10 AM, then every 90 minutes", async () => {
    // Legacy/WhatsApp data with nextReminderAt = due = 26 Oct 22:00 IST.
    const s = store([task({ id: "n", repeat: "every90", dueAt: "2026-10-26T16:30:00.000Z", dueHasTime: true, nextReminderAt: "2026-10-26T16:30:00.000Z" })]);
    expect(await runReminders(s, at("2026-10-26T16:30:00Z"))).toEqual([]);
    expect((await s.getTask("n"))!.nextReminderAt).toBe("2026-10-27T04:30:00.000Z");
    expect(await runReminders(s, at("2026-10-26T22:00:00Z"))).toEqual([]); // 03:30 IST
    expect(await runReminders(s, at("2026-10-27T04:30:00Z"))).toHaveLength(1);
    expect((await s.getTask("n"))!.nextReminderAt).toBe("2026-10-27T06:00:00.000Z"); // 11:30 IST
  });

  it("a due time just before 8 PM still reminds when the cron is a minute late", async () => {
    const s = store([task({ id: "e", repeat: "every90", nextReminderAt: "2026-10-26T14:25:00.000Z" })]); // 19:55 IST
    expect(await runReminders(s, at("2026-10-26T14:31:00Z"))).toHaveLength(1);
  });

  it("dashboard reopen at 10 PM: first reminder 10 AM next day", async () => {
    const s = store([task({ id: "x", status: "cancelled", repeat: "every90", nextReminderAt: null })]);
    await reopenTask(s, (await s.getTask("x"))!, DASH, { dueAt: at("2026-10-26T16:30:00Z"), hasTime: true }, null, NOW);
    expect(await runReminders(s, at("2026-10-26T16:30:00Z"))).toEqual([]);
    expect(await runReminders(s, at("2026-10-27T04:30:00Z"))).toHaveLength(1);
  });

  it("WhatsApp Naya task: every90 at 10 PM stores and announces 10 AM next day", async () => {
    const s = store();
    const send = chat(s, ADMIN);
    await send(tap("MENU:create_task"));
    await send(tap("create_task:branch:DURG"));
    await send(tap(`create_task:user:${STAFF_DURG.phone}`));
    await send("Stock check");
    await send(tap("create_task:due:today"));
    await send("10pm");
    await send(tap("create_task:repeat:every90"));
    const out = await send(tap("create_task:confirm:yes"));
    const [t] = [...s.tasks.values()];
    expect(t.dueAt).toBe("2026-10-26T16:30:00.000Z");
    expect(t.nextReminderAt).toBe("2026-10-27T04:30:00.000Z");
    expect(all(out)).toContain("Pehla reminder: *27 Oct, 10:00 AM");
    expect(templates(out)[0].bodyValues[4]).toContain("27 Oct, 10:00 AM");
  });

  it("remark at 23:50 IST pauses every90 until 10 AM the next IST day", () => {
    expect(afterResponse({ repeat: "every90", nextReminderAt: "x" }, at("2026-10-26T18:20:00Z"))).toBe("2026-10-27T04:30:00.000Z");
  });
});

describe("monthly repeat on the 31st, February and leap years", () => {
  const chain = (start: string, n: number) => {
    const out: string[] = [];
    let dueAt = start;
    for (let i = 0; i < n; i++) {
      dueAt = nextMonthlyDue({ dueAt, repeatDay: 31 }).toISOString();
      out.push(dueAt.slice(0, 10));
    }
    return out;
  };

  it("31 Dec 2027 → 31 Jan → 29 Feb 2028 (leap) → 31 Mar → 30 Apr", () => {
    expect(chain("2027-12-31T04:30:00.000Z", 4)).toEqual(["2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30"]);
  });

  it("non-leap Feb: 31 Jan 2027 → 28 Feb → 31 Mar", () => {
    expect(chain("2027-01-31T04:30:00.000Z", 2)).toEqual(["2027-02-28", "2027-03-31"]);
  });

  it("keeps the IST time when the IST day differs from the UTC day (11:30 PM IST)", () => {
    // 31 Jan 2028 23:30 IST = 31 Jan 18:00Z → 29 Feb 23:30 IST
    expect(nextMonthlyDue({ dueAt: "2028-01-31T18:00:00.000Z", repeatDay: 31 }).toISOString()).toBe("2028-02-29T18:00:00.000Z");
    // 1 Nov 00:30 IST = 31 Oct 19:00Z, repeat day 1 → 1 Dec 00:30 IST
    expect(nextMonthlyDue({ dueAt: "2026-10-31T19:00:00.000Z", repeatDay: 1 }).toISOString()).toBe("2026-11-30T19:00:00.000Z");
  });

  it("a monthly task moved into next month does not skip that month", () => {
    // 27 Oct moved to 2 Nov → next is 27 Nov (was 27 Dec)
    expect(nextMonthlyDue({ dueAt: "2026-11-02T04:30:00.000Z", repeatDay: 27 }).toISOString()).toBe("2026-11-27T04:30:00.000Z");
    // 27 Dec moved to 3 Jan → 27 Jan
    expect(nextMonthlyDue({ dueAt: "2027-01-03T04:30:00.000Z", repeatDay: 27 }).toISOString()).toBe("2027-01-27T04:30:00.000Z");
    // 1 Nov moved back to 29 Oct → still November's → 1 Dec
    expect(nextMonthlyDue({ dueAt: "2026-10-29T04:30:00.000Z", repeatDay: 1 }).toISOString()).toBe("2026-12-01T04:30:00.000Z");
    // 31 Oct moved to 2 Nov → 30 Nov
    expect(nextMonthlyDue({ dueAt: "2026-11-02T04:30:00.000Z", repeatDay: 31 }).toISOString()).toBe("2026-11-30T04:30:00.000Z");
  });

  it("WhatsApp Done on 31 Jan 2028 creates 29 Feb 2028, reminded on that day only", async () => {
    const now = at("2028-01-31T09:30:00Z");
    const s = store([task({ id: "m", repeat: "monthly", repeatDay: 31, dueAt: "2028-01-31T04:30:00.000Z", nextReminderAt: null })]);
    const send = chat(s, STAFF_DURG, now);
    await send(tap("MENU:my_tasks"));
    await send(tap("tasks:task:m"));
    const out = await send(tap("tasks:act:done"));
    expect(all(out)).toContain("29 Feb");
    const next = [...s.tasks.values()].find((t) => t.id !== "m")!;
    expect(next).toMatchObject({ dueAt: "2028-02-29T04:30:00.000Z", nextReminderAt: "2028-02-29T04:30:00.000Z", repeatDay: 31, status: "pending" });
    expect(await runReminders(s, at("2028-02-28T23:00:00Z"))).toEqual([]);
    expect(await runReminders(s, at("2028-02-29T04:30:00Z"))).toHaveLength(1);
  });
});

describe("IST midnight reminder math", () => {
  it("due 00:15 IST: due reminder, then 11 AM the same IST day (UTC day is the previous one)", async () => {
    const s = store([task({ id: "a", dueAt: "2026-10-26T18:45:00.000Z", dueHasTime: true, nextReminderAt: "2026-10-26T18:45:00.000Z" })]);
    expect(await runReminders(s, at("2026-10-26T18:45:00Z"))).toHaveLength(1);
    expect((await s.getTask("a"))!.nextReminderAt).toBe("2026-10-27T05:30:00.000Z");
  });

  it("due 23:50 IST: next reminder 11 AM next IST day; due 06:00 IST: skips the same-day 11 AM (6 h gap)", async () => {
    const s = store([
      task({ id: "late", dueAt: "2026-10-26T18:20:00.000Z", nextReminderAt: "2026-10-26T18:20:00.000Z" }),
      task({ id: "early", dueAt: "2026-10-27T00:30:00.000Z", nextReminderAt: "2026-10-27T00:30:00.000Z" }),
    ]);
    await runReminders(s, at("2026-10-26T18:20:00Z"));
    await runReminders(s, at("2026-10-27T00:30:00Z"));
    expect((await s.getTask("late"))!.nextReminderAt).toBe("2026-10-27T05:30:00.000Z");
    expect((await s.getTask("early"))!.nextReminderAt).toBe("2026-10-28T05:30:00.000Z");
  });

  it("daily summary at 10 AM IST counts a 00:15 IST task as overdue", async () => {
    const s = store([task({ id: "a", dueAt: "2026-10-26T18:45:00.000Z" })]);
    const [m] = templates(await runDailySummary(s, at("2026-10-27T04:30:00Z")));
    expect(m.bodyValues).toEqual([STAFF_DURG.name, "1", "1"]);
  });
});

describe("staff deactivated while owning pending tasks", () => {
  it("no reminders or summary while inactive; reminders resume after re-activation", async () => {
    const s = store([task({ id: "p", nextReminderAt: "2026-10-26T09:00:00.000Z" })]);
    await s.saveUser({ ...STAFF_DURG, active: false });
    expect(await runReminders(s, NOW)).toEqual([]);
    expect(await runDailySummary(s, at("2026-10-27T04:30:00Z"))).toEqual([]);
    expect(await runReminders(s, at("2026-10-27T05:30:00Z"))).toEqual([]);
    await s.saveUser({ ...STAFF_DURG, active: true });
    expect(await runReminders(s, at("2026-10-28T05:30:00Z"))).toHaveLength(1);
  });

  it("their pending date request can still be decided; the result is not sent to them", async () => {
    const s = store([task({ id: "p", dateRequest: req() })]);
    await s.saveUser({ ...STAFF_DURG, active: false });
    const send = chat(s, ADMIN);
    await send(tap("MENU:approvals"));
    await send(tap("approvals:task:p"));
    const out = await send(tap("approvals:decide:approve"));
    expect(all(out)).toContain("Approve kar diya");
    expect(templates(out).filter((m) => m.to === STAFF_DURG.phone)).toHaveLength(0);
    expect((await s.getTask("p"))!.dueAt).toBe("2026-12-05T04:30:00.000Z");
  });

  it("Naya task: assignee removed before confirm → no task, no template", async () => {
    const s = store();
    const send = chat(s, ADMIN);
    await send(tap("MENU:create_task"));
    await send(tap("create_task:branch:DURG"));
    await send(tap(`create_task:user:${STAFF_DURG.phone}`));
    await send("Stock check");
    await send(tap("create_task:due:tomorrow"));
    await send(tap("create_task:time:skip"));
    await send(tap("create_task:repeat:none"));
    await s.saveUser({ ...STAFF_DURG, active: false });
    const out = await send(tap("create_task:confirm:yes"));
    expect(all(out)).toContain("active nahi hai");
    expect(templates(out)).toHaveLength(0);
    expect(s.tasks.size).toBe(0);
  });

  it("Naya task: due time passed while on the confirm step → asks for a new date", async () => {
    const s = store();
    await chat(s, STAFF_DURG)(tap("MENU:create_task"));
    await chat(s, STAFF_DURG)("Bank jana");
    await chat(s, STAFF_DURG)(tap("create_task:due:today"));
    await chat(s, STAFF_DURG)("3:10pm");
    await chat(s, STAFF_DURG)(tap("create_task:repeat:none"));
    const out = await chat(s, STAFF_DURG, at("2026-10-26T09:50:00Z"))(tap("create_task:confirm:yes")); // 15:20 IST
    expect(all(out)).toContain("nikal chuka hai");
    expect(s.tasks.size).toBe(0);
    expect((await s.getSession(STAFF_DURG.phone))!.step).toBe("ask_due");
  });
});

describe("date requests across cancel / reopen / races", () => {
  it("pending request is gone after cancel and stays gone after reopen; open approval screen says handled", async () => {
    const s = store([task({ id: "p", dateRequest: req() })]);
    const send = chat(s, ADMIN);
    await send(tap("MENU:approvals"));
    await send(tap("approvals:task:p"));
    await cancelTask(s, (await s.getTask("p"))!, DASH, NOW);
    expect((await s.getTask("p"))!.dateRequest).toBeNull();
    await reopenTask(s, (await s.getTask("p"))!, DASH, { dueAt: at("2026-11-02T04:30:00Z"), hasTime: false }, null, NOW);
    expect((await s.getTask("p"))!.dateRequest).toBeNull();
    const out = await send(tap("approvals:decide:approve"));
    expect(all(out)).toContain("pehle hi handle");
    expect(templates(out)).toHaveLength(0);
    expect((await s.getTask("p"))!.dueAt).toBe("2026-11-02T04:30:00.000Z");
    expect(all(await chat(s, ADMIN)(tap("MENU:approvals")))).toContain("Koi approval pending nahi");
  });

  it("requested date already in the past: approve refused, reject works", async () => {
    const s = store([task({ id: "p", dueAt: "2026-09-01T04:30:00.000Z", dateRequest: req({ dueAt: "2026-10-20T04:30:00.000Z" }) })]);
    const send = chat(s, ADMIN);
    await send(tap("MENU:approvals"));
    await send(tap("approvals:task:p"));
    const out = await send(tap("approvals:decide:approve"));
    expect(all(out)).toContain("nikal chuki hai");
    expect(templates(out)).toHaveLength(0);
    expect((await s.getTask("p"))!.dueAt).toBe("2026-09-01T04:30:00.000Z");
    const rej = await send(tap("approvals:decide:reject"));
    expect(all(rej)).toContain("Reject kar diya");
    expect((await s.getTask("p"))!.dateRequest).toBeNull();
  });

  it("WhatsApp approve after a dashboard approve: 'pehle hi handle', applied and notified once", async () => {
    const s = store([task({ id: "p", dateRequest: req() })]);
    const send = chat(s, ADMIN);
    await send(tap("MENU:approvals"));
    await send(tap("approvals:task:p"));
    const dash = await decideDateRequest(s, (await s.getTask("p"))!, DASH, "approve", NOW);
    expect(dash.ok && dash.outs).toHaveLength(1);
    const out = await send(tap("approvals:decide:reject"));
    expect(all(out)).toContain("pehle hi handle");
    expect(templates(out)).toHaveLength(0);
    const t = (await s.getTask("p"))!;
    expect(t.dueAt).toBe("2026-12-05T04:30:00.000Z");
    expect(t.remarks).toHaveLength(1);
  });

  it("dashboard approve after a WhatsApp approve is refused", async () => {
    const s = store([task({ id: "p", dateRequest: req() })]);
    const stale = (await s.getTask("p"))!;
    const send = chat(s, ADMIN);
    await send(tap("MENU:approvals"));
    await send(tap("approvals:task:p"));
    await send(tap("approvals:decide:approve"));
    const r = await decideDateRequest(s, (await s.getTask("p"))!, DASH, "reject", NOW, stale.dateRequest!.requestedAt);
    expect(r.ok).toBe(false);
  });
});

describe("duplicate deliveries and double cron", () => {
  it("the same Done tap delivered twice: one done notice, one next-month task", async () => {
    const s = store([task({ id: "m", repeat: "monthly", repeatDay: 27, createdByPhone: ADMIN.phone })]);
    await openTask(s, STAFF_DURG, "m");
    const first = await chat(s, STAFF_DURG)(tap("tasks:act:done"));
    const second = await chat(s, STAFF_DURG)(tap("tasks:act:done"));
    expect(templates(first)).toHaveLength(1);
    expect(templates(second)).toHaveLength(0);
    expect(all(second)).toContain("purana");
    expect(s.tasks.size).toBe(2);
  });

  it("an old Done button pressed after the task was done elsewhere is refused", async () => {
    const s = store([task({ id: "p" })]);
    await openTask(s, STAFF_DURG, "p");
    await markDone(s, (await s.getTask("p"))!, DASH, NOW);
    const out = await chat(s, STAFF_DURG)(tap("tasks:act:done"));
    expect(all(out)).toContain("pehle hi done");
    expect(templates(out)).toHaveLength(0);
  });

  it("cron twice in the same minute sends each reminder once", async () => {
    const s = store([task({ id: "a", nextReminderAt: "2026-10-26T09:00:00.000Z" }), task({ id: "b", repeat: "every90", nextReminderAt: "2026-10-26T09:00:00.000Z" })]);
    expect(await runReminders(s, NOW)).toHaveLength(2);
    expect(await runReminders(s, new Date(NOW.getTime() + 20_000))).toEqual([]);
  });

  it("task cancelled after the cron listed it (before sending) gets no reminder", async () => {
    const s = store([task({ id: "a", nextReminderAt: "2026-10-26T09:00:00.000Z" })]);
    const list = s.listDueTasks.bind(s);
    s.listDueTasks = async (now, limit) => {
      const rows = await list(now, limit);
      await cancelTask(s, (await s.getTask("a"))!, DASH, NOW);
      return rows;
    };
    expect(await runReminders(s, NOW)).toEqual([]);
    expect((await s.getTask("a"))!.nextReminderAt).toBeNull();
  });

  it("task re-dated after the cron listed it waits for the new date", async () => {
    const s = store([task({ id: "a", nextReminderAt: "2026-10-26T09:00:00.000Z" })]);
    const list = s.listDueTasks.bind(s);
    s.listDueTasks = async (now, limit) => {
      const rows = await list(now, limit);
      await s.updateTask("a", { dueAt: "2026-10-29T04:30:00.000Z", nextReminderAt: "2026-10-29T04:30:00.000Z" });
      return rows;
    };
    expect(await runReminders(s, NOW)).toEqual([]);
    expect((await s.getTask("a"))!.nextReminderAt).toBe("2026-10-29T04:30:00.000Z");
  });
});

describe("misc", () => {
  it("a staff member cannot act on someone else's task id from a forged tap", async () => {
    const s = store([task({ id: "mine" }), task({ id: "p", assigneePhone: ADMIN.phone, assigneeName: ADMIN.name, createdByPhone: ADMIN2.phone })]);
    const send = chat(s, STAFF_DURG);
    await send(tap("MENU:my_tasks"));
    const out = await send(tap("tasks:task:p"));
    expect(all(out)).toContain("aapka nahi");
  });
});
