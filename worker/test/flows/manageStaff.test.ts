import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import type { User } from "../../src/domain/types";
import type { Inbound } from "../../src/bot/flow";
import type { Outgoing } from "../../src/bot/outgoing";
import { manageStaffFlow } from "../../src/bot/flows/manageStaff";
import { normalizePhone } from "../../src/numbers";
import { ADMIN, ADMIN2, INACTIVE, NOW, STAFF_DURG, STAFF_RAIPUR, USERS, makeCtx, say, tap, task } from "../helpers/bot";

const F = "manage_staff";

function setup(user: User, store = new MemoryStore({ users: USERS })) {
  const ctx = makeCtx(user, store);
  const step = async (input: Inbound): Promise<Outgoing[]> => {
    const session = await store.getSession(user.phone);
    if (!session) throw new Error("no session");
    return manageStaffFlow.handle(ctx, session, input);
  };
  const session = () => store.getSession(user.phone);
  return { ctx, store, step, session };
}

function body(o: Outgoing): string {
  return o.kind === "template" ? o.fallbackText : o.body;
}

function ids(o: Outgoing): string[] {
  if (o.kind === "list") return o.rows.map((r) => r.id);
  if (o.kind === "buttons") return o.buttons.map((b) => b.id);
  return [];
}

describe("normalizePhone", () => {
  it("accepts 10 digits and 91-prefixed 12 digits", () => {
    expect(normalizePhone("98765 43210")).toBe("919876543210");
    expect(normalizePhone("+91 98765-43210")).toBe("919876543210");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("449876543210")).toBeNull();
  });
});

describe("manageStaffFlow", () => {
  it("start shows the four actions", async () => {
    const t = setup(ADMIN);
    const out = await manageStaffFlow.start(t.ctx);
    expect(ids(out[0])).toEqual([`${F}:action:add`, `${F}:action:remove`, `${F}:action:list`, `${F}:action:edit`]);
    expect((await t.session())?.step).toBe("choose");
  });

  it("blocks non-admins in start and handle", async () => {
    const t = setup(STAFF_DURG);
    const out = await manageStaffFlow.start(t.ctx);
    expect(body(out[0])).toBe("Ye option sirf admin ke liye hai.");
    expect(await t.session()).toBeNull();

    await t.store.saveSession({ phone: STAFF_DURG.phone, flow: F, step: "choose", data: {}, updatedAt: NOW.toISOString() });
    const out2 = await t.step(tap(`${F}:action:list`));
    expect(body(out2[0])).toBe("Ye option sirf admin ke liye hai.");
    expect(await t.session()).toBeNull();
  });

  it("adds a staff member with branch and sends welcome template", async () => {
    const t = setup(ADMIN);
    await manageStaffFlow.start(t.ctx);
    await t.step(tap(`${F}:action:add`));
    const bad = await t.step(say("A"));
    expect((await t.session())?.step).toBe("add_name");
    expect(body(bad[0])).toContain("2 se 40");
    await t.step(say("Ramesh"));
    const role = await t.step(say("98765 43210"));
    expect(ids(role[0])).toEqual([`${F}:role:staff`, `${F}:role:admin`]);
    const branches = await t.step(tap(`${F}:role:staff`));
    expect(ids(branches[0])).not.toContain(`${F}:branch:ADMINS`);
    const conf = await t.step(tap(`${F}:branch:DURG`));
    expect(body(conf[0])).toContain("Staff (Durg)");
    const out = await t.step(tap(`${F}:confirm:yes`));

    expect(await t.store.getUser("919876543210")).toEqual({
      phone: "919876543210",
      name: "Ramesh",
      role: "staff",
      branch: "DURG",
      active: true,
      createdAt: NOW.toISOString(),
    });
    expect(await t.session()).toBeNull();
    expect(body(out[0])).toContain("✅ *Ramesh* add ho gaya");
    expect(out[1]).toMatchObject({
      to: "919876543210",
      kind: "template",
      template: "welcome_user_v1",
      bodyValues: ["Ramesh", "Bhaskar", "Staff (Durg)"],
    });
    expect(body(out[1])).toContain("*Hi*");
  });

  it("adds an admin with no branch", async () => {
    const t = setup(ADMIN);
    await manageStaffFlow.start(t.ctx);
    await t.step(tap(`${F}:action:add`));
    await t.step(say("Suresh"));
    await t.step(say("919812345678"));
    const conf = await t.step(tap(`${F}:role:admin`));
    expect((await t.session())?.step).toBe("add_confirm");
    expect(body(conf[0])).toContain("Admin");
    const out = await t.step(tap(`${F}:confirm:yes`));
    const saved = await t.store.getUser("919812345678");
    expect(saved).toMatchObject({ role: "admin", branch: null, active: true });
    expect(out[1]).toMatchObject({ kind: "template", bodyValues: ["Suresh", "Bhaskar", "Admin"] });
  });

  it("rejects an active duplicate number and re-activates an inactive one", async () => {
    const t = setup(ADMIN);
    await manageStaffFlow.start(t.ctx);
    await t.step(tap(`${F}:action:add`));
    await t.step(say("Hardware 2"));
    const dup = await t.step(say("9000000011"));
    expect(body(dup[0])).toContain("pehle se *Hardware* ke naam se registered hai");
    expect(await t.session()).toBeNull();

    await manageStaffFlow.start(t.ctx);
    await t.step(tap(`${F}:action:add`));
    await t.step(say("Old Staff"));
    await t.step(say(INACTIVE.phone));
    await t.step(tap(`${F}:role:staff`));
    await t.step(tap(`${F}:branch:RAIPUR`));
    await t.step(tap(`${F}:confirm:yes`));
    expect(await t.store.getUser(INACTIVE.phone)).toMatchObject({ active: true, branch: "RAIPUR" });
  });

  it("re-prompts on a bad number", async () => {
    const t = setup(ADMIN);
    await manageStaffFlow.start(t.ctx);
    await t.step(tap(`${F}:action:add`));
    await t.step(say("Ramesh"));
    const out = await t.step(say("12345"));
    expect(body(out[0])).toContain("sahi nahi");
    expect((await t.session())?.step).toBe("add_phone");
  });

  it("cancel at add confirm saves nothing", async () => {
    const t = setup(ADMIN);
    await manageStaffFlow.start(t.ctx);
    await t.step(tap(`${F}:action:add`));
    await t.step(say("Ramesh"));
    await t.step(say("9876543210"));
    await t.step(tap(`${F}:role:admin`));
    const out = await t.step(tap(`${F}:confirm:no`));
    expect(body(out[0])).toContain("add nahi kiya");
    expect(await t.store.getUser("919876543210")).toBeNull();
  });

  it("removes a staff member after confirm, showing pending count", async () => {
    const store = new MemoryStore({ users: USERS, tasks: [task(), task({ id: "task2", status: "done" })] });
    const t = setup(ADMIN, store);
    await manageStaffFlow.start(t.ctx);
    const br = await t.step(tap(`${F}:action:remove`));
    expect(ids(br[0])).toContain(`${F}:branch:ADMINS`);
    const users = await t.step(tap(`${F}:branch:DURG`));
    expect(ids(users[0])).toEqual([`${F}:user:${STAFF_DURG.phone}`]);
    const conf = await t.step(tap(`${F}:user:${STAFF_DURG.phone}`));
    expect(body(conf[0])).toContain("*Hardware* ko hatana hai?");
    expect(body(conf[0])).toContain("*1* pending");
    const out = await t.step(tap(`${F}:confirm:yes`));
    expect(body(out[0])).toContain("hata diya");
    expect((await t.store.getUser(STAFF_DURG.phone))?.active).toBe(false);
    expect((await t.store.getTask("task1"))?.status).toBe("pending");
    expect(await t.session()).toBeNull();
  });

  it("cannot remove yourself; admins list excludes self", async () => {
    const t = setup(ADMIN);
    await manageStaffFlow.start(t.ctx);
    await t.step(tap(`${F}:action:remove`));
    const list = await t.step(tap(`${F}:branch:ADMINS`));
    expect(ids(list[0])).toEqual([`${F}:user:${ADMIN2.phone}`]);
    const self = await t.step(tap(`${F}:user:${ADMIN.phone}`));
    expect(body(self[0])).toContain("list mein nahi");
    expect((await t.session())?.step).toBe("remove_user");
    expect((await t.store.getUser(ADMIN.phone))?.active).toBe(true);
  });

  it("empty group on remove says so", async () => {
    const t = setup(ADMIN, new MemoryStore({ users: [ADMIN] }));
    await manageStaffFlow.start(t.ctx);
    await t.step(tap(`${F}:action:remove`));
    const out = await t.step(tap(`${F}:branch:ADMINS`));
    expect(body(out[0])).toContain("koi nahi");
    expect((await t.session())?.step).toBe("remove_branch");
  });

  it("pages the remove list", async () => {
    const many: User[] = Array.from({ length: 10 }, (_, i) => ({
      ...STAFF_DURG,
      phone: `9190000002${String(i).padStart(2, "0")}`,
      name: `Staff ${String(i).padStart(2, "0")}`,
    }));
    const t = setup(ADMIN, new MemoryStore({ users: [ADMIN, ...many] }));
    await manageStaffFlow.start(t.ctx);
    await t.step(tap(`${F}:action:remove`));
    const p0 = await t.step(tap(`${F}:branch:DURG`));
    expect(ids(p0[0])).toContain(`${F}:page:1`);
    const p1 = await t.step(tap(`${F}:page:1`));
    expect(ids(p1[0])).toEqual([`${F}:user:${many[8].phone}`, `${F}:user:${many[9].phone}`, `${F}:page:0`]);
  });

  it("lists everyone grouped by branch then admins", async () => {
    const t = setup(ADMIN);
    await manageStaffFlow.start(t.ctx);
    const out = await t.step(tap(`${F}:action:list`));
    const b = body(out[0]);
    expect(b).toContain("kul *5* log");
    expect(b).toContain("*Durg* (1)\n• Hardware (number ending …0011)");
    expect(b).toContain("*Admins* (2)");
    expect(b).not.toContain("Old Staff");
    expect(b.indexOf("*Raipur*")).toBeLessThan(b.indexOf("*Admins*"));
    expect(await t.session()).toBeNull();
  });

  it("wrong input at choose re-shows the menu", async () => {
    const t = setup(ADMIN);
    await manageStaffFlow.start(t.ctx);
    const out = await t.step(say("add"));
    expect(ids(out[0])).toContain(`${F}:action:add`);
    expect((await t.session())?.step).toBe("choose");
  });

  describe("edit", () => {
    async function toField(t: ReturnType<typeof setup>, branch: string, user: User) {
      await manageStaffFlow.start(t.ctx);
      await t.step(tap(`${F}:action:edit`));
      await t.step(tap(`${F}:branch:${branch}`));
      return t.step(tap(`${F}:user:${user.phone}`));
    }

    it("picks a person and shows the field buttons; admins list includes self", async () => {
      const t = setup(ADMIN);
      await manageStaffFlow.start(t.ctx);
      const br = await t.step(tap(`${F}:action:edit`));
      expect(ids(br[0])).toContain(`${F}:branch:ADMINS`);
      expect((await t.session())?.step).toBe("edit_branch");
      const list = await t.step(tap(`${F}:branch:ADMINS`));
      expect(ids(list[0])).toEqual([`${F}:user:${ADMIN.phone}`, `${F}:user:${ADMIN2.phone}`]);
      const fields = await t.step(tap(`${F}:user:${ADMIN.phone}`));
      expect(ids(fields[0])).toEqual([`${F}:field:name`, `${F}:field:branch`, `${F}:field:role`]);
      expect((await t.session())?.step).toBe("edit_field");
    });

    it("renames a staff member, keeping phone, createdAt and active", async () => {
      const t = setup(ADMIN);
      await toField(t, "DURG", STAFF_DURG);
      const ask = await t.step(tap(`${F}:field:name`));
      expect(body(ask[0])).toContain("naya naam");
      const bad = await t.step(say("X"));
      expect(body(bad[0])).toContain("2 se 40");
      expect((await t.session())?.step).toBe("edit_name");
      const conf = await t.step(say("  Hardware Ramesh "));
      expect(body(conf[0])).toContain("Naam: Hardware → *Hardware Ramesh*");
      const out = await t.step(tap(`${F}:confirm:yes`));
      expect(body(out[0])).toContain("✅ Update ho gaya");
      expect(await t.store.getUser(STAFF_DURG.phone)).toEqual({ ...STAFF_DURG, name: "Hardware Ramesh" });
      expect(await t.session()).toBeNull();
    });

    it("admin can rename themselves", async () => {
      const t = setup(ADMIN);
      await toField(t, "ADMINS", ADMIN);
      await t.step(tap(`${F}:field:name`));
      await t.step(say("Bhaskar Ji"));
      await t.step(tap(`${F}:confirm:yes`));
      expect((await t.store.getUser(ADMIN.phone))?.name).toBe("Bhaskar Ji");
    });

    it("changes a staff member's branch", async () => {
      const t = setup(ADMIN);
      await toField(t, "DURG", STAFF_DURG);
      const br = await t.step(tap(`${F}:field:branch`));
      expect(ids(br[0])).not.toContain(`${F}:branch:ADMINS`);
      const same = await t.step(tap(`${F}:branch:DURG`));
      expect(body(same[0])).toContain("pehle se Durg");
      expect((await t.session())?.step).toBe("edit_new_branch");
      const conf = await t.step(tap(`${F}:branch:RAIPUR`));
      expect(body(conf[0])).toContain("Branch: Durg → *Raipur*");
      await t.step(tap(`${F}:confirm:yes`));
      expect(await t.store.getUser(STAFF_DURG.phone)).toEqual({ ...STAFF_DURG, branch: "RAIPUR" });
    });

    it("admin has no branch: says so and re-shows the fields", async () => {
      const t = setup(ADMIN);
      await toField(t, "ADMINS", ADMIN2);
      const out = await t.step(tap(`${F}:field:branch`));
      expect(body(out[0])).toContain("Admin ki branch nahi hoti");
      expect(ids(out[0])).toEqual([`${F}:field:name`, `${F}:field:branch`, `${F}:field:role`]);
      expect((await t.session())?.step).toBe("edit_field");
    });

    it("staff → admin clears the branch", async () => {
      const t = setup(ADMIN);
      await toField(t, "RAIPUR", STAFF_RAIPUR);
      const conf = await t.step(tap(`${F}:field:role`));
      expect((await t.session())?.step).toBe("edit_confirm");
      expect(body(conf[0])).toContain("Role: Staff (Raipur) → *Admin*");
      await t.step(tap(`${F}:confirm:yes`));
      expect(await t.store.getUser(STAFF_RAIPUR.phone)).toEqual({ ...STAFF_RAIPUR, role: "admin", branch: null });
    });

    it("admin → staff asks for the branch first", async () => {
      const t = setup(ADMIN);
      await toField(t, "ADMINS", ADMIN2);
      const br = await t.step(tap(`${F}:field:role`));
      expect(body(br[0])).toContain("staff banenge");
      expect(ids(br[0])).not.toContain(`${F}:branch:ADMINS`);
      expect((await t.session())?.step).toBe("edit_new_branch");
      const conf = await t.step(tap(`${F}:branch:JAGDALPUR`));
      expect(body(conf[0])).toContain("Role: Admin → *Staff (Jagdalpur)*");
      const out = await t.step(tap(`${F}:confirm:yes`));
      expect(body(out[0])).toContain("✅ Update ho gaya");
      expect(await t.store.getUser(ADMIN2.phone)).toEqual({ ...ADMIN2, role: "staff", branch: "JAGDALPUR" });
    });

    it("cannot change your own role", async () => {
      const t = setup(ADMIN);
      await toField(t, "ADMINS", ADMIN);
      const out = await t.step(tap(`${F}:field:role`));
      expect(body(out[0])).toContain("Apna role khud nahi badal sakte");
      expect((await t.session())?.step).toBe("edit_field");
      expect((await t.store.getUser(ADMIN.phone))?.role).toBe("admin");
    });

    it("cannot demote the last active admin", async () => {
      // The acting admin is no longer active in the store, so ADMIN2 is the only active admin.
      const store = new MemoryStore({ users: [{ ...ADMIN, active: false }, ADMIN2, STAFF_DURG] });
      const t = setup(ADMIN, store);
      await toField(t, "ADMINS", ADMIN2);
      const out = await t.step(tap(`${F}:field:role`));
      expect(body(out[0])).toContain("akele admin");
      expect((await t.session())?.step).toBe("edit_field");
      expect((await store.getUser(ADMIN2.phone))?.role).toBe("admin");
    });

    it("re-checks the last-admin rule at confirm", async () => {
      const t = setup(ADMIN);
      await toField(t, "ADMINS", ADMIN2);
      await t.step(tap(`${F}:field:role`));
      await t.step(tap(`${F}:branch:DURG`));
      await t.store.saveUser({ ...ADMIN, active: false });
      const out = await t.step(tap(`${F}:confirm:yes`));
      expect(body(out[0])).toContain("akele admin");
      expect((await t.store.getUser(ADMIN2.phone))?.role).toBe("admin");
    });

    it("cancel at confirm changes nothing", async () => {
      const t = setup(ADMIN);
      await toField(t, "DURG", STAFF_DURG);
      await t.step(tap(`${F}:field:name`));
      await t.step(say("Naya Naam"));
      const junk = await t.step(say("ok"));
      expect(ids(junk[0])).toEqual([`${F}:confirm:yes`, `${F}:confirm:no`]);
      const out = await t.step(tap(`${F}:confirm:no`));
      expect(body(out[0])).toContain("kuch nahi badla");
      expect(await t.store.getUser(STAFF_DURG.phone)).toEqual(STAFF_DURG);
      expect(await t.session()).toBeNull();
    });

    it("wrong input at field re-prompts", async () => {
      const t = setup(ADMIN);
      await toField(t, "DURG", STAFF_DURG);
      const out = await t.step(say("naam"));
      expect(body(out[0])).toContain("chuniye");
      expect((await t.session())?.step).toBe("edit_field");
    });

    it("pages the edit list", async () => {
      const many: User[] = Array.from({ length: 10 }, (_, i) => ({
        ...STAFF_DURG,
        phone: `9190000003${String(i).padStart(2, "0")}`,
        name: `Staff ${String(i).padStart(2, "0")}`,
      }));
      const t = setup(ADMIN, new MemoryStore({ users: [ADMIN, ...many] }));
      await manageStaffFlow.start(t.ctx);
      await t.step(tap(`${F}:action:edit`));
      const p0 = await t.step(tap(`${F}:branch:DURG`));
      expect(ids(p0[0])).toContain(`${F}:page:1`);
      const p1 = await t.step(tap(`${F}:page:1`));
      expect(ids(p1[0])).toEqual([`${F}:user:${many[8].phone}`, `${F}:user:${many[9].phone}`, `${F}:page:0`]);
      const fields = await t.step(tap(`${F}:user:${many[9].phone}`));
      expect(body(fields[0])).toContain("Staff 09");
    });

    it("empty branch on edit says so", async () => {
      const t = setup(ADMIN, new MemoryStore({ users: [ADMIN] }));
      await manageStaffFlow.start(t.ctx);
      await t.step(tap(`${F}:action:edit`));
      const out = await t.step(tap(`${F}:branch:DURG`));
      expect(body(out[0])).toContain("koi nahi");
      expect((await t.session())?.step).toBe("edit_branch");
    });
  });
});
