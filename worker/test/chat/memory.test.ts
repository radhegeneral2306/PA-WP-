import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import type { ChatMemory } from "../../src/chat/types";

const base = (extra: Partial<ChatMemory> = {}): ChatMemory => ({ v: 0, at: "2026-11-19T05:00:00.000Z", shown: ["a", "b"], offset: 0, total: 2, sel: null, ...extra });

describe("MemoryStore chat memory", () => {
  it("returns null before any save", async () => {
    expect(await new MemoryStore().getChatMemory("919")).toBeNull();
  });

  it("saves, reads and clears", async () => {
    const s = new MemoryStore();
    expect(await s.saveChatMemory("919", base())).toBe(true);
    expect(await s.getChatMemory("919")).toMatchObject({ v: 1, shown: ["a", "b"] });
    await s.clearChatMemory("919");
    expect(await s.getChatMemory("919")).toBeNull();
    // after clear a fresh v=0 save works again
    expect(await s.saveChatMemory("919", base())).toBe(true);
  });

  it("increments the version on each successful save", async () => {
    const s = new MemoryStore();
    await s.saveChatMemory("919", base());
    const m1 = (await s.getChatMemory("919"))!;
    expect(m1.v).toBe(1);
    expect(await s.saveChatMemory("919", m1)).toBe(true);
    expect((await s.getChatMemory("919"))!.v).toBe(2);
  });

  it("a second writer with the same v loses and writes nothing", async () => {
    const s = new MemoryStore();
    await s.saveChatMemory("919", base());
    const read = (await s.getChatMemory("919"))!;
    expect(await s.saveChatMemory("919", { ...read, sel: "first" })).toBe(true);
    expect(await s.saveChatMemory("919", { ...read, sel: "second" })).toBe(false);
    expect((await s.getChatMemory("919"))).toMatchObject({ v: 2, sel: "first" });
  });

  it("two saves from the same read: exactly one wins (concurrent)", async () => {
    const s = new MemoryStore();
    await s.saveChatMemory("919", base());
    const read = (await s.getChatMemory("919"))!;
    const results = await Promise.all([s.saveChatMemory("919", { ...read, sel: "x" }), s.saveChatMemory("919", { ...read, sel: "y" })]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await s.getChatMemory("919"))!.v).toBe(2);
  });

  it("two concurrent first saves (v=0): exactly one wins", async () => {
    const s = new MemoryStore();
    const results = await Promise.all([s.saveChatMemory("919", base()), s.saveChatMemory("919", base())]);
    expect(results.sort()).toEqual([false, true]);
  });

  it("rejects a save with the wrong version", async () => {
    const s = new MemoryStore();
    expect(await s.saveChatMemory("919", base({ v: 3 }))).toBe(false);
    expect(await s.getChatMemory("919")).toBeNull();
  });

  it("an empty phone never stores or reads", async () => {
    const s = new MemoryStore();
    expect(await s.saveChatMemory("", base())).toBe(false);
    expect(await s.getChatMemory("")).toBeNull();
    await s.clearChatMemory("");
  });

  it("isolates stored and returned objects (structuredClone)", async () => {
    const s = new MemoryStore();
    const input = base();
    await s.saveChatMemory("919", input);
    input.shown!.push("mutated");
    const out = (await s.getChatMemory("919"))!;
    expect(out.shown).toEqual(["a", "b"]);
    out.shown!.push("also");
    expect((await s.getChatMemory("919"))!.shown).toEqual(["a", "b"]);
  });

  it("keeps memories per phone separate", async () => {
    const s = new MemoryStore();
    await s.saveChatMemory("1", base({ sel: "one" }));
    await s.saveChatMemory("2", base({ sel: "two" }));
    expect((await s.getChatMemory("1"))!.sel).toBe("one");
    await s.clearChatMemory("1");
    expect((await s.getChatMemory("2"))!.sel).toBe("two");
  });
});
