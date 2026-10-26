import { describe, expect, it } from "vitest";
import { handleMessage } from "../src/bot/router";
import { MemoryStore } from "../src/data/memoryStore";
import { ADMIN, NOW, STAFF_DURG, USERS, makeCtx, say, tap } from "./helpers/bot";

const rowIds = (out: any) => out.rows.map((r: { id: string }) => r.id);

describe("router", () => {
  it("shows the admin menu with all four entries", async () => {
    const [menu] = await handleMessage(makeCtx(ADMIN), say("Hi"));
    expect(menu.kind).toBe("list");
    expect(rowIds(menu)).toEqual(["MENU:my_tasks", "MENU:staff_tasks", "MENU:create_task", "MENU:manage_staff"]);
  });

  it("shows staff only their two entries", async () => {
    const [menu] = await handleMessage(makeCtx(STAFF_DURG), say("hello"));
    expect(rowIds(menu)).toEqual(["MENU:my_tasks", "MENU:create_task"]);
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
    expect(out.kind).toBe("list");
    expect(await store.getSession(ADMIN.phone)).toBeNull();
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
});
