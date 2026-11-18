import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import type { User } from "../../src/domain/types";
import type { Inbound } from "../../src/bot/flow";
import type { Outgoing } from "../../src/bot/outgoing";
import { createTaskFlow } from "../../src/bot/flows/createTask";
import { tasksFlow } from "../../src/bot/flows/tasks";
import { ADMIN, ADMIN2, NOW, STAFF_DURG, STAFF_RAIPUR, USERS, makeCtx, say, tap } from "../helpers/bot";

const F = "create_task";

function setup(user: User, store = new MemoryStore({ users: USERS })) {
  const ctx = makeCtx(user, store);
  const step = async (input: Inbound): Promise<Outgoing[]> => {
    const session = await store.getSession(user.phone);
    if (!session) throw new Error("no session");
    return createTaskFlow.handle(ctx, session, input);
  };
  const session = () => store.getSession(user.phone);
  return { ctx, store, step, session };
}

function body(o: Outgoing): string {
  return o.kind === "template" ? o.fallbackText : o.body;
}

function ids(o: Outgoing): string[] {
  if (o.kind === "list") return o.rows.map((r) => r.id);
  if (o.kind === "buttons") return o.buttons.map((b) => b.id);
  return [];
}

async function adminToTitle(t: ReturnType<typeof setup>, branch = "DURG", user = STAFF_DURG) {
  await createTaskFlow.start(t.ctx);
  await t.step(tap(`${F}:branch:${branch}`));
  await t.step(tap(`${F}:user:${user.phone}`));
}

describe("createTaskFlow", () => {
  it("admin happy path: Durg staff, one tap Kal 10 AM, saved and template sent", async () => {
    const t = setup(ADMIN);
    const start = await createTaskFlow.start(t.ctx);
    expect(start[0].kind).toBe("list");
    expect(ids(start[0])).toContain(`${F}:branch:ADMINS`);
    expect((await t.session())?.step).toBe("pick_branch");

    const users = await t.step(tap(`${F}:branch:DURG`));
    expect(ids(users[0])).toEqual([`${F}:user:${STAFF_DURG.phone}`]);

    const title = await t.step(tap(`${F}:user:${STAFF_DURG.phone}`));
    expect(body(title[0])).toContain("Task kya hai");

    const due = await t.step(say("  Sharma ji se payment lena  "));
    expect(ids(due[0])).toEqual([
      `${F}:quick:today18`,
      `${F}:quick:tom10`,
      `${F}:quick:tom14`,
      `${F}:quick:tom17`,
      `${F}:quick:day2`,
      `${F}:quick:week`,
      `${F}:quick:custom`,
    ]);

    // Date + time in one tap, straight to confirm (reminder defaults to Ek baar).
    const conf = await t.step(tap(`${F}:quick:tom10`));
    expect((await t.session())?.step).toBe("confirm");
    expect(conf[0].kind).toBe("buttons");
    expect(ids(conf[0])).toEqual([`${F}:confirm:yes`, `${F}:confirm:edit`, `${F}:confirm:no`]);
    expect(body(conf[0])).toContain("🔔 Reminder: *Ek baar*");
    expect(body(conf[0])).toContain("*Sharma ji se payment lena*");
    expect(body(conf[0])).toContain("Hardware (Durg)");
    expect(body(conf[0])).toContain("27 Oct");

    const out = await t.step(tap(`${F}:confirm:yes`));
    expect(await t.session()).toBeNull();

    const [saved] = await t.store.listTasks({});
    expect(saved).toMatchObject({
      title: "Sharma ji se payment lena",
      assigneePhone: STAFF_DURG.phone,
      assigneeName: STAFF_DURG.name,
      branch: "DURG",
      createdByPhone: ADMIN.phone,
      createdByName: ADMIN.name,
      dueAt: "2026-10-27T04:30:00.000Z",
      dueHasTime: false,
      status: "pending",
      repeat: "none",
      nextReminderAt: "2026-10-27T04:30:00.000Z",
      repeatDay: null,
      dateRequest: null,
      lastReminderAt: null,
      remarks: [],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      doneAt: null,
    });

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ to: ADMIN.phone, kind: "text" });
    expect(body(out[0])).toContain("✅ Task ban gaya!");
    const tpl = out[1];
    expect(tpl.kind).toBe("template");
    if (tpl.kind !== "template") return;
    expect(tpl.to).toBe(STAFF_DURG.phone);
    expect(tpl.template).toBe("task_assigned_v1");
    expect(tpl.bodyValues).toEqual(["Hardware", "Bhaskar", "Sharma ji se payment lena", "27 Oct", "27 Oct"]);
    expect(tpl.fallbackText).toMatch(/Menu ke liye \*Hi\* bhejiye\.$/);
  });

  it("admin can assign to another admin via ADMINS (list includes self)", async () => {
    const t = setup(ADMIN);
    await createTaskFlow.start(t.ctx);
    const list = await t.step(tap(`${F}:branch:ADMINS`));
    expect(ids(list[0])).toEqual([`${F}:user:${ADMIN.phone}`, `${F}:user:${ADMIN2.phone}`]);
    await t.step(tap(`${F}:user:${ADMIN2.phone}`));
    await t.step(say("GST file karna"));
    await t.step(say("28/10 4pm"));
    await t.step(tap(`${F}:repeat:none`));
    const out = await t.step(tap(`${F}:confirm:yes`));
    const [saved] = await t.store.listTasks({});
    expect(saved.assigneePhone).toBe(ADMIN2.phone);
    expect(saved.branch).toBeNull();
    expect(saved.dueHasTime).toBe(true);
    expect(out[1]).toMatchObject({ kind: "template", to: ADMIN2.phone });
  });

  it("admin self task via ADMINS sends no template", async () => {
    const t = setup(ADMIN);
    await adminToTitle(t, "ADMINS", ADMIN);
    await t.step(say("Bank jana"));
    await t.step(tap(`${F}:due:tomorrow`));
    await t.step(tap(`${F}:time:skip`));
    await t.step(tap(`${F}:repeat:none`));
    const out = await t.step(tap(`${F}:confirm:yes`));
    expect(out).toHaveLength(1);
    expect(body(out[0])).toContain("Aap khud");
  });

  it("staff creates a self task without picking anyone and no template", async () => {
    const t = setup(STAFF_RAIPUR);
    const start = await createTaskFlow.start(t.ctx);
    expect(body(start[0])).toContain("Task kya hai");
    expect((await t.session())?.step).toBe("ask_title");
    await t.step(say("Godown stock check"));
    await t.step(tap(`${F}:due:today`));
    await t.step(say("6pm"));
    const conf = await t.step(tap(`${F}:repeat:none`));
    expect(conf[0].kind).toBe("buttons");
    const out = await t.step(tap(`${F}:confirm:yes`));
    expect(out).toHaveLength(1);
    expect(out[0].to).toBe(STAFF_RAIPUR.phone);
    const [saved] = await t.store.listTasks({});
    expect(saved).toMatchObject({
      assigneePhone: STAFF_RAIPUR.phone,
      createdByPhone: STAFF_RAIPUR.phone,
      branch: "RAIPUR",
      dueAt: "2026-10-26T12:30:00.000Z",
      dueHasTime: true,
    });
  });

  it("custom date via Date likho button: 28/10 4pm", async () => {
    const t = setup(ADMIN);
    await adminToTitle(t);
    await t.step(say("Visit"));
    const ask = await t.step(tap(`${F}:due:custom`));
    expect(body(ask[0])).toContain("28/10");
    expect((await t.session())?.step).toBe("ask_custom_due");
    await t.step(say("28/10 4pm"));
    const conf = await t.step(tap(`${F}:repeat:none`));
    expect(body(conf[0])).toContain("28 Oct, 4:00 PM");
    const s = await t.session();
    expect(s?.step).toBe("confirm");
    expect(s?.data.dueAt).toBe("2026-10-28T10:30:00.000Z");
  });

  it("re-prompts on invalid time and invalid custom date", async () => {
    const t = setup(ADMIN);
    await adminToTitle(t);
    await t.step(say("Visit"));
    await t.step(tap(`${F}:due:tomorrow`));
    const bad = await t.step(say("jaldi"));
    expect(body(bad[0])).toContain("Time samajh nahi aaya");
    expect((await t.session())?.step).toBe("ask_time");
    await t.step(say("11:30 am"));
    const ok = await t.step(tap(`${F}:repeat:none`));
    expect(body(ok[0])).toContain("27 Oct, 11:30 AM");

    const t2 = setup(ADMIN);
    await adminToTitle(t2);
    await t2.step(say("Visit"));
    await t2.step(tap(`${F}:due:custom`));
    const badDate = await t2.step(say("jaldi kabhi"));
    expect(body(badDate[0])).toContain("Date samajh nahi aayi");
    expect((await t2.session())?.step).toBe("ask_custom_due");
  });

  it("rejects a past due time and re-asks the date", async () => {
    const t = setup(ADMIN);
    await adminToTitle(t);
    await t.step(say("Visit"));
    await t.step(tap(`${F}:due:today`));
    const out = await t.step(tap(`${F}:time:skip`)); // today 10 AM < 3 PM now
    expect(body(out[0])).toContain("nikal chuka hai");
    expect(ids(out[0])).toContain(`${F}:quick:custom`);
    const s = await t.session();
    expect(s?.step).toBe("ask_due");
    expect(s?.data.day).toBeUndefined();
    expect(s?.data.title).toBe("Visit");
  });

  it("accepts a typed date at ask_due", async () => {
    const t = setup(ADMIN);
    await adminToTitle(t);
    await t.step(say("Visit"));
    const conf = await t.step(say("kal 11am"));
    expect((await t.session())?.step).toBe("confirm");
    expect(body(conf[0])).toContain("27 Oct, 11:00 AM");
  });

  it("cancel at confirm saves nothing", async () => {
    const t = setup(ADMIN);
    await adminToTitle(t);
    await t.step(say("Visit"));
    await t.step(tap(`${F}:due:tomorrow`));
    await t.step(tap(`${F}:time:skip`));
    await t.step(tap(`${F}:repeat:none`));
    const out = await t.step(tap(`${F}:confirm:no`));
    expect(body(out[0])).toBe("Theek hai, task cancel kar diya.");
    expect(await t.session()).toBeNull();
    expect(await t.store.listTasks({})).toHaveLength(0);
  });

  it("handles stale and wrong taps by re-sending the step prompt", async () => {
    const t = setup(ADMIN);
    await createTaskFlow.start(t.ctx);
    const wrong = await t.step(say("Durg"));
    expect(wrong[0].kind).toBe("list");
    expect(body(wrong[0])).toContain("naam ka koi nahi mila");
    expect((await t.session())?.step).toBe("pick_branch");

    await t.step(tap(`${F}:branch:DURG`));
    const gone = await t.step(tap(`${F}:user:919000000099`)); // inactive
    expect(body(gone[0])).toContain("list mein nahi");
    expect((await t.session())?.step).toBe("pick_user");

    await t.step(tap(`${F}:user:${STAFF_DURG.phone}`));
    const tapTitle = await t.step(tap(`${F}:due:today`));
    expect(body(tapTitle[0])).toContain("Task kya hai");
    const long = await t.step(say("x".repeat(201)));
    expect(body(long[0])).toContain("200");
    expect((await t.session())?.step).toBe("ask_title");

    await t.step(say("Visit"));
    const junk = await t.step(say("pata nahi"));
    expect(ids(junk[0])).toContain(`${F}:quick:custom`);
    expect((await t.session())?.step).toBe("ask_due");

    await t.step(tap(`${F}:due:tomorrow`));
    await t.step(tap(`${F}:time:skip`));
    await t.step(tap(`${F}:repeat:none`));
    const confJunk = await t.step(say("ok"));
    expect(ids(confJunk[0])).toEqual([`${F}:confirm:yes`, `${F}:confirm:edit`, `${F}:confirm:no`]);
    expect((await t.session())?.step).toBe("confirm");
  });

  it("empty branch tells the admin and shows branches again", async () => {
    const store = new MemoryStore({ users: [ADMIN, STAFF_DURG] });
    const t = setup(ADMIN, store);
    await createTaskFlow.start(t.ctx);
    const out = await t.step(tap(`${F}:branch:RAIPUR`));
    expect(body(out[0])).toContain("koi nahi");
    expect(ids(out[0])).toContain(`${F}:branch:DURG`);
    expect((await t.session())?.step).toBe("pick_branch");
  });

  it("pages through a long user list", async () => {
    const many: User[] = Array.from({ length: 12 }, (_, i) => ({
      ...STAFF_DURG,
      phone: `9190000001${String(i).padStart(2, "0")}`,
      name: `Staff ${String(i).padStart(2, "0")}`,
    }));
    const t = setup(ADMIN, new MemoryStore({ users: [ADMIN, ...many] }));
    await createTaskFlow.start(t.ctx);
    const p0 = await t.step(tap(`${F}:branch:DURG`));
    expect(ids(p0[0])).toContain(`${F}:page:1`);
    const p1 = await t.step(tap(`${F}:page:1`));
    expect(ids(p1[0])).toContain(`${F}:user:${many[11].phone}`);
    expect(ids(p1[0])).toContain(`${F}:page:0`);
    await t.step(tap(`${F}:user:${many[11].phone}`));
    expect((await t.session())?.data.assigneeName).toBe("Staff 11");
  });

  it("ends the flow when session data is missing", async () => {
    const t = setup(ADMIN);
    await t.store.saveSession({ phone: ADMIN.phone, flow: F, step: "confirm", data: {}, updatedAt: NOW.toISOString() });
    const out = await t.step(tap(`${F}:confirm:yes`));
    expect(body(out[0])).toContain("Kuch gadbad hui");
    expect(await t.session()).toBeNull();
    expect(await t.store.listTasks({})).toHaveLength(0);
  });

  async function toRepeat(t: ReturnType<typeof setup>) {
    await adminToTitle(t);
    await t.step(say("Rent dena"));
    await t.step(say("28/10 4pm"));
    const rep = await t.step(tap(`${F}:confirm:edit`));
    expect(body(rep[0])).toContain("Reminder kaise chahiye");
    expect((await t.session())?.step).toBe("ask_repeat");
  }

  it("Har 90 min: stored every90, summary line and template next-reminder text", async () => {
    const t = setup(ADMIN);
    await toRepeat(t);
    const conf = await t.step(tap(`${F}:repeat:every90`));
    expect((await t.session())?.data.repeat).toBe("every90");
    expect(body(conf[0])).toContain("🔔 Reminder: *Har 90 min*");
    const out = await t.step(tap(`${F}:confirm:yes`));
    const [saved] = await t.store.listTasks({});
    expect(saved).toMatchObject({
      repeat: "every90",
      repeatDay: null,
      nextReminderAt: "2026-10-28T10:30:00.000Z",
      dateRequest: null,
      lastReminderAt: null,
    });
    const next = "28 Oct, 4:00 PM (phir har 90 min, jab tak jawab na mile)";
    expect(body(out[0])).toContain(`⏰ Pehla reminder: *${next}*`);
    const tpl = out[1];
    if (tpl.kind !== "template") throw new Error("expected template");
    expect(tpl.bodyValues[3]).toBe("28 Oct, 4:00 PM");
    expect(tpl.bodyValues[4]).toBe(next);
    expect(tpl.fallbackText).toContain(`Agla reminder: *${next}*`);
  });

  it("Har mahine: stored monthly with IST repeatDay", async () => {
    const t = setup(ADMIN);
    await toRepeat(t);
    const conf = await t.step(tap(`${F}:repeat:monthly`));
    expect(body(conf[0])).toContain("🔔 Reminder: *Har mahine (28 tareekh)*");
    const out = await t.step(tap(`${F}:confirm:yes`));
    const [saved] = await t.store.listTasks({});
    expect(saved).toMatchObject({ repeat: "monthly", repeatDay: 28, nextReminderAt: "2026-10-28T10:30:00.000Z" });
    const tpl = out[1];
    if (tpl.kind !== "template") throw new Error("expected template");
    expect(tpl.bodyValues[4]).toBe("28 Oct, 4:00 PM (har mahine)");
    expect(tpl.fallbackText).toContain("(har mahine)");
    expect(body(out[0])).toContain("Har mahine (28 tareekh)");
  });

  it("monthly repeatDay uses the IST day even when UTC is the previous day", async () => {
    const t = setup(ADMIN);
    await adminToTitle(t);
    await t.step(say("Bill"));
    await t.step(say("1/11 1am")); // 31 Oct 19:30 UTC
    await t.step(tap(`${F}:confirm:repeat`));
    await t.step(tap(`${F}:repeat:monthly`));
    await t.step(tap(`${F}:confirm:yes`));
    const [saved] = await t.store.listTasks({});
    expect(saved.dueAt).toBe("2026-10-31T19:30:00.000Z");
    expect(saved.repeatDay).toBe(1);
  });

  it("Ek baar: template next reminder is just the due time", async () => {
    const t = setup(ADMIN);
    await toRepeat(t);
    await t.step(tap(`${F}:repeat:none`));
    const out = await t.step(tap(`${F}:confirm:yes`));
    const tpl = out[1];
    if (tpl.kind !== "template") throw new Error("expected template");
    expect(tpl.bodyValues[4]).toBe("28 Oct, 4:00 PM");
  });

  it("wrong input at ask_repeat re-prompts", async () => {
    const t = setup(ADMIN);
    await toRepeat(t);
    const typed = await t.step(say("har mahine"));
    expect(body(typed[0])).toContain("chuniye");
    expect(ids(typed[0])).toEqual([
      `${F}:repeat:none`, `${F}:repeat:every90`, `${F}:repeat:monthly`, `${F}:repeat:weekly`, `${F}:urgent:on`,
    ]);
    const stale = await t.step(tap(`${F}:repeat:yearly`));
    expect(ids(stale[0])).toContain(`${F}:repeat:none`);
    const old = await t.step(tap(`${F}:confirm:yes`));
    expect(old[0].kind).toBe("list");
    expect((await t.session())?.step).toBe("ask_repeat");
    expect(await t.store.listTasks({})).toHaveLength(0);
  });

  it("confirm without a stored repeat (old session) defaults to a single reminder", async () => {
    const t = setup(ADMIN);
    await t.store.saveSession({
      phone: ADMIN.phone,
      flow: F,
      step: "confirm",
      data: {
        title: "Visit", assigneePhone: STAFF_DURG.phone, assigneeName: STAFF_DURG.name,
        assigneeBranch: "DURG", assigneeRole: "staff", dueAt: "2026-10-27T04:30:00.000Z", dueHasTime: "false",
      },
      updatedAt: NOW.toISOString(),
    });
    await t.step(tap(`${F}:confirm:yes`));
    const [saved] = await t.store.listTasks({});
    expect(saved).toMatchObject({ repeat: "none", repeatDay: null });
  });

  it("admin types a name at the branch step and skips the branch + person lists", async () => {
    const t = setup(ADMIN);
    await createTaskFlow.start(t.ctx);
    const out = await t.step(say("chikku"));
    expect(body(out[0])).toContain("*Chikku*");
    expect(body(out[0])).toContain("Task kya hai");
    expect((await t.session())?.data).toMatchObject({ assigneePhone: STAFF_RAIPUR.phone, assigneeBranch: "RAIPUR" });
    await t.step(say("Stock check"));
    await t.step(tap(`${F}:quick:tom17`));
    const done = await t.step(tap(`${F}:confirm:yes`));
    expect(done[1]).toMatchObject({ to: STAFF_RAIPUR.phone, template: "task_assigned_v1" });
    expect((await t.store.listTasks({}))[0]).toMatchObject({ dueAt: "2026-10-27T11:30:00.000Z", dueHasTime: true, repeat: "none" });
  });

  it("an ambiguous or inactive name shows the branch list again", async () => {
    const t = setup(ADMIN);
    await createTaskFlow.start(t.ctx);
    const two = await t.step(say("Par")); // only "Partner Two" starts with it
    expect((await t.session())?.data.assigneePhone).toBe(ADMIN2.phone);
    expect(body(two[0])).toContain("Partner Two");

    const t2 = setup(ADMIN);
    await createTaskFlow.start(t2.ctx);
    const old = await t2.step(say("Old Staff")); // inactive
    expect(body(old[0])).toContain("nahi mila");
    expect((await t2.session())?.step).toBe("pick_branch");

    const t3 = setup(ADMIN);
    await createTaskFlow.start(t3.ctx);
    const many = await t3.step(say("staff")); // Jag Staff + Old Staff(inactive) → one match
    expect((await t3.session())?.data.assigneeName).toBe("Jag Staff");
    expect(body(many[0])).toContain("Jag Staff");
  });

  it("staff self task takes three steps: title, one date tap, Haan", async () => {
    const t = setup(STAFF_RAIPUR);
    await createTaskFlow.start(t.ctx);
    await t.step(say("Godown stock check"));
    await t.step(tap(`${F}:quick:day2`));
    const out = await t.step(tap(`${F}:confirm:yes`));
    expect(body(out[0])).toContain("✅ Task ban gaya!");
    expect((await t.store.listTasks({}))[0]).toMatchObject({ dueAt: "2026-10-28T04:30:00.000Z", dueHasTime: false });
  });

  it("a quick option that has passed is refused at tap time", async () => {
    const t = setup(STAFF_RAIPUR);
    await createTaskFlow.start(t.ctx);
    await t.step(say("Godown"));
    const late = { ...t.ctx, now: new Date("2026-10-26T13:00:00Z") };
    const session = await t.store.getSession(STAFF_RAIPUR.phone);
    const out = await createTaskFlow.handle(late, session!, tap(`${F}:quick:today18`));
    expect(body(out[0])).toContain("nikal chuka");
    expect(ids(out[0])).not.toContain(`${F}:quick:today18`);
    expect((await t.session())?.step).toBe("ask_due");
  });

  it("every emitted reply id is namespaced", async () => {
    const t = setup(ADMIN);
    const outs = [
      ...(await createTaskFlow.start(t.ctx)),
      ...(await t.step(tap(`${F}:branch:DURG`))),
      ...(await t.step(tap(`${F}:user:${STAFF_DURG.phone}`))),
      ...(await t.step(say("Visit"))),
      ...(await t.step(tap(`${F}:due:tomorrow`))),
      ...(await t.step(tap(`${F}:time:skip`))),
      ...(await t.step(tap(`${F}:repeat:monthly`))),
    ];
    for (const o of outs) for (const id of ids(o)) expect(id.startsWith(`${F}:`)).toBe(true);
  });
});

describe("createTaskFlow ⚙️ Badlo: repeat kinds and 🔴 Urgent (Round 3, F4/F5)", () => {
  // NOW is Monday 26 Oct; "28/10 4pm" is a Wednesday (Budhvar).
  async function toConfirm(t: ReturnType<typeof setup>) {
    await adminToTitle(t);
    await t.step(say("Rent dena"));
    return t.step(say("28/10 4pm"));
  }

  function rows(o: Outgoing) {
    if (o.kind !== "list") throw new Error("expected list");
    return o.rows;
  }

  it("confirm has Haan / ⚙️ Badlo / Nahi and Badlo opens the options list", async () => {
    const t = setup(ADMIN);
    const conf = await toConfirm(t);
    if (conf[0].kind !== "buttons") throw new Error("expected buttons");
    expect(conf[0].buttons.map((b) => b.title)).toEqual(["Haan ✅", "⚙️ Badlo", "Nahi ❌"]);
    for (const b of conf[0].buttons) {
      expect(b.title.length).toBeLessThanOrEqual(20);
      expect(b.title).not.toMatch(/cancel|stop/i);
    }
    const opt = await t.step(tap(`${F}:confirm:edit`));
    expect((await t.session())?.step).toBe("ask_repeat");
    const r = rows(opt[0]);
    expect(r.map((x) => x.id)).toEqual([
      `${F}:repeat:none`, `${F}:repeat:every90`, `${F}:repeat:monthly`, `${F}:repeat:weekly`, `${F}:urgent:on`,
    ]);
    expect(r.map((x) => x.title)).toEqual(["Ek baar ✓", "Har 90 min", "Har mahine", "Har hafte", "🔴 Urgent karo"]);
    expect(r.every((x) => x.description && x.description.length <= 72 && x.title.length <= 24)).toBe(true);
    expect(r[2].description).toBe("Har mahine 28 tareekh ko");
    expect(r[3].description).toBe("Har Budhvar ko");
  });

  const kinds: [string, string][] = [
    ["none", "Ek baar"],
    ["every90", "Har 90 min"],
    ["monthly", "Har mahine (28 tareekh)"],
    ["weekly", "Har hafte (Budhvar)"],
  ];
  for (const [kind, label] of kinds) {
    it(`Badlo -> ${kind}: back on confirm with "${label}" and saved`, async () => {
      const t = setup(ADMIN);
      await toConfirm(t);
      await t.step(tap(`${F}:confirm:edit`));
      const conf = await t.step(tap(`${F}:repeat:${kind}`));
      expect((await t.session())?.step).toBe("confirm");
      expect(conf[0].kind).toBe("buttons");
      expect(body(conf[0])).toContain(`🔔 Reminder: *${label}*`);
      const out = await t.step(tap(`${F}:confirm:yes`));
      expect(body(out[0])).toContain(`🔔 Reminder: *${label}*`);
      const [saved] = await t.store.listTasks({});
      expect(saved.repeat).toBe(kind);
      expect(saved.urgent).toBeUndefined();
      if (kind === "weekly") {
        expect(saved).toMatchObject({ repeatDay: null, cycleMonth: null, nextReminderAt: "2026-10-28T10:30:00.000Z" });
        const tpl = out[1];
        if (tpl.kind !== "template") throw new Error("expected template");
        expect(tpl.bodyValues[4]).toBe("28 Oct, 4:00 PM (har hafte)");
      }
    });
  }

  it("Urgent karo / Urgent hatao toggles, shows 🔴 Urgent and saves urgent: true", async () => {
    const t = setup(ADMIN);
    await toConfirm(t);
    const nonce = (await t.session())?.data.nonce;
    expect(nonce).toBeTruthy();
    await t.step(tap(`${F}:confirm:edit`));
    const on = await t.step(tap(`${F}:urgent:on`));
    expect(body(on[0])).toContain("\n🔴 Urgent\n");
    expect((await t.session())?.data).toMatchObject({ urgent: "true", nonce });

    const opt = await t.step(tap(`${F}:confirm:edit`));
    const r = rows(opt[0]);
    expect(r[4]).toMatchObject({ id: `${F}:urgent:off`, title: "Urgent hatao" });
    const off = await t.step(tap(`${F}:urgent:off`));
    expect(body(off[0])).not.toContain("Urgent");
    expect((await t.session())?.data.urgent).toBeUndefined();

    await t.step(tap(`${F}:confirm:edit`));
    await t.step(tap(`${F}:urgent:on`));
    await t.step(tap(`${F}:confirm:edit`));
    await t.step(tap(`${F}:repeat:weekly`));
    const out = await t.step(tap(`${F}:confirm:yes`));
    expect(body(out[0])).toContain("🔴 Urgent");
    const [saved] = await t.store.listTasks({});
    expect(saved).toMatchObject({ urgent: true, repeat: "weekly" });
  });

  it("double tap on Haan after Badlo still creates one task", async () => {
    const t = setup(ADMIN);
    await toConfirm(t);
    await t.step(tap(`${F}:confirm:edit`));
    await t.step(tap(`${F}:urgent:on`));
    const s = await t.session();
    const first = await createTaskFlow.handle(t.ctx, s!, tap(`${F}:confirm:yes`));
    const second = await createTaskFlow.handle(t.ctx, s!, tap(`${F}:confirm:yes`));
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
    expect(await t.store.listTasks({})).toHaveLength(1);
  });

  it("old ids: confirm:repeat opens the list; repeat:<kind> and urgent:on on the confirm step apply", async () => {
    const t = setup(ADMIN);
    await toConfirm(t);
    const old = await t.step(tap(`${F}:confirm:repeat`));
    expect(old[0].kind).toBe("list");
    expect((await t.session())?.step).toBe("ask_repeat");
    await t.step(tap(`${F}:repeat:none`));
    // An earlier list / repeat button tapped while the confirm screen is open.
    const conf = await t.step(tap(`${F}:repeat:weekly`));
    expect((await t.session())?.step).toBe("confirm");
    expect(body(conf[0])).toContain("Har hafte (Budhvar)");
    const urg = await t.step(tap(`${F}:urgent:on`));
    expect(body(urg[0])).toContain("🔴 Urgent");
    const junk = await t.step(tap(`${F}:urgent:maybe`));
    expect(body(junk[0])).toContain("Neeche diye option");
    await t.step(tap(`${F}:confirm:yes`));
    expect((await t.store.listTasks({}))[0]).toMatchObject({ repeat: "weekly", urgent: true });
  });

  it("weekly task made in the wizard: Done from Mere tasks creates next week's task", async () => {
    const store = new MemoryStore({ users: USERS });
    const admin = setup(ADMIN, store);
    await toConfirm(admin);
    await admin.step(tap(`${F}:confirm:edit`));
    await admin.step(tap(`${F}:repeat:weekly`));
    await admin.step(tap(`${F}:confirm:yes`));
    const [made] = await store.listTasks({});

    const staffCtx = makeCtx(STAFF_DURG, store);
    await tasksFlow.start(staffCtx);
    const session = await store.getSession(STAFF_DURG.phone);
    const out = await tasksFlow.handle(staffCtx, session!, tap(`tasks:act:done:${made.id}`));
    expect(out.some((o) => o.kind === "text" && o.body.includes("🔁 Agla task: *4 Nov, 4:00 PM*"))).toBe(true);
    const pending = await store.listTasks({ status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ repeat: "weekly", dueAt: "2026-11-04T10:30:00.000Z", title: "Rent dena" });
    expect((await store.getTask(made.id))?.status).toBe("done");
  });
});
