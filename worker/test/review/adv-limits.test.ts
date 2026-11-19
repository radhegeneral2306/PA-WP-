// Round 7 adversarial review (reviewer 2): daily AI limit, subrequest budget of a full webhook, guided-step timeouts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { FirestoreStore } from "../../src/data/firestoreStore";
import { CHAT_TESTERS, handleMessage } from "../../src/bot/router";
import { CHAT_LIMIT, chatCountKey } from "../../src/bot/flows/chat";
import processWebhookModule, { processWebhook } from "../../src/index";
import type { Inbound } from "../../src/bot/flow";
import type { ChatResult, ChatService } from "../../src/chat/types";
import type { Env } from "../../src/env";
import type { Task, User } from "../../src/domain/types";
import { fromFields, toFields, type Plain } from "../../src/firebase/firestore";
import { ADMIN, NOW, STAFF_DURG, STAFF_RAIPUR, USERS, say, tap, task } from "../helpers/bot";
import { textWebhook } from "../fixtures";

vi.mock("../../src/firebase/auth", () => ({ getAccessToken: vi.fn(async () => "tok") }));
void processWebhookModule;

const cfg = { projectId: "proj", clientEmail: "bot@x", privateKey: "unused" };
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


const MINE = task({ id: "m1", title: "Sharma ji payment", assigneePhone: STAFF_DURG.phone, assigneeName: "Hardware", branch: "DURG", urgent: true });
const MINE2 = task({ id: "m2", title: "GST file bharna", assigneePhone: STAFF_DURG.phone, assigneeName: "Hardware", branch: "DURG", dueAt: "2026-10-28T04:30:00.000Z" });
const WEIRD = "kuch ajeeb sa sawal jo rules nahi samajhte abhi";

function world(user: User, ai: ChatResult = { ok: true, request: { kind: "unclear" } }, tasks: Task[] = [MINE, MINE2]) {
  const store = new MemoryStore({ users: USERS, tasks });
  const understand = vi.fn(async () => ai);
  const chat: ChatService = { understand };
  let now = NOW;
  const send = (input: Inbound) => handleMessage({ store, user, now, chat }, input);
  return { store, understand, send, setNow: (d: Date) => (now = d), advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}
const used = (s: MemoryStore, u: User, now = NOW) => s.bumpDailyCount(chatCountKey(u.phone, now), now).then((n) => n - 1);

beforeEach(() => {
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

describe("daily AI limit counts only AI calls (memory + detail ON)", () => {
  it("rules, follow-ups, task questions, courtesies, resets and the menu never bump the counter", async () => {
    const w = world(STAFF_DURG);
    for (const p of ["mere pending tasks", "sirf urgent wale", "aur dikhao", "pehla wala kholo", "iski due date kya hai", "kisko diya hai", "last update kya tha", "kitne remark hain", "shuru se", "ok", "thanks", "hi", "menu", "mere kitne tasks hain", "kal ke tasks"]) {
      await w.send(say(p));
    }
    expect(w.understand).not.toHaveBeenCalled();
    expect(await used(w.store, STAFF_DURG)).toBe(0);
  });

  it("staff: 20 AI messages pass, the 21st gets the limit text and no AI call; rules still work afterwards", async () => {
    const w = world(STAFF_DURG);
    for (let i = 0; i < CHAT_LIMIT.staff; i++) await w.send(say(`${WEIRD} ${i}`));
    expect(w.understand).toHaveBeenCalledTimes(20);
    const over = await w.send(say(`${WEIRD} extra`));
    expect(w.understand).toHaveBeenCalledTimes(20);
    expect(JSON.stringify(over)).toContain("limit poori");
    const rule = await w.send(say("mere pending tasks"));
    expect(JSON.stringify(rule)).toContain("Sharma ji payment");
    const follow = await w.send(say("sirf urgent wale"));
    expect(JSON.stringify(follow)).toContain("Sharma ji payment");
    await w.send(say("pehla wala kholo"));
    const q = await w.send(say("iski due date kya hai"));
    expect(JSON.stringify(q)).not.toContain("limit poori");
    expect(JSON.stringify(q)).toMatch(/Due|due/);
  });

  it("admin: 50 AI messages pass, the 51st is refused", async () => {
    const w = world(ADMIN);
    for (let i = 0; i < CHAT_LIMIT.admin; i++) await w.send(say(`${WEIRD} ${i}`));
    expect(w.understand).toHaveBeenCalledTimes(50);
    await w.send(say(`${WEIRD} extra`));
    expect(w.understand).toHaveBeenCalledTimes(50);
  });

  it("the counter is per person and per IST day", async () => {
    const w = world(STAFF_DURG);
    for (let i = 0; i < 21; i++) await w.send(say(`${WEIRD} ${i}`));
    expect(w.understand).toHaveBeenCalledTimes(20);
    w.setNow(new Date(NOW.getTime() + 24 * 3_600_000));
    await w.send(say(`${WEIRD} next day`));
    expect(w.understand).toHaveBeenCalledTimes(21);
  });

  it("a stray memory kind from the AI still counted once (it was an AI call) and does nothing", async () => {
    const w = world(STAFF_DURG, { ok: true, request: { kind: "reset" } });
    await w.send(say("mere pending tasks"));
    await w.send(say(WEIRD));
    expect(await used(w.store, STAFF_DURG)).toBe(1);
  });

  it("detail-screen text that is a rule question does not count", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    await w.send(tap("tasks:task:m1"));
    await w.send(say("iski due date kya hai"));
    await w.send(say("kisko diya hai"));
    expect(w.understand).not.toHaveBeenCalled();
  });

  it("an unconfigured chat service (no key) does not burn the daily quota", async () => {
    const store = new MemoryStore({ users: USERS, tasks: [MINE] });
    const out = await handleMessage({ store, user: STAFF_DURG, now: NOW }, say(WEIRD));
    expect(JSON.stringify(out)).toContain("samajh nahi paaya");
    expect(await store.bumpDailyCount(chatCountKey(STAFF_DURG.phone, NOW), NOW)).toBe(1);
  });

  // FINDING (medium, quota): with the memory switch on a bare number is no longer a courtesy ("2" used to cost
  // nothing). With NO fresh memory (never listed, or expired) the rules return null and the message goes to Gemini:
  // every stray "2" / "10" / "99" burns one of the 20 daily AI messages and ends in "Samajh nahi aaya".
  // Fix: in handleChat, a bare number (or a pure follow-up phrase) with no fresh memory should answer
  // CHAT_MSG.whichTask ("Pehle list dekhne ke liye mere tasks likhiye") without the AI.
  it.fails("FINDING: a bare number without memory must not cost an AI call", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("2"));
    await w.send(say("10"));
    expect(w.understand).not.toHaveBeenCalled();
  });

  it.fails("FINDING: 'aur dikhao' / 'iski due date kya hai' with no memory must not cost an AI call", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("aur dikhao"));
    await w.send(say("iski due date kya hai"));
    expect(w.understand).not.toHaveBeenCalled();
  });
});

describe("timeouts of guided steps still apply (switches ON)", () => {
  it("create wizard: a button step expires after 2 min (typed text then gets the expire text, never chat)", async () => {
    const w = world(ADMIN);
    await w.send(tap("MENU:create_task"));
    // wizard asks for a person first; pick through the flow until a typed step is open, whatever it is
    const s1 = await w.store.getSession(ADMIN.phone);
    expect(s1?.flow).toBe("create_task");
    // A button step (not a typing step) must expire after 2 min and answer the expire text.
    w.advance(2 * 60_000 + 1000);
    const out = await w.send(say("kuch likha"));
    expect(JSON.stringify(out)).toContain("Session expire ho gaya");
    expect(w.understand).not.toHaveBeenCalled();
  });

  it("create wizard (staff): the typed-title step lives 5 min, expires after, and typed text there is the title, never chat", async () => {
    const w = world(STAFF_DURG);
    await w.send(tap("MENU:create_task"));
    const s = await w.store.getSession(STAFF_DURG.phone);
    expect(s?.flow).toBe("create_task");
    expect(s?.step).toBe("ask_title");
    w.advance(4 * 60_000);
    const out = await w.send(say("mere pending tasks"));
    expect(w.understand).not.toHaveBeenCalled();
    expect(JSON.stringify(out)).toContain("Due date"); // taken as the title, next step asked
    const s2 = await w.store.getSession(STAFF_DURG.phone);
    expect(s2?.flow).toBe("create_task");
    expect(s2?.data.title).toMatch(/mere pending tasks/i);
    w.advance(6 * 60_000);
    const late = await w.send(say("kuch aur"));
    expect(JSON.stringify(late)).toContain("Session expire ho gaya");
  });

  it("task detail: typed text works until 5 min (chat) and is 'expire' after 5 min; the 2-min button TTL does not apply to typing", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    await w.send(tap("tasks:task:m1"));
    w.advance(4 * 60_000);
    const ok = await w.send(say("iski due date kya hai"));
    expect(JSON.stringify(ok)).toContain("Sharma ji payment");
    // the chat message refreshed the clock; 5 min of silence now expires it
    w.advance(5 * 60_000 + 1000);
    const late = await w.send(say("iski due date kya hai"));
    expect(JSON.stringify(late)).toContain("Session expire ho gaya");
  });

  it("task detail: a Done tap more than 2 minutes after the last message of a detail 'typing' step still works (5-min step)", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    await w.send(tap("tasks:task:m1"));
    w.advance(3 * 60_000);
    const out = await w.send(tap("tasks:act:update:m1"));
    expect(JSON.stringify(out)).toMatch(/remark|likh/i);
  });

  it("ask_remark: typed text within 5 minutes is the remark, never chat", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    await w.send(tap("tasks:task:m1"));
    await w.send(tap("tasks:act:update:m1"));
    w.advance(4 * 60_000);
    await w.send(say("mere pending tasks"));
    expect((await w.store.getTask("m1"))?.remarks.map((r) => r.text)).toEqual(["mere pending tasks"]);
    expect(w.understand).not.toHaveBeenCalled();
  });

  // FINDING (medium, design): the chat's picker session ("tasks"/"list" with chat=1) has the normal 2-minute TTL,
  // but the memory lives 15 minutes. After 2-15 minutes the typed follow-up ("doosra wala kholo", "aur dikhao")
  // hits the router's expired branch first and gets "Session expire ho gaya" (the session is cleared); only the
  // SECOND attempt reaches the memory. Same for a numbered list with no picker left. Fix: in router.ts treat an
  // expired session whose data.chat === "1" like "no session" when typed text and canUseChatMemory(user), i.e. do
  // not answer EXPIRED for it.
  it.fails("FINDING: a typed follow-up 3 minutes after a chat list works (memory is 15 min), not 'Session expire ho gaya'", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    w.advance(3 * 60_000);
    const out = await w.send(say("pehla wala kholo"));
    expect(JSON.stringify(out)).not.toContain("Session expire ho gaya");
  });

  it("... and the second attempt after that does reach the memory (documents the double step)", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    w.advance(3 * 60_000);
    await w.send(say("pehla wala kholo"));
    const out = await w.send(say("pehla wala kholo"));
    expect(JSON.stringify(out)).toMatch(/Sharma ji|GST file/);
  });

  it("memory itself expires at 15 minutes: the follow-up opens nothing", async () => {
    const w = world(STAFF_DURG);
    await w.send(say("mere pending tasks"));
    w.advance(16 * 60_000);
    await w.send(say("x")); // consumes the expired-session notice, if any
    const out = await w.send(say("pehla wala kholo"));
    expect(JSON.stringify(out)).not.toMatch(/Sharma ji payment|GST file bharna/);
  });
});

// ---- full webhook with the real Firestore store on the fake backend: every outbound request counts ----
const env: Env = {
  WEBHOOK_SECRET: "s", INTERAKT_API_KEY: "key", INTERAKT_ORG_ID: "org-test", TEST_NUMBERS: "",
  FIREBASE_PROJECT_ID: "proj", FIREBASE_CLIENT_EMAIL: "bot@x", FIREBASE_PRIVATE_KEY: "unused",
} as Env;

describe("subrequest budget of a whole webhook (real FirestoreStore, fake Firestore + Interakt)", () => {
  it("every message of a long admin and staff chat uses far fewer than 50 requests", async () => {
    const fs = new FakeFirestore();
    const interakt: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("firestore.googleapis.com")) return fs.fetch(String(url), init);
      interakt.push(String(url));
      return new Response("{}", { status: 200 });
    }));
    const admin = { ...ADMIN, phone: "919999999999" };
    for (const u of [admin, { ...STAFF_DURG, phone: "919999999998" }]) fs.put("users", u.phone, u as never);
    for (let i = 1; i <= 14; i++) {
      const t = task({ id: `t${i}`, title: `Kaam ${i}`, assigneePhone: "919999999998", assigneeName: "Hardware", dueAt: new Date(Date.UTC(2026, 9, 20, 4, 30 + i * 60)).toISOString() });
      const { id, ...rest } = t;
      fs.put("tasks", id, rest as never);
    }
    const chat: ChatService = { understand: vi.fn(async () => ({ ok: true, request: { kind: "list", filter: { scope: "all", when: "overdue" } } }) as ChatResult) };
    let n = 0;
    const worst: [string, number][] = [];
    const msg = (phone: string, text: string) => {
      const w = textWebhook(text, { id: `msg-${++n}` }) as any;
      w.data.customer.phone_number = phone.slice(2);
      return w;
    };
    const script = ["sabke pending tasks", "sirf urgent wale", "aur dikhao", "doosra wala kholo", "iski due date kya hai", "kisko diya hai", "last update kya tha", "durg ke overdue", "kal wale", "shuru se", WEIRD, "ok", "hi"];
    for (const text of script) {
      fs.reqs = [];
      interakt.length = 0;
      await processWebhook(env, msg("919999999999", text), "{}", { chat, now: NOW });
      worst.push([`admin:${text}`, fs.reqs.length + interakt.length]);
    }
    for (const text of ["mere pending tasks", "sirf urgent wale", "pehla wala kholo", "iski due date kya hai", WEIRD]) {
      fs.reqs = [];
      interakt.length = 0;
      await processWebhook(env, msg("919999999998", text), "{}", { chat, now: NOW });
      worst.push([`staff:${text}`, fs.reqs.length + interakt.length]);
    }
    for (const [what, count] of worst) expect(count, what).toBeLessThanOrEqual(25);
    expect(Math.max(...worst.map((x) => x[1]))).toBeLessThan(50);
  });
});
