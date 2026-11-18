import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUSY_FOR_VOICE, EXPIRED, expiredText, handleMessage, normalizeWords, sessionTtlMinutes } from "../src/bot/router";
import { MemoryStore } from "../src/data/memoryStore";
import { ADMIN, ADMIN2, NOW, STAFF_DURG, USERS, makeCtx, say, tap, task } from "./helpers/bot";

const rowIds = (out: any) => out.rows.map((r: { id: string }) => r.id);

describe("router", () => {
  it("shows the admin menu with all six entries (form right after Naya task)", async () => {
    for (const admin of [ADMIN, ADMIN2]) {
      const [menu] = await handleMessage(makeCtx(admin), say("Hi"));
      expect(menu.kind).toBe("list");
      expect(rowIds(menu)).toEqual(["MENU:my_tasks", "MENU:staff_tasks", "MENU:create_task", "MENU:create_task_form", "MENU:approvals", "MENU:manage_staff"]);
    }
  });

  it("opens approvals from the template quick reply, for admins only", async () => {
    const [out] = await handleMessage(makeCtx(ADMIN), say("Approvals dekhein"));
    expect(JSON.stringify(out)).toContain("approval pending nahi");
    const [denied] = await handleMessage(makeCtx(STAFF_DURG), say("Approvals dekhein"));
    expect(JSON.stringify(denied)).toContain("available nahi");
  });

  it("shows staff only their three entries", async () => {
    const [menu] = await handleMessage(makeCtx(STAFF_DURG), say("hello"));
    // Three entries fit in plain buttons: one tap instead of "Menu kholo" + pick.
    expect(menu.kind).toBe("buttons");
    if (menu.kind !== "buttons") return;
    expect(menu.buttons.map((b) => b.id)).toEqual(["MENU:my_tasks", "MENU:create_task", "MENU:create_task_form"]);
    expect(menu.buttons.every((b) => [...b.title].length <= 20)).toBe(true);
  });

  it("refuses admin-only entries for staff", async () => {
    const store = new MemoryStore({ users: USERS });
    const [out] = await handleMessage(makeCtx(STAFF_DURG, store), tap("MENU:manage_staff"));
    expect(JSON.stringify(out)).toContain("available nahi");
    expect(await store.getSession(STAFF_DURG.phone)).toBeNull();
  });

  it("starts a flow from the menu and routes the next message to it", async () => {
    const store = new MemoryStore({ users: USERS });
    await handleMessage(makeCtx(ADMIN, store), tap("MENU:create_task"));
    expect((await store.getSession(ADMIN.phone))?.flow).toBe("create_task");
    await handleMessage(makeCtx(ADMIN, store), tap("create_task:branch:DURG"));
    expect((await store.getSession(ADMIN.phone))?.step).toBe("pick_user");
  });

  it("treats taps from another flow as stale", async () => {
    const store = new MemoryStore({ users: USERS });
    await handleMessage(makeCtx(ADMIN, store), tap("MENU:create_task"));
    const [out] = await handleMessage(makeCtx(ADMIN, store), tap("tasks:task:t1"));
    expect(JSON.stringify(out)).toContain("purana");
    expect((await store.getSession(ADMIN.phone))?.flow).toBe("create_task");
  });

  it("drops expired sessions", async () => {
    const store = new MemoryStore({ users: USERS });
    await store.saveSession({ phone: ADMIN.phone, flow: "create_task", step: "ask_title", data: {}, updatedAt: "2026-10-26T08:00:00.000Z" });
    const [out] = await handleMessage(makeCtx(ADMIN, store, NOW), say("Sharma ji payment"));
    // ask_title is a typing step: 5 minutes, and the message says so.
    expect(out).toEqual({ to: ADMIN.phone, kind: "text", body: expiredText(5) });
    expect(EXPIRED).toContain("*Hi*");
    expect(EXPIRED).toContain("2 minute");
    expect(await store.getSession(ADMIN.phone)).toBeNull();
  });

  it("expires a chat after 2 quiet minutes, counted from the user's last message", async () => {
    const store = new MemoryStore({ users: USERS });
    const at = (sec: number) => new Date(NOW.getTime() + sec * 1000);
    await handleMessage(makeCtx(STAFF_DURG, store, NOW), tap("MENU:create_task"));
    // A wrong input only re-prompts, but still keeps the chat alive.
    await handleMessage(makeCtx(STAFF_DURG, store, at(100)), tap("create_task:due:today"));
    await handleMessage(makeCtx(STAFF_DURG, store, at(200)), say("Bank jana"));
    expect((await store.getSession(STAFF_DURG.phone))?.step).toBe("ask_due");
    const [late] = await handleMessage(makeCtx(STAFF_DURG, store, at(200 + 121)), tap("create_task:quick:tom10"));
    expect(late).toMatchObject({ kind: "text", body: EXPIRED });
    expect(await store.getSession(STAFF_DURG.phone)).toBeNull();
  });

  it("typing steps get 5 minutes, tap steps 2 (F15)", async () => {
    const store = new MemoryStore({ users: USERS });
    const at = (sec: number) => new Date(NOW.getTime() + sec * 1000);
    await handleMessage(makeCtx(STAFF_DURG, store, NOW), tap("MENU:create_task")); // ask_title (typing)
    const typed = await handleMessage(makeCtx(STAFF_DURG, store, at(4 * 60)), say("Bank jana"));
    expect((await store.getSession(STAFF_DURG.phone))?.step).toBe("ask_due");
    expect(typed[0].kind).toBe("list");
    // ask_due is a tap step: 2 minutes.
    const [late] = await handleMessage(makeCtx(STAFF_DURG, store, at(4 * 60 + 121)), tap("create_task:quick:tom10"));
    expect(late).toMatchObject({ kind: "text", body: expiredText(2) });
  });

  it("a tap from a chat that already ended says expired; typed text with no chat gets the menu", async () => {
    const store = new MemoryStore({ users: USERS });
    const [tapOut] = await handleMessage(makeCtx(STAFF_DURG, store), tap("create_task:quick:tom10"));
    expect(tapOut).toMatchObject({ kind: "text", body: EXPIRED });
    const [typed] = await handleMessage(makeCtx(STAFF_DURG, store), say("kuch bhi"));
    expect(typed.kind).toBe("buttons");
  });

  it("cancels with a cancel word", async () => {
    const store = new MemoryStore({ users: USERS });
    await handleMessage(makeCtx(ADMIN, store), tap("MENU:create_task"));
    const [out] = await handleMessage(makeCtx(ADMIN, store), say("cancel"));
    expect(JSON.stringify(out)).toContain("cancel");
    expect(await store.getSession(ADMIN.phone)).toBeNull();
  });

  it("handles template quick replies sent as plain text", async () => {
    const [menu] = await handleMessage(makeCtx(ADMIN), say("Menu"));
    expect(menu.kind).toBe("list");
    const out = await handleMessage(makeCtx(STAFF_DURG), say("Mere tasks"));
    expect(JSON.stringify(out)).toMatch(/pending task/i);
  });

  it("normalizes greetings: punctuation, emoji, spaces and a trailing ji", () => {
    expect(normalizeWords("  Hi! 🙏 ")).toBe("hi");
    expect(normalizeWords("Band   karo!!")).toBe("band karo");
    expect(normalizeWords("Hello ji ❤️")).toBe("hello ji");
  });

  for (const greeting of ["Hi!", "hi 🙏", "hii.", "Hello ji", "Hello.", "menu!", "  NAMASTE  "]) {
    it(`"${greeting}" in the middle of a wizard shows the menu, not a task title`, async () => {
      const store = new MemoryStore({ users: USERS });
      await handleMessage(makeCtx(ADMIN, store), tap("MENU:create_task"));
      await handleMessage(makeCtx(ADMIN, store), tap("create_task:branch:DURG"));
      const [menu] = await handleMessage(makeCtx(ADMIN, store), say(greeting));
      expect(menu.kind).toBe("list");
      expect(await store.getSession(ADMIN.phone)).toBeNull();
    });
  }

  for (const title of ["Hisab karna", "Menu card print", "Hi-fi speaker lana", "Start karo machine", "Ji hi"]) {
    it(`a real task title "${title}" is not taken as a greeting`, async () => {
      const store = new MemoryStore({ users: USERS });
      await handleMessage(makeCtx(STAFF_DURG, store), tap("MENU:create_task"));
      expect((await store.getSession(STAFF_DURG.phone))?.step).toBe("ask_title");
      await handleMessage(makeCtx(STAFF_DURG, store), say(title));
      const session = await store.getSession(STAFF_DURG.phone);
      expect(session?.step).toBe("ask_due");
      expect(session?.data.title).toBe(title);
    });
  }

  it("still accepts typed cancel words, with punctuation too", async () => {
    for (const word of ["band karo", "Band karo!", "cancel.", "Stop"]) {
      const store = new MemoryStore({ users: USERS });
      await handleMessage(makeCtx(ADMIN, store), tap("MENU:create_task"));
      const [out] = await handleMessage(makeCtx(ADMIN, store), say(word));
      expect(out).toMatchObject({ kind: "text", body: "Theek hai, cancel kar diya. Menu ke liye *Hi* bhejiye." });
      expect(await store.getSession(ADMIN.phone)).toBeNull();
    }
  });

  it("typed Mere tasks inside a wizard closes it and shows the task list", async () => {
    const store = new MemoryStore({ users: USERS });
    await handleMessage(makeCtx(STAFF_DURG, store), tap("MENU:create_task"));
    const out = await handleMessage(makeCtx(STAFF_DURG, store), say("Mere tasks!"));
    expect(JSON.stringify(out)).toMatch(/pending task/i);
    expect((await store.getSession(STAFF_DURG.phone))?.flow).not.toBe("create_task");
  });

  it("never tells the user to type cancel (Interakt goodbye automation)", () => {
    expect(BUSY_FOR_VOICE).toBe("Pehle chal raha kaam pura kijiye ya *band karo* likhiye, phir voice note bhejiye.");
    expect(BUSY_FOR_VOICE).not.toMatch(/cancel|stop/i);
  });
});

describe("router: voice notes (Round 4)", () => {
  const voice = { text: "", reply: null, voice: { mediaUrl: "https://media.example/v.ogg" } };
  const withVoice = (user: typeof ADMIN, store: MemoryStore, understand: ReturnType<typeof fail>) => ({
    ...makeCtx(user, store),
    voice: { understand } as any,
  });
  const fail = () => vi.fn<(url: string, c: any) => Promise<any>>(async () => ({ ok: false, reason: "not_understood" }));

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("another open flow (create_task) is busy for voice, as before", async () => {
    const store = new MemoryStore({ users: USERS });
    await handleMessage(makeCtx(ADMIN, store), tap("MENU:create_task"));
    const understand = fail();
    const [out] = await handleMessage(withVoice(ADMIN, store, understand), voice);
    expect(out).toMatchObject({ kind: "text", body: BUSY_FOR_VOICE });
    expect(understand).not.toHaveBeenCalled();
    expect((await store.getSession(ADMIN.phone))?.flow).toBe("create_task");
  });

  it("an open task detail is context: the session survives a note that was not understood", async () => {
    const store = new MemoryStore({ users: USERS, tasks: [task()] });
    await store.saveSession({ phone: ADMIN.phone, flow: "tasks", step: "detail", data: { taskId: "task1" }, updatedAt: NOW.toISOString() });
    const understand = fail();
    const [out] = await handleMessage(withVoice(ADMIN, store, understand), voice);
    expect(out).toMatchObject({ kind: "text" });
    expect(understand.mock.calls[0][1].task).toEqual({ title: "Sharma ji se payment lena", assignee: "Hardware" });
    expect(await store.getSession(ADMIN.phone)).toMatchObject({ flow: "tasks", step: "detail", data: { taskId: "task1" } });
  });

  it("voice_update replies are routed to the flow; a stale id from another flow gets the old-option text", async () => {
    const store = new MemoryStore({ users: USERS, tasks: [task()] });
    await store.saveSession({ phone: ADMIN.phone, flow: "voice_update", step: "confirm", data: { taskId: "task1", action: "done" }, updatedAt: NOW.toISOString() });
    const [out] = await handleMessage(makeCtx(ADMIN, store), tap("tasks:page:1"));
    expect(JSON.stringify(out)).toContain("purana");
  });

  it("typing steps of voice_update last 5 minutes", () => {
    expect(sessionTtlMinutes({ flow: "voice_update", step: "ask_remark" })).toBe(5);
    expect(sessionTtlMinutes({ flow: "voice_update", step: "ask_custom_date" })).toBe(5);
    expect(sessionTtlMinutes({ flow: "voice_update", step: "confirm" })).toBe(2);
  });
});
