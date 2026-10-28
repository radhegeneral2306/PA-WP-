// Write routes: POST /api/tasks/:id/{done,remark,due,assign,cancel,reopen,approve,reject}.
// Rules live in bot/taskActions (shared with WhatsApp); this module only resolves
// the acting admin, validates the body and turns ActionResults into responses.
// The router matches exact paths, so matchWriteRoute binds the :id into the handler.

import { addRemark, cancelTask, changeDue, decideDateRequest, dueFromInput, markDone, reassign, reopenTask, REMARK_MAX, type ActionResult, type Actor } from "../../bot/taskActions";
import type { ParsedDue } from "../../domain/dates";
import type { Task } from "../../domain/types";
import { mask } from "../../numbers";
import { json, type ApiContext, type Route } from "../api";
import { toTaskDTO } from "./read";

export type WriteAction = "done" | "remark" | "due" | "assign" | "cancel" | "reopen" | "approve" | "reject";

/** Runs one action on a loaded task for a resolved actor. */
type TaskAction = (ctx: ApiContext, body: Record<string, unknown>, task: Task, actor: Actor) => Promise<Response>;

export const bad = (error: string): Response => json({ error, code: "bad_request" }, 400);

export function asObject(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** The session's picked name → the active admin behind it (phone used for "never notify the actor"). */
export async function resolveActor(ctx: ApiContext): Promise<Actor | null> {
  const name = ctx.session?.name;
  if (!name) return null;
  const admin = (await ctx.store.listUsers({ role: "admin" })).find((u) => u.name === name);
  return admin ? { phone: admin.phone, name: admin.name, viaDashboard: true } : null;
}

export async function respond(ctx: ApiContext, action: WriteAction | "create", actor: Actor, task: Task, result: ActionResult): Promise<Response> {
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  console.log(`dashboard ${action}: task ${task.id} by ${mask(actor.phone)}, notices to ${result.outs.map((o) => mask(o.to)).join(",") || "none"}`);
  await ctx.deliver(result.outs);
  return json({ task: toTaskDTO(result.task, ctx.now), next: result.next ? toTaskDTO(result.next, ctx.now) : null });
}

const done: TaskAction = async (ctx, _body, task, actor) =>
  respond(ctx, "done", actor, task, await markDone(ctx.store, task, actor, ctx.now));

const remark: TaskAction = async (ctx, body, task, actor) => {
  if (typeof body.text !== "string") return bad("Remark likhiye");
  return respond(ctx, "remark", actor, task, await addRemark(ctx.store, task, actor, body.text, ctx.now));
};

/** Shared body check for date + optional remark (due, reopen). */
export function dateBody(body: Record<string, unknown>): { due: ParsedDue; note: string | null } | Response {
  const parsed = dueFromInput(body.date, body.time);
  if (!parsed) return bad("Date ya time galat hai");
  const note = body.remark ?? null;
  if (note !== null && typeof note !== "string") return bad("Remark text hona chahiye");
  if (note && note.length > REMARK_MAX) return bad(`Remark ${REMARK_MAX} characters se chhota rakhiye`);
  return { due: parsed, note };
}

const due: TaskAction = async (ctx, body, task, actor) => {
  const input = dateBody(body);
  if (input instanceof Response) return input;
  const result = await changeDue(ctx.store, task, actor, input.due, input.note, ctx.now, { notifyAssignee: true });
  return respond(ctx, "due", actor, task, result);
};

const assign: TaskAction = async (ctx, body, task, actor) => {
  if (typeof body.phone !== "string" || !body.phone) return bad("Kisko assign karna hai, chuniye");
  const to = await ctx.store.getUser(body.phone);
  if (!to || !to.active) return bad("Ye user ab active nahi hai");
  return respond(ctx, "assign", actor, task, await reassign(ctx.store, task, actor, to, ctx.now));
};

const cancel: TaskAction = async (ctx, _body, task, actor) =>
  respond(ctx, "cancel", actor, task, await cancelTask(ctx.store, task, actor, ctx.now));

const reopen: TaskAction = async (ctx, body, task, actor) => {
  const input = dateBody(body);
  if (input instanceof Response) return input;
  return respond(ctx, "reopen", actor, task, await reopenTask(ctx.store, task, actor, input.due, input.note, ctx.now));
};

/** Staff date request (body.requestedAt guards against a request replaced since the list loaded). */
const decideRequest =
  (decision: "approve" | "reject"): TaskAction =>
  async (ctx, body, task, actor) => {
    const expected = typeof body.requestedAt === "string" ? body.requestedAt : null;
    // Approving a date that has already gone by would restart reminders from the past
    // (an instant, possibly night-time reminder). Reject it, or change the date instead.
    const r = task.dateRequest;
    if (decision === "approve" && task.status === "pending" && r && (!expected || r.requestedAt === expected) && Date.parse(r.dueAt) < ctx.now.getTime()) {
      return json({ error: "Maangi gayi date nikal chuki hai. Reject kijiye ya nayi date dijiye.", code: "request_expired" }, 409);
    }
    return respond(ctx, decision, actor, task, await decideDateRequest(ctx.store, task, actor, decision, ctx.now, expected));
  };

const ACTIONS: Record<WriteAction, TaskAction> = {
  done,
  remark,
  due,
  assign,
  cancel,
  reopen,
  approve: decideRequest("approve"),
  reject: decideRequest("reject"),
};

/** Common prelude: actor (403), task (404), then the action. */
async function runAction(ctx: ApiContext, body: unknown, id: string, action: WriteAction): Promise<Response> {
  const actor = await resolveActor(ctx);
  if (!actor) return json({ error: "Pehle apna naam chuniye", code: "need_name" }, 403);
  const task = await ctx.store.getTask(id);
  if (!task) return json({ error: "Task nahi mila", code: "not_found" }, 404);
  return ACTIONS[action](ctx, asObject(body), task, actor);
}

const PATH_RE = /^\/api\/tasks\/([^/]+)\/(done|remark|due|assign|cancel|reopen|approve|reject)$/;

function boundRoute(action: WriteAction, id: string, path: string): Route {
  return { method: "POST", path, auth: "named", handler: (ctx, body) => runAction(ctx, body, id, action) };
}

function isSafeId(id: string): boolean {
  return id.length <= 256 && id !== "." && id !== ".." && !/[/\\\u0000-\u001f\u007f]/.test(id);
}

/** `POST /api/tasks/<id>/<action>` → a route with the id bound into its handler; null otherwise. */
export function matchWriteRoute(method: string, path: string): { route: Route; id: string } | null {
  if (method !== "POST") return null;
  const m = PATH_RE.exec(path);
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  // Task ids are Firestore document ids: never a path ("a%2Fb"), "." / "..", or control characters.
  if (!isSafeId(id)) return null;
  return { route: boundRoute(m[2] as WriteAction, id, path), id };
}

/** Pattern routes (docs / listing). They never match exactly; dispatch goes through matchWriteRoute. */
export const writeRoutes: Route[] = (Object.keys(ACTIONS) as WriteAction[]).map((action) => ({
  method: "POST",
  path: `/api/tasks/:id/${action}`,
  auth: "named",
  handler: (ctx, body) => {
    const match = matchWriteRoute(ctx.request.method, new URL(ctx.request.url).pathname.replace(/\/+$/, ""));
    return match ? match.route.handler(ctx, body) : Promise.resolve(json({ error: "Task nahi mila", code: "not_found" }, 404));
  },
}));
