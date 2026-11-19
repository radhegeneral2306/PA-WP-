// Round 7 adversarial review (reviewer 2): message size limits and text safety of the new numbered lists / task answers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { CHAT_TESTERS, handleMessage } from "../../src/bot/router";
import type { Outgoing } from "../../src/bot/outgoing";
import type { ChatResult, ChatService } from "../../src/chat/types";
import { describeTask } from "../../src/chat/taskInfo";
import { ADMIN, NOW, STAFF_DURG, USERS, say, task } from "../helpers/bot";

const chat: ChatService = { understand: vi.fn(async () => ({ ok: true, request: { kind: "unclear" } }) as ChatResult) };
beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());
(CHAT_TESTERS as Set<string>).add(STAFF_DURG.name);

const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const bodyOf = (o: Outgoing) => (o.kind === "template" ? o.fallbackText : o.body);

describe("sizes", () => {
  const long = "Bahut lamba title ".repeat(40);
  const many = Array.from({ length: 12 }, (_, i) =>
    task({ id: `t${i}`, title: `${i} ${long}`, urgent: true, assigneePhone: STAFF_DURG.phone, assigneeName: "Hardware ".repeat(20), dueAt: new Date(Date.UTC(2026, 9, 20, 4, 30 + i * 60)).toISOString() }),
  );

  it("a numbered list of 8 huge titles stays within WhatsApp limits (body <= 1024, row title <= 24, description <= 72)", async () => {
    const store = new MemoryStore({ users: USERS, tasks: many });
    const out = await handleMessage({ store, user: ADMIN, now: NOW, chat }, say("sabke pending tasks"));
    for (const o of out) {
      expect(bodyOf(o).length).toBeLessThanOrEqual(1024);
      if (o.kind === "list") for (const r of o.rows) {
        expect(r.title.length).toBeLessThanOrEqual(24);
        expect((r.description ?? "").length).toBeLessThanOrEqual(72);
      }
    }
  });

  it("a task answer with a 5000-char title and remark stays <= 6 lines and small", () => {
    const t = task({ title: "T".repeat(5000), remarks: [{ at: NOW.toISOString(), byPhone: "1", byName: "B".repeat(500), text: "R".repeat(5000) }] });
    for (const f of ["all", "last_remark", "due", "status"] as const) {
      const s = describeTask(t, f, NOW);
      expect(s.split("\n").length).toBeLessThanOrEqual(6);
      expect(s.length).toBeLessThan(600);
    }
  });

  async function ask(assigneeName: string) {
    const tasks = many.map((t) => ({ ...t, assigneeName }));
    const store = new MemoryStore({ users: USERS, tasks });
    const ai: ChatService = { understand: vi.fn(async () => ({ ok: true, request: { kind: "ask_task", field: "due", taskWords: ["bahut"] } }) as ChatResult) };
    const out = await handleMessage({ store, user: ADMIN, now: NOW, chat: ai }, say("bahut wale ka due kab hai batao zara"));
    return bodyOf(out[0]);
  }

  it("ask_task with several matches: one numbered question, <= 5 choices, <= 1024 chars (realistic names)", async () => {
    const b = await ask("Hardware Staff Durg");
    expect(b.split("\n").filter((l) => /^\d\) /.test(l)).length).toBeLessThanOrEqual(5);
    expect(b.length).toBeLessThanOrEqual(1024);
  });

  it("... also with the longest allowed staff name (40 chars, manageStaff NAME_MAX); the body is not clipped in code but cannot reach 1024", async () => {
    expect((await ask("N".repeat(40))).length).toBeLessThanOrEqual(1024);
  });
});

describe("text safety", () => {
  // FINDING (low): bot/ui.ts clip() slices UTF-16 units, so a title with an emoji at the cut point leaves a lone
  // surrogate in the numbered line (WhatsApp / JSON consumers may show "�" or reject it). Pre-existing helper, but
  // the new numbered lines (60 chars) and task answers (80/100/150) expose it more. Fix: cut with Array.from / code points.
  // Fixed: clip() cuts by code points.
  it("clipping a title at an emoji never leaves a lone surrogate", async () => {
    const title = `${"x".repeat(58)}😀😀 end`;
    const store = new MemoryStore({ users: USERS, tasks: [task({ id: "e", title, assigneePhone: STAFF_DURG.phone })] });
    const out = await handleMessage({ store, user: STAFF_DURG, now: NOW, chat }, say("mere pending tasks"));
    expect(bodyOf(out[0])).not.toMatch(lone);
  });

  it("phone numbers inside a remark or title are scrubbed from task answers", () => {
    const t = task({ title: "Call 9876543210 now", remarks: [{ at: NOW.toISOString(), byPhone: "1", byName: "A", text: "mera number +91 98765 43210 hai" }] });
    const s = describeTask(t, "all", NOW) + describeTask(t, "last_remark", NOW);
    expect(s).not.toMatch(/9876543210|98765 43210/);
  });
});
