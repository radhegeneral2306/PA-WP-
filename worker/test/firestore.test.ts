import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signJwt } from "../src/firebase/auth";
import { deleteMany, queryAtMost, queryBefore, toFields } from "../src/firebase/firestore";

// Only the token fetch is mocked; signJwt stays real.
vi.mock("../src/firebase/auth", async (importActual) => ({
  ...(await importActual<typeof import("../src/firebase/auth")>()),
  getAccessToken: vi.fn(async () => "tok"),
}));

describe("toFields", () => {
  it("encodes plain values as Firestore typed values", () => {
    expect(
      toFields({
        s: "a",
        i: 3,
        d: 1.5,
        b: true,
        n: null,
        t: new Date("2026-10-24T00:00:00Z"),
        arr: ["x"],
        map: { k: 1 },
      }),
    ).toEqual({
      s: { stringValue: "a" },
      i: { integerValue: "3" },
      d: { doubleValue: 1.5 },
      b: { booleanValue: true },
      n: { nullValue: null },
      t: { timestampValue: "2026-10-24T00:00:00.000Z" },
      arr: { arrayValue: { values: [{ stringValue: "x" }] } },
      map: { mapValue: { fields: { k: { integerValue: "1" } } } },
    });
  });
});

describe("signJwt", () => {
  it("signs a verifiable RS256 JWT from a PEM key with escaped newlines", async () => {
    const pair = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
    const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\\n");
    const pem = `-----BEGIN PRIVATE KEY-----\\n${b64}\\n-----END PRIVATE KEY-----\\n`;

    const jwt = await signJwt({ clientEmail: "bot@test.iam.gserviceaccount.com", privateKey: pem }, 1000);
    const [h, c, s] = jwt.split(".");
    const decode = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));

    expect(JSON.parse(new TextDecoder().decode(decode(c)))).toMatchObject({
      iss: "bot@test.iam.gserviceaccount.com",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1000,
      exp: 4600,
    });
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      pair.publicKey,
      decode(s),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(valid).toBe(true);
  });
});

describe("queryBefore / deleteMany", () => {
  const cfg = { projectId: "proj", clientEmail: "bot@x", privateKey: "unused" };
  const BASE = "https://firestore.googleapis.com/v1/projects/proj/databases/(default)/documents";
  const NAME = "projects/proj/databases/(default)/documents";
  let calls: { url: string; method: string; body: any }[];
  let replies: Response[];

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

  const reply = (status: number, body: unknown = {}) =>
    replies.push(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

  it("queryAtMost: one <= range filter, ordered by the same field, with a limit (due reminders)", async () => {
    reply(200, [{ document: { name: `${NAME}/tasks/t1`, fields: { nextReminderAt: { stringValue: "2026-10-28T05:30:00.000Z" } } } }, { readTime: "x" }]);
    const docs = await queryAtMost(cfg, "tasks", "nextReminderAt", "2026-10-28T05:30:00.000Z", 8);
    expect(docs.map((d) => d.id)).toEqual(["t1"]);
    expect(calls[0].url).toBe(`${BASE}:runQuery`);
    expect(calls[0].body.structuredQuery).toEqual({
      from: [{ collectionId: "tasks" }],
      where: { fieldFilter: { field: { fieldPath: "nextReminderAt" }, op: "LESS_THAN_OR_EQUAL", value: { stringValue: "2026-10-28T05:30:00.000Z" } } },
      orderBy: [{ field: { fieldPath: "nextReminderAt" }, direction: "ASCENDING" }],
      limit: 8,
    });
  });

  it("queries with a single LESS_THAN timestamp filter and a limit, no orderBy", async () => {
    reply(200, [
      { document: { name: `${NAME}/webhook_log/m1`, fields: {} } },
      { document: { name: `${NAME}/webhook_log/m2`, fields: {} } },
      { readTime: "2026-10-27T00:00:00Z" },
    ]);
    const docs = await queryBefore(cfg, "webhook_log", "loggedAt", new Date("2026-09-27T00:00:00Z"), 500, ["__name__"]);
    expect(docs.map((d) => d.id)).toEqual(["m1", "m2"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}:runQuery`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({
      structuredQuery: {
        from: [{ collectionId: "webhook_log" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "loggedAt" },
            op: "LESS_THAN",
            value: { timestampValue: "2026-09-27T00:00:00.000Z" },
          },
        },
        limit: 500,
        select: { fields: [{ fieldPath: "__name__" }] },
      },
    });
    expect(calls[0].body.structuredQuery.orderBy).toBeUndefined();
  });

  it("uses a stringValue for string bounds and returns decoded data", async () => {
    reply(200, [{ document: { name: `${NAME}/login_guards/ip-a`, fields: { fails: { integerValue: "2" } } } }]);
    const docs = await queryBefore(cfg, "login_guards", "windowStart", "2026-09-27T00:00:00.000Z", 10);
    expect(docs).toEqual([{ id: "ip-a", data: { fails: 2 } }]);
    expect(calls[0].body.structuredQuery.where.fieldFilter.value).toEqual({ stringValue: "2026-09-27T00:00:00.000Z" });
    expect(calls[0].body.structuredQuery.limit).toBe(10);
    expect(calls[0].body.structuredQuery.select).toBeUndefined();
  });

  it("throws a clear error when the query fails", async () => {
    reply(400, "index missing");
    await expect(queryBefore(cfg, "webhook_log", "loggedAt", new Date(0), 5)).rejects.toThrow(
      /Firestore query webhook_log .*failed 400: index missing/,
    );
  });

  it("deletes ids with one commit holding full document paths", async () => {
    reply(200, { writeResults: [{}, {}] });
    await deleteMany(cfg, "webhook_log", ["m1", "m2"]);
    expect(calls).toEqual([
      {
        url: `${BASE}:commit`,
        method: "POST",
        body: { writes: [{ delete: `${NAME}/webhook_log/m1` }, { delete: `${NAME}/webhook_log/m2` }] },
      },
    ]);
  });

  it("splits into commits of at most 500 writes", async () => {
    reply(200);
    reply(200);
    reply(200);
    const ids = Array.from({ length: 1001 }, (_, i) => `id${i}`);
    await deleteMany(cfg, "webhook_log", ids);
    expect(calls.map((c) => c.body.writes.length)).toEqual([500, 500, 1]);
    expect(calls[1].body.writes[0]).toEqual({ delete: `${NAME}/webhook_log/id500` });
    expect(calls[2].body.writes[0]).toEqual({ delete: `${NAME}/webhook_log/id1000` });
  });

  it("makes no request for an empty id list", async () => {
    await deleteMany(cfg, "webhook_log", []);
    expect(calls).toHaveLength(0);
  });

  it("throws a clear error when the commit fails", async () => {
    reply(403, "denied");
    await expect(deleteMany(cfg, "login_guards", ["a"])).rejects.toThrow(
      "Firestore delete 1 docs in login_guards failed 403: denied",
    );
  });
});
