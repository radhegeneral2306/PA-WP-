// Router handling of submitted WhatsApp Forms. handleTaskForm is mocked: its behaviour is tested
// in test/flows/createTaskForm.test.ts; here we only check the hand-off.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/bot/flows/createTaskForm", () => ({
  taskFormFlow: { id: "task_form", start: vi.fn(async () => []), handle: vi.fn(async () => []) },
  handleTaskForm: vi.fn(async (ctx: any) => [{ to: ctx.user.phone, kind: "text", body: "FORM_HANDLED" }]),
}));

import { FORM_TESTERS, FORMS_LIVE, handleMessage } from "../src/bot/router";
import { handleTaskForm } from "../src/bot/flows/createTaskForm";
import { MemoryStore } from "../src/data/memoryStore";
import { ADMIN, ADMIN2, STAFF_DURG, USERS, makeCtx, tap } from "./helpers/bot";

const answers = { flow_token: "tok-1", title: "Stock check" };
const formInput = (form: Record<string, unknown> = answers) => ({ text: "", reply: null, form });
const rowIds = (out: any) => out.rows.map((r: { id: string }) => r.id);

beforeEach(() => {
  vi.mocked(handleTaskForm).mockClear();
});

describe("router: submitted forms", () => {
  it("hands the answers to handleTaskForm and returns its messages", async () => {
    const ctx = makeCtx(STAFF_DURG);
    const outs = await handleMessage(ctx, formInput());
    expect(outs).toEqual([{ to: STAFF_DURG.phone, kind: "text", body: "FORM_HANDLED" }]);
    expect(handleTaskForm).toHaveBeenCalledTimes(1);
    expect(handleTaskForm).toHaveBeenCalledWith(ctx, answers);
  });

  it("clears an open session before handing over", async () => {
    const store = new MemoryStore({ users: USERS });
    await handleMessage(makeCtx(ADMIN, store), tap("MENU:create_task"));
    expect((await store.getSession(ADMIN.phone))?.flow).toBe("create_task");

    let sessionSeenByHandler: unknown = "not called";
    vi.mocked(handleTaskForm).mockImplementationOnce(async (ctx) => {
      sessionSeenByHandler = await ctx.store.getSession(ctx.user.phone);
      return [];
    });
    await handleMessage(makeCtx(ADMIN, store), formInput());
    expect(sessionSeenByHandler).toBeNull();
    expect(await store.getSession(ADMIN.phone)).toBeNull();
  });

  it("wins over greeting/menu handling even if text is set", async () => {
    const outs = await handleMessage(makeCtx(ADMIN), { text: "Hi", reply: null, form: answers });
    expect(handleTaskForm).toHaveBeenCalledTimes(1);
    expect(outs[0]).toMatchObject({ body: "FORM_HANDLED" });
  });

  it("does not call handleTaskForm for ordinary messages", async () => {
    await handleMessage(makeCtx(ADMIN), { text: "Hi", reply: null, form: null });
    await handleMessage(makeCtx(ADMIN), { text: "Hi", reply: null });
    expect(handleTaskForm).not.toHaveBeenCalled();
  });
});

describe("router: form menu entry (FORMS_LIVE, everyone since 27 Oct)", () => {
  it("is switched on", () => {
    expect(FORMS_LIVE).toBe(true);
  });

  it.each([ADMIN, ADMIN2, STAFF_DURG])("menu for %s has 'Naya task (Form)'", async (user) => {
    const [menu] = await handleMessage(makeCtx(user), { text: "Hi", reply: null });
    expect(rowIds(menu)).toContain("MENU:create_task_form");
    expect(JSON.stringify(menu)).toContain("Naya task (Form)");
  });

  it("a tap starts the form flow for any user", async () => {
    const { taskFormFlow } = await import("../src/bot/flows/createTaskForm");
    await handleMessage(makeCtx(STAFF_DURG), tap("MENU:create_task_form"));
    expect(taskFormFlow.start).toHaveBeenCalled();
    expect(FORM_TESTERS.size).toBeGreaterThan(0);
  });
});
