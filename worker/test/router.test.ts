import { describe, expect, it } from "vitest";
import { handleMessage } from "../src/bot/router";
import { MemoryStore } from "../src/data/memoryStore";
import { ADMIN, ADMIN2, NOW, STAFF_DURG, USERS, makeCtx, say, tap } from "./helpers/bot";

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
