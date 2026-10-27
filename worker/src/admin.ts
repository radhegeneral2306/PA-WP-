// /webhook/<secret>/users: bootstrap and inspect the user list without
// WhatsApp (the first admin has to come from somewhere).
//   GET  /users         → all users (including removed ones)
//   PUT  /users         → JSON array of { phone, name, role, branch?, active? }; upserts
//                         (active defaults to true; name/branch changes carry over to tasks)
//   POST /users/welcome → { phones: string[], addedBy: string }; welcome_user_v1 to each active user

import type { Store } from "./data/store";
import { BRANCHES, type BranchId, type Role, type User } from "./domain/types";
import { normalizePhone } from "./numbers";
import type { Outgoing } from "./bot/outgoing";
import { syncUserTasks, welcomeMessage } from "./bot/userChanges";

export type Deliver = (outs: Outgoing[]) => Promise<void>;

export async function handleUsersEndpoint(
  request: Request,
  store: Store,
  now: Date,
  deliver: Deliver = async () => undefined,
  welcome = false,
): Promise<Response> {
  if (welcome) return handleWelcome(request, store, deliver);
  if (request.method === "GET") {
    return Response.json(await store.listUsers({ activeOnly: false }), { headers: { "Cache-Control": "no-store" } });
  }
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405 });

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!Array.isArray(input)) return new Response("Expected a JSON array", { status: 400 });

  const changes: { before: User | null; after: User }[] = [];
  for (const [i, raw] of input.entries()) {
    const result = toUser(raw, now);
    if (typeof result === "string") return new Response(`Item ${i}: ${result}`, { status: 400 });
    const before = await store.getUser(result.phone);
    changes.push({ before, after: before ? { ...result, createdAt: before.createdAt } : result });
  }
  let tasksUpdated = 0;
  for (const { before, after } of changes) {
    await store.saveUser(after);
    if (before) tasksUpdated += await syncUserTasks(store, before, after);
  }
  return Response.json({ saved: changes.length, tasksUpdated });
}

async function handleWelcome(request: Request, store: Store, deliver: Deliver): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const { phones, addedBy } = (input ?? {}) as { phones?: unknown; addedBy?: unknown };
  if (!Array.isArray(phones) || typeof addedBy !== "string" || !addedBy.trim()) {
    return new Response('Expected { "phones": [...], "addedBy": "Name" }', { status: 400 });
  }
  const outs: Outgoing[] = [];
  const skipped: string[] = [];
  for (const raw of phones) {
    const phone = typeof raw === "string" ? normalizePhone(raw) : null;
    const user = phone ? await store.getUser(phone) : null;
    if (user?.active) outs.push(welcomeMessage(user, addedBy.trim()));
    else skipped.push(String(raw).slice(-4));
  }
  await deliver(outs);
  return Response.json({ sent: outs.length, skipped });
}

function toUser(raw: unknown, now: Date): User | string {
  if (typeof raw !== "object" || raw === null) return "not an object";
  const r = raw as Record<string, unknown>;
  const phone = typeof r.phone === "string" ? normalizePhone(r.phone) : null;
  if (!phone) return "phone must be a 10-digit or 91XXXXXXXXXX number";
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return "name is required";
  if (r.role !== "admin" && r.role !== "staff") return 'role must be "admin" or "staff"';
  const role = r.role as Role;
  const branch = r.branch == null || r.branch === "" ? null : String(r.branch).toUpperCase();
  if (branch !== null && !BRANCHES.some((b) => b.id === branch)) return `unknown branch ${branch}`;
  if (role === "staff" && branch === null) return "staff need a branch";
  if (r.active !== undefined && typeof r.active !== "boolean") return "active must be true or false";
  const active = r.active !== false;
  return { phone, name, role, branch: branch as BranchId | null, active, createdAt: now.toISOString() };
}
