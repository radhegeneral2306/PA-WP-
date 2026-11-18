import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import type { Task, User } from "../../src/domain/types";
import type { BotContext, Inbound } from "../../src/bot/flow";
import type { Outgoing } from "../../src/bot/outgoing";
import { voiceUpdateFlow, UPDATE_MSG } from "../../src/bot/flows/voiceUpdate";
import { handleVoice, VOICE_MSG } from "../../src/bot/flows/voiceTask";
import { handleMessage, sessionTtlMinutes } from "../../src/bot/router";
import { markDone } from "../../src/bot/taskActions";
import type { VoiceDraft, VoiceFailure, VoiceResult, VoiceService } from "../../src/voice/types";
import { ADMIN, ADMIN2, NOW, STAFF_DURG, STAFF_RAIPUR, USERS, say, task, tap } from "../helpers/bot";

const F = "voice_update";
const created = "2026-10-01T00:00:00.000Z";
const staff = (phone: string, name: string, branch: User["branch"], active = true): User => ({ phone, name, role: "staff", branch, active, createdAt: created });

const PINKY = staff("919000000021", "Pinky", "RAIPUR");
const HARSH = staff("919000000022", "Harsh", "DURG");
const RAHUL_A = staff("919000000023", "Rahul Sharma", "OFFICE");
const RAHUL_B = staff("919000000024", "Rahul Verma", "OFFICE");
const EXTRA = [PINKY, HARSH, RAHUL_A, RAHUL_B];

const T_SHARMA = task({ id: "t1", title: "Sharma ji se payment lena", assigneePhone: PINKY.phone, assigneeName: PINKY.name, branch: "RAIPUR", createdByPhone: ADMIN2.phone, createdByName: ADMIN2.name });
const T_STOCK = task({ id: "t2", title: "Stock ginna", assigneePhone: PINKY.phone, assigneeName: PINKY.name, branch: "RAIPUR", createdByPhone: ADMIN2.phone, createdByName: ADMIN2.name, dueAt: "2026-10-28T04:30:00.000Z" });
const T_OTHER = task({ id: "t3", title: "Sharma ji ka bill", assigneePhone: HARSH.phone, assigneeName: HARSH.name, branch: "DURG", createdByPhone: ADMIN2.phone, createdByName: ADMIN2.name });

function draft(over: Partial<VoiceDraft> = {}): VoiceDraft {
  return { transcript: "Pinky ka Sharma ji wala task", title: null, person: "Pinky", personHeard: "Pinky", date: null, time: null, repeat: null, intent: "update", action: "done", taskWords: ["sharma"], ...over };
}
const ok = (over: Partial<VoiceDraft> = {}): VoiceResult => ({ ok: true, draft: draft(over), durationSec: 5 });

type FakeVoice = VoiceService & { understand: ReturnType<typeof vi.fn<VoiceService["understand"]>> };
const fakeVoice = (result: VoiceResult): FakeVoice => ({ understand: vi.fn<VoiceService["understand"]>(async () => result) });

function setup(opts: { result?: VoiceResult; tasks?: Task[]; user?: User; now?: Date } = {}) {
  const user = opts.user ?? ADMIN;
  const store = new MemoryStore({ users: [...USERS, ...EXTRA], tasks: opts.tasks ?? [T_SHARMA, T_STOCK, T_OTHER] });
  const voice = fakeVoice(opts.result ?? ok());
  let now = opts.now ?? NOW;
  const ctx = (): BotContext => ({ store, user, now, voice });
  const send = () => handleVoice(ctx(), "https://media.example/v.ogg");
  /** A message while the voice_update session is open (straight into the flow). */
  const step = async (input: Inbound): Promise<Outgoing[]> => {
    const session = await store.getSession(user.phone);
    if (!session) throw new Error("no session");
    return voiceUpdateFlow.handle(ctx(), session, input);
  };
  /** Through the router (session lookup, TTL, id prefix check). */
  const route = (input: Inbound) => handleMessage(ctx(), input);
  const session = () => store.getSession(user.phone);
  const setNow = (d: Date) => (now = d);
  return { store, voice, send, step, route, session, ctx, setNow };
}

const body = (o: Outgoing) => (o.kind === "template" ? o.fallbackText : o.body);
const ids = (o: Outgoing) => (o.kind === "list" ? o.rows.map((r) => r.id) : o.kind === "buttons" ? o.buttons.map((b) => b.id) : []);
const templates = (out: Outgoing[]) => out.filter((o): o is Extract<Outgoing, { kind: "template" }> => o.kind === "template");
const yes = tap(`${F}:confirm:yes`, "Haan ✅");
const no = tap(`${F}:confirm:no`, "Rehne do ❌");
const CONFIRM_IDS = [`${F}:confirm:yes`, `${F}:confirm:no`];

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** Free mode: voice note -> pick the only task -> the confirm screen. */
async function toConfirm(t: ReturnType<typeof setup>, id = "t1") {
  const picked = await t.send();
  expect(picked[0].kind).toBe("list");
  return t.step(tap(`${F}:task:${id}`));
}

describe("free mode: the four actions", () => {
  it("done: list -> confirm in big words -> Haan marks it done, creator told, actor not", async () => {
    const t = setup({ result: ok({ action: "done" }) });
    const out = await t.send();
    expect(out).toHaveLength(1);
    expect(body(out[0])).toBe(UPDATE_MSG.which);
    expect(ids(out[0])).toEqual([`${F}:task:t1`]);
    const row = (out[0] as Extract<Outgoing, { kind: "list" }>).rows[0];
    expect(row.title).toBe("Sharma ji se payment le…"); // clipped to the 24-char row limit
    expect(row.description).toBe("Pinky · Due 27 Oct");
    expect(t.voice.understand).toHaveBeenCalledTimes(1);

    const confirm = await t.step(tap(`${F}:task:t1`));
    expect(ids(confirm[0])).toEqual(CONFIRM_IDS);
    expect(body(confirm[0])).toBe(
      'Maine suna: "Pinky ka Sharma ji wala task"\n\n✅ DONE karna hai:\nTask: Sharma ji se payment lena\nKisko: Pinky\nDue: 27 Oct\n\nSahi hai?',
    );

    const out2 = await t.step(yes);
    expect(body(out2[0])).toBe("✅ Done ho gaya: *Sharma ji se payment lena*");
    const done = await t.store.getTask("t1");
    expect(done?.status).toBe("done");
    expect(done?.remarks.at(-1)?.byName).toBe("Bhaskar (voice)");
    expect(done?.remarks.at(-1)?.text).toBe("Done kiya");
    const tpl = templates(out2);
    expect(tpl.map((x) => [x.template, x.to])).toEqual([["task_done_v1", ADMIN2.phone]]);
    expect(await t.session()).toBeNull();
  });

  it("remark: confirm shows the text; Haan writes it as '(voice)' and tells creator + assignee, not the actor", async () => {
    const t = setup({ result: ok({ action: "remark", remark: "customer kal aayega" }) });
    const confirm = await toConfirm(t);
    expect(body(confirm[0])).toContain("📝 REMARK likhna hai:\nTask: Sharma ji se payment lena\nRemark: \"customer kal aayega\"");
    const out = await t.step(yes);
    expect(body(out[0])).toBe("📝 Remark likh diya: *Sharma ji se payment lena*");
    const r = (await t.store.getTask("t1"))!.remarks.at(-1)!;
    expect(r).toMatchObject({ byName: "Bhaskar (voice)", text: "customer kal aayega" });
    expect(templates(out).map((x) => [x.template, x.to]).sort()).toEqual(
      [["task_updated_v1", ADMIN2.phone], ["task_updated_v1", PINKY.phone]].sort(),
    );
    expect(templates(out).some((x) => x.to === ADMIN.phone)).toBe(false);
  });

  it("due: confirm shows old -> new; Haan moves the date, creator AND assignee told", async () => {
    const t = setup({ result: ok({ action: "due", date: "2026-10-29", time: "17:00" }) });
    const confirm = await toConfirm(t);
    expect(body(confirm[0])).toContain("🕒 DATE BADALNI hai:\nTask: Sharma ji se payment lena\nDate: 27 Oct → 29 Oct, 5:00 PM");
    const out = await t.step(yes);
    expect(body(out[0])).toBe("🕒 Date badal di: *Sharma ji se payment lena*\n27 Oct → 29 Oct, 5:00 PM");
    const after = (await t.store.getTask("t1"))!;
    expect(after.dueAt).toBe("2026-10-29T11:30:00.000Z");
    expect(after.dueHasTime).toBe(true);
    expect(after.remarks.at(-1)?.byName).toBe("Bhaskar (voice)");
    expect(templates(out).map((x) => x.to).sort()).toEqual([ADMIN2.phone, PINKY.phone].sort());
  });

  it("reassign: confirm shows old -> new; Haan gives it to the new person who alone gets task_assigned_v1", async () => {
    const t = setup({ result: ok({ action: "reassign", newPerson: "Harsh", newPersonHeard: "Harsh" }) });
    const confirm = await toConfirm(t);
    expect(body(confirm[0])).toContain("👤 DUSRE KO DENA hai:\nTask: Sharma ji se payment lena\nKisko: Pinky → Harsh");
    const out = await t.step(yes);
    expect(body(out[0])).toBe("👤 Task de diya: *Sharma ji se payment lena*\nPinky → Harsh");
    const after = (await t.store.getTask("t1"))!;
    expect(after.assigneePhone).toBe(HARSH.phone);
    expect(after.remarks.at(-1)?.byName).toBe("Bhaskar (voice)");
    expect(templates(out).map((x) => [x.template, x.to])).toEqual([["task_assigned_v1", HARSH.phone]]);
  });

  it("buttons: titles <= 20 chars, never cancel/stop, only Haan and Rehne do", async () => {
    const t = setup();
    const confirm = await toConfirm(t);
    const c = confirm[0] as Extract<Outgoing, { kind: "buttons" }>;
    expect(c.buttons.map((b) => b.title)).toEqual(["Haan ✅", "Rehne do ❌"]);
    for (const b of c.buttons) {
      expect(b.title.length).toBeLessThanOrEqual(20);
      expect(b.title).not.toMatch(/cancel|stop/i);
    }
    expect(body(c).length).toBeLessThanOrEqual(1024);
  });

  it("a long transcript keeps the confirm body under the WhatsApp limit", async () => {
    const t = setup({ result: ok({ transcript: "bahut ".repeat(200), action: "remark", remark: "x".repeat(300) }) });
    const confirm = await toConfirm(t);
    expect(body(confirm[0]).length).toBeLessThanOrEqual(1024);
  });
});

describe("free mode: finding the task", () => {
  it("one match still shows the list (the admin always picks)", async () => {
    const t = setup();
    const out = await t.send();
    expect(out[0].kind).toBe("list");
    expect(ids(out[0])).toHaveLength(1);
    expect((await t.session())?.step).toBe("pick_task");
  });

  it("several matches: a list, nothing changes yet", async () => {
    const t = setup({ result: ok({ person: null, personHeard: null }) });
    const out = await t.send();
    expect(ids(out[0]).sort()).toEqual([`${F}:task:t1`, `${F}:task:t3`]);
    expect((await t.store.getTask("t1"))?.status).toBe("pending");
  });

  it("at most 8 candidates, row texts within WhatsApp limits", async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      task({ id: `m${i}`, title: `Sharma ji ka bahut lamba kaam number ${i} jo kabhi khatam nahi hota`, assigneePhone: PINKY.phone, assigneeName: PINKY.name }),
    );
    const t = setup({ tasks: many });
    const out = (await t.send())[0] as Extract<Outgoing, { kind: "list" }>;
    expect(out.rows).toHaveLength(8);
    for (const r of out.rows) {
      expect(r.title.length).toBeLessThanOrEqual(24);
      expect((r.description ?? "").length).toBeLessThanOrEqual(72);
    }
  });

  it("no match but a person known: that person's shortlist with the 'no exact match' text", async () => {
    const t = setup({ result: ok({ taskWords: ["zzzz"] }) });
    const out = await t.send();
    expect(body(out[0])).toBe(UPDATE_MSG.noExact);
    expect(ids(out[0]).sort()).toEqual([`${F}:task:t1`, `${F}:task:t2`]);
  });

  it("no match and no person: text only, nothing saved", async () => {
    const t = setup({ result: ok({ person: null, personHeard: null, taskWords: ["zzzz"] }) });
    const out = await t.send();
    expect(out).toEqual([{ to: ADMIN.phone, kind: "text", body: UPDATE_MSG.noTask }]);
    expect(await t.session()).toBeNull();
  });

  it("a known person without pending tasks says so", async () => {
    const t = setup({ result: ok({ person: "Harsh", personHeard: "Harsh", taskWords: ["zzzz"] }), tasks: [] });
    const out = await t.send();
    expect(body(out[0])).toBe("Harsh ke paas koi pending task nahi hai.");
  });

  it("a done / cancelled task is never offered", async () => {
    const t = setup({ tasks: [{ ...T_SHARMA, status: "done" }, { ...T_STOCK, title: "Sharma ji stock", status: "cancelled" }] });
    expect(body((await t.send())[0])).toBe("Pinky ke paas koi pending task nahi hai.");
    const anyone = setup({ result: ok({ person: null, personHeard: null }), tasks: [{ ...T_SHARMA, status: "done" }] });
    expect(body((await anyone.send())[0])).toBe(UPDATE_MSG.noTask);
  });

  it("two people with that name: asks who, then searches that person's tasks", async () => {
    const t = setup({
      result: ok({ person: null, personHeard: "Rahul", taskWords: ["bill"] }),
      tasks: [task({ id: "r1", title: "Bill bhejna", assigneePhone: RAHUL_B.phone, assigneeName: RAHUL_B.name })],
    });
    const out = await t.send();
    expect(body(out[0])).toContain("Is naam ke do log hain. Kiska task hai?");
    expect(ids(out[0])).toContain(`${F}:user:${RAHUL_A.phone}`);
    expect(ids(out[0])).toContain(`${F}:user:${RAHUL_B.phone}`);
    const picked = await t.step(tap(`${F}:user:${RAHUL_B.phone}`));
    expect(ids(picked[0])).toEqual([`${F}:task:r1`]);
  });

  it("an unknown name: branch picker, then user list, then the search", async () => {
    const t = setup({ result: ok({ person: null, personHeard: "Qwxz", taskWords: ["stock"] }) });
    const out = await t.send();
    expect(body(out[0])).toContain("Ye naam staff list mein nahi mila. Kiska task hai?");
    expect(ids(out[0])).toContain(`${F}:branch:RAIPUR`);
    const users = await t.step(tap(`${F}:branch:RAIPUR`));
    expect(ids(users[0])).toContain(`${F}:user:${PINKY.phone}`);
    const tasks = await t.step(tap(`${F}:user:${PINKY.phone}`));
    expect(ids(tasks[0])).toEqual([`${F}:task:t2`]);
  });

  it("a deactivated person is named as such", async () => {
    const t = setup({ result: ok({ person: null, personHeard: "Old Staff", taskWords: ["x"] }) });
    const out = await t.send();
    expect(body(out[0])).toContain("Old Staff ab active nahi hai.");
  });

  it("a tap outside the list re-shows it with a hint", async () => {
    const t = setup();
    await t.send();
    const out = await t.step(tap(`${F}:task:nope`));
    expect(body(out[0])).toContain(UPDATE_MSG.tapHint);
    expect(ids(out[0])).toEqual([`${F}:task:t1`]);
  });
});

describe("missing parts", () => {
  it("action unclear in free mode: asks the action after the task is picked", async () => {
    const t = setup({ result: ok({ action: null }) });
    await t.send();
    const out = await t.step(tap(`${F}:task:t1`));
    expect(body(out[0])).toBe(UPDATE_MSG.action);
    expect(ids(out[0])).toEqual([`${F}:action:done`, `${F}:action:remark`, `${F}:action:due`, `${F}:action:reassign`]);
    const confirm = await t.step(tap(`${F}:action:done`));
    expect(body(confirm[0])).toContain("✅ DONE karna hai:");
  });

  it("due without a date: quick list; a tap gives the confirm", async () => {
    const t = setup({ result: ok({ action: "due" }) });
    const q = await toConfirm(t);
    expect(ids(q[0])[0]).toMatch(new RegExp(`^${F}:quick:`));
    expect(ids(q[0])).toContain(`${F}:quick:custom`);
    const confirm = await t.step(tap(`${F}:quick:tom14`));
    expect(body(confirm[0])).toContain("Date: 27 Oct → 27 Oct, 2:00 PM");
  });

  it("due: a typed date works at the list, 'custom' asks for text", async () => {
    const t = setup({ result: ok({ action: "due" }) });
    await toConfirm(t);
    const custom = await t.step(tap(`${F}:quick:custom`));
    expect(body(custom[0])).toBe(UPDATE_MSG.customDue);
    expect((await t.session())?.step).toBe("ask_custom_date");
    const bad = await t.step(say("kuch bhi"));
    expect(body(bad[0])).toContain("Date samajh nahi aayi");
    const confirm = await t.step(say("30/10 4pm"));
    expect(body(confirm[0])).toContain("→ 30 Oct, 4:00 PM");
    // typed straight at the quick list too
    const t2 = setup({ result: ok({ action: "due" }) });
    await toConfirm(t2);
    const c2 = await t2.step(say("kal 11am"));
    expect(body(c2[0])).toContain("→ 27 Oct, 11:00 AM");
  });

  it("due: a date in the past is asked again", async () => {
    const t = setup({ result: ok({ action: "due", date: "2026-10-20" }) });
    const q = await toConfirm(t);
    expect(body(q[0])).toContain(VOICE_MSG.datePast);
    expect((await t.session())?.step).toBe("ask_due");
  });

  it("remark without text: asks to type it; typed text goes to the confirm", async () => {
    const t = setup({ result: ok({ action: "remark" }) });
    const ask = await toConfirm(t);
    expect(ask).toEqual([{ to: ADMIN.phone, kind: "text", body: UPDATE_MSG.askRemark }]);
    expect((await t.session())?.step).toBe("ask_remark");
    const confirm = await t.step(say("Customer ne kal bulaya hai"));
    expect(body(confirm[0])).toContain('Remark: "Customer ne kal bulaya hai"');
    expect(ids(confirm[0])).toEqual(CONFIRM_IDS);
  });

  it("remark: an over-long typed remark is refused", async () => {
    const t = setup({ result: ok({ action: "remark" }) });
    await toConfirm(t);
    const out = await t.step(say("x".repeat(501)));
    expect(body(out[0])).toBe(UPDATE_MSG.remarkLong);
    expect((await t.session())?.step).toBe("ask_remark");
  });

  it("reassign without a new person: branch list -> user list (admins can be picked too) -> confirm", async () => {
    const t = setup({ result: ok({ action: "reassign" }) });
    const branches = await toConfirm(t);
    expect(body(branches[0])).toBe(UPDATE_MSG.whomNew);
    expect(ids(branches[0])).toContain(`${F}:branch:ADMINS`);
    const admins = await t.step(tap(`${F}:branch:ADMINS`));
    expect(ids(admins[0])).toContain(`${F}:user:${ADMIN2.phone}`);
    const confirm = await t.step(tap(`${F}:user:${ADMIN2.phone}`));
    expect(body(confirm[0])).toContain("Kisko: Pinky → Partner Two");
    const out = await t.step(yes);
    expect((await t.store.getTask("t1"))?.assigneePhone).toBe(ADMIN2.phone);
    expect(templates(out).map((x) => x.to)).toEqual([ADMIN2.phone]);
  });

  it("reassign with an ambiguous new person: asks which one", async () => {
    const t = setup({ result: ok({ action: "reassign", newPerson: null, newPersonHeard: "Rahul" }) });
    const out = await toConfirm(t);
    expect(body(out[0])).toContain("Is naam ke do log hain.");
    const confirm = await t.step(tap(`${F}:user:${RAHUL_A.phone}`));
    expect(body(confirm[0])).toContain("Pinky → Rahul Sharma");
  });

  it("reassign to the person who already has it: plain message, nothing changes", async () => {
    const t = setup({ result: ok({ action: "reassign", newPerson: "Pinky" }) });
    const out = await toConfirm(t);
    expect(body(out[0])).toContain("pehle se *Pinky* ke naam pe hai");
    expect(await t.session()).toBeNull();
  });

  it("an unrelated message at a tap step re-prompts", async () => {
    const t = setup({ result: ok({ action: null }) });
    await toConfirm(t);
    const out = await t.step(say("hello"));
    expect(body(out[0])).toContain(UPDATE_MSG.tapHint);
    expect((await t.session())?.step).toBe("pick_action");
  });
});

describe("Rehne do and typed answers", () => {
  it("Rehne do changes nothing and ends the flow", async () => {
    const t = setup();
    await toConfirm(t);
    const out = await t.step(no);
    expect(body(out[0])).toBe(UPDATE_MSG.cancelled);
    expect((await t.store.getTask("t1"))?.status).toBe("pending");
    expect(await t.session()).toBeNull();
  });

  it("typed 'haan' and 'nahi' work like the buttons", async () => {
    const a = setup();
    await toConfirm(a);
    await a.step(say("Haan"));
    expect((await a.store.getTask("t1"))?.status).toBe("done");
    const b = setup();
    await toConfirm(b);
    await b.step(say("nahi"));
    expect((await b.store.getTask("t1"))?.status).toBe("pending");
  });

  it("other text re-shows the confirm with a hint and keeps the same nonce", async () => {
    const t = setup();
    await toConfirm(t);
    const nonce = (await t.session())!.data.nonce;
    const out = await t.step(say("pata nahi"));
    expect(body(out[0])).toContain(UPDATE_MSG.confirmHint);
    expect((await t.session())!.data.nonce).toBe(nonce);
  });
});

describe("double tap", () => {
  it("two Haan taps act once: one remark, one set of notices", async () => {
    const t = setup({ result: ok({ action: "remark", remark: "ek baar" }) });
    await toConfirm(t);
    const session = (await t.session())!;
    const first = await voiceUpdateFlow.handle(t.ctx(), session, yes);
    const second = await voiceUpdateFlow.handle(t.ctx(), session, yes);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
    expect((await t.store.getTask("t1"))!.remarks).toHaveLength(1);
  });

  it("two Haan taps on Done: one done notice", async () => {
    const t = setup();
    await toConfirm(t);
    const session = (await t.session())!;
    const a = await voiceUpdateFlow.handle(t.ctx(), session, yes);
    const b = await voiceUpdateFlow.handle(t.ctx(), session, yes);
    expect(templates(a)).toHaveLength(1);
    // the second tap sees the task already closed and says so, without a second notice
    expect(templates(b)).toHaveLength(0);
  });
});

describe("the task changes between the pick and Haan", () => {
  it("done by someone else", async () => {
    const t = setup({ result: ok({ action: "remark", remark: "x" }) });
    await toConfirm(t);
    await markDone(t.store, (await t.store.getTask("t1"))!, { phone: ADMIN2.phone, name: ADMIN2.name }, NOW);
    const out = await t.step(yes);
    expect(body(out[0])).toBe("*Sharma ji se payment lena* pehle hi done ho chuka hai ✅");
    expect(templates(out)).toHaveLength(0);
    expect((await t.store.getTask("t1"))!.remarks.some((r) => r.text === "x")).toBe(false);
    expect(await t.session()).toBeNull();
  });

  it("cancelled", async () => {
    const t = setup();
    await toConfirm(t);
    await t.store.updateTask("t1", { status: "cancelled" });
    const out = await t.step(yes);
    expect(body(out[0])).toBe("*Sharma ji se payment lena* cancel ho chuka hai ❌");
    expect((await t.store.getTask("t1"))?.status).toBe("cancelled");
  });

  it("deleted", async () => {
    const t = setup();
    await toConfirm(t);
    await t.store.updateTask("t1", { status: "deleted" });
    const out = await t.step(yes);
    expect(body(out[0])).toBe(UPDATE_MSG.gone);
    expect((await t.store.getTask("t1"))?.status).toBe("deleted");
    expect(await t.session()).toBeNull();
  });

  it("reassigned to someone else: the stale screen is not acted on", async () => {
    const t = setup();
    await toConfirm(t);
    await t.store.updateTask("t1", { assigneePhone: HARSH.phone, assigneeName: HARSH.name });
    const out = await t.step(yes);
    expect(body(out[0])).toContain("ab *Harsh* ke paas hai");
    expect((await t.store.getTask("t1"))?.status).toBe("pending");
    expect(await t.session()).toBeNull();
  });

  it("gone between the voice note and the task tap", async () => {
    const t = setup();
    await t.send();
    await t.store.updateTask("t1", { status: "done" });
    const out = await t.step(tap(`${F}:task:t1`));
    expect(body(out[0])).toContain("pehle hi done ho chuka hai");
  });

  it("the new due has passed by Haan: asks the date again, nothing changes", async () => {
    const t = setup({ result: ok({ action: "due", date: "2026-10-26", time: "16:00" }) });
    await toConfirm(t);
    t.setNow(new Date("2026-10-26T11:00:00Z")); // 4:30 PM IST, past 4 PM
    const out = await t.step(yes);
    expect(out[0].kind).toBe("list");
    expect(body(out[0])).toContain(VOICE_MSG.datePast);
    expect((await t.session())?.step).toBe("ask_due");
    expect((await t.store.getTask("t1"))?.dueAt).toBe(T_SHARMA.dueAt);
  });

  it("the new person was deactivated: asks again, nothing changes", async () => {
    const t = setup({ result: ok({ action: "reassign", newPerson: "Harsh" }) });
    await toConfirm(t);
    await t.store.saveUser({ ...HARSH, active: false });
    const out = await t.step(yes);
    expect(body(out[0])).toContain("Harsh ab active nahi hai.");
    expect(ids(out[0])).toContain(`${F}:branch:DURG`);
    expect((await t.store.getTask("t1"))?.assigneePhone).toBe(PINKY.phone);
    // picking someone else completes it
    await t.step(tap(`${F}:branch:RAIPUR`));
    const confirm = await t.step(tap(`${F}:user:${STAFF_RAIPUR.phone}`));
    expect(body(confirm[0])).toContain("Pinky → Chikku");
  });
});

describe("voice failures (free mode)", () => {
  const cases: [VoiceFailure, string, boolean][] = [
    ["too_long", VOICE_MSG.tooLong, false],
    ["limit", VOICE_MSG.off, true],
    ["not_understood", VOICE_MSG.notUnderstood, false],
    ["download", VOICE_MSG.downloadFailed, true],
    ["failed", VOICE_MSG.notUnderstood, true],
  ];
  for (const [reason, msg, health] of cases) {
    it(`${reason}: the same text as creating${health ? ", counted for the health check" : ""}`, async () => {
      const t = setup({ result: { ok: false, reason }, user: ADMIN2 });
      const out = await t.send();
      expect(out).toEqual([{ to: ADMIN2.phone, kind: "text", body: msg }]);
      expect(await t.session()).toBeNull();
      expect((await t.store.getHealth())?.errors ?? 0).toBe(health ? 1 : 0);
    });
  }
});

describe("context mode (through the router)", () => {
  async function open(t: ReturnType<typeof setup>, id = "t1") {
    await t.store.saveSession({ phone: ADMIN.phone, flow: "tasks", step: "detail", data: { taskId: id }, updatedAt: NOW.toISOString() });
  }
  const voiceMsg: Inbound = { text: "", reply: null, voice: { mediaUrl: "https://media.example/v.ogg" } };

  it("passes the open task to the service and applies only to it (no list, no search)", async () => {
    const t = setup({ result: ok({ action: "done", taskWords: [], person: null, personHeard: null }) });
    await open(t);
    const out = await t.route(voiceMsg);
    expect(t.voice.understand).toHaveBeenCalledTimes(1);
    expect(t.voice.understand.mock.calls[0][1].task).toEqual({ title: "Sharma ji se payment lena", assignee: "Pinky" });
    expect(ids(out[0])).toEqual(CONFIRM_IDS);
    expect((await t.session())?.flow).toBe(F);
    const done = await t.route(yes);
    expect(body(done[0])).toBe("✅ Done ho gaya: *Sharma ji se payment lena*");
    expect((await t.store.getTask("t3"))?.status).toBe("pending");
  });

  it("remark", async () => {
    const t = setup({ result: ok({ action: "remark", remark: "kal aayega", taskWords: [] }) });
    await open(t);
    expect(body((await t.route(voiceMsg))[0])).toContain('Remark: "kal aayega"');
    await t.route(yes);
    expect((await t.store.getTask("t1"))!.remarks.at(-1)).toMatchObject({ byName: "Bhaskar (voice)", text: "kal aayega" });
  });

  it("due", async () => {
    const t = setup({ result: ok({ action: "due", date: "2026-10-30", taskWords: [] }) });
    await open(t);
    expect(body((await t.route(voiceMsg))[0])).toContain("Date: 27 Oct → 30 Oct");
    await t.route(yes);
    expect((await t.store.getTask("t1"))?.dueAt).toBe("2026-10-30T04:30:00.000Z");
  });

  it("reassign", async () => {
    const t = setup({ result: ok({ action: "reassign", newPerson: "Harsh", taskWords: [] }) });
    await open(t);
    expect(body((await t.route(voiceMsg))[0])).toContain("Pinky → Harsh");
    await t.route(yes);
    expect((await t.store.getTask("t1"))?.assigneePhone).toBe(HARSH.phone);
  });

  it("an unclear action: asks with the four-option list, then continues on the same task", async () => {
    const t = setup({ result: ok({ action: null, taskWords: [] }) });
    await open(t);
    const out = await t.route(voiceMsg);
    expect(body(out[0])).toBe(UPDATE_MSG.action);
    expect(ids(out[0])).toHaveLength(4);
    const confirm = await t.route(tap(`${F}:action:done`));
    expect(body(confirm[0])).toContain("Sharma ji se payment lena");
  });

  it("a remark that was not extracted is asked as typed text", async () => {
    const t = setup({ result: ok({ action: "remark", remark: null, taskWords: [] }) });
    await open(t);
    expect(await t.route(voiceMsg)).toEqual([{ to: ADMIN.phone, kind: "text", body: UPDATE_MSG.askRemark }]);
    const confirm = await t.route(say("bhej diya hai"));
    expect(body(confirm[0])).toContain('Remark: "bhej diya hai"');
  });

  it("ignores person / task words from the model: it is always the open task", async () => {
    const t = setup({ result: ok({ action: "done", person: "Harsh", taskWords: ["bill"] }) });
    await open(t, "t1");
    const out = await t.route(voiceMsg);
    expect(body(out[0])).toContain("Sharma ji se payment lena");
    await t.route(yes);
    expect((await t.store.getTask("t3"))?.status).toBe("pending");
    expect((await t.store.getTask("t1"))?.status).toBe("done");
  });

  it("failure keeps the open task chat intact (and counts health / shows _Tech: to the super admin)", async () => {
    const t = setup({ result: { ok: false, reason: "download", detail: "media 403" } });
    await open(t);
    const out = await t.route(voiceMsg);
    expect(body(out[0])).toBe(`${VOICE_MSG.downloadFailed}\n\n_Tech: download: media 403_`);
    const s = await t.session();
    expect(s).toMatchObject({ flow: "tasks", step: "detail", data: { taskId: "t1" } });
    expect((await t.store.getHealth())?.lastProblem).toBe("voice download: media 403");
  });

  it("busy and not understood leave the chat intact; busy has its own text", async () => {
    const busy = setup({ result: { ok: false, reason: "failed", detail: "gemini 503 UNAVAILABLE" }, user: ADMIN });
    await open(busy);
    expect(body((await busy.route(voiceMsg))[0])).toContain(VOICE_MSG.busy);
    expect((await busy.session())?.flow).toBe("tasks");
    const nu = setup({ result: { ok: false, reason: "not_understood" } });
    await open(nu);
    expect(body((await nu.route(voiceMsg))[0])).toContain(VOICE_MSG.notUnderstood);
    expect((await nu.session())?.step).toBe("detail");
  });

  it("the task was closed meanwhile: says so and ends the chat", async () => {
    const t = setup();
    await open(t);
    await t.store.updateTask("t1", { status: "done" });
    const out = await t.route(voiceMsg);
    expect(body(out[0])).toContain("ab pending nahi hai");
    expect(t.voice.understand).not.toHaveBeenCalled();
    expect(await t.session()).toBeNull();
  });

  it("a stale detail chat (older than its timeout) is not context: free mode runs instead", async () => {
    const t = setup();
    await t.store.saveSession({ phone: ADMIN.phone, flow: "tasks", step: "detail", data: { taskId: "t1" }, updatedAt: new Date(NOW.getTime() - 6 * 60_000).toISOString() });
    await t.route(voiceMsg);
    expect(t.voice.understand.mock.calls[0][1].task).toBeUndefined();
  });

  it("a tasks list chat (no open task) is busy for voice, as before", async () => {
    const t = setup();
    await t.store.saveSession({ phone: ADMIN.phone, flow: "tasks", step: "list", data: {}, updatedAt: NOW.toISOString() });
    const out = await t.route(voiceMsg);
    expect(body(out[0])).toContain("band karo");
    expect(t.voice.understand).not.toHaveBeenCalled();
  });
});

describe("who can reach it", () => {
  it("non-admins never reach the flow: the router sends their voice note to the menu", async () => {
    const t = setup({ user: STAFF_DURG });
    const out = await t.route({ text: "", reply: null, voice: { mediaUrl: "u" } });
    expect(t.voice.understand).not.toHaveBeenCalled();
    expect(out[0].kind).toBe("buttons"); // staff main menu
  });

  it("an admin who may not use voice yet never reaches it", async () => {
    const t = setup({ user: ADMIN2 });
    const out = await t.route({ text: "", reply: null, voice: { mediaUrl: "u" } });
    expect(t.voice.understand).not.toHaveBeenCalled();
    expect(out[0].kind).toBe("list");
  });

  it("the flow itself refuses a non-admin session", async () => {
    const t = setup({ user: STAFF_DURG });
    await t.store.saveSession({ phone: STAFF_DURG.phone, flow: F, step: "confirm", data: { taskId: "t1", action: "done" }, updatedAt: NOW.toISOString() });
    const out = await t.step(yes);
    expect(body(out[0])).toBe(UPDATE_MSG.broken);
    expect((await t.store.getTask("t1"))?.status).toBe("pending");
  });

  it("start() only explains how to use it", async () => {
    const t = setup();
    expect(body((await voiceUpdateFlow.start(t.ctx()))[0])).toBe(UPDATE_MSG.start);
  });
});

describe("create notes still go to the create flow", () => {
  for (const intent of ["create", null, undefined] as const) {
    it(`intent ${String(intent)} -> the old voice_task confirmation`, async () => {
      const t = setup({ result: ok({ intent, action: null, taskWords: [], title: "Naya kaam", person: "Pinky", date: "2026-10-27" }) });
      const out = await t.send();
      expect(ids(out[0])).toEqual(["voice_task:confirm:yes", "voice_task:confirm:edit", "voice_task:confirm:no"]);
      expect((await t.session())?.flow).toBe("voice_task");
    });
  }
});

describe("timeouts", () => {
  it("typing steps get 5 minutes, tap steps 2", () => {
    for (const step of ["ask_remark", "ask_custom_date"]) expect(sessionTtlMinutes({ flow: F, step })).toBe(5);
    for (const step of ["pick_task", "pick_action", "pick_person", "pick_branch", "pick_user", "ask_due", "confirm"]) {
      expect(sessionTtlMinutes({ flow: F, step })).toBe(2);
    }
  });

  it("a confirm older than 2 minutes expired; a typed remark step lasts 4 minutes", async () => {
    const t = setup({ result: ok({ action: "remark" }) });
    await toConfirm(t); // at ask_remark
    t.setNow(new Date(NOW.getTime() + 4 * 60_000));
    const typed = await t.route(say("likh do"));
    expect(ids(typed[0])).toEqual(CONFIRM_IDS);
    t.setNow(new Date(NOW.getTime() + 7 * 60_000)); // 3 minutes after the confirm
    const late = await t.route(yes);
    expect(body(late[0])).toContain("Session expire");
    expect((await t.store.getTask("t1"))!.remarks).toHaveLength(0);
  });
});

describe("a voice note while another voice flow is open", () => {
  it("replaces an open voice_update chat (not busy)", async () => {
    const t = setup();
    await t.send();
    expect((await t.session())?.flow).toBe(F);
    await t.route({ text: "", reply: null, voice: { mediaUrl: "u" } });
    expect(t.voice.understand).toHaveBeenCalledTimes(2);
  });
});
