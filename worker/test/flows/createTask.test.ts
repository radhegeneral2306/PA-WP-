import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import type { User } from "../../src/domain/types";
import type { Inbound } from "../../src/bot/flow";
import type { Outgoing } from "../../src/bot/outgoing";
import { createTaskFlow } from "../../src/bot/flows/createTask";
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
  it("admin happy path: Durg staff, kal + skip, saved and template sent", async () => {
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
    expect(ids(due[0])).toEqual([`${F}:due:today`, `${F}:due:tomorrow`, `${F}:due:custom`]);

    const time = await t.step(tap(`${F}:due:tomorrow`));
    expect(ids(time[0])).toEqual([`${F}:time:skip`]);

    const rep = await t.step(tap(`${F}:time:skip`));
    expect((await t.session())?.step).toBe("ask_repeat");
    expect(ids(rep[0])).toEqual([`${F}:repeat:none`, `${F}:repeat:every90`, `${F}:repeat:monthly`]);
    expect(body(rep[0])).toContain("Reminder kaise chahiye?");

    const conf = await t.step(tap(`${F}:repeat:none`));
    expect(conf[0].kind).toBe("buttons");
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
    const badDate = await t2.step(say("agle hafte"));
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
    expect(ids(out[0])).toContain(`${F}:due:today`);
    const s = await t.session();
    expect(s?.step).toBe("ask_due");
    expect(s?.data.day).toBeUndefined();
    expect(s?.data.title).toBe("Visit");
  });

  it("accepts a typed date at ask_due", async () => {
    const t = setup(ADMIN);
    await adminToTitle(t);
    await t.step(say("Visit"));
    await t.step(say("kal 11am"));
    expect((await t.session())?.step).toBe("ask_repeat");
    const conf = await t.step(tap(`${F}:repeat:none`));
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
    expect(body(wrong[0])).toContain("chuniye");
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
    expect(ids(junk[0])).toContain(`${F}:due:custom`);
    expect((await t.session())?.step).toBe("ask_due");

    await t.step(tap(`${F}:due:tomorrow`));
    await t.step(tap(`${F}:time:skip`));
    await t.step(tap(`${F}:repeat:none`));
    const confJunk = await t.step(say("ok"));
    expect(ids(confJunk[0])).toEqual([`${F}:confirm:yes`, `${F}:confirm:no`]);
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
    expect(ids(typed[0])).toEqual([`${F}:repeat:none`, `${F}:repeat:every90`, `${F}:repeat:monthly`]);
    const stale = await t.step(tap(`${F}:repeat:weekly`));
    expect(ids(stale[0])).toContain(`${F}:repeat:none`);
    const old = await t.step(tap(`${F}:confirm:yes`));
    expect(old[0].kind).toBe("buttons");
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
