import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { tasksFlow } from "../../src/bot/flows/tasks";
import type { BotContext, Inbound } from "../../src/bot/flow";
import type { Outgoing } from "../../src/bot/outgoing";
import type { Task, User } from "../../src/domain/types";
import { ADMIN, ADMIN2, STAFF_DURG, STAFF_JAG, STAFF_RAIPUR, USERS, makeCtx, say, tap, task } from "../helpers/bot";

function seed(): Task[] {
  const jag = Array.from({ length: 11 }, (_, i) =>
    task({
      id: `j${i}`,
      title: `Jag task ${i}`,
      assigneePhone: STAFF_JAG.phone,
      assigneeName: STAFF_JAG.name,
      branch: "JAGDALPUR",
      dueAt: `2026-11-${String(i + 1).padStart(2, "0")}T04:30:00.000Z`,
    }),
  );
  return [
    task({ id: "d2", title: "Kal wala kaam" }),
    task({ id: "d1", title: "Purana kaam", dueAt: "2026-10-25T04:30:00.000Z" }),
    task({
      id: "d3",
      title: "Apna kaam",
      createdByPhone: STAFF_DURG.phone,
      createdByName: STAFF_DURG.name,
      dueAt: "2026-10-28T04:30:00.000Z",
    }),
    task({ id: "done1", title: "Ho gaya kaam", status: "done", doneAt: "2026-10-20T04:30:00.000Z" }),
    task({ id: "r1", title: "Raipur kaam", assigneePhone: STAFF_RAIPUR.phone, assigneeName: STAFF_RAIPUR.name, branch: "RAIPUR" }),
    task({ id: "a1", title: "Admin2 kaam", assigneePhone: ADMIN2.phone, assigneeName: ADMIN2.name, branch: null }),
    task({
      id: "a2",
      title: "Admin1 kaam",
      assigneePhone: ADMIN.phone,
      assigneeName: ADMIN.name,
      branch: null,
      createdByPhone: ADMIN2.phone,
      createdByName: ADMIN2.name,
      dueAt: "2026-10-29T04:30:00.000Z",
    }),
    ...jag,
  ];
}

function setup(user: User): BotContext {
  return makeCtx(user, new MemoryStore({ users: USERS, tasks: seed() }));
}

async function send(ctx: BotContext, input: Inbound): Promise<Outgoing[]> {
  const session = await ctx.store.getSession(ctx.user.phone);
  if (!session) throw new Error("no session");
  return tasksFlow.handle(ctx, session, input);
}

async function step(ctx: BotContext): Promise<string | null> {
  return (await ctx.store.getSession(ctx.user.phone))?.step ?? null;
}

function bodies(out: Outgoing[]): string {
  return out.map((o) => (o.kind === "template" ? o.fallbackText : o.body)).join("\n");
}

function rowIds(o: Outgoing | undefined): string[] {
  return o?.kind === "list" ? o.rows.map((r) => r.id) : [];
}

function last(out: Outgoing[]): Outgoing | undefined {
  return out[out.length - 1];
}

/** Opens a task's detail from the user's own list. */
async function openMine(ctx: BotContext, id: string): Promise<Outgoing[]> {
  await tasksFlow.start(ctx, "mine");
  return send(ctx, tap(`tasks:task:${id}`));
}

describe("mere tasks", () => {
  it("lists pending tasks sorted by due with overdue marker", async () => {
    const ctx = setup(STAFF_DURG);
    const out = await tasksFlow.start(ctx, "mine");
    expect(out).toHaveLength(1);
    const msg = out[0];
    expect(msg.kind).toBe("list");
    if (msg.kind !== "list") return;
    expect(msg.body).toBe("Aapke *3* pending tasks hain 👇 (⚠️ = overdue)");
    expect(msg.rows.map((r) => r.id)).toEqual(["tasks:task:d1", "tasks:task:d2", "tasks:task:d3"]);
    expect(msg.rows[0].description).toContain("⚠️");
    expect(msg.rows[1].description).not.toContain("⚠️");
    expect(await step(ctx)).toBe("list");
  });

  it("empty case ends the flow", async () => {
    const ctx = setup(ADMIN2);
    await ctx.store.updateTask("a1", { status: "done" });
    const out = await tasksFlow.start(ctx, "mine");
    expect(bodies(out)).toBe("🎉 Aapke koi pending task nahi hain!");
    expect(await step(ctx)).toBeNull();
  });

  it("pages through long lists", async () => {
    const ctx = setup(STAFF_JAG);
    const p0 = await tasksFlow.start(ctx, "mine");
    expect(rowIds(p0[0])).toHaveLength(9);
    expect(rowIds(p0[0])).toContain("tasks:page:1");
    const p1 = await send(ctx, tap("tasks:page:1"));
    expect(rowIds(p1[0])).toEqual(["tasks:task:j8", "tasks:task:j9", "tasks:task:j10", "tasks:page:0"]);
    expect((await ctx.store.getSession(STAFF_JAG.phone))?.data.page).toBe("1");
  });

  it("re-prompts on unexpected input in the list", async () => {
    const ctx = setup(STAFF_DURG);
    await tasksFlow.start(ctx, "mine");
    const out = await send(ctx, say("kuch bhi"));
    expect(bodies(out)).toContain("list se chuniye");
    expect(last(out)?.kind).toBe("list");
    expect(await step(ctx)).toBe("list");
  });
});

describe("staff ke tasks", () => {
  it("is admin only", async () => {
    const ctx = setup(STAFF_DURG);
    const out = await tasksFlow.start(ctx, "staff");
    expect(bodies(out)).toBe("Ye option sirf admin ke liye hai.");
    expect(await step(ctx)).toBeNull();
  });

  it("branch → user → that user's tasks", async () => {
    const ctx = setup(ADMIN);
    const b = await tasksFlow.start(ctx, "staff");
    expect(rowIds(b[0])).toContain("tasks:branch:ADMINS");
    const u = await send(ctx, tap("tasks:branch:DURG"));
    expect(rowIds(u[0])).toEqual([`tasks:user:${STAFF_DURG.phone}`, "tasks:all"]);
    const l = await send(ctx, tap(`tasks:user:${STAFF_DURG.phone}`));
    expect(rowIds(l[0])).toEqual(["tasks:task:d1", "tasks:task:d2", "tasks:task:d3"]);
    expect(bodies(l)).toContain("*Hardware* ke *3* pending tasks");
    expect(await step(ctx)).toBe("list");
  });

  it("all tasks of a branch show the assignee", async () => {
    const ctx = setup(ADMIN);
    await tasksFlow.start(ctx, "staff");
    await send(ctx, tap("tasks:branch:RAIPUR"));
    const out = await send(ctx, tap("tasks:all"));
    const msg = out[0];
    if (msg.kind !== "list") throw new Error("expected list");
    expect(msg.rows.map((r) => r.id)).toEqual(["tasks:task:r1"]);
    expect(msg.rows[0].description).toContain("Chikku");
  });

  it("ADMINS group shows every admin's pending tasks", async () => {
    const ctx = setup(ADMIN);
    await tasksFlow.start(ctx, "staff");
    const u = await send(ctx, tap("tasks:branch:ADMINS"));
    expect(rowIds(u[0])).toEqual([`tasks:user:${ADMIN.phone}`, `tasks:user:${ADMIN2.phone}`, "tasks:all"]);
    const out = await send(ctx, tap("tasks:all"));
    expect(rowIds(out[0])).toEqual(["tasks:task:a1", "tasks:task:a2"]);
    expect(bodies(out)).toContain("*Admins* ke *2* pending tasks");
  });

  it("user without tasks → says so and re-shows users", async () => {
    const ctx = setup(ADMIN);
    await ctx.store.updateTask("r1", { status: "done" });
    await tasksFlow.start(ctx, "staff");
    await send(ctx, tap("tasks:branch:RAIPUR"));
    const out = await send(ctx, tap(`tasks:user:${STAFF_RAIPUR.phone}`));
    expect(bodies(out)).toContain("*Chikku* ke koi pending task nahi hain.");
    expect(rowIds(last(out))).toContain("tasks:all");
    expect(await step(ctx)).toBe("pick_user");
  });

  it("pages the user's view in staff mode", async () => {
    const ctx = setup(ADMIN);
    await tasksFlow.start(ctx, "staff");
    await send(ctx, tap("tasks:branch:JAGDALPUR"));
    await send(ctx, tap("tasks:all"));
    const p1 = await send(ctx, tap("tasks:page:1"));
    expect(rowIds(p1[0])).toEqual(["tasks:task:j8", "tasks:task:j9", "tasks:task:j10", "tasks:page:0"]);
  });

  it("bad input at branch picker re-shows it", async () => {
    const ctx = setup(ADMIN);
    await tasksFlow.start(ctx, "staff");
    const out = await send(ctx, tap("tasks:user:123"));
    expect(rowIds(last(out))).toContain("tasks:branch:DURG");
    expect(await step(ctx)).toBe("pick_branch");
  });
});

describe("task detail", () => {
  it("pending task shows buttons", async () => {
    const ctx = setup(STAFF_DURG);
    await ctx.store.updateTask("d1", {
      remarks: [{ at: "2026-10-25T06:30:00.000Z", byPhone: STAFF_DURG.phone, byName: "Hardware", text: "Kal aayenge" }],
    });
    const out = await openMine(ctx, "d1");
    const msg = out[0];
    if (msg.kind !== "buttons") throw new Error("expected buttons");
    expect(msg.body).toBe(
      "*Purana kaam*\nKisko: Hardware\nDiya: Bhaskar\nDue: 25 Oct ⚠️ Overdue\nStatus: Pending\nLast remark: Kal aayenge (25 Oct, 12:00 PM)",
    );
    expect(msg.buttons.map((b) => b.id)).toEqual(["tasks:act:done", "tasks:act:update", "tasks:act:date"]);
    expect(await step(ctx)).toBe("detail");
  });

  it("done task shows text only", async () => {
    const ctx = setup(STAFF_DURG);
    await tasksFlow.start(ctx, "mine");
    const out = await send(ctx, tap("tasks:task:done1"));
    expect(out[0].kind).toBe("text");
    expect(bodies(out)).toContain("Status: Done ✅");
  });

  it("unknown task", async () => {
    const ctx = setup(STAFF_DURG);
    await tasksFlow.start(ctx, "mine");
    const out = await send(ctx, tap("tasks:task:nope"));
    expect(bodies(out)).toContain("Ye task nahi mila");
    expect(await step(ctx)).toBeNull();
  });

  it("denies a user who is not assignee, creator or admin", async () => {
    const ctx = setup(STAFF_RAIPUR);
    await tasksFlow.start(ctx, "mine");
    const out = await send(ctx, tap("tasks:task:d2"));
    expect(bodies(out)).toBe("Ye task aapka nahi hai.");

    await ctx.store.saveSession({ phone: STAFF_RAIPUR.phone, flow: "tasks", step: "detail", data: { view: "mine", taskId: "d2" }, updatedAt: ctx.now.toISOString() });
    const act = await send(ctx, tap("tasks:act:done"));
    expect(bodies(act)).toBe("Ye task aapka nahi hai.");
    expect((await ctx.store.getTask("d2"))?.status).toBe("pending");
  });

  it("re-shows detail on unexpected input", async () => {
    const ctx = setup(STAFF_DURG);
    await openMine(ctx, "d2");
    const out = await send(ctx, say("hmm"));
    expect(last(out)?.kind).toBe("buttons");
    expect(await step(ctx)).toBe("detail");
  });

  it("missing session data does not crash", async () => {
    const ctx = setup(STAFF_DURG);
    await ctx.store.saveSession({ phone: STAFF_DURG.phone, flow: "tasks", step: "ask_time", data: {}, updatedAt: ctx.now.toISOString() });
    const out = await send(ctx, tap("tasks:time:skip"));
    expect(bodies(out)).toBe("Kuch gadbad hui, dobara *Hi* bhejiye.");
    expect(await step(ctx)).toBeNull();
  });
});

describe("done", () => {
  it("marks done and notifies the creator", async () => {
    const ctx = setup(STAFF_DURG);
    await openMine(ctx, "d2");
    const out = await send(ctx, tap("tasks:act:done"));
    expect(out[0]).toEqual({ to: STAFF_DURG.phone, kind: "text", body: "✅ *Kal wala kaam* done mark ho gaya. Shabash! 👏" });
    expect(out[1]).toMatchObject({
      to: ADMIN.phone,
      kind: "template",
      template: "task_done_v1",
      bodyValues: ["Bhaskar", "Hardware", "Kal wala kaam", "26 Oct, 3:00 PM"],
    });
    expect(out).toHaveLength(2);
    const t = await ctx.store.getTask("d2");
    expect(t).toMatchObject({ status: "done", doneAt: ctx.now.toISOString(), updatedAt: ctx.now.toISOString(), nextReminderAt: null });
    expect(await step(ctx)).toBeNull();
  });

  it("no template when the creator marks it done", async () => {
    const ctx = setup(STAFF_DURG);
    await openMine(ctx, "d3");
    const out = await send(ctx, tap("tasks:act:done"));
    expect(out).toHaveLength(1);
  });

  it("admin can mark another's task done", async () => {
    const ctx = setup(ADMIN2);
    await tasksFlow.start(ctx, "staff");
    await send(ctx, tap("tasks:branch:DURG"));
    await send(ctx, tap("tasks:all"));
    await send(ctx, tap("tasks:task:d2"));
    const out = await send(ctx, tap("tasks:act:done"));
    expect(out[1]).toMatchObject({ to: ADMIN.phone, bodyValues: ["Bhaskar", "Partner Two", "Kal wala kaam", "26 Oct, 3:00 PM"] });
  });

  it("already done", async () => {
    const ctx = setup(STAFF_DURG);
    await openMine(ctx, "d2");
    await ctx.store.updateTask("d2", { status: "done" });
    const out = await send(ctx, tap("tasks:act:done"));
    expect(bodies(out)).toContain("pehle hi done");
    expect(out).toHaveLength(1);
  });
});

describe("update remark", () => {
  it("saves the remark", async () => {
    const ctx = setup(STAFF_DURG);
    await openMine(ctx, "d2");
    expect(bodies(await send(ctx, tap("tasks:act:update")))).toContain("Update / remark likhiye");
    const tapped = await send(ctx, tap("tasks:act:done"));
    expect(bodies(tapped)).toContain("type karke");
    expect(await step(ctx)).toBe("ask_remark");
    expect(bodies(await send(ctx, say("x".repeat(501))))).toContain("500");
    const out = await send(ctx, say("Customer ne kal bulaya"));
    expect(bodies(out)).toBe("📝 Remark save ho gaya.");
    const t = await ctx.store.getTask("d2");
    expect(t?.remarks).toEqual([{ at: ctx.now.toISOString(), byPhone: STAFF_DURG.phone, byName: "Hardware", text: "Customer ne kal bulaya" }]);
    expect(t?.updatedAt).toBe(ctx.now.toISOString());
    expect(t?.status).toBe("pending");
  });
});

describe("date badlo", () => {
  async function toDue(ctx: BotContext, id = "d2"): Promise<void> {
    await openMine(ctx, id);
    const out = await send(ctx, tap("tasks:act:date"));
    expect(rowIdsOfButtons(out[0])).toEqual(["tasks:due:today", "tasks:due:tomorrow", "tasks:due:custom"]);
  }
  function rowIdsOfButtons(o: Outgoing | undefined): string[] {
    return o?.kind === "buttons" ? o.buttons.map((b) => b.id) : [];
  }

  it("kal + skip → 10 AM tomorrow after a remark", async () => {
    const ctx = setup(STAFF_DURG);
    await toDue(ctx, "d1");
    const t = await send(ctx, tap("tasks:due:tomorrow"));
    expect(rowIdsOfButtons(t[0])).toEqual(["tasks:time:skip"]);
    const r = await send(ctx, tap("tasks:time:skip"));
    expect(bodies(r)).toContain("Date kyun badal rahe hain?");
    const out = await send(ctx, say("Customer bahar hai"));
    expect(bodies(out)).toBe("📅 Date badal di: *27 Oct*");
    const task1 = await ctx.store.getTask("d1");
    expect(task1).toMatchObject({
      dueAt: "2026-10-27T04:30:00.000Z",
      dueHasTime: false,
      nextReminderAt: "2026-10-27T04:30:00.000Z",
      updatedAt: ctx.now.toISOString(),
    });
    expect(task1?.remarks.at(-1)?.text).toBe("Date badli: 25 Oct → 27 Oct. Customer bahar hai");
    expect(await step(ctx)).toBeNull();
  });

  it("custom 28/10 4pm", async () => {
    const ctx = setup(STAFF_DURG);
    await toDue(ctx);
    expect(bodies(await send(ctx, tap("tasks:due:custom")))).toContain("*28/10*");
    await send(ctx, say("28/10 4pm"));
    const out = await send(ctx, say("Shaam ko milenge"));
    expect(bodies(out)).toBe("📅 Date badal di: *28 Oct, 4:00 PM*");
    const t = await ctx.store.getTask("d2");
    expect(t).toMatchObject({ dueAt: "2026-10-28T10:30:00.000Z", dueHasTime: true });
    expect(t?.remarks.at(-1)?.text).toBe("Date badli: 27 Oct → 28 Oct, 4:00 PM. Shaam ko milenge");
  });

  it("accepts a typed date at the due buttons and a typed time", async () => {
    const ctx = setup(STAFF_DURG);
    await toDue(ctx);
    await send(ctx, say("29/10"));
    expect(await step(ctx)).toBe("ask_date_remark");

    const ctx2 = setup(STAFF_DURG);
    await toDue(ctx2);
    await send(ctx2, tap("tasks:due:today"));
    await send(ctx2, say("6pm"));
    await send(ctx2, say("ok"));
    expect((await ctx2.store.getTask("d2"))?.dueAt).toBe("2026-10-26T12:30:00.000Z");
  });

  it("invalid input keeps the step", async () => {
    const ctx = setup(STAFF_DURG);
    await toDue(ctx);
    expect(bodies(await send(ctx, say("pata nahi")))).toContain("Samajh nahi aaya");
    expect(await step(ctx)).toBe("ask_due");
    await send(ctx, tap("tasks:due:custom"));
    expect(bodies(await send(ctx, say("blah")))).toContain("samajh nahi");
    expect(await step(ctx)).toBe("ask_custom_due");
    await send(ctx, say("28/10"));
    expect(bodies(await send(ctx, tap("tasks:due:today")))).toContain("type karke");
    expect(await step(ctx)).toBe("ask_date_remark");
  });

  it("invalid time keeps ask_time", async () => {
    const ctx = setup(STAFF_DURG);
    await toDue(ctx);
    await send(ctx, tap("tasks:due:tomorrow"));
    expect(bodies(await send(ctx, say("jaldi")))).toContain("Time samajh nahi aaya");
    expect(await step(ctx)).toBe("ask_time");
  });

  it("rejects a past instant", async () => {
    const ctx = setup(STAFF_DURG);
    await toDue(ctx);
    await send(ctx, tap("tasks:due:today"));
    const out = await send(ctx, tap("tasks:time:skip"));
    expect(bodies(out)).toContain("nikal chuka");
    expect(await step(ctx)).toBe("ask_due");
    expect((await ctx.store.getTask("d2"))?.dueAt).toBe("2026-10-27T04:30:00.000Z");
  });

  it("25-day rule blocks staff", async () => {
    const ctx = setup(STAFF_DURG);
    await toDue(ctx);
    await send(ctx, tap("tasks:due:custom"));
    const out = await send(ctx, say("30/11"));
    expect(bodies(out)).toBe(
      "⚠️ 25 din se zyada aage ki date allowed nahi hai. Iske liye admin ki approval chahiye (ye feature jaldi aa raha hai). Abhi purani date (*27 Oct*) hi rahegi.",
    );
    expect(await step(ctx)).toBeNull();
    expect((await ctx.store.getTask("d2"))?.dueAt).toBe("2026-10-27T04:30:00.000Z");
  });

  it("25-day rule does not limit admins", async () => {
    const ctx = setup(ADMIN);
    await toDue(ctx, "a2");
    await send(ctx, tap("tasks:due:custom"));
    await send(ctx, say("30/11"));
    const out = await send(ctx, say("Partner ne bola"));
    expect(bodies(out)).toBe("📅 Date badal di: *30 Nov*");
    expect((await ctx.store.getTask("a2"))?.dueAt).toBe("2026-11-30T04:30:00.000Z");
  });

  it("stale taps from another step are re-prompted, not applied", async () => {
    const ctx = setup(STAFF_DURG);
    await toDue(ctx);
    const out = await send(ctx, tap("tasks:act:done"));
    expect(last(out)?.kind).toBe("buttons");
    expect(await step(ctx)).toBe("ask_due");
    expect((await ctx.store.getTask("d2"))?.status).toBe("pending");
  });
});
