import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/data/memoryStore";
import { addRemark, changeDue, dueFromInput, markDone, reassign, type Actor } from "../src/bot/taskActions";
import { ADMIN, ADMIN2, NOW, STAFF_DURG, STAFF_RAIPUR, INACTIVE, USERS, task } from "./helpers/bot";

const dash: Actor = { phone: ADMIN2.phone, name: ADMIN2.name, viaDashboard: true };
const creator: Actor = { phone: ADMIN.phone, name: ADMIN.name };
const store = (t = task()) => new MemoryStore({ users: USERS, tasks: [t] });
const later = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe("markDone", () => {
  it("closes the task, logs a dashboard remark and tells the creator", async () => {
    const s = store(task({ dateRequest: { dueAt: "x", hasTime: false, remark: "r", byPhone: "p", byName: "n", requestedAt: "y" } }));
    const r = await markDone(s, (await s.getTask("task1"))!, dash, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.task).toMatchObject({ status: "done", doneAt: NOW.toISOString(), nextReminderAt: null, dateRequest: null });
    expect(r.task.remarks.at(-1)).toMatchObject({ byName: "Partner Two (dashboard)", text: "Done kiya" });
    expect(r.outs).toEqual([expect.objectContaining({ to: ADMIN.phone, template: "task_done_v1" })]);
  });

  it("does not notify the creator about their own action or add a remark from WhatsApp", async () => {
    const s = store();
    const r = await markDone(s, (await s.getTask("task1"))!, creator, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.outs).toEqual([]);
    expect(r.task.remarks).toEqual([]);
  });

  it("creates next month's task for monthly ones", async () => {
    const s = store(task({ repeat: "monthly", repeatDay: 27 }));
    const r = await markDone(s, (await s.getTask("task1"))!, dash, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.next).toMatchObject({ status: "pending", dueAt: "2026-11-27T04:30:00.000Z" });
  });

  it("refuses closed tasks", async () => {
    for (const status of ["done", "cancelled"] as const) {
      const s = store(task({ status }));
      const r = await markDone(s, (await s.getTask("task1"))!, dash, NOW);
      expect(r).toMatchObject({ ok: false, status: 409, code: "task_closed" });
    }
  });
});

describe("addRemark", () => {
  it("saves the remark, pauses every90 and tells the creator", async () => {
    const s = store(task({ repeat: "every90", nextReminderAt: later(1).toISOString() }));
    const r = await addRemark(s, (await s.getTask("task1"))!, dash, "  Customer kal dega  ", NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.task.remarks.at(-1)).toMatchObject({ text: "Customer kal dega", byPhone: ADMIN2.phone });
    expect(r.task.nextReminderAt).toBe("2026-10-27T04:30:00.000Z");
    expect(r.outs).toEqual([expect.objectContaining({ to: ADMIN.phone, template: "task_updated_v1" })]);
  });

  it("rejects empty and too long remarks", async () => {
    const s = store();
    const t = (await s.getTask("task1"))!;
    expect(await addRemark(s, t, dash, "   ", NOW)).toMatchObject({ ok: false, status: 400 });
    expect(await addRemark(s, t, dash, "x".repeat(501), NOW)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("changeDue", () => {
  it("moves the date, clears requests, resets the reminder and tells creator and assignee once each", async () => {
    const s = store(task({ dateRequest: { dueAt: "x", hasTime: false, remark: "r", byPhone: "p", byName: "n", requestedAt: "y" } }));
    const due = dueFromInput("2026-11-05", "16:30")!;
    const r = await changeDue(s, (await s.getTask("task1"))!, dash, due, "Customer bola", NOW, { notifyAssignee: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.task).toMatchObject({ dueAt: "2026-11-05T11:00:00.000Z", dueHasTime: true, nextReminderAt: "2026-11-05T11:00:00.000Z", dateRequest: null });
    expect(r.task.remarks.at(-1)?.text).toBe("Date badli: 27 Oct → 5 Nov, 4:30 PM. Customer bola");
    expect(r.outs.map((o) => o.to).sort()).toEqual([ADMIN.phone, STAFF_DURG.phone].sort());
  });

  it("never notifies the actor and rejects past dates", async () => {
    const s = store();
    const t = (await s.getTask("task1"))!;
    const r = await changeDue(s, t, creator, dueFromInput("2026-11-05", null)!, null, NOW, { notifyAssignee: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.outs.map((o) => o.to)).toEqual([STAFF_DURG.phone]);
    expect(await changeDue(s, r.task, creator, dueFromInput("2026-10-01", null)!, null, NOW, { notifyAssignee: false })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("reassign", () => {
  it("moves the task to another branch's staff and notifies only the new assignee", async () => {
    const s = store();
    const r = await reassign(s, (await s.getTask("task1"))!, dash, STAFF_RAIPUR, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.task).toMatchObject({ assigneePhone: STAFF_RAIPUR.phone, assigneeName: "Chikku", branch: "RAIPUR" });
    expect(r.task.remarks.at(-1)?.text).toBe("Assign badla: Hardware → Chikku");
    expect(r.outs).toEqual([expect.objectContaining({ to: STAFF_RAIPUR.phone, template: "task_assigned_v1" })]);
  });

  it("rejects inactive users and the same assignee; no self notification", async () => {
    const s = store();
    const t = (await s.getTask("task1"))!;
    expect(await reassign(s, t, dash, INACTIVE, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(await reassign(s, t, dash, STAFF_DURG, NOW)).toMatchObject({ ok: false, status: 400 });
    const r = await reassign(s, t, dash, ADMIN2, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.outs).toEqual([]);
    expect(r.task.branch).toBeNull();
  });
});

describe("dueFromInput", () => {
  it("parses dates with and without time in IST", () => {
    expect(dueFromInput("2026-10-28", null)).toEqual({ dueAt: new Date("2026-10-28T04:30:00.000Z"), hasTime: false });
    expect(dueFromInput("2026-10-28", "")).toEqual({ dueAt: new Date("2026-10-28T04:30:00.000Z"), hasTime: false });
    expect(dueFromInput("2026-10-28", "09:05")).toEqual({ dueAt: new Date("2026-10-28T03:35:00.000Z"), hasTime: true });
  });
  it("rejects bad input", () => {
    for (const [d, t] of [["2026-02-30", null], ["28/10/2026", null], ["2026-10-28", "25:00"], ["2026-10-28", "9:5"], [123, null]] as const) {
      expect(dueFromInput(d, t)).toBeNull();
    }
  });
});
