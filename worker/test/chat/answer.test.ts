import { describe, expect, it } from "vitest";
import { answerQuery, STAFF_REFUSAL } from "../../src/chat/answer";
import { MemoryStore } from "../../src/data/memoryStore";
import type { Store } from "../../src/data/store";
import type { Task, User } from "../../src/domain/types";
import type { ChatFilter } from "../../src/chat/types";

// Wed 2026-10-28 15:00 IST. Week = Mon 26 Oct .. Sun 1 Nov.
const NOW = new Date("2026-10-28T09:30:00Z");
const created = "2026-10-01T00:00:00.000Z";
const user = (phone: string, name: string, role: "admin" | "staff", branch: User["branch"]): User => ({ phone, name, role, branch, active: true, createdAt: created });
const BHASKAR = user("919000000001", "Bhaskar", "admin", null);
const PINKY = user("919000000011", "Pinky", "staff", "DURG");
const RAMESH = user("919000000012", "Ramesh", "staff", "RAIPUR");
const GONE = { ...user("919000000013", "Gone", "staff", "DURG"), active: false };
const USERS = [BHASKAR, PINKY, RAMESH, GONE];

/** IST wall-clock to ISO. */
const ist = (day: string, hm = "10:00") => new Date(`${day}T${hm}:00+05:30`).toISOString();
let n = 0;
function task(o: Partial<Task> & { due: string }): Task {
  const { due, ...rest } = o;
  const owner = rest.assigneePhone ? USERS.find((u) => u.phone === rest.assigneePhone)! : PINKY;
  return {
    id: `t${++n}`,
    title: "Kaam",
    assigneePhone: owner.phone,
    assigneeName: owner.name,
    branch: owner.branch,
    createdByPhone: BHASKAR.phone,
    createdByName: BHASKAR.name,
    dueAt: due,
    dueHasTime: true,
    status: "pending",
    repeat: "none",
    nextReminderAt: due,
    remarks: [],
    createdAt: created,
    updatedAt: created,
    doneAt: null,
    ...rest,
  };
}

const TASKS: Task[] = [
  task({ id: "over", title: "Purana", due: ist("2026-10-20") }), // overdue, last week
  task({ id: "monday", title: "Somvar wala", due: ist("2026-10-26", "09:00") }), // overdue, this week
  task({ id: "todayAm", title: "Subah wala", due: ist("2026-10-28", "09:00") }), // overdue AND due today
  task({ id: "todayPm", title: "Shaam wala", due: ist("2026-10-28", "18:00") }),
  task({ id: "tom", title: "Kal wala", due: ist("2026-10-29") }),
  task({ id: "sun", title: "Itwar wala", due: ist("2026-11-01", "23:30") }),
  task({ id: "nextMon", title: "Agla hafta", due: ist("2026-11-02", "00:30") }),
  task({ id: "done", title: "Ho gaya", due: ist("2026-10-28"), status: "done" }),
  task({ id: "canc", title: "Cancel", due: ist("2026-10-28"), status: "cancelled" }),
  task({ id: "del", title: "Deleted", due: ist("2026-10-28"), status: "deleted" }),
  task({ id: "r1", title: "Raipur kaam", assigneePhone: RAMESH.phone, due: ist("2026-10-27") }),
  task({ id: "r2", title: "Raipur kal", assigneePhone: RAMESH.phone, due: ist("2026-10-29") }),
  task({ id: "a1", title: "Admin kaam", assigneePhone: BHASKAR.phone, due: ist("2026-10-28", "20:00"), urgent: true }),
];

function setup(tasks = TASKS) {
  const base = new MemoryStore({ users: USERS, tasks });
  const calls: string[] = [];
  const store = new Proxy(base, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        calls.push(String(prop));
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as Store;
  return { store, calls };
}
const f = (scope: ChatFilter["scope"], when: ChatFilter["when"], extra: Partial<ChatFilter> = {}): ChatFilter => ({ scope, when, ...extra });
const listOf = (filter: ChatFilter) => ({ kind: "list" as const, filter });
const countOf = (filter: ChatFilter) => ({ kind: "count" as const, filter });

function ids(out: Awaited<ReturnType<typeof answerQuery>>): string[] {
  const l = out.find((o) => o.kind === "list");
  if (!l || l.kind !== "list") return [];
  return l.rows.filter((r) => r.id.startsWith("tasks:task:")).map((r) => r.id.slice("tasks:task:".length));
}
const body = (out: Awaited<ReturnType<typeof answerQuery>>) => (out[0] as { body: string }).body;

describe("staff scoping", () => {
  it("mine: only own pending tasks", async () => {
    const { store } = setup();
    const out = await answerQuery(store, PINKY, listOf(f("mine", "all")), NOW);
    expect(ids(out).sort()).toEqual(["monday", "nextMon", "over", "sun", "todayAm", "todayPm", "tom"].sort());
    expect(out[0].kind).toBe("text");
  });

  it.each([f("all", "all"), f("branch", "all", { branch: "RAIPUR" }), f("person", "all", { person: "Ramesh" })])("refuses %j", async (filter) => {
    const { store, calls } = setup();
    for (const kind of ["list", "count"] as const) {
      const out = await answerQuery(store, PINKY, { kind, filter }, NOW);
      expect(out).toEqual([{ to: PINKY.phone, kind: "text", body: STAFF_REFUSAL }]);
    }
    expect(calls).toEqual([]); // refused before any read
  });

  it("staff naming themselves is fine", async () => {
    const { store } = setup();
    const out = await answerQuery(store, PINKY, listOf(f("person", "today", { person: "pinky" })), NOW);
    expect(ids(out).sort()).toEqual(["todayAm", "todayPm"]);
  });
});

describe("admin scopes", () => {
  it("person (exact name, case-insensitive), 2 store calls", async () => {
    const { store, calls } = setup();
    const out = await answerQuery(store, BHASKAR, listOf(f("person", "all", { person: "ramesh" })), NOW);
    expect(ids(out).sort()).toEqual(["r1", "r2"]);
    expect(calls).toEqual(["listUsers", "listTasks"]);
  });

  it("unknown person -> friendly text, no task read", async () => {
    const { store, calls } = setup();
    const out = await answerQuery(store, BHASKAR, listOf(f("person", "all", { person: "Nobody" })), NOW);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("text");
    expect(calls).toEqual(["listUsers"]);
  });

  it("inactive person is not found", async () => {
    const { store } = setup();
    const out = await answerQuery(store, BHASKAR, countOf(f("person", "all", { person: "Gone" })), NOW);
    expect(body(out)).toContain("naam");
  });

  it("branch uses the branch filter", async () => {
    const { store, calls } = setup();
    const out = await answerQuery(store, BHASKAR, listOf(f("branch", "all", { branch: "RAIPUR" })), NOW);
    expect(ids(out).sort()).toEqual(["r1", "r2"]);
    expect(calls).toEqual(["listTasks"]);
    expect(body(out)).toContain("Raipur ke");
  });

  it("branch without a branch id asks", async () => {
    const { store } = setup();
    const out = await answerQuery(store, BHASKAR, listOf(f("branch", "all")), NOW);
    expect(out[0].kind).toBe("text");
  });

  it("all: every pending task, 1 store call", async () => {
    const { store, calls } = setup();
    const out = await answerQuery(store, BHASKAR, countOf(f("all", "all")), NOW);
    expect(body(out)).toContain("*10* pending");
    expect(calls).toEqual(["listTasks"]);
  });

  it("mine for admin", async () => {
    const { store, calls } = setup();
    const out = await answerQuery(store, BHASKAR, listOf(f("mine", "all")), NOW);
    expect(ids(out)).toEqual(["a1"]);
    expect(calls).toEqual(["listTasks"]);
  });

  it("admin naming themselves reads their own tasks", async () => {
    const { store } = setup();
    const out = await answerQuery(store, BHASKAR, countOf(f("person", "all", { person: "Bhaskar" })), NOW);
    expect(body(out)).toContain("Aapke *1* pending");
  });
});

describe("buckets (IST, Mon-Sun week)", () => {
  const run = async (when: ChatFilter["when"]) => {
    const { store } = setup();
    return ids(await answerQuery(store, PINKY, listOf(f("mine", when)), NOW)).sort();
  };
  it("today: due on the IST day, even if the time already passed", async () => expect(await run("today")).toEqual(["todayAm", "todayPm"]));
  it("tomorrow", async () => expect(await run("tomorrow")).toEqual(["tom"]));
  it("overdue: past due only", async () => expect(await run("overdue")).toEqual(["monday", "over", "todayAm"]));
  it("week: Monday..Sunday of this IST week", async () =>
    expect(await run("week")).toEqual(["monday", "sun", "todayAm", "todayPm", "tom"].sort()));
  it("all", async () => expect(await run("all")).toHaveLength(7));

  it("just before IST midnight stays on the same day, just after is the next", async () => {
    const lateTask = task({ id: "late", due: ist("2026-10-28", "23:59") });
    const earlyTask = task({ id: "early", due: ist("2026-10-29", "00:01") });
    const s = setup([lateTask, earlyTask]).store;
    const before = new Date("2026-10-28T23:58:00+05:30");
    expect(ids(await answerQuery(s, PINKY, listOf(f("mine", "today")), before))).toEqual(["late"]);
    expect(ids(await answerQuery(s, PINKY, listOf(f("mine", "tomorrow")), before))).toEqual(["early"]);
    const after = new Date("2026-10-29T00:02:00+05:30");
    expect(ids(await answerQuery(s, PINKY, listOf(f("mine", "today")), after))).toEqual(["early"]);
    expect(ids(await answerQuery(s, PINKY, listOf(f("mine", "overdue")), after)).sort()).toEqual(["early", "late"]);
  });

  it("week boundaries: on Monday the week starts today, on Sunday it ends today", async () => {
    const tasks = [
      task({ id: "prevSun", due: ist("2026-10-25") }),
      task({ id: "mon", due: ist("2026-10-26", "18:00") }),
      task({ id: "sun", due: ist("2026-11-01", "18:00") }),
      task({ id: "nextMon", due: ist("2026-11-02", "18:00") }),
    ];
    const s = setup(tasks).store;
    const monday = new Date("2026-10-26T08:00:00+05:30");
    expect(ids(await answerQuery(s, PINKY, listOf(f("mine", "week")), monday)).sort()).toEqual(["mon", "sun"]);
    const sunday = new Date("2026-11-01T08:00:00+05:30");
    expect(ids(await answerQuery(s, PINKY, listOf(f("mine", "week")), sunday)).sort()).toEqual(["mon", "sun"]);
    const nextMonday = new Date("2026-11-02T08:00:00+05:30");
    expect(ids(await answerQuery(s, PINKY, listOf(f("mine", "week")), nextMonday))).toEqual(["nextMon"]);
  });
});

describe("closed / deleted never count", () => {
  it("done, cancelled and deleted are excluded even if the store returns them", async () => {
    const closed = [
      task({ id: "d", due: ist("2026-10-28"), status: "done" }),
      task({ id: "c", due: ist("2026-10-20"), status: "cancelled" }),
      task({ id: "x", due: ist("2026-10-20"), status: "deleted" }),
    ];
    const { store } = setup(closed);
    // Simulate a store that ignores the status filter.
    (store as unknown as { listTasks: Store["listTasks"] }).listTasks = async () => closed;
    const out = await answerQuery(store, PINKY, countOf(f("mine", "all")), NOW);
    expect(body(out)).toContain("*0* pending");
    const list = await answerQuery(store, PINKY, listOf(f("mine", "overdue")), NOW);
    expect(list).toHaveLength(1);
    expect(body(list)).toContain("koi task nahi");
  });
});

describe("count text", () => {
  const run = async (when: ChatFilter["when"], scope: ChatFilter = f("mine", when)) => {
    const { store } = setup();
    return body(await answerQuery(store, PINKY, countOf(scope), NOW));
  };
  it("all: pending, overdue, today", async () => {
    expect(await run("all")).toBe("Aapke *7* pending tasks hain, *3* overdue ⚠️, *2* aaj due.");
  });
  it("asked bucket first", async () => {
    expect(await run("overdue")).toBe("Aapke *3* overdue ⚠️ tasks hain, total *7* pending, *2* aaj due.");
    expect(await run("today")).toBe("Aapke *2* tasks aaj due hain, total *7* pending, *3* overdue ⚠️.");
    expect(await run("tomorrow")).toContain("*1* tasks kal due hain, total *7* pending, *3* overdue ⚠️, *2* aaj due.");
    expect(await run("week")).toContain("*5* tasks is hafte due hain");
  });
  it("branch count mirrors the spec example shape", async () => {
    const { store } = setup();
    const out = await answerQuery(store, BHASKAR, countOf(f("branch", "all", { branch: "DURG" })), NOW);
    expect(body(out)).toBe("Durg ke *7* pending tasks hain, *3* overdue ⚠️, *2* aaj due.");
  });
  it("empty scope is friendly", async () => {
    const { store } = setup([]);
    const out = await answerQuery(store, PINKY, countOf(f("mine", "all")), NOW);
    expect(body(out)).toContain("*0* pending");
    expect(body(out)).toContain("🎉");
  });
  it("urgentOnly", async () => {
    const { store } = setup();
    const out = await answerQuery(store, BHASKAR, countOf(f("all", "all", { urgentOnly: true })), NOW);
    expect(body(out)).toContain("*1* 🔴 urgent pending");
  });
});

describe("list output", () => {
  it("header text + taskList with tasks:task:<id> ids, urgent first", async () => {
    const { store } = setup();
    const out = await answerQuery(store, BHASKAR, listOf(f("all", "today")), NOW);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("text");
    expect(body(out)).toContain("Sabke aaj ke *3* tasks hain.");
    const l = out[1];
    expect(l.kind).toBe("list");
    if (l.kind !== "list") return;
    expect(l.rows[0].id).toBe("tasks:task:a1"); // urgent first
    expect(l.rows[0].title.startsWith("🔴")).toBe(true);
    expect(l.rows.every((r) => r.id.startsWith("tasks:task:"))).toBe(true);
    expect(l.rows[0].description).toContain("Bhaskar"); // assignee shown outside "mine"
  });

  it("empty -> friendly text only", async () => {
    const { store } = setup([]);
    const out = await answerQuery(store, PINKY, listOf(f("mine", "today")), NOW);
    expect(out).toEqual([{ to: PINKY.phone, kind: "text", body: "Aapke aaj ke koi task nahi 🎉" }]);
  });

  it("caps at 8 rows with no paging rows, and says so", async () => {
    const many = Array.from({ length: 15 }, (_, i) => task({ id: `m${i}`, title: "Bahut lamba task title yahan hai ji " + i, due: ist("2026-10-30", `${String(8 + (i % 10)).padStart(2, "0")}:00`) }));
    const { store } = setup(many);
    const out = await answerQuery(store, PINKY, listOf(f("mine", "all")), NOW);
    const l = out[1];
    if (l.kind !== "list") throw new Error("list expected");
    expect(l.rows).toHaveLength(8);
    expect(l.rows.some((r) => r.id.includes(":page:"))).toBe(false);
    expect(body(out)).toContain("*15*");
    expect(body(out)).toContain("Pehle 8");
    for (const r of l.rows) {
      expect(r.title.length).toBeLessThanOrEqual(24);
      expect((r.description ?? "").length).toBeLessThanOrEqual(72);
    }
    expect(l.body.length).toBeLessThanOrEqual(1024);
  });

  it("urgentOnly filters the list", async () => {
    const { store } = setup();
    const out = await answerQuery(store, BHASKAR, listOf(f("all", "all", { urgentOnly: true })), NOW);
    expect(ids(out)).toEqual(["a1"]);
  });

  it("long person names and titles keep within limits", async () => {
    const long = "N".repeat(60);
    const t = task({ id: "lg", title: "T".repeat(200), assigneeName: long, due: ist("2026-10-28") });
    const { store } = setup([t]);
    const out = await answerQuery(store, BHASKAR, listOf(f("all", "all")), NOW);
    const l = out[1];
    if (l.kind !== "list") throw new Error("list expected");
    expect(l.rows[0].title.length).toBeLessThanOrEqual(24);
    expect((l.rows[0].description ?? "").length).toBeLessThanOrEqual(72);
  });
});

describe("privacy and store calls", () => {
  it("never leaks phone numbers", async () => {
    const { store } = setup();
    for (const scope of [f("all", "all"), f("branch", "all", { branch: "DURG" }), f("person", "all", { person: "Ramesh" })]) {
      for (const kind of ["list", "count"] as const) {
        const out = await answerQuery(store, BHASKAR, { kind, filter: scope }, NOW);
        expect(JSON.stringify(out.map(({ to: _to, ...rest }) => rest))).not.toMatch(/9190000000\d\d/);
      }
    }
  });

  it("at most 2 store calls, only listUsers/listTasks", async () => {
    for (const filter of [f("mine", "all"), f("person", "week", { person: "Pinky" }), f("branch", "today", { branch: "DURG" }), f("all", "overdue")]) {
      const { store, calls } = setup();
      await answerQuery(store, BHASKAR, listOf(filter), NOW);
      expect(calls.length).toBeLessThanOrEqual(2);
      expect(calls.every((c) => c === "listUsers" || c === "listTasks")).toBe(true);
    }
  });
});
