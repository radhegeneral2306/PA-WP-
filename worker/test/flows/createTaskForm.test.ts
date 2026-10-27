import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import type { User } from "../../src/domain/types";
import type { Outgoing } from "../../src/bot/outgoing";
import { handleTaskForm, taskFormFlow } from "../../src/bot/flows/createTaskForm";
import { handleMessage } from "../../src/bot/router";
import { ADMIN, INACTIVE, STAFF_DURG, STAFF_RAIPUR, USERS, makeCtx } from "../helpers/bot";

function setup(user: User) {
  const store = new MemoryStore({ users: USERS });
  const ctx = makeCtx(user, store);
  const submit = (form: Record<string, unknown>) => handleTaskForm(ctx, form);
  return { store, ctx, submit };
}

function body(o: Outgoing): string {
  return o.kind === "template" ? o.fallbackText : o.kind === "text" ? o.body : o.body;
}

const ADMIN_FORM = {
  flow_token: "task_form_admin",
  branch: "Durg",
  person: "Hardware (Durg)",
  title: "  Sharma ji se payment lena  ",
  date: "2026-10-28",
  time: "4:30 PM",
  repeat: "Ek baar",
};

const STAFF_FORM = { flow_token: "task_form_staff", title: "Stock check", date: "2026-10-28", time: "11:00 AM", repeat: "Ek baar" };

describe("taskFormFlow.start", () => {
  it("admin gets the admin form template", async () => {
    const out = await taskFormFlow.start(makeCtx(ADMIN));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ to: ADMIN.phone, kind: "template", template: "task_form_admin_v1", flowToken: "task_form_admin", bodyValues: [] });
    expect(body(out[0])).toContain("➕ Naya task");
  });

  it("staff get the staff form template", async () => {
    const out = await taskFormFlow.start(makeCtx(STAFF_DURG));
    expect(out[0]).toMatchObject({ to: STAFF_DURG.phone, kind: "template", template: "task_form_staff_v1", flowToken: "task_form_staff", bodyValues: [] });
  });
});

describe("handleTaskForm: success", () => {
  it("admin submission creates the task and notifies the assignee", async () => {
    const t = setup(ADMIN);
    const out = await t.submit(ADMIN_FORM);
    const [saved] = await t.store.listTasks({});
    expect(saved).toMatchObject({
      title: "Sharma ji se payment lena",
      assigneePhone: STAFF_DURG.phone,
      assigneeName: STAFF_DURG.name,
      branch: "DURG",
      createdByPhone: ADMIN.phone,
      createdByName: ADMIN.name,
      dueAt: "2026-10-28T11:00:00.000Z",
      dueHasTime: true,
      repeat: "none",
      repeatDay: null,
      nextReminderAt: "2026-10-28T11:00:00.000Z",
      status: "pending",
    });
    expect(out).toHaveLength(2);
    expect(out[0].to).toBe(ADMIN.phone);
    const msg = body(out[0]);
    expect(msg).toContain("✅ Task ban gaya!");
    expect(msg).toContain("*Sharma ji se payment lena*");
    expect(msg).toContain("Hardware (Durg)");
    expect(msg).toContain("28 Oct, 4:30 PM");
    expect(msg).toContain("🔔 Reminder: *Ek baar*");
    expect(msg).toContain("⏰ Pehla reminder: *28 Oct, 4:30 PM*");
    expect(out[1]).toMatchObject({ to: STAFF_DURG.phone, kind: "template", template: "task_assigned_v1" });
  });

  it("admin task for themself sends no template", async () => {
    const t = setup(ADMIN);
    const out = await t.submit({ ...ADMIN_FORM, branch: "Admins", person: "Bhaskar (Admin)" });
    const [saved] = await t.store.listTasks({});
    expect(saved).toMatchObject({ assigneePhone: ADMIN.phone, branch: null });
    expect(out).toHaveLength(1);
    expect(body(out[0])).toContain("Aap khud");
  });

  it("staff submission creates a self task", async () => {
    const t = setup(STAFF_RAIPUR);
    const out = await t.submit(STAFF_FORM);
    const [saved] = await t.store.listTasks({});
    expect(saved).toMatchObject({
      title: "Stock check",
      assigneePhone: STAFF_RAIPUR.phone,
      createdByPhone: STAFF_RAIPUR.phone,
      branch: "RAIPUR",
      dueAt: "2026-10-28T05:30:00.000Z",
      dueHasTime: true,
    });
    expect(out).toHaveLength(1);
    expect(body(out[0])).toContain("Aap khud");
  });

  it("auto-generated keys, id-style values and an epoch date", async () => {
    const t = setup(ADMIN);
    const out = await t.submit({
      flow_token: "task_form_admin",
      screen_0_Branch_0: "3_Durg",
      screen_0_Kisko_dena_hai_1: "14_Hardware_(Durg)",
      screen_0_Task_kya_hai_2: "Godown saaf karna",
      screen_0_Due_date_3: String(Date.UTC(2026, 9, 28)), // epoch ms, IST day 28 Oct
      screen_0_Time_4: "5_11:30_AM",
      screen_0_Reminder_5: "1_Har_90_min",
    });
    const [saved] = await t.store.listTasks({});
    expect(saved).toMatchObject({
      title: "Godown saaf karna",
      assigneePhone: STAFF_DURG.phone,
      dueAt: "2026-10-28T06:00:00.000Z",
      dueHasTime: true,
      repeat: "every90",
    });
    expect(out[1]).toMatchObject({ template: "task_assigned_v1" });
  });

  it("numeric epoch and dd/mm/yyyy dates are accepted", async () => {
    const a = setup(STAFF_DURG);
    await a.submit({ ...STAFF_FORM, date: Date.UTC(2026, 9, 29) });
    expect((await a.store.listTasks({}))[0].dueAt).toBe("2026-10-29T05:30:00.000Z");
    const b = setup(STAFF_DURG);
    await b.submit({ ...STAFF_FORM, date: "30/10/2026" });
    expect((await b.store.listTasks({}))[0].dueAt).toBe("2026-10-30T05:30:00.000Z");
  });

  it("no time means 10:00 AM IST without a time", async () => {
    const t = setup(STAFF_DURG);
    const { time: _time, ...form } = STAFF_FORM;
    const out = await t.submit(form);
    const [saved] = await t.store.listTasks({});
    expect(saved).toMatchObject({ dueAt: "2026-10-28T04:30:00.000Z", dueHasTime: false });
    expect(body(out[0])).toContain("🕒 Due: *28 Oct*");
  });

  it("the '10:00 AM (default)' option also means no time", async () => {
    const t = setup(STAFF_DURG);
    await t.submit({ ...STAFF_FORM, time: "10:00 AM (default)" });
    const [saved] = await t.store.listTasks({});
    expect(saved).toMatchObject({ dueAt: "2026-10-28T04:30:00.000Z", dueHasTime: false });
  });

  it.each([
    ["Ek baar", "none", null],
    ["Har 90 min", "every90", null],
    ["Har mahine", "monthly", 28],
    [undefined, "none", null],
  ])("repeat %s → %s", async (label, repeat, repeatDay) => {
    const t = setup(ADMIN);
    const out = await t.submit({ ...ADMIN_FORM, repeat: label });
    const [saved] = await t.store.listTasks({});
    expect(saved).toMatchObject({ repeat, repeatDay });
    expect(saved.nextReminderAt).toBeTruthy();
    if (repeat === "monthly") expect(body(out[0])).toContain("Har mahine (28 tareekh)");
  });
});

describe("handleTaskForm: errors", () => {
  async function fails(user: User, form: Record<string, unknown>): Promise<string> {
    const t = setup(user);
    const out = await t.submit(form);
    expect(await t.store.listTasks({})).toHaveLength(0);
    expect(out).toHaveLength(1);
    expect(out[0].to).toBe(user.phone);
    return body(out[0]);
  }

  it("missing title (and logs keys only)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const msg = await fails(ADMIN, { ...ADMIN_FORM, title: undefined });
    expect(msg).toContain("Task kya hai");
    expect(msg).toContain("Menu se");
    expect(msg).toContain("➕ Naya task");
    const missing = await fails(STAFF_DURG, { flow_token: "task_form_staff", date: "2026-10-28" });
    expect(missing).toContain("Task kya hai");
    const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("flow_token");
    expect(logged).not.toContain(STAFF_DURG.phone);
    log.mockRestore();
  });

  it("past date", async () => {
    expect(await fails(ADMIN, { ...ADMIN_FORM, date: "2026-10-20" })).toContain("date nikal chuki hai");
  });

  it("today with a past time; today with a future time works", async () => {
    expect(await fails(ADMIN, { ...ADMIN_FORM, date: "2026-10-26", time: "11:00 AM" })).toContain("time");
    const t = setup(ADMIN);
    await t.submit({ ...ADMIN_FORM, date: "2026-10-26", time: "6:00 PM" });
    expect((await t.store.listTasks({}))[0].dueAt).toBe("2026-10-26T12:30:00.000Z");
  });

  it("bad date and bad time are listed together", async () => {
    const msg = await fails(ADMIN, { ...ADMIN_FORM, title: "", date: "kal", time: "lunch" });
    expect(msg).toContain("Task kya hai");
    expect(msg).toContain("Due date");
    expect(msg).toContain("lunch");
  });

  it("unknown person", async () => {
    expect(await fails(ADMIN, { ...ADMIN_FORM, person: "Pinky (Durg)" })).toContain("Pinky (Durg)");
  });

  it("inactive person", async () => {
    expect(await fails(ADMIN, { ...ADMIN_FORM, person: `${INACTIVE.name} (Durg)` })).toContain("active nahi");
  });

  it("person and branch do not match", async () => {
    expect(await fails(ADMIN, { ...ADMIN_FORM, branch: "Raipur" })).toContain("match nahi");
    expect(await fails(ADMIN, { ...ADMIN_FORM, person: "Hardware (Raipur)", branch: undefined })).toContain("match nahi");
    expect(await fails(ADMIN, { ...ADMIN_FORM, person: "Chikku (Raipur)", branch: "Admins" })).toContain("match nahi");
  });

  it("staff cannot submit the admin form", async () => {
    expect(await fails(STAFF_DURG, { ...STAFF_FORM, person: "Chikku (Raipur)", branch: "Raipur" })).toContain("sirf admin");
    expect(await fails(STAFF_DURG, { ...STAFF_FORM, flow_token: "task_form_admin" })).toContain("sirf admin");
  });

  it("admin without a person", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await fails(ADMIN, { ...STAFF_FORM })).toContain("Kisko dena hai");
    vi.restoreAllMocks();
  });
});

describe("router: form submissions", () => {
  it("a form clears any open session and creates the task", async () => {
    const store = new MemoryStore({ users: USERS });
    const ctx = makeCtx(ADMIN, store);
    await store.saveSession({ phone: ADMIN.phone, flow: "create_task", step: "ask_title", data: {}, updatedAt: ctx.now.toISOString() });
    const out = await handleMessage(ctx, { text: "", reply: null, form: ADMIN_FORM });
    expect(await store.getSession(ADMIN.phone)).toBeNull();
    expect(body(out[0])).toContain("✅ Task ban gaya!");
    expect(await store.listTasks({})).toHaveLength(1);
  });
});

describe("Interakt Person list short tags", () => {
  it("'(Hdw)' means the Hardware branch (Interakt's 30-character option limit)", async () => {
    const hw: User = { ...STAFF_DURG, phone: "919000000021", name: "Ofc Hardware - 66466", branch: "HARDWARE" };
    const store = new MemoryStore({ users: [...USERS, hw] });
    const ctx = makeCtx(ADMIN, store);
    const out = await handleTaskForm(ctx, { ...ADMIN_FORM, branch: "Hardware", person: "Ofc Hardware - 66466 (Hdw)" });
    const [saved] = await store.listTasks({});
    expect(saved).toMatchObject({ assigneePhone: hw.phone, branch: "HARDWARE" });
    expect(body(out[0])).toContain("✅ Task ban gaya!");
  });
});

describe("Admin form v3 (no Branch field, template task_form_admin_v2)", () => {
  it("a submission without a branch answer uses the person's own branch", async () => {
    const t = setup(ADMIN);
    const { branch: _b, ...noBranch } = ADMIN_FORM;
    const out = await t.submit(noBranch);
    const [saved] = await t.store.listTasks({});
    expect(saved).toMatchObject({ assigneePhone: STAFF_DURG.phone, branch: "DURG" });
    expect(body(out[0])).toContain("✅ Task ban gaya!");
  });

  it("a wrong bracket tag is still refused without a branch answer", async () => {
    const t = setup(ADMIN);
    const { branch: _b, ...noBranch } = ADMIN_FORM;
    const out = await t.submit({ ...noBranch, person: "Hardware (Raipur)" });
    expect(await t.store.listTasks({})).toEqual([]);
    expect(body(out[0])).toContain("❌ Task nahi bana");
  });
});
