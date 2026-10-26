import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirestoreStore } from "../src/data/firestoreStore";
import type { NewTask, Session, Task, User } from "../src/domain/types";
import { fromFields, toFields } from "../src/firebase/firestore";

vi.mock("../src/firebase/auth", () => ({ getAccessToken: vi.fn(async () => "tok") }));

const cfg = { projectId: "proj", clientEmail: "bot@x", privateKey: "unused" };
const BASE = "https://firestore.googleapis.com/v1/projects/proj/databases/(default)/documents";
const NAME = "projects/proj/databases/(default)/documents";

interface Call {
  url: string;
  method: string;
  body: any;
}

let calls: Call[];
let replies: Response[];

function reply(status: number, body: unknown = {}) {
  replies.push(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
}

beforeEach(() => {
  calls = [];
  replies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body as string) : undefined });
      const next = replies.shift();
      if (!next) throw new Error(`unexpected fetch ${url}`);
      return next;
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function user(phone: string, name: string, extra: Partial<User> = {}): User {
  return { phone, name, role: "staff", branch: "RAIPUR", active: true, createdAt: "2026-10-01T00:00:00.000Z", ...extra };
}

function newTask(extra: Partial<NewTask> = {}): NewTask {
  return {
    title: "GST file karo",
    assigneePhone: "911",
    assigneeName: "Amit",
    branch: "DURG",
    createdByPhone: "900",
    createdByName: "Boss",
    dueAt: "2026-10-30T04:30:00.000Z",
    dueHasTime: false,
    status: "pending",
    repeat: "none",
    nextReminderAt: null,
    remarks: [{ at: "2026-10-26T05:00:00.000Z", byPhone: "911", byName: "Amit", text: "kal tak" }],
    createdAt: "2026-10-26T04:00:00.000Z",
    updatedAt: "2026-10-26T05:00:00.000Z",
    doneAt: null,
    ...extra,
  };
}

const doc = (path: string, data: object) => ({
  name: `${NAME}/${path}`,
  fields: toFields(data as never),
  createTime: "2026-10-26T00:00:00Z",
  updateTime: "2026-10-26T00:00:00Z",
});

/** runQuery response: one row per doc plus a trailing readTime-only row. */
const queryRows = (docs: object[]) => [...docs.map((document) => ({ document, readTime: "x" })), { readTime: "x" }];

describe("codec", () => {
  it("round-trips a full Task through toFields/fromFields", () => {
    const t = newTask({ doneAt: "2026-10-27T00:00:00.000Z", branch: null });
    expect(fromFields(toFields(t as never) as never)).toEqual(t);
  });

  it("decodes real-shaped values, including empty arrays/maps and timestamps", () => {
    expect(
      fromFields({
        i: { integerValue: "42" },
        d: { doubleValue: 1.5 },
        n: { nullValue: "NULL_VALUE" },
        t: { timestampValue: "2026-10-24T00:00:00Z" },
        a: { arrayValue: {} },
        m: { mapValue: {} },
      }),
    ).toEqual({ i: 42, d: 1.5, n: null, t: "2026-10-24T00:00:00.000Z", a: [], m: {} });
  });
});

describe("FirestoreStore users", () => {
  it("getUser reads users/{phone} and returns null on 404", async () => {
    const store = new FirestoreStore(cfg);
    const u = user("919", "Ravi");
    reply(200, doc("users/919", u));
    reply(404, { error: { code: 404 } });

    expect(await store.getUser("919")).toEqual(u);
    expect(await store.getUser("000")).toBeNull();
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["GET", `${BASE}/users/919`],
      ["GET", `${BASE}/users/000`],
    ]);
  });

  it("saveUser replaces the whole document", async () => {
    const u = user("919", "Ravi", { branch: null, role: "admin" });
    reply(200, doc("users/919", u));
    await new FirestoreStore(cfg).saveUser(u);
    expect(calls[0]).toEqual({ method: "PATCH", url: `${BASE}/users/919`, body: { fields: toFields(u as never) } });
  });

  it("listUsers queries by branch only, then filters role/active and sorts by name", async () => {
    reply(
      200,
      queryRows([
        doc("users/1", user("1", "Zoya")),
        doc("users/2", user("2", "Anil", { role: "admin" })),
        doc("users/3", user("3", "Bina", { active: false })),
        doc("users/4", user("4", "Chetan")),
      ]),
    );
    const list = await new FirestoreStore(cfg).listUsers({ branch: "RAIPUR", role: "staff" });

    expect(list.map((u) => u.name)).toEqual(["Chetan", "Zoya"]);
    expect(calls[0].url).toBe(`${BASE}:runQuery`);
    expect(calls[0].body).toEqual({
      structuredQuery: {
        from: [{ collectionId: "users" }],
        where: { fieldFilter: { field: { fieldPath: "branch" }, op: "EQUAL", value: { stringValue: "RAIPUR" } } },
      },
    });
  });

  it("listUsers with no filter lists everything and can include inactive", async () => {
    reply(200, queryRows([doc("users/3", user("3", "Bina", { active: false }))]));
    const list = await new FirestoreStore(cfg).listUsers({ activeOnly: false });
    expect(list).toHaveLength(1);
    expect(calls[0].body.structuredQuery.where).toBeUndefined();
  });
});

describe("FirestoreStore tasks", () => {
  it("createTask POSTs without a documentId and returns the generated id", async () => {
    const t = newTask();
    reply(200, doc("tasks/abc123", t));
    const created = await new FirestoreStore(cfg).createTask(t);

    expect(created).toEqual({ ...t, id: "abc123" });
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/tasks` });
    expect(calls[0].body.fields.id).toBeUndefined();
    expect(calls[0].body.fields.dueAt).toEqual({ stringValue: t.dueAt });
    expect(calls[0].body.fields.nextReminderAt).toEqual({ nullValue: null });
  });

  it("getTask decodes the doc with the id from its name, null on 404", async () => {
    const t = newTask();
    reply(200, doc("tasks/abc123", t));
    reply(404, {});
    const store = new FirestoreStore(cfg);

    const got = await store.getTask("abc123");
    expect(got).toEqual({ ...t, id: "abc123" } satisfies Task);
    expect(await store.getTask("nope")).toBeNull();
  });

  it("updateTask patches only the given fields with an updateMask", async () => {
    reply(200, doc("tasks/abc123", newTask()));
    await new FirestoreStore(cfg).updateTask("abc123", {
      status: "done",
      doneAt: "2026-10-27T00:00:00.000Z",
      updatedAt: "2026-10-27T00:00:00.000Z",
    });

    const url = new URL(calls[0].url);
    expect(calls[0].method).toBe("PATCH");
    expect(url.pathname).toBe("/v1/projects/proj/databases/(default)/documents/tasks/abc123");
    expect(url.searchParams.getAll("updateMask.fieldPaths")).toEqual(["status", "doneAt", "updatedAt"]);
    expect(url.searchParams.get("currentDocument.exists")).toBe("true");
    expect(Object.keys(calls[0].body.fields)).toEqual(["status", "doneAt", "updatedAt"]);
  });

  it("updateTask throws with status and body on failure (e.g. missing task)", async () => {
    reply(404, "no such doc");
    await expect(new FirestoreStore(cfg).updateTask("x", { status: "done" })).rejects.toThrow(/404: no such doc/);
  });

  it("listTasks uses the most selective single filter, filters the rest, sorts by dueAt", async () => {
    reply(
      200,
      queryRows([
        doc("tasks/late", newTask({ dueAt: "2026-11-05T04:30:00.000Z" })),
        doc("tasks/done", newTask({ status: "done" })),
        doc("tasks/early", newTask({ dueAt: "2026-10-27T04:30:00.000Z" })),
      ]),
    );
    const list = await new FirestoreStore(cfg).listTasks({ status: "pending", branch: "DURG", assigneePhone: "911" });

    expect(list.map((t) => t.id)).toEqual(["early", "late"]);
    expect(calls[0].body.structuredQuery.where.fieldFilter.field.fieldPath).toBe("assigneePhone");
    expect(calls[0].body.structuredQuery.orderBy).toBeUndefined();
  });

  it("listTasks picks createdByPhone > branch > status, and none for an empty filter", async () => {
    const store = new FirestoreStore(cfg);
    const cases = [
      [{ createdByPhone: "900", status: "pending" as const }, "createdByPhone"],
      [{ branch: "DURG" as const, status: "pending" as const }, "branch"],
      [{ status: "done" as const }, "status"],
    ] as const;
    for (const [filter, field] of cases) {
      reply(200, []);
      await store.listTasks(filter);
      expect(calls.at(-1)!.body.structuredQuery.where.fieldFilter.field.fieldPath).toBe(field);
    }
    reply(200, queryRows([]));
    expect(await store.listTasks({})).toEqual([]);
    expect(calls.at(-1)!.body.structuredQuery.where).toBeUndefined();
  });

  it("throws on query errors", async () => {
    reply(400, "needs index");
    await expect(new FirestoreStore(cfg).listTasks({})).rejects.toThrow(/Firestore query tasks failed 400: needs index/);
  });
});

describe("FirestoreStore sessions", () => {
  const s: Session = { phone: "919", flow: "create_task", step: "ask_title", data: { a: "1" }, updatedAt: "2026-10-26T00:00:00.000Z" };

  it("saves, reads and clears sessions/{phone}", async () => {
    const store = new FirestoreStore(cfg);
    reply(200, doc("sessions/919", s));
    reply(200, doc("sessions/919", s));
    reply(200, {});
    reply(404, {});

    await store.saveSession(s);
    expect(await store.getSession("919")).toEqual(s);
    await store.clearSession("919");
    expect(await store.getSession("919")).toBeNull();
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["PATCH", `${BASE}/sessions/919`],
      ["GET", `${BASE}/sessions/919`],
      ["DELETE", `${BASE}/sessions/919`],
      ["GET", `${BASE}/sessions/919`],
    ]);
  });

  it("decodes an empty data map", async () => {
    reply(200, { name: `${NAME}/sessions/919`, fields: { ...toFields({ ...s, data: {} }), data: { mapValue: {} } } });
    expect((await new FirestoreStore(cfg).getSession("919"))?.data).toEqual({});
  });

  it("throws on non-404 read errors", async () => {
    reply(500, "boom");
    await expect(new FirestoreStore(cfg).getSession("919")).rejects.toThrow(/500: boom/);
  });
});
