import { describe, expect, it } from "vitest";
import { memoryFresh, refineFilter, resolveRef } from "../../src/chat/refs";
import type { ChatMemory } from "../../src/chat/types";

const NOW = new Date("2026-11-19T10:00:00Z");
const mem = (over: Partial<ChatMemory> = {}, ageMin = 1): ChatMemory => ({
  v: 3,
  at: new Date(NOW.getTime() - ageMin * 60_000).toISOString(),
  shown: ["a", "b", "c"],
  sel: "b",
  ...over,
});

describe("memoryFresh", () => {
  it("is true only inside the window", () => {
    expect(memoryFresh(mem({}, 0), NOW)).toBe(true);
    expect(memoryFresh(mem({}, 14.9), NOW)).toBe(true);
    expect(memoryFresh(mem({}, 15), NOW)).toBe(false);
    expect(memoryFresh(mem({}, 60), NOW)).toBe(false);
    expect(memoryFresh(null, NOW)).toBe(false);
    expect(memoryFresh({ v: 1, at: "garbage" }, NOW)).toBe(false);
  });
});

describe("resolveRef", () => {
  it("index is 1-based", () => {
    expect(resolveRef(mem(), { by: "index", n: 1 }, NOW)).toEqual({ ok: true, taskId: "a" });
    expect(resolveRef(mem(), { by: "index", n: 3 }, NOW)).toEqual({ ok: true, taskId: "c" });
  });
  it("rejects out of range, zero, negative, fractions", () => {
    for (const n of [0, 4, -1, 1.5, NaN]) expect(resolveRef(mem(), { by: "index", n }, NOW)).toEqual({ ok: false, reason: "out_of_range" });
  });
  it("selected and last", () => {
    expect(resolveRef(mem(), { by: "selected" }, NOW)).toEqual({ ok: true, taskId: "b" });
    expect(resolveRef(mem({ sel: null }), { by: "selected" }, NOW)).toEqual({ ok: false, reason: "none_selected" });
    expect(resolveRef(mem({ sel: undefined }), { by: "selected" }, NOW)).toEqual({ ok: false, reason: "none_selected" });
    expect(resolveRef(mem(), { by: "last" }, NOW)).toEqual({ ok: true, taskId: "c" });
    expect(resolveRef(mem({ shown: [] }), { by: "last" }, NOW)).toEqual({ ok: false, reason: "out_of_range" });
    expect(resolveRef(mem({ shown: undefined }), { by: "index", n: 1 }, NOW)).toEqual({ ok: false, reason: "out_of_range" });
  });
  it("no memory and expired memory", () => {
    expect(resolveRef(null, { by: "selected" }, NOW)).toEqual({ ok: false, reason: "no_memory" });
    expect(resolveRef(mem({}, 20), { by: "index", n: 1 }, NOW)).toEqual({ ok: false, reason: "expired" });
    expect(resolveRef(mem({}, 20), { by: "selected" }, NOW)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("refineFilter", () => {
  const base = { scope: "branch" as const, branch: "DURG" as const, when: "overdue" as const };
  it("keeps old values for missing keys", () => {
    expect(refineFilter(base, { urgentOnly: true })).toEqual({ scope: "branch", branch: "DURG", when: "overdue", urgentOnly: true });
    expect(refineFilter(base, {})).toEqual(base);
  });
  it("changes when only", () => {
    expect(refineFilter(base, { when: "tomorrow" })).toEqual({ scope: "branch", branch: "DURG", when: "tomorrow" });
  });
  it("branch change sets scope branch and drops person", () => {
    const prev = { scope: "person" as const, person: "Pinky", when: "all" as const };
    expect(refineFilter(prev, { branch: "RAIPUR" })).toEqual({ scope: "branch", branch: "RAIPUR", when: "all" });
  });
  it("person change sets scope person and drops branch", () => {
    expect(refineFilter(base, { person: "Pinky" })).toEqual({ scope: "person", person: "Pinky", when: "overdue" });
  });
  it("explicit scope mine/all drops person and branch", () => {
    expect(refineFilter(base, { scope: "mine" })).toEqual({ scope: "mine", when: "overdue" });
    expect(refineFilter(base, { scope: "all" })).toEqual({ scope: "all", when: "overdue" });
  });
  it("urgentOnly false clears it", () => {
    expect(refineFilter({ scope: "mine", when: "all", urgentOnly: true }, { urgentOnly: false })).toEqual({ scope: "mine", when: "all" });
  });
  it("does not mutate the previous filter", () => {
    const prev = { scope: "mine" as const, when: "all" as const };
    refineFilter(prev, { when: "today", urgentOnly: true });
    expect(prev).toEqual({ scope: "mine", when: "all" });
  });
});
