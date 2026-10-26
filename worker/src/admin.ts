// /webhook/<secret>/users: bootstrap and inspect the user list without
// WhatsApp (the first admin has to come from somewhere).
//   GET → all users (including removed ones)
//   PUT → JSON array of { phone, name, role, branch? }; upserts as active

import type { Store } from "./data/store";
import { BRANCHES, type BranchId, type Role, type User } from "./domain/types";
import { normalizePhone } from "./numbers";

export async function handleUsersEndpoint(request: Request, store: Store, now: Date): Promise<Response> {
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

  const users: User[] = [];
  for (const [i, raw] of input.entries()) {
    const result = toUser(raw, now);
    if (typeof result === "string") return new Response(`Item ${i}: ${result}`, { status: 400 });
    const existing = await store.getUser(result.phone);
    users.push(existing ? { ...result, createdAt: existing.createdAt } : result);
  }
  for (const u of users) await store.saveUser(u);
  return Response.json({ saved: users.length });
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
  return { phone, name, role, branch: branch as BranchId | null, active: true, createdAt: now.toISOString() };
}
