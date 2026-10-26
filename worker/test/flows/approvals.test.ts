import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { approvalsFlow } from "../../src/bot/flows/approvals";
import type { BotContext, Inbound } from "../../src/bot/flow";
import type { Outgoing } from "../../src/bot/outgoing";
import type { DateRequest, Task, User } from "../../src/domain/types";
import { ADMIN, ADMIN2, STAFF_DURG, STAFF_RAIPUR, USERS, makeCtx, say, tap, task } from "../helpers/bot";

function req(overrides: Partial<DateRequest> = {}): DateRequest {
  return {
    dueAt: "2026-12-05T04:30:00.000Z", // 5 Dec 10:00 IST
    hasTime: false,
    remark: "Customer bahar hai",
    byPhone: STAFF_DURG.phone,
    byName: STAFF_DURG.name,
    requestedAt: "2026-10-25T04:30:00.000Z",
    ...overrides,
  };
}

function seed(): Task[] {
  return [
    task({ id: "p1", title: "Payment lena", dateRequest: req() }),
    task({
      id: "p2",
      title: "Display badalna",
      assigneePhone: STAFF_RAIPUR.phone,
      assigneeName: STAFF_RAIPUR.name,
      branch: "RAIPUR",
      dueAt: "2026-10-30T08:30:00.000Z",
      dueHasTime: true,
      dateRequest: req({ byPhone: STAFF_RAIPUR.phone, byName: STAFF_RAIPUR.name, requestedAt: "2026-10-24T04:30:00.000Z", dueAt: "2026-12-10T10:30:00.000Z", hasTime: true }),
    }),
    task({ id: "n1", title: "No request", dateRequest: null }),
    task({ id: "old", title: "Old shape" }), // no optional fields at all
    task({ id: "done", title: "Done one", status: "done", dateRequest: req() }),
  ];
}

function setup(user: User, tasks: Task[] = seed()): BotContext {
  return makeCtx(user, new MemoryStore({ users: USERS, tasks }));
}

async function send(ctx: BotContext, input: Inbound): Promise<Outgoing[]> {
  const session = await ctx.store.getSession(ctx.user.phone);
  if (!session) throw new Error("no session");
  return approvalsFlow.handle(ctx, session, input);
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

describe("approvals list", () => {
  it("is admin only", async () => {
    const ctx = setup(STAFF_DURG);
    const out = await approvalsFlow.start(ctx);
    expect(bodies(out)).toBe("Ye option sirf admin ke liye hai.");
    expect(await step(ctx)).toBeNull();

    await ctx.store.saveSession({ phone: STAFF_DURG.phone, flow: "approvals", step: "decide", data: { taskId: "p1" }, updatedAt: ctx.now.toISOString() });
    const act = await send(ctx, tap("approvals:decide:approve"));
    expect(bodies(act)).toBe("Ye option sirf admin ke liye hai.");
    expect((await ctx.store.getTask("p1"))?.dateRequest).not.toBeNull();
  });

  it("empty", async () => {
    const ctx = setup(ADMIN, [task({ id: "old" }), task({ id: "n1", dateRequest: null })]);
    const out = await approvalsFlow.start(ctx);
    expect(bodies(out)).toBe("✅ Koi approval pending nahi hai.");
    expect(await step(ctx)).toBeNull();
  });

  it("lists pending requests sorted by requestedAt", async () => {
    const ctx = setup(ADMIN);
    const out = await approvalsFlow.start(ctx);
    const msg = out[0];
    if (msg.kind !== "list") throw new Error("expected list");
    expect(msg.rows.map((r) => r.id)).toEqual(["approvals:task:p2", "approvals:task:p1"]);
    expect(msg.rows[0]).toMatchObject({ title: "Display badalna", description: "Chikku → 10 Dec, 4:00 PM" });
    expect(msg.rows[1].description).toBe("Hardware → 5 Dec");
    expect(await step(ctx)).toBe("list");
  });

  it("pages long lists", async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      task({ id: `m${i}`, title: `Task ${i}`, dateRequest: req({ requestedAt: `2026-10-${String(10 + i)}T04:30:00.000Z` }) }),
    );
    const ctx = setup(ADMIN, many);
    const p0 = await approvalsFlow.start(ctx);
    expect(rowIds(p0[0])).toHaveLength(9);
    expect(rowIds(p0[0]).at(-1)).toBe("approvals:page:1");
    const p1 = await send(ctx, tap("approvals:page:1"));
    expect(rowIds(p1[0])).toEqual(["approvals:task:m8", "approvals:task:m9", "approvals:page:0"]);
  });

  it("re-prompts on unexpected input", async () => {
    const ctx = setup(ADMIN);
    await approvalsFlow.start(ctx);
    const out = await send(ctx, say("kya"));
    expect(bodies(out)).toContain("list se chuniye");
    expect(out.at(-1)?.kind).toBe("list");
  });
});

describe("decide", () => {
  async function open(ctx: BotContext, id: string): Promise<Outgoing[]> {
    await approvalsFlow.start(ctx);
    return send(ctx, tap(`approvals:task:${id}`));
  }

  it("shows the request detail with buttons", async () => {
    const ctx = setup(ADMIN);
    const out = await open(ctx, "p1");
    const msg = out[0];
    if (msg.kind !== "buttons") throw new Error("expected buttons");
    expect(msg.body).toBe("*Payment lena*\nStaff: Hardware\nAbhi ki date: 27 Oct\nNayi date: 5 Dec\nRemark: Customer bahar hai");
    expect(msg.buttons.map((b) => b.id)).toEqual(["approvals:decide:approve", "approvals:decide:reject"]);
    expect(await step(ctx)).toBe("decide");
    expect(bodies(await send(ctx, say("hmm")))).toContain("buttons se chuniye");
  });

  it("approve updates the task, notifies the requester and re-shows the list", async () => {
    const ctx = setup(ADMIN2);
    await open(ctx, "p1");
    const out = await send(ctx, tap("approvals:decide:approve"));
    expect(out[0]).toEqual({ to: ADMIN2.phone, kind: "text", body: "✅ Approve kar diya" });
    expect(out[1]).toMatchObject({
      to: STAFF_DURG.phone,
      kind: "template",
      template: "date_approval_result_v1",
      bodyValues: ["Hardware", "Payment lena", "Approved", "5 Dec"],
    });
    expect(rowIds(out[2])).toEqual(["approvals:task:p2"]);
    expect(await step(ctx)).toBe("list");

    const t = await ctx.store.getTask("p1");
    expect(t).toMatchObject({
      dueAt: "2026-12-05T04:30:00.000Z",
      dueHasTime: false,
      nextReminderAt: "2026-12-05T04:30:00.000Z",
      dateRequest: null,
      updatedAt: ctx.now.toISOString(),
    });
    expect(t?.remarks.at(-1)).toEqual({
      at: ctx.now.toISOString(),
      byPhone: ADMIN2.phone,
      byName: "Partner Two",
      text: "Date approve hui (Partner Two): 27 Oct → 5 Dec. Customer bahar hai",
    });
  });

  it("reject keeps the date and ends when nothing remains", async () => {
    const ctx = setup(ADMIN, [seed()[1]]);
    await open(ctx, "p2");
    const out = await send(ctx, tap("approvals:decide:reject"));
    expect(out).toHaveLength(2);
    expect(bodies([out[0]])).toBe("❌ Reject kar diya");
    expect(out[1]).toMatchObject({
      to: STAFF_RAIPUR.phone,
      template: "date_approval_result_v1",
      bodyValues: ["Chikku", "Display badalna", "Rejected", "30 Oct, 2:00 PM"],
    });
    expect(await step(ctx)).toBeNull();
    const t = await ctx.store.getTask("p2");
    expect(t).toMatchObject({ dueAt: "2026-10-30T08:30:00.000Z", dateRequest: null });
    expect(t?.remarks.at(-1)?.text).toBe("Date request reject hui (Bhaskar). Date 30 Oct, 2:00 PM hi rahegi.");
  });

  it("already handled by someone else → list again", async () => {
    const ctx = setup(ADMIN);
    await open(ctx, "p1");
    await ctx.store.updateTask("p1", { dateRequest: null });
    const out = await send(ctx, tap("approvals:decide:approve"));
    expect(bodies([out[0]])).toBe("Ye request pehle hi handle ho chuki hai.");
    expect(rowIds(out[1])).toEqual(["approvals:task:p2"]);
    expect((await ctx.store.getTask("p1"))?.dueAt).toBe("2026-10-27T04:30:00.000Z");
  });

  it("already handled and nothing left → ends", async () => {
    const ctx = setup(ADMIN, [seed()[0]]);
    await open(ctx, "p1");
    await ctx.store.updateTask("p1", { status: "done" });
    const out = await send(ctx, tap("approvals:decide:reject"));
    expect(bodies(out)).toBe("Ye request pehle hi handle ho chuki hai.");
    expect(await step(ctx)).toBeNull();
  });

  it("stale tap on a handled task in the list", async () => {
    const ctx = setup(ADMIN);
    await approvalsFlow.start(ctx);
    const out = await send(ctx, tap("approvals:task:old"));
    expect(bodies([out[0]])).toBe("Ye request pehle hi handle ho chuki hai.");
    expect(out[1].kind).toBe("list");
  });

  it("a replaced request is shown again before deciding", async () => {
    const ctx = setup(ADMIN);
    await open(ctx, "p1");
    await ctx.store.updateTask("p1", { dateRequest: req({ dueAt: "2026-12-20T04:30:00.000Z", requestedAt: "2026-10-26T09:00:00.000Z" }) });
    const out = await send(ctx, tap("approvals:decide:approve"));
    expect(bodies(out)).toContain("Nayi date: 20 Dec");
    expect((await ctx.store.getTask("p1"))?.dateRequest).not.toBeNull();
    const ok = await send(ctx, tap("approvals:decide:approve"));
    expect(bodies([ok[0]])).toBe("✅ Approve kar diya");
    expect((await ctx.store.getTask("p1"))?.dueAt).toBe("2026-12-20T04:30:00.000Z");
  });

  it("can jump to another row from the detail", async () => {
    const ctx = setup(ADMIN);
    await open(ctx, "p1");
    const out = await send(ctx, tap("approvals:task:p2"));
    expect(bodies(out)).toContain("*Display badalna*");
    expect((await ctx.store.getSession(ADMIN.phone))?.data.taskId).toBe("p2");
  });
});
