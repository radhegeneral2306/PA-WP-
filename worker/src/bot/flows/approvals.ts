// "Approvals": admins review staff requests to move a due date beyond the
// 25-day limit and approve or reject them.

import type { DateRequest, Task } from "../../domain/types";
import { formatDue } from "../../domain/dates";
import { endFlow, replyValue, setStep, type BotContext, type Flow, type Inbound } from "../flow";
import type { Outgoing } from "../outgoing";
import { buttons, clip, list, paginate, text } from "../ui";
import type { ListRow } from "../../interakt/send";
import { decideDateRequest, type DateDecision } from "../taskActions";

const ID = "approvals";
const PAGE_SIZE = 8;
const TITLE_MAX = 24;
const DESC_MAX = 72;

type Data = Record<string, string>;
type Pending = Task & { dateRequest: DateRequest };
type Decision = DateDecision;

const MSG = {
  adminOnly: "Ye option sirf admin ke liye hai.",
  none: "✅ Koi approval pending nahi hai.",
  handled: "Ye request pehle hi handle ho chuki hai.",
  changed: "Is request mein badlav hua hai, dobara dekh ke decide kijiye.",
  useList: "👆 Upar wali list se chuniye.",
  useButtons: "👆 Upar wale buttons se chuniye.",
};

export const approvalsFlow: Flow = {
  id: ID,

  async start(ctx) {
    if (ctx.user.role !== "admin") return finish(ctx, MSG.adminOnly);
    return renderList(ctx, 0);
  },

  async handle(ctx, session, input) {
    if (ctx.user.role !== "admin") return finish(ctx, MSG.adminOnly);
    if (session.step === "list") return onList(ctx, session.data, input);
    if (session.step === "decide") return onDecide(ctx, session.data, input);
    return renderList(ctx, 0);
  },
};

// ---------- helpers ----------

function say(ctx: BotContext, body: string): Outgoing {
  return text(ctx.user.phone, body);
}

async function finish(ctx: BotContext, body: string): Promise<Outgoing[]> {
  await endFlow(ctx);
  return [say(ctx, body)];
}

function pageOf(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function hasRequest(t: Task | null): t is Pending {
  return !!t && t.status === "pending" && !!t.dateRequest;
}

const due = (ctx: BotContext, at: string, hasTime: boolean): string => formatDue(at, hasTime, ctx.now);

async function loadPending(ctx: BotContext): Promise<Pending[]> {
  const tasks = await ctx.store.listTasks({ status: "pending" });
  return tasks.filter(hasRequest).sort((a, b) => a.dateRequest.requestedAt.localeCompare(b.dateRequest.requestedAt));
}

// ---------- list ----------

function listMessage(ctx: BotContext, tasks: Pending[], page: number): Outgoing {
  const pg = paginate(tasks, page, PAGE_SIZE);
  const rows: ListRow[] = pg.items.map((t) => ({
    id: `${ID}:task:${t.id}`,
    title: clip(t.title, TITLE_MAX),
    description: clip(`${t.dateRequest.byName} → ${due(ctx, t.dateRequest.dueAt, t.dateRequest.hasTime)}`, DESC_MAX),
  }));
  if (pg.hasPrev) rows.push({ id: `${ID}:page:${pg.page - 1}`, title: "⬅️ Peeche" });
  if (pg.hasNext) rows.push({ id: `${ID}:page:${pg.page + 1}`, title: "Aage ➡️" });
  const body = `*${tasks.length}* date request approval ke liye pending hain 👇`;
  return list(ctx.user.phone, body, "Request chuno", rows, "Approvals");
}

/** Shows the pending list, or ends the flow when nothing is left. */
async function renderList(ctx: BotContext, page: number): Promise<Outgoing[]> {
  const tasks = await loadPending(ctx);
  if (tasks.length === 0) return finish(ctx, MSG.none);
  const p = paginate(tasks, page, PAGE_SIZE).page;
  await setStep(ctx, ID, "list", { page: String(p) });
  return [listMessage(ctx, tasks, p)];
}

async function onList(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const page = replyValue(input, ID, "page");
  if (page !== null) return renderList(ctx, pageOf(page));
  const taskId = replyValue(input, ID, "task");
  if (taskId) return openDetail(ctx, data, taskId);
  return [say(ctx, MSG.useList), ...(await renderList(ctx, pageOf(data.page)))];
}

// ---------- detail / decide ----------

function detailMessage(ctx: BotContext, t: Pending): Outgoing {
  const r = t.dateRequest;
  const body = [
    `*${t.title}*`,
    `Staff: ${r.byName}`,
    `Abhi ki date: ${due(ctx, t.dueAt, t.dueHasTime)}`,
    `Nayi date: ${due(ctx, r.dueAt, r.hasTime)}`,
    `Remark: ${r.remark}`,
  ].join("\n");
  return buttons(ctx.user.phone, body, [
    { id: `${ID}:decide:approve`, title: "Approve ✅" },
    { id: `${ID}:decide:reject`, title: "Reject ❌" },
  ]);
}

async function handledAlready(ctx: BotContext, data: Data): Promise<Outgoing[]> {
  if ((await loadPending(ctx)).length === 0) return finish(ctx, MSG.handled);
  return [say(ctx, MSG.handled), ...(await renderList(ctx, pageOf(data.page)))];
}

async function openDetail(ctx: BotContext, data: Data, taskId: string): Promise<Outgoing[]> {
  const t = await ctx.store.getTask(taskId);
  if (!hasRequest(t)) return handledAlready(ctx, data);
  await setStep(ctx, ID, "decide", { page: data.page ?? "0", taskId, requestedAt: t.dateRequest.requestedAt });
  return [detailMessage(ctx, t)];
}

async function onDecide(ctx: BotContext, data: Data, input: Inbound): Promise<Outgoing[]> {
  const choice = replyValue(input, ID, "decide");
  if (choice !== "approve" && choice !== "reject") {
    // The list is still on screen; let the admin jump to another row.
    if (replyValue(input, ID, "task") !== null || replyValue(input, ID, "page") !== null) return onList(ctx, data, input);
    const t = data.taskId ? await ctx.store.getTask(data.taskId) : null;
    if (!hasRequest(t)) return handledAlready(ctx, data);
    return [say(ctx, MSG.useButtons), detailMessage(ctx, t)];
  }
  const t = data.taskId ? await ctx.store.getTask(data.taskId) : null;
  if (!hasRequest(t)) return handledAlready(ctx, data);
  if (data.requestedAt && t.dateRequest.requestedAt !== data.requestedAt) {
    await setStep(ctx, ID, "decide", { ...data, requestedAt: t.dateRequest.requestedAt });
    return [say(ctx, MSG.changed), detailMessage(ctx, t)];
  }
  return decide(ctx, t, choice, data);
}

async function decide(ctx: BotContext, t: Pending, choice: Decision, data: Data): Promise<Outgoing[]> {
  const result = await decideDateRequest(ctx.store, t, { phone: ctx.user.phone, name: ctx.user.name }, choice, ctx.now);
  if (!result.ok) return handledAlready(ctx, data);
  const approved = choice === "approve";
  const head = [say(ctx, approved ? "✅ Approve kar diya" : "❌ Reject kar diya"), ...result.outs];
  const rest = await loadPending(ctx);
  if (rest.length === 0) {
    await endFlow(ctx);
    return head;
  }
  return [...head, ...(await renderList(ctx, pageOf(data.page)))];
}
