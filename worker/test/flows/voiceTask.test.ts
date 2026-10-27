import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import type { User } from "../../src/domain/types";
import type { BotContext, Inbound } from "../../src/bot/flow";
import type { Outgoing } from "../../src/bot/outgoing";
import { handleVoice, voiceTaskFlow, VOICE_MSG } from "../../src/bot/flows/voiceTask";
import { handleMessage } from "../../src/bot/router";
import type { VoiceDraft, VoiceFailure, VoiceResult, VoiceService } from "../../src/voice/types";
import { ADMIN, INACTIVE, NOW, STAFF_DURG, STAFF_RAIPUR, USERS, say, tap } from "../helpers/bot";

const F = "voice_task";
const created = "2026-10-01T00:00:00.000Z";
const staff = (phone: string, name: string, branch: User["branch"]): User => ({ phone, name, role: "staff", branch, active: true, createdAt: created });

const PINKY = staff("919000000021", "Pinky", "RAIPUR");
const HARSH = staff("919000000022", "Harsh", "DURG");
const BHARTI = staff("919000000023", "Bharti", "OFFICE");
const ISHA = staff("919000000024", "Isha", "JAGDALPUR");
const RESHMI = staff("919000000025", "Reshmi", "OFFICE");
const GOPESHWARI = staff("919000000026", "Gopeshwari", "HARDWARE");
const EXTRA = [PINKY, HARSH, BHARTI, ISHA, RESHMI, GOPESHWARI];

// 27 Oct (kal) in IST, as UTC instants.
const KAL_10AM = "2026-10-27T04:30:00.000Z";
const KAL_5PM = "2026-10-27T11:30:00.000Z";
const KAL_12PM = "2026-10-27T06:30:00.000Z";

function draft(over: Partial<VoiceDraft> = {}): VoiceDraft {
  return { transcript: "test", title: "Test task", person: null, personHeard: null, date: "2026-10-27", time: null, repeat: null, ...over };
}

type FakeVoice = VoiceService & { understand: ReturnType<typeof vi.fn<VoiceService["understand"]>> };

function fakeVoice(result: VoiceResult | (() => Promise<VoiceResult>)): FakeVoice {
  return { understand: vi.fn<VoiceService["understand"]>(typeof result === "function" ? result : async () => result) };
}

function setup(opts: { user?: User; result?: VoiceResult; users?: User[]; voice?: FakeVoice | null } = {}) {
  const user = opts.user ?? ADMIN;
  const store = new MemoryStore({ users: opts.users ?? [...USERS, ...EXTRA] });
  const voice = opts.voice === null ? undefined : opts.voice ?? fakeVoice(opts.result ?? { ok: true, draft: draft(), durationSec: 5 });
  const ctx: BotContext = { store, user, now: NOW, voice };
  const step = async (input: Inbound): Promise<Outgoing[]> => {
    const session = await store.getSession(user.phone);
    if (!session) throw new Error("no session");
    return voiceTaskFlow.handle(ctx, session, input);
  };
  const session = () => store.getSession(user.phone);
  const send = () => handleVoice(ctx, "https://media.example/voice.ogg");
  return { ctx, store, step, session, send, voice };
}

const ok = (over: Partial<VoiceDraft> = {}): VoiceResult => ({ ok: true, draft: draft(over), durationSec: 8 });

function body(o: Outgoing): string {
  return o.kind === "template" ? o.fallbackText : o.body;
}

function ids(o: Outgoing): string[] {
  if (o.kind === "list") return o.rows.map((r) => r.id);
  if (o.kind === "buttons") return o.buttons.map((b) => b.id);
  return [];
}

const CONFIRM_IDS = [`${F}:confirm:yes`, `${F}:confirm:edit`, `${F}:confirm:no`];

describe("handleVoice failures", () => {
  const cases: [VoiceFailure, string, boolean][] = [
    ["too_long", VOICE_MSG.tooLong, false],
    ["not_configured", VOICE_MSG.off, false],
    ["limit", VOICE_MSG.off, true],
    ["not_understood", VOICE_MSG.notUnderstood, false],
    ["download", VOICE_MSG.notUnderstood, true],
    ["failed", VOICE_MSG.notUnderstood, true],
  ];
  for (const [reason, msg, health] of cases) {
    it(`${reason} -> one text${health ? " + health problem" : ""}`, async () => {
      const t = setup({ result: { ok: false, reason } });
      const out = await t.send();
      expect(out).toEqual([{ to: ADMIN.phone, kind: "text", body: msg }]);
      expect(await t.session()).toBeNull();
      const h = await t.store.getHealth();
      if (health) {
        expect(h?.errors).toBe(1);
        expect(h?.lastProblem).toBe(`voice ${reason}`);
      } else expect(h).toBeNull();
    });
  }

  it("exact brief wording", () => {
    expect(VOICE_MSG.tooLong).toBe("Voice note bahut lamba hai. 1 minute ke andar bhejiye.");
    expect(VOICE_MSG.off).toBe("Voice se task abhi band hai. Form ya 'Naya task' use kijiye.");
    expect(VOICE_MSG.notUnderstood).toBe("Samajh nahi aaya. Dobara bhejiye ya form se task banaiye.");
  });

  it("no voice service in ctx = not configured", async () => {
    const t = setup({ voice: null });
    expect(body((await t.send())[0])).toBe(VOICE_MSG.off);
  });

  it("service throwing counts as failed", async () => {
    const t = setup({ voice: fakeVoice(async () => { throw new Error("boom"); }) });
    expect(body((await t.send())[0])).toBe(VOICE_MSG.notUnderstood);
    expect((await t.store.getHealth())?.lastProblem).toBe("voice failed");
  });

  it("non-admin is rejected without calling the service", async () => {
    const t = setup({ user: STAFF_DURG });
    const out = await t.send();
    expect(body(out[0])).toBe(VOICE_MSG.adminsOnly);
    expect(t.voice!.understand).not.toHaveBeenCalled();
    expect(await t.session()).toBeNull();
  });

  it("passes now and active people with labels to the service", async () => {
    const t = setup();
    await t.send();
    const [url, arg] = t.voice!.understand.mock.calls[0];
    expect(url).toBe("https://media.example/voice.ogg");
    expect(arg.now).toBe(NOW);
    expect(arg.people).toContainEqual({ name: "Bhaskar", label: "Admin" });
    expect(arg.people).toContainEqual({ name: "Chikku", label: "Raipur" });
    expect(arg.people.find((p) => p.name === INACTIVE.name)).toBeUndefined();
  });
});

describe("brief example sentences", () => {
  it("#1 Pinky kal 5 baje -> confirmation, Haan creates the voice task", async () => {
    const transcript = "Pinky ko bolo kal shaam paanch baje Sharma ji ka payment ka follow up lena hai";
    const t = setup({ result: ok({ transcript, title: "Sharma ji ka payment ka follow up", person: "Pinky", personHeard: "Pinky", time: "17:00" }) });
    const out = await t.send();
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("buttons");
    expect(ids(out[0])).toEqual(CONFIRM_IDS);
    expect(body(out[0])).toBe(
      `Maine suna: "${transcript}"\n\nTask: Sharma ji ka payment ka follow up\nKisko: Pinky (Raipur)\nKab: 27 Oct, 5:00 PM\nRepeat: Ek baar\n\nYe task banau?`,
    );
    expect((await t.session())?.step).toBe("confirm");

    const done = await t.step(tap(`${F}:confirm:yes`, "Haan ✅"));
    expect(body(done[0])).toContain(VOICE_MSG.created);
    expect(body(done[0])).toContain("Pinky (Raipur)");
    expect(body(done[0])).toContain("27 Oct, 5:00 PM");
    expect(done[1]).toMatchObject({ to: PINKY.phone, kind: "template", template: "task_assigned_v1" });
    expect(await t.session()).toBeNull();

    const [task] = await t.store.listTasks({ assigneePhone: PINKY.phone });
    expect(task).toMatchObject({
      title: "Sharma ji ka payment ka follow up",
      source: "voice",
      dueAt: KAL_5PM,
      dueHasTime: true,
      repeat: "none",
      createdByPhone: ADMIN.phone,
      branch: "RAIPUR",
    });
    expect(task.remarks).toHaveLength(1);
    expect(task.remarks[0].text).toBe(`Voice se banaya. Maine suna: "${transcript}"`);
  });

  it("#2 Chikku kal 12 baje", async () => {
    const t = setup({ result: ok({ transcript: "Chiku ko bolo kal barah baje PC ko format kar dega", title: "PC format karna", person: "Chikku", personHeard: "Chiku", time: "12:00" }) });
    const out = await t.send();
    expect(body(out[0])).toContain("Kisko: Chikku (Raipur)\nKab: 27 Oct, 12:00 PM");
    await t.step(tap(`${F}:confirm:yes`));
    const [task] = await t.store.listTasks({ assigneePhone: STAFF_RAIPUR.phone });
    expect(task.dueAt).toBe(KAL_12PM);
  });

  const simple: [string, string, User, string][] = [
    ["#3", "Harsh ko bolo ki kal stock counting karwa lega aur update dega", HARSH, "Stock counting karwa ke update dena"],
    ["#4", "Bharti ko bolo kal creditor list clear kar degi", BHARTI, "Creditor list clear karna"],
    ["#6", "Reshmi ko bolo kal PagarBook ki saari entries update kar degi", RESHMI, "PagarBook ki saari entries update karna"],
    ["#7", "Gopeshwari ko bolo kal Rajim ki entry kar legi aur fir mujhe update degi", GOPESHWARI, "Rajim ki entry karke update dena"],
  ];
  for (const [n, transcript, who, title] of simple) {
    it(`${n} ${who.name} kal, no time -> 10 AM default`, async () => {
      const t = setup({ result: ok({ transcript, title, person: who.name, personHeard: who.name }) });
      const out = await t.send();
      expect(body(out[0])).toContain(`Kisko: ${who.name} (`);
      expect(body(out[0])).toContain("Kab: 27 Oct\n");
      await t.step(tap(`${F}:confirm:yes`));
      const [task] = await t.store.listTasks({ assigneePhone: who.phone });
      expect(task).toMatchObject({ title, dueAt: KAL_10AM, dueHasTime: false, repeat: "none", source: "voice" });
    });
  }

  it("#5 Isha, no date -> date question, then Kal -> confirmation", async () => {
    const t = setup({ result: ok({ transcript: "Isha ko bolo Durg ka task complete hone ke baad Jagdalpur ka karegi", title: "Durg ke baad Jagdalpur ka task", person: "Isha", personHeard: "Isha", date: null }) });
    const out = await t.send();
    expect(body(out[0])).toBe(VOICE_MSG.dateMissing);
    expect(VOICE_MSG.dateMissing).toBe("Date nahi suni. Ye task kab tak ka hai?");
    expect(ids(out[0])).toEqual([`${F}:due:today`, `${F}:due:tomorrow`, `${F}:due:custom`]);
    expect((await t.session())?.step).toBe("ask_date");

    const conf = await t.step(tap(`${F}:due:tomorrow`, "Kal"));
    expect(ids(conf[0])).toEqual(CONFIRM_IDS);
    expect(body(conf[0])).toContain("Kab: 27 Oct\n");
  });

  it("#8 Bharti har 90 min -> repeat every90", async () => {
    const t = setup({ result: ok({ transcript: "Bharti ko bolo kal wallmark ka hisab mila legi aur fir mujhe update degi, har ninety minutes mein ise remind karna", title: "Wallmark ka hisab milake update dena", person: "Bharti", personHeard: "Bharti", repeat: "every90" }) });
    const out = await t.send();
    expect(body(out[0])).toContain("Repeat: Har 90 min");
    const done = await t.step(tap(`${F}:confirm:yes`));
    expect(body(done[0])).toContain("Har 90 min");
    const [task] = await t.store.listTasks({ assigneePhone: BHARTI.phone });
    expect(task.repeat).toBe("every90");
  });
});

describe("confirmation", () => {
  it("self task: no template", async () => {
    const t = setup({ result: ok({ person: "bhaskar" }) });
    await t.send();
    const done = await t.step(tap(`${F}:confirm:yes`));
    expect(done).toHaveLength(1);
    expect(body(done[0])).toContain("Aap khud");
  });

  it("Cancel -> nothing created", async () => {
    const t = setup({ result: ok({ person: "Pinky" }) });
    await t.send();
    const out = await t.step(tap(`${F}:confirm:no`, "Cancel ❌"));
    expect(body(out[0])).toBe("Theek hai, task nahi banaya.");
    expect(await t.session()).toBeNull();
    expect(await t.store.listTasks({})).toHaveLength(0);
  });

  it("unexpected text repeats the confirmation with a hint", async () => {
    const t = setup({ result: ok({ person: "Pinky" }) });
    await t.send();
    const out = await t.step(say("kya?"));
    expect(ids(out[0])).toEqual(CONFIRM_IDS);
    expect(body(out[0])).toMatch(/^Haan, Badlo ya Cancel dabaiye/);
    expect((await t.session())?.step).toBe("confirm");
  });

  it("typed haan works like the button", async () => {
    const t = setup({ result: ok({ person: "Pinky" }) });
    await t.send();
    await t.step(say("Haan"));
    expect(await t.store.listTasks({})).toHaveLength(1);
  });

  it("long transcript is clipped so the body stays under 1024", async () => {
    const t = setup({ result: ok({ person: "Pinky", transcript: "bahut lamba ".repeat(200) }) });
    const out = await t.send();
    expect(body(out[0]).length).toBeLessThanOrEqual(1024);
    expect(body(out[0])).toContain("…\"");
    const again = await t.step(say("??"));
    expect(body(again[0]).length).toBeLessThanOrEqual(1024);
  });

  it("button titles fit WhatsApp limits", async () => {
    const t = setup({ result: ok({ person: "Pinky" }) });
    const out = await t.send();
    if (out[0].kind !== "buttons") throw new Error("expected buttons");
    for (const b of out[0].buttons) expect(b.title.length).toBeLessThanOrEqual(20);
  });

  it("assignee deactivated before Haan -> asks the person again", async () => {
    const t = setup({ result: ok({ person: "Pinky" }) });
    await t.send();
    await t.store.saveUser({ ...PINKY, active: false });
    const out = await t.step(tap(`${F}:confirm:yes`));
    expect(body(out[0])).toBe("Pinky ab active nahi hai. Kisko dena hai?");
    expect(out[0].kind).toBe("list");
    expect((await t.session())?.step).toBe("pick_branch");
    expect(await t.store.listTasks({})).toHaveLength(0);
  });

  it("due time passed while on confirm -> asks for the time/date again", async () => {
    const t = setup({ result: ok({ person: "Pinky", date: "2026-10-26", time: "15:30" }) });
    const out0 = await t.send();
    expect(ids(out0[0])).toEqual(CONFIRM_IDS);
    const later: BotContext = { ...t.ctx, now: new Date("2026-10-26T10:15:00Z") }; // 15:45 IST
    const s = await t.session();
    const out = await voiceTaskFlow.handle(later, s!, tap(`${F}:confirm:yes`));
    expect(body(out[0])).toContain("nikal chuka hai");
    expect(await t.store.listTasks({})).toHaveLength(0);
  });
});

describe("Badlo", () => {
  async function toEdit(field: string, over: Partial<VoiceDraft> = {}) {
    const t = setup({ result: ok({ person: "Pinky", title: "Purana task", ...over }) });
    await t.send();
    const menu = await t.step(tap(`${F}:confirm:edit`, "Badlo ✏️"));
    expect(body(menu[0])).toBe("Kya badalna hai?");
    expect(ids(menu[0])).toEqual(["title", "person", "date", "time", "repeat"].map((f) => `${F}:edit:${f}`));
    const q = await t.step(tap(`${F}:edit:${field}`));
    return { t, q };
  }

  it("Task", async () => {
    const { t, q } = await toEdit("title");
    expect(body(q[0])).toContain("Abhi: *Purana task*");
    const conf = await t.step(say("Naya task text"));
    expect(body(conf[0])).toContain("Task: Naya task text");
    await t.step(tap(`${F}:confirm:yes`));
    expect((await t.store.listTasks({}))[0].title).toBe("Naya task text");
  });

  it("Kisko via branch -> person", async () => {
    const { t, q } = await toEdit("person");
    expect(ids(q[0])).toContain(`${F}:branch:DURG`);
    const users = await t.step(tap(`${F}:branch:DURG`));
    expect(ids(users[0])).toContain(`${F}:user:${HARSH.phone}`);
    const conf = await t.step(tap(`${F}:user:${HARSH.phone}`));
    expect(body(conf[0])).toContain("Kisko: Harsh (Durg)");
  });

  it("Date via typed date", async () => {
    const { t, q } = await toEdit("date");
    expect(ids(q[0])).toEqual([`${F}:due:today`, `${F}:due:tomorrow`, `${F}:due:custom`]);
    const conf = await t.step(say("30/10"));
    expect(body(conf[0])).toContain("Kab: 30 Oct\n");
  });

  it("Date via Doosri date", async () => {
    const { t } = await toEdit("date");
    const p = await t.step(tap(`${F}:due:custom`));
    expect(body(p[0])).toContain("Date likhiye");
    const bad = await t.step(say("kabhi bhi"));
    expect(body(bad[0])).toContain("Date samajh nahi aayi");
    const conf = await t.step(say("29/10 4pm"));
    expect(body(conf[0])).toContain("Kab: 29 Oct, 4:00 PM");
  });

  it("Time typed, then back to 10 baje", async () => {
    const { t, q } = await toEdit("time");
    expect(ids(q[0])).toEqual([`${F}:time:default`, `${F}:edit:date`]);
    const conf = await t.step(say("shaam 6"));
    expect(body(conf[0])).toContain("Kab: 27 Oct, 6:00 PM");
    await t.step(tap(`${F}:confirm:edit`));
    await t.step(tap(`${F}:edit:time`));
    const conf2 = await t.step(tap(`${F}:time:default`, "10 baje"));
    expect(body(conf2[0])).toContain("Kab: 27 Oct\n");
  });

  it("Time not understood", async () => {
    const { t } = await toEdit("time");
    const out = await t.step(say("jaldi"));
    expect(body(out[0])).toContain("Time samajh nahi aaya");
  });

  it("Repeat", async () => {
    const { t, q } = await toEdit("repeat");
    expect(ids(q[0])).toEqual([`${F}:repeat:none`, `${F}:repeat:every90`, `${F}:repeat:monthly`]);
    const conf = await t.step(tap(`${F}:repeat:monthly`));
    expect(body(conf[0])).toContain("Repeat: Har mahine");
    await t.step(tap(`${F}:confirm:yes`));
    expect((await t.store.listTasks({}))[0]).toMatchObject({ repeat: "monthly", repeatDay: 27 });
  });

  it("text on the edit menu repeats the list", async () => {
    const t = setup({ result: ok({ person: "Pinky" }) });
    await t.send();
    await t.step(tap(`${F}:confirm:edit`));
    const out = await t.step(say("hmm"));
    expect(out[0].kind).toBe("list");
    expect(body(out[0])).toContain(VOICE_MSG.tapHint);
  });
});

describe("names", () => {
  it("two people with the same name -> short list, never the sender", async () => {
    const PINKY2 = staff("919000000031", "Pinky Verma", "DURG");
    const t = setup({ users: [...USERS, ...EXTRA, PINKY2], result: ok({ person: null, personHeard: "Pinky" }) });
    const out = await t.send();
    expect(body(out[0])).toBe("Is naam ke do log hain. Kisko dena hai?");
    expect(ids(out[0])).toEqual([`${F}:user:${PINKY.phone}`, `${F}:user:${PINKY2.phone}`, `${F}:other`]);
    expect(ids(out[0])).not.toContain(`${F}:user:${ADMIN.phone}`);
    const bad = await t.step(say("pata nahi"));
    expect(ids(bad[0])).toEqual([`${F}:user:${PINKY.phone}`, `${F}:user:${PINKY2.phone}`, `${F}:other`]);
    const conf = await t.step(tap(`${F}:user:${PINKY2.phone}`));
    expect(body(conf[0])).toContain("Kisko: Pinky Verma (Durg)");
  });

  it("unknown but close name -> not-found list with the close match", async () => {
    const t = setup({ result: ok({ person: null, personHeard: "Chiku" }) });
    const out = await t.send();
    expect(body(out[0])).toBe("Ye naam staff list mein nahi mila. Kisko dena hai?");
    expect(ids(out[0])[0]).toBe(`${F}:user:${STAFF_RAIPUR.phone}`);
    expect(ids(out[0]).at(-1)).toBe(`${F}:other`);
    const branches = await t.step(tap(`${F}:other`));
    expect(ids(branches[0])).toContain(`${F}:branch:ADMINS`);
  });

  it("completely unknown name -> branch picker with the not-found text", async () => {
    const t = setup({ result: ok({ person: null, personHeard: "Zxqw" }) });
    const out = await t.send();
    expect(body(out[0])).toBe(VOICE_MSG.notFound);
    expect(ids(out[0])).toContain(`${F}:branch:RAIPUR`);
    expect((await t.session())?.step).toBe("pick_branch");
  });

  it("no name heard -> branch picker", async () => {
    const t = setup({ result: ok({ person: null, personHeard: null }) });
    const out = await t.send();
    expect(body(out[0])).toBe(VOICE_MSG.noName);
    expect(out[0].kind).toBe("list");
  });

  it("personHeard with one exact match is accepted", async () => {
    const t = setup({ result: ok({ person: null, personHeard: "harsh" }) });
    const out = await t.send();
    expect(body(out[0])).toContain("Kisko: Harsh (Durg)");
  });

  it("service picked a name that is not a real user -> list", async () => {
    const t = setup({ result: ok({ person: "Pinki", personHeard: "Pinki" }) });
    const out = await t.send();
    expect(body(out[0])).toBe(VOICE_MSG.notFound);
    expect(ids(out[0])).toContain(`${F}:user:${PINKY.phone}`);
  });

  it("inactive person -> says so and asks whom", async () => {
    const t = setup({ result: ok({ person: "Old Staff", personHeard: "Old Staff" }) });
    const out = await t.send();
    expect(body(out[0])).toBe("Old Staff ab active nahi hai. Kisko dena hai?");
    expect(ids(out[0])).not.toContain(`${F}:user:${INACTIVE.phone}`);
  });

  it("after picking the person, missing date is still asked", async () => {
    const t = setup({ result: ok({ person: null, personHeard: "Zxqw", date: null }) });
    await t.send();
    await t.step(tap(`${F}:branch:DURG`));
    const out = await t.step(tap(`${F}:user:${HARSH.phone}`));
    expect(body(out[0])).toBe(VOICE_MSG.dateMissing);
  });
});

describe("missing / bad parts", () => {
  it("title missing -> asks title, then confirmation", async () => {
    const t = setup({ result: ok({ person: "Pinky", title: null }) });
    const out = await t.send();
    expect(body(out[0])).toBe("Task kya hai? Likh ke bhejiye 📝");
    const bad = await t.step(say("   "));
    expect(body(bad[0])).toContain("Task likh ke bhejiye");
    const conf = await t.step(say("Sharma ji ka follow up"));
    expect(body(conf[0])).toContain("Task: Sharma ji ka follow up");
  });

  it("past date -> date asked again", async () => {
    const t = setup({ result: ok({ person: "Pinky", date: "2026-10-20" }) });
    const out = await t.send();
    expect(body(out[0])).toContain("Ye date/time nikal chuka hai");
    expect(ids(out[0])).toEqual([`${F}:due:today`, `${F}:due:tomorrow`, `${F}:due:custom`]);
  });

  it("today without time (10 AM passed) -> asks time; typed time -> confirm", async () => {
    const t = setup({ result: ok({ person: "Pinky", date: "2026-10-26" }) });
    const out = await t.send();
    expect(body(out[0])).toContain("Aaj 10 AM nikal chuka hai");
    expect((await t.session())?.step).toBe("ask_time");
    const conf = await t.step(say("6pm"));
    expect(body(conf[0])).toContain("Kab: 26 Oct, 6:00 PM");
  });

  it("invalid date/time strings from the service are ignored", async () => {
    const t = setup({ result: ok({ person: "Pinky", date: "2026-13-45", time: "99:00" }) });
    const out = await t.send();
    expect(body(out[0])).toBe(VOICE_MSG.dateMissing);
  });

  it("unexpected text on the date question repeats it with a hint", async () => {
    const t = setup({ result: ok({ person: "Pinky", date: null }) });
    await t.send();
    const out = await t.step(say("pata nahi"));
    expect(body(out[0])).toContain("Button dabaiye ya date likhiye");
    expect((await t.session())?.step).toBe("ask_date");
  });
});

describe("through the router", () => {
  const voiceIn = (): Inbound => ({ text: "", reply: null, voice: { mediaUrl: "https://media.example/v.ogg" } });

  it("voice note from Bhaskar -> confirmation, then Haan creates the task", async () => {
    const t = setup({ result: ok({ person: "Pinky", time: "17:00" }) });
    const out = await handleMessage(t.ctx, voiceIn());
    expect(ids(out[0])).toEqual(CONFIRM_IDS);
    expect((await t.session())?.flow).toBe(F);
    const done = await handleMessage(t.ctx, tap(`${F}:confirm:yes`, "Haan ✅"));
    expect(body(done[0])).toContain(VOICE_MSG.created);
    expect((await t.store.listTasks({}))[0].source).toBe("voice");
  });

  it("Cancel button tap reaches the flow (not the router's cancel word)", async () => {
    const t = setup({ result: ok({ person: "Pinky" }) });
    await handleMessage(t.ctx, voiceIn());
    const out = await handleMessage(t.ctx, tap(`${F}:confirm:no`, "Cancel ❌"));
    expect(body(out[0])).toBe(VOICE_MSG.cancelled);
  });

  it("another open flow -> asked to finish it first, no service call", async () => {
    const t = setup({ result: ok({ person: "Pinky" }) });
    await t.store.saveSession({ phone: ADMIN.phone, flow: "create_task", step: "ask_title", data: {}, updatedAt: NOW.toISOString() });
    const out = await handleMessage(t.ctx, voiceIn());
    expect(body(out[0])).toBe("Pehle chal raha kaam pura ya cancel kijiye, phir voice note bhejiye.");
    expect(t.voice!.understand).not.toHaveBeenCalled();
    expect((await t.session())?.flow).toBe("create_task");
  });

  it("a new voice note replaces an open voice draft", async () => {
    const t = setup({ result: ok({ person: "Pinky" }) });
    await handleMessage(t.ctx, voiceIn());
    const out = await handleMessage(t.ctx, voiceIn());
    expect(ids(out[0])).toEqual(CONFIRM_IDS);
    expect(t.voice!.understand).toHaveBeenCalledTimes(2);
  });
});
