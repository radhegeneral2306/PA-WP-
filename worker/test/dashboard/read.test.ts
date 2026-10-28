import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { issueToken } from "../../src/dashboard/auth";
import { addRoutes, handleApi } from "../../src/dashboard/api";
import { archiveLimit, readRoutes, toTaskDTO, type TaskDTO } from "../../src/dashboard/routes/read";
import { BRANCHES, type Task } from "../../src/domain/types";
import type { Env } from "../../src/env";
import { ADMIN, NOW, STAFF_RAIPUR, USERS, task } from "../helpers/bot";

const env: Env = {
  WEBHOOK_SECRET: "w".repeat(48),
  INTERAKT_API_KEY: "k",
  FIREBASE_PROJECT_ID: "p",
  FIREBASE_CLIENT_EMAIL: "e",
  FIREBASE_PRIVATE_KEY: "k",
  DASHBOARD_USER: "radhe",
  DASHBOARD_PASSWORD: "correct horse battery",
};

addRoutes(readRoutes);

async function call(store: MemoryStore, path: string, withToken = true): Promise<Response> {
  const headers: Record<string, string> = {};
  if (withToken) headers.Authorization = `Bearer ${await issueToken(env, null, NOW)}`;
  return handleApi(new Request(`https://w${path}`, { headers }), env, store, NOW, async () => undefined);
}

async function tasksOf(store: MemoryStore, query: string): Promise<{ now: string; tasks: TaskDTO[] }> {
  const res = await call(store, `/api/tasks?${query}`);
  expect(res.status).toBe(200);
  return res.json();
}

/** An old Firestore doc: none of the optional fields that later batches added. */
function oldTask(overrides: Partial<Task> = {}): Task {
  const t = task(overrides);
  delete t.repeatDay;
  delete t.dateRequest;
  delete t.source;
  delete t.lastReminderAt;
  delete t.cancelledAt;
  delete t.cancelledByName;
  return t;
}

const remark = (at: string, text: string) => ({ at, byPhone: ADMIN.phone, byName: ADMIN.name, text });

describe("read routes auth", () => {
  it("need a session token", async () => {
    const store = new MemoryStore({ users: USERS });
    expect((await call(store, "/api/users", false)).status).toBe(401);
    expect((await call(store, "/api/tasks?view=pending", false)).status).toBe(401);
  });
});

describe("GET /api/users", () => {
  it("lists active users by name with the Worker's branch list", async () => {
    const res = await call(new MemoryStore({ users: USERS }), "/api/users");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { users: { phone: string; name: string; role: string; branch: string | null }[]; branches: unknown };
    expect(body.users.map((u) => u.name)).toEqual(["Bhaskar", "Chikku", "Hardware", "Jag Staff", "Partner Two"]);
    expect(body.users[0]).toEqual({ phone: ADMIN.phone, name: "Bhaskar", role: "admin", branch: null });
    expect(body.users.find((u) => u.phone === STAFF_RAIPUR.phone)).toEqual({ phone: STAFF_RAIPUR.phone, name: "Chikku", role: "staff", branch: "RAIPUR" });
    expect(body.branches).toEqual(BRANCHES);
    expect(body.branches).toContainEqual({ id: "HARDWARE", name: "Hardware" });
    expect(body.branches).toContainEqual({ id: "OFFICE", name: "Office" });
  });
});

describe("GET /api/tasks?view=pending", () => {
  it("returns pending tasks by due date with overdue/dueToday across IST midnight", async () => {
    // NOW = 26 Oct 15:00 IST
    const store = new MemoryStore({
      users: USERS,
      tasks: [
        task({ id: "tomorrow0000", dueAt: "2026-10-26T18:30:00.000Z" }), // 27 Oct 00:00 IST
        task({ id: "today2359", dueAt: "2026-10-26T18:29:00.000Z" }), // 26 Oct 23:59 IST
        task({ id: "today0000", dueAt: "2026-10-25T18:30:00.000Z" }), // 26 Oct 00:00 IST
        task({ id: "yesterday2359", dueAt: "2026-10-25T18:29:00.000Z" }), // 25 Oct 23:59 IST
        task({ id: "done", status: "done", doneAt: "2026-10-20T00:00:00.000Z" }),
        task({ id: "cancelled", status: "cancelled", cancelledAt: "2026-10-20T00:00:00.000Z" }),
      ],
    });
    const body = await tasksOf(store, "view=pending");
    expect(body.now).toBe(NOW.toISOString());
    expect(body.tasks.map((t) => [t.id, t.overdue, t.dueToday])).toEqual([
      ["yesterday2359", true, false],
      ["today0000", true, true],
      ["today2359", false, true],
      ["tomorrow0000", false, false],
    ]);
  });

  it("fills missing optional fields of old tasks with null", async () => {
    const store = new MemoryStore({ tasks: [oldTask({ id: "old" })] });
    const [t] = (await tasksOf(store, "view=pending")).tasks;
    expect(t).toMatchObject({
      repeatDay: null,
      dateRequest: null,
      source: null,
      lastReminderAt: null,
      cancelledAt: null,
      cancelledByName: null,
      closedAt: null,
      lastRemark: null,
      remarks: [],
    });
  });
});

describe("GET /api/tasks?view=archive", () => {
  const closed = (i: number, status: "done" | "cancelled", at: string, updatedAt = at): Task =>
    status === "done"
      ? task({ id: `d${i}`, status, doneAt: at, updatedAt })
      : task({ id: `c${i}`, status, cancelledAt: at, cancelledByName: "Bhaskar", updatedAt });

  const store = () =>
    new MemoryStore({
      tasks: [
        closed(1, "done", "2026-10-20T00:00:00.000Z"),
        closed(2, "cancelled", "2026-10-22T00:00:00.000Z"),
        closed(3, "done", "2026-10-24T00:00:00.000Z"),
        closed(4, "cancelled", "2026-10-21T00:00:00.000Z"),
        closed(5, "done", "2026-10-24T00:00:00.000Z", "2026-10-25T00:00:00.000Z"), // same closedAt as d3, updated later
        task({ id: "p1" }),
      ],
    });

  it("merges done and cancelled, newest closed first, without pending", async () => {
    const { tasks } = await tasksOf(store(), "view=archive");
    expect(tasks.map((t) => t.id)).toEqual(["d5", "d3", "c2", "c4", "d1"]);
    expect(tasks.every((t) => !t.overdue && !t.dueToday)).toBe(true);
    expect(tasks.find((t) => t.id === "c2")).toMatchObject({ closedAt: "2026-10-22T00:00:00.000Z", cancelledByName: "Bhaskar" });
  });

  it("respects and clamps the limit", async () => {
    expect((await tasksOf(store(), "view=archive&limit=2")).tasks.map((t) => t.id)).toEqual(["d5", "d3"]);
    expect((await tasksOf(store(), "view=archive&limit=0")).tasks).toHaveLength(1);
    expect((await tasksOf(store(), "view=archive&limit=abc")).tasks).toHaveLength(5);
  });

  it("archiveLimit defaults and clamps", () => {
    expect(archiveLimit(null)).toBe(200);
    expect(archiveLimit("")).toBe(200);
    expect(archiveLimit("abc")).toBe(200);
    expect(archiveLimit("0")).toBe(1);
    expect(archiveLimit("-3")).toBe(1);
    expect(archiveLimit("9999")).toBe(500);
    expect(archiveLimit("50")).toBe(50);
  });
});

describe("GET /api/tasks bad view", () => {
  it("returns 400 for a missing or unknown view", async () => {
    const store = new MemoryStore();
    for (const path of ["/api/tasks", "/api/tasks?view=all"]) {
      const res = await call(store, path);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "view pending ya archive hona chahiye" });
    }
  });
});

describe("toTaskDTO", () => {
  it("copies stored fields and computes closedAt and lastRemark", () => {
    const t = task({
      status: "done",
      doneAt: "2026-10-25T00:00:00.000Z",
      repeat: "monthly",
      repeatDay: 31,
      lastReminderAt: "2026-10-24T00:00:00.000Z",
      remarks: [remark("2026-10-23T00:00:00.000Z", "pehla"), remark("2026-10-24T00:00:00.000Z", "doosra")],
      dueAt: "2026-10-20T04:30:00.000Z",
    });
    const dto = toTaskDTO(t, NOW);
    expect(dto).toMatchObject({
      id: "task1",
      repeatDay: 31,
      lastReminderAt: "2026-10-24T00:00:00.000Z",
      closedAt: "2026-10-25T00:00:00.000Z",
      overdue: false, // not pending
      dueToday: false,
      cancelledAt: null,
    });
    expect(dto.lastRemark?.text).toBe("doosra");
  });

  it("uses cancelledAt as closedAt and keeps a date request", () => {
    const dateRequest = { dueAt: "2026-12-01T04:30:00.000Z", hasTime: false, remark: "late", byPhone: "1", byName: "X", requestedAt: "2026-10-25T00:00:00.000Z" };
    const dto = toTaskDTO(task({ status: "cancelled", cancelledAt: "2026-10-26T01:00:00.000Z", cancelledByName: "Nayan", dateRequest }), NOW);
    expect(dto).toMatchObject({ closedAt: "2026-10-26T01:00:00.000Z", cancelledByName: "Nayan", dateRequest, doneAt: null });
  });

  it("passes source voice through and maps null to null", () => {
    expect(toTaskDTO(task({ source: "voice" }), NOW).source).toBe("voice");
    expect(toTaskDTO(task({ source: null }), NOW).source).toBeNull();
  });

  it("has exactly the contract keys and tolerates missing remarks", () => {
    const t = oldTask();
    delete (t as Partial<Task>).remarks;
    const dto = toTaskDTO(t, NOW);
    expect(dto.remarks).toEqual([]);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "id", "title", "assigneePhone", "assigneeName", "branch", "createdByPhone", "createdByName", "dueAt", "dueHasTime",
        "status", "repeat", "repeatDay", "nextReminderAt", "lastReminderAt", "dateRequest", "source", "remarks", "createdAt", "updatedAt",
        "doneAt", "cancelledAt", "cancelledByName", "overdue", "dueToday", "closedAt", "lastRemark",
      ].sort(),
    );
    expect(Object.values(dto)).not.toContain(undefined);
  });
});
