// POST /api/tasks: a new task from the dashboard (Naya task). Rules live in bot/taskActions.

import { createTaskFor } from "../../bot/taskActions";
import type { TaskRepeat } from "../../domain/types";
import { json, type Route } from "../api";
import { asObject, bad, dateBody, resolveActor, respond } from "./write";

const REPEATS: readonly TaskRepeat[] = ["none", "every90", "monthly"];

export const createRoutes: Route[] = [
  {
    method: "POST",
    path: "/api/tasks",
    auth: "named",
    handler: async (ctx, raw) => {
      const actor = await resolveActor(ctx);
      if (!actor) return json({ error: "Pehle apna naam chuniye", code: "need_name" }, 403);
      const body = asObject(raw);
      if (typeof body.title !== "string") return bad("Task kya hai, likhiye");
      if (typeof body.assigneePhone !== "string" || !body.assigneePhone) return bad("Kisko dena hai, chuniye");
      const repeat = body.repeat ?? "none";
      if (!REPEATS.includes(repeat as TaskRepeat)) return bad("Reminder ka option galat hai");
      const input = dateBody({ date: body.date, time: body.time });
      if (input instanceof Response) return input;
      const assignee = await ctx.store.getUser(body.assigneePhone);
      if (!assignee || !assignee.active) return bad("Ye user ab active nahi hai");
      const result = await createTaskFor(ctx.store, actor, { title: body.title, assignee, due: input.due, repeat: repeat as TaskRepeat }, ctx.now);
      if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
      const res = await respond(ctx, "create", actor, result.task, result);
      return new Response(res.body, { status: 201, headers: res.headers });
    },
  },
];
