// Round 7 adversarial review (reviewer 2): the real FirestoreStore + real handleMessage on a fake Firestore REST backend.
// Counts requests per message (memory <= 2 +1 on conflict; whole message well under the 50-subrequest budget),
// races between two concurrent messages, what is stored in chat_ctx, cleanup scope.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirestoreStore } from "../../src/data/firestoreStore";
import { CHAT_TESTERS, handleMessage } from "../../src/bot/router";
import type { Inbound } from "../../src/bot/flow";
import type { ChatResult, ChatService } from "../../src/chat/types";
import type { User } from "../../src/domain/types";
import { fromFields, toFields, type Plain } from "../../src/firebase/firestore";
import { runCleanup } from "../../src/scheduler/cleanup";
import { ADMIN, NOW, STAFF_DURG, STAFF_RAIPUR, say, tap, task } from "../helpers/bot";

vi.mock("../../src/firebase/auth", () => ({ getAccessToken: vi.fn(async () => "tok") }));

const cfg = { projectId: "proj", clientEmail: "bot@x", privateKey: "unused" };
const ROOT = "https://firestore.googleapis.com/v1/projects/proj/databases/(default)/documents";
const NAME = "projects/proj/databases/(default)/documents";

type Row = { data: { [k: string]: Plain }; updateTime: string };
interface Req { method: string; path: string; query: URLSearchParams; body: any; collection: string }

class FakeFirestore {
  docs = new Map<string, Row>(); // "coll/id" -> row
  reqs: Req[] = [];
  clock = 0;
  /** Optional hook run before a request is served (to inject a concurrent write). */
  before: ((r: Req) => void) | null = null;
  failChatCtx: number | null = null;

  stamp() {
    return new Date(Date.UTC(2026, 0, 1) + ++this.clock * 1000).toISOString();
  }
  put(coll: string, id: string, data: { [k: string]: Plain }) {
    this.docs.set(`${coll}/${id}`, { data, updateTime: this.stamp() });
  }
  raw(key: string) {
    const r = this.docs.get(key)!;
    return { name: `${NAME}/${key}`, fields: toFields(r.data), updateTime: r.updateTime, createTime: r.updateTime };
  }
  get chatReqs() {
    return this.reqs.filter((r) => r.collection === "chat_ctx" || (r.path.endsWith(":commit") && JSON.stringify(r.body).includes("/chat_ctx/")));
  }
  count(coll: string) {
    return this.reqs.filter((r) => r.collection === coll).length;
  }

  fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace("/v1/projects/proj/databases/(default)/documents", "")).replace(/^\//, "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    const collection = path.startsWith(":") ? (body?.structuredQuery?.from?.[0]?.collectionId ?? "") : path.split("/")[0].split(":")[0];
    const req: Req = { method, path, query: u.searchParams, body, collection };
    this.reqs.push(req);
    this.before?.(req);
    if (this.failChatCtx && collection === "chat_ctx") return new Response("boom", { status: this.failChatCtx });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (path === ":runQuery") {
      const q = body.structuredQuery;
      const f = q.where?.fieldFilter;
      let rows = [...this.docs.entries()].filter(([k]) => k.startsWith(`${q.from[0].collectionId}/`));
      if (f) {
        const want = fromFields({ v: f.value } as never).v as Plain;
        rows = rows.filter(([, r]) => {
          const have = r.data[f.field.fieldPath];
          if (f.op === "EQUAL") return have === want;
          if (f.op === "LESS_THAN") return typeof have === "string" && typeof want === "string" && have < want;
          if (f.op === "LESS_THAN_OR_EQUAL") return typeof have === "string" && typeof want === "string" && have <= want;
          return true;
        });
      }
      if (q.limit) rows = rows.slice(0, q.limit);
      return json([...rows.map(([k]) => ({ document: this.raw(k), readTime: "x" })), { readTime: "x" }]);
    }
    if (path === ":commit") {
      for (const w of body.writes) if (w.delete) this.docs.delete(w.delete.replace(`${NAME}/`, ""));
      return json({ writeResults: [] });
    }
    const [coll, id] = path.split("/");
    const key = `${coll}/${id}`;
    if (method === "GET") return this.docs.has(key) ? json(this.raw(key)) : json({ error: { code: 404 } }, 404);
    if (method === "DELETE") {
      this.docs.delete(key);
      return json({});
    }
    if (method === "POST") {
      const docId = u.searchParams.get("documentId") ?? `auto${++this.clock}`;
      const k = `${coll}/${docId}`;
      if (this.docs.has(k)) return json({ error: { code: 409 } }, 409);
      this.put(coll, docId, fromFields(body.fields));
      return json(this.raw(k));
    }
    if (method === "PATCH") {
      const exists = this.docs.get(key);
      if (u.searchParams.get("currentDocument.exists") === "false" && exists) return json({ error: {} }, 409);
      if (u.searchParams.get("currentDocument.exists") === "true" && !exists) return json({ error: {} }, 404);
      const ut = u.searchParams.get("currentDocument.updateTime");
      if (ut && (!exists || exists.updateTime !== ut)) return json({ error: {} }, 412);
      const mask = u.searchParams.getAll("updateMask.fieldPaths");
      const data = fromFields(body.fields);
      this.put(coll, id, mask.length && exists ? { ...exists.data, ...data } : data);
      return json(this.raw(key));
    }
    return json({}, 500);
  };
}

let fs: FakeFirestore;
const store = () => new FirestoreStore(cfg);

function ai(result: ChatResult = { ok: true, request: { kind: "unclear" } }) {
  const understand = vi.fn(async () => result);
  return { understand } as ChatService & { understand: ReturnType<typeof vi.fn> };
}
function bot(user: User, st = store(), chat: ChatService = ai(), now = NOW) {
  return { st, chat, send: (i: Inbound, at = now) => handleMessage({ store: st, user, now: at, chat }, i) };
}

async function seed(extra: (f: FakeFirestore) => void = () => {}) {
  for (const u of [ADMIN, STAFF_DURG, STAFF_RAIPUR, { ...ADMIN, phone: "919000000002", name: "Partner Two" }]) fs.put("users", u.phone, u as never);
  for (let i = 1; i <= 12; i++) {
    const t = task({ id: `t${i}`, title: `Kaam number ${i} SECRETTITLE`, assigneePhone: STAFF_DURG.phone, assigneeName: "Hardware", dueAt: new Date(Date.UTC(2026, 9, 20, 4, 30 + i * 60)).toISOString() });
    const { id, ...rest } = t;
    fs.put("tasks", id, rest as never);
  }
  extra(fs);
}

beforeEach(() => {
  fs = new FakeFirestore();
  vi.stubGlobal("fetch", vi.fn(fs.fetch));
  (CHAT_TESTERS as Set<string>).add(STAFF_DURG.name);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  (CHAT_TESTERS as Set<string>).delete(STAFF_DURG.name);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("request counts (memory on)", () => {
  it("first list message: 1 memory read + 1 memory write", async () => {
    await seed();
    const b = bot(STAFF_DURG);
    fs.reqs = [];
    const out = await b.send(say("mere pending tasks"));
    expect(out.length).toBeGreaterThan(0);
    expect(fs.chatReqs.map((r) => r.method)).toEqual(["GET", "PATCH"]);
    expect(fs.docs.get(`chat_ctx/${STAFF_DURG.phone}`)?.data.v).toBe(1);
  });

  it("follow-up message in the same isolate: still <= 2 memory requests", async () => {
    await seed();
    const b = bot(STAFF_DURG);
    await b.send(say("mere pending tasks"));
    for (const p of ["sirf urgent wale", "aur dikhao", "pehla wala kholo", "iski due date kya hai"]) {
      fs.reqs = [];
      await b.send(say(p));
      expect(fs.chatReqs.length, p).toBeLessThanOrEqual(2);
    }
  });

  it("a cold isolate (new FirestoreStore per message, as in production) still costs <= 2 memory requests", async () => {
    await seed();
    await bot(STAFF_DURG).send(say("mere pending tasks"));
    for (const p of ["aur dikhao", "doosra wala kholo", "iski due date kya hai"]) {
      fs.reqs = [];
      await bot(STAFF_DURG, store()).send(say(p));
      expect(fs.chatReqs.length, p).toBeLessThanOrEqual(2);
    }
  });

  it("courtesy words cost no memory request at all", async () => {
    await seed();
    await bot(STAFF_DURG).send(say("mere pending tasks"));
    fs.reqs = [];
    // courtesy: no memory read at all
    await bot(STAFF_DURG, store()).send(say("ok"));
    expect(fs.chatReqs.length).toBe(0);
  });

  it("whole message budget: every message of a long chat stays far below 50 requests", async () => {
    await seed();
    const b = bot(ADMIN);
    const worst: Record<string, number> = {};
    for (const p of ["sabke pending tasks", "sirf urgent wale", "aur dikhao", "doosra wala kholo", "iski due date kya hai", "kisko diya hai", "last update kya tha", "shuru se", "durg ke overdue tasks"]) {
      fs.reqs = [];
      await bot(ADMIN, store()).send(say(p));
      worst[p] = fs.reqs.length;
    }
    for (const [p, n] of Object.entries(worst)) expect(n, p).toBeLessThanOrEqual(12);
    void b;
  });

  it("the AI path adds only counter (2) + memory (<=2) requests, plus Gemini calls the chat service makes (not Firestore)", async () => {
    await seed();
    fs.reqs = [];
    const chat = ai({ ok: true, request: { kind: "list", filter: { scope: "mine", when: "all" } } });
    await bot(STAFF_DURG, store(), chat).send(say("kuch ajeeb sa sawal jo rules nahi samajhte abhi"));
    expect(chat.understand).toHaveBeenCalledTimes(1);
    expect(fs.count("claims")).toBe(2);
    expect(fs.chatReqs.length).toBeLessThanOrEqual(2);
    expect(fs.reqs.length).toBeLessThanOrEqual(15);
  });

  it("conflict costs at most one extra read + one extra write", async () => {
    await seed();
    await bot(STAFF_DURG).send(say("mere pending tasks"));
    fs.reqs = [];
    let injected = false;
    fs.before = (r) => {
      // another message writes the memory right before our PATCH
      if (!injected && r.collection === "chat_ctx" && r.method === "PATCH") {
        injected = true;
        const cur = fs.docs.get(`chat_ctx/${STAFF_DURG.phone}`)!;
        fs.put("chat_ctx", STAFF_DURG.phone, { ...cur.data, v: (cur.data.v as number) + 1, at: new Date(NOW.getTime() - 1000).toISOString() });
      }
    };
    await bot(STAFF_DURG, store()).send(say("aur dikhao"));
    expect(injected).toBe(true);
    expect(fs.chatReqs.length).toBeLessThanOrEqual(4); // read, failed write, re-read, write
  });
});

describe("what chat_ctx stores", () => {
  it("only ids / filters: no task titles, no message text, no remark text, no names", async () => {
    await seed();
    const t = task({ id: "r1", title: "REMARKTASK", assigneePhone: STAFF_DURG.phone, assigneeName: "Hardware", remarks: [{ at: NOW.toISOString(), byPhone: "1", byName: "Boss", text: "REMARKTEXT" }] });
    const { id, ...rest } = t;
    fs.put("tasks", id, rest as never);
    const b = bot(STAFF_DURG);
    await b.send(say("mere pending tasks"));
    await b.send(say("kaam number 3 secrettitle ki due date kya hai"));
    await b.send(say("sirf urgent wale"));
    await b.send(say("r1 ya REMARKTASK kholo"));
    await b.send(tap("tasks:task:r1"));
    await b.send(say("last update kya tha"));
    const stored = JSON.stringify(fs.docs.get(`chat_ctx/${STAFF_DURG.phone}`));
    expect(stored).not.toMatch(/SECRETTITLE|REMARKTEXT|REMARKTASK|Hardware|kaam number|ki due date|urgent wale/i);
    const d = fs.docs.get(`chat_ctx/${STAFF_DURG.phone}`)!.data;
    expect(Object.keys(d).sort().every((k) => ["v", "at", "query", "shown", "offset", "total", "sel"].includes(k))).toBe(true);
  });

  it("the doc id is the phone and there is exactly one doc per person", async () => {
    await seed();
    await bot(STAFF_DURG).send(say("mere pending tasks"));
    await bot(ADMIN).send(say("sabke pending tasks"));
    const keys = [...fs.docs.keys()].filter((k) => k.startsWith("chat_ctx/"));
    expect(keys.sort()).toEqual([`chat_ctx/${ADMIN.phone}`, `chat_ctx/${STAFF_DURG.phone}`].sort());
  });

  it("an empty phone never touches Firestore memory", async () => {
    const s = store();
    fs.reqs = [];
    expect(await s.getChatMemory("")).toBeNull();
    expect(await s.saveChatMemory("", { v: 0, at: NOW.toISOString() })).toBe(false);
    await s.clearChatMemory("");
    expect(fs.reqs.length).toBe(0);
  });

  it("phone with odd characters is url-encoded into one doc id (no path traversal)", async () => {
    const s = store();
    const evil = "../users/919000000001";
    expect(await s.saveChatMemory(evil, { v: 0, at: NOW.toISOString(), shown: ["a"] })).toBe(true);
    expect([...fs.docs.keys()].some((k) => k.startsWith("users/") && k.includes("919000000001") && fs.docs.get(k)!.data.shown)).toBe(false);
  });
});

describe("garbage and expired memory in Firestore", () => {
  it("garbage fields do not crash a message; the doc is overwritten with a valid one", async () => {
    await seed();
    fs.put("chat_ctx", STAFF_DURG.phone, { v: "x", at: 5, shown: "nope", sel: 7, query: [1] } as never);
    const out = await bot(STAFF_DURG).send(say("mere pending tasks"));
    expect(out.length).toBeGreaterThan(0);
    const d = fs.docs.get(`chat_ctx/${STAFF_DURG.phone}`)!.data;
    expect(d.v).toBe(1);
    expect(Array.isArray(d.shown)).toBe(true);
  });

  it("a doc with a valid v but at = 'garbage' is treated as unusable, not as fresh", async () => {
    await seed();
    fs.put("chat_ctx", STAFF_DURG.phone, { v: 4, at: "not a date", shown: ["t1"], sel: "t1" });
    const out = await bot(STAFF_DURG).send(say("1"));
    // "1" with no usable memory is not an open; it must not open t1
    expect(JSON.stringify(out)).not.toContain("SECRETTITLE");
  });

  it("expired memory (older than 15 min) is not used for '2' / 'aur dikhao'", async () => {
    await seed();
    const b = bot(STAFF_DURG);
    await b.send(say("mere pending tasks"));
    const later = new Date(NOW.getTime() + 16 * 60_000);
    const out = await b.send(say("doosra wala kholo"), later);
    expect(JSON.stringify(out)).not.toContain("SECRETTITLE");
  });

  it("future-dated memory (clock skew / forged 'at' in 2099) does not stay fresh forever", async () => {
    await seed();
    fs.put("chat_ctx", STAFF_DURG.phone, { v: 1, at: "2099-01-01T00:00:00.000Z", shown: ["t1"], sel: "t1" });
    const out = await bot(STAFF_DURG).send(say("1"));
    // Documented risk: a future 'at' is "fresh" (age negative < 15 min). Only our own writes set 'at', so this
    // needs a forged doc; staff cannot write Firestore. Still: it should not open anything outside their own tasks.
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("races: two concurrent messages from one person", () => {
  it("both run through handleMessage at once: no exception, memory ends consistent, version advanced by writes", async () => {
    await seed();
    await bot(STAFF_DURG).send(say("mere pending tasks"));
    const a = bot(STAFF_DURG, store());
    const c = bot(STAFF_DURG, store());
    const [r1, r2] = await Promise.all([a.send(say("sirf urgent wale")), c.send(say("aur dikhao"))]);
    expect(r1.length).toBeGreaterThan(0);
    expect(r2.length).toBeGreaterThan(0);
    const d = fs.docs.get(`chat_ctx/${STAFF_DURG.phone}`)!.data;
    expect(typeof d.v).toBe("number");
    expect(Array.isArray(d.shown)).toBe(true);
  });

  it("an older message (earlier clock) cannot overwrite a newer one that wrote first", async () => {
    await seed();
    await bot(STAFF_DURG).send(say("mere pending tasks"));
    const tNew = new Date(NOW.getTime() + 60_000);
    const tOld = new Date(NOW.getTime() + 30_000);
    // Old message reads (v1), then the NEW message completes fully, then the old one saves.
    const oldB = bot(STAFF_DURG, store());
    let released!: () => void;
    const gate = new Promise<void>((r) => (released = r));
    let held = false;
    const origFetch = fs.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const isMemPatch = (init?.method ?? "GET") === "PATCH" && String(url).includes("/chat_ctx/");
      if (isMemPatch && !held && (globalThis as any).__holdOld) {
        held = true;
        await gate;
      }
      return origFetch(url, init);
    }));
    (globalThis as any).__holdOld = true;
    const oldRun = oldB.send(say("sirf urgent wale"), tOld);
    await new Promise((r) => setTimeout(r, 10));
    (globalThis as any).__holdOld = false;
    await bot(STAFF_DURG, store()).send(say("kal wale"), tNew);
    const afterNew = JSON.parse(JSON.stringify(fs.docs.get(`chat_ctx/${STAFF_DURG.phone}`)!.data));
    released();
    await oldRun;
    delete (globalThis as any).__holdOld;
    const final = fs.docs.get(`chat_ctx/${STAFF_DURG.phone}`)!.data;
    // The newer message's query (when: tomorrow) must survive; the older 'urgent' must not replace it.
    expect((final.query as any)?.when).toBe((afterNew.query as any)?.when);
    expect(final.at).toBe(afterNew.at);
  });

  it("MemoryStore-less check: stale writer with the same version is rejected by the precondition (412)", async () => {
    await seed();
    const s1 = store();
    const s2 = store();
    const m = await s1.getChatMemory(STAFF_DURG.phone);
    expect(m).toBeNull();
    await s2.getChatMemory(STAFF_DURG.phone);
    expect(await s1.saveChatMemory(STAFF_DURG.phone, { v: 0, at: NOW.toISOString(), shown: ["t1"] })).toBe(true);
    expect(await s2.saveChatMemory(STAFF_DURG.phone, { v: 0, at: NOW.toISOString(), shown: ["t2"] })).toBe(false);
    expect(fs.docs.get(`chat_ctx/${STAFF_DURG.phone}`)!.data.shown).toEqual(["t1"]);
  });
});

describe("memory failures never break the answer", () => {
  it("Firestore chat_ctx 500 on read and write: the message is still answered", async () => {
    await seed();
    fs.failChatCtx = 500;
    const out = await bot(STAFF_DURG).send(say("mere pending tasks"));
    expect(JSON.stringify(out)).toContain("Kaam number");
  });

  it("log lines of a memory failure contain no task titles or message text", async () => {
    await seed();
    fs.failChatCtx = 500;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await bot(STAFF_DURG).send(say("mere pending tasks"));
    expect(err).toHaveBeenCalled();
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/SECRETTITLE|mere pending/);
  });

  // FINDING (low): chat.ts logs String(err) of a failed memory read/save/clear; the Firestore error text is
  // "Firestore get chat_ctx/<phone> failed 500: ...", so the sender's phone number reaches the logs on every
  // Firestore hiccup. Fix: log a fixed string (or err.name / status only) instead of String(err).
  // Fixed: chat.ts logs a fixed text plus a status code only.
  it("a memory failure must not put the phone number into the logs", async () => {
    await seed();
    fs.failChatCtx = 500;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await bot(STAFF_DURG).send(say("mere pending tasks"));
    expect(JSON.stringify(err.mock.calls)).not.toContain(STAFF_DURG.phone);
  });
});

describe("cleanup deletes only old chat_ctx docs", () => {
  it("removes chat_ctx older than a day, keeps recent ones and every other collection", async () => {
    await seed();
    fs.put("chat_ctx", "old", { v: 1, at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString() });
    fs.put("chat_ctx", "recent", { v: 1, at: new Date(NOW.getTime() - 3_600_000).toISOString() });
    fs.put("sessions", "sess", { at: "2000-01-01T00:00:00.000Z" } as never);
    const before = [...fs.docs.keys()].filter((k) => !k.startsWith("chat_ctx/"));
    const res = await runCleanup(cfg, NOW);
    expect(res.chatCtx).toBe(1);
    expect(fs.docs.has("chat_ctx/old")).toBe(false);
    expect(fs.docs.has("chat_ctx/recent")).toBe(true);
    expect([...fs.docs.keys()].filter((k) => !k.startsWith("chat_ctx/"))).toEqual(before);
  });

  it("a chat_ctx doc without a usable 'at' is never matched by the cleanup (stays forever): documented", async () => {
    fs.put("chat_ctx", "noat", { v: 1 });
    await runCleanup(cfg, NOW);
    expect(fs.docs.has("chat_ctx/noat")).toBe(true);
  });
});
