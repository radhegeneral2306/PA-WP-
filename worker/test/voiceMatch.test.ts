import { describe, expect, it } from "vitest";
import { matchTasks, normalizeTokens, shortlist, transliterateDevanagari } from "../src/bot/voiceMatch";
import { task } from "./helpers/bot";

let n = 0;
function t(title: string, extra: Record<string, unknown> = {}) {
  n++;
  return task({ id: `t${n}`, title, ...extra });
}
const titles = (ms: { task: { title: string } }[]) => ms.map((m) => m.task.title);

const SHARMA = "Sharma ji se payment lena";
const WALL = "Wallmark ka hisab milake update dena";
const DURG = "Durg ka stock check";
const FOLLOW = "Gupta ji ko followup call";

describe("normalisation", () => {
  it("collapses transliteration variants", () => {
    expect(normalizeTokens("Sharma ji")).toEqual(["sharma"]);
    expect(normalizeTokens("sharmaji")).toEqual(["sharma"]);
    expect(normalizeTokens("Sharma jee")).toEqual(["sharma"]);
    expect(normalizeTokens("payment")).toEqual(normalizeTokens("paiment"));
    expect(normalizeTokens("stock")).toEqual(normalizeTokens("stok"));
    expect(normalizeTokens("Wallmark")).toEqual(normalizeTokens("walmark"));
    expect(normalizeTokens("phone")).toEqual(normalizeTokens("fone"));
    expect(normalizeTokens("follow")).toEqual(normalizeTokens("folo"));
    expect(normalizeTokens("Pooja")).toEqual(normalizeTokens("puja"));
  });
  it("strips punctuation and diacritics", () => {
    expect(normalizeTokens("Café, Sharmá!!")).toEqual(normalizeTokens("cafe sharma"));
  });
  it("transliterates Devanagari", () => {
    expect(transliterateDevanagari("शर्मा")).toBe("sharma");
    expect(transliterateDevanagari("स्टॉक")).toBe("stok");
    expect(transliterateDevanagari("hello")).toBe("hello");
  });
});

describe("matchTasks: basics", () => {
  const all = [t(SHARMA), t(WALL), t(DURG), t(FOLLOW)];
  it("exact word", () => {
    expect(titles(matchTasks(all, ["sharma"]))).toEqual([SHARMA]);
    expect(titles(matchTasks(all, ["Wallmark"]))).toEqual([WALL]);
    expect(titles(matchTasks(all, ["stock"]))).toEqual([DURG]);
  });
  it("multi-word", () => {
    expect(titles(matchTasks(all, ["sharma", "payment"]))[0]).toBe(SHARMA);
    expect(titles(matchTasks(all, ["wallmark", "hisab", "update"]))).toEqual([WALL]);
  });
  it("multi-word phrase in one entry", () => {
    expect(titles(matchTasks(all, ["durg stock"]))).toEqual([DURG]);
  });
  it("more matched words rank higher", () => {
    const a = t("Sharma ji se payment lena");
    const b = t("Sharma ji ka stock check");
    const r = matchTasks([b, a], ["sharma", "payment"]);
    expect(r[0].task).toBe(a);
    expect(r[0].score).toBeGreaterThan(r[1].score);
  });
  it("exact beats prefix beats fuzzy", () => {
    const exact = t("payment lena");
    const prefix = t("paymentreceipt lena");
    const fuzzy = t("paymnet lena");
    const r = matchTasks([fuzzy, prefix, exact], ["payment"]);
    expect(r[0].task).toBe(exact);
    expect(r[1].task).toBe(prefix);
    expect(r[2].task).toBe(fuzzy);
  });
});

describe("matchTasks: spelling variants", () => {
  const all = [t(SHARMA), t(WALL), t(DURG), t(FOLLOW)];
  it.each([
    [["sharmaji"], SHARMA],
    [["sharma", "ji"], SHARMA],
    [["Sharma", "jee"], SHARMA],
    [["paiment"], SHARMA],
    [["paymnt"], SHARMA],
    [["sarma"], SHARMA],
    [["walmark"], WALL],
    [["vallmark"], WALL],
    [["hisaab"], WALL],
    [["stok"], DURG],
    [["stock", "chek"], DURG],
    [["durgg"], DURG],
    [["gupta", "ji"], FOLLOW],
    [["guptaji"], FOLLOW],
    [["folo", "up"], FOLLOW],
    [["follow", "up"], FOLLOW],
    [["followup"], FOLLOW],
  ])("%j -> %s", (words, expected) => {
    expect(titles(matchTasks(all, words as string[]))[0]).toBe(expected);
  });
  it("joined spoken vs split title and vice versa", () => {
    expect(titles(matchTasks([t("Gupta ji ko follow up call")], ["followup"]))).toHaveLength(1);
    expect(titles(matchTasks([t("Gupta ji ko followup call")], ["follow", "up"]))).toHaveLength(1);
    expect(titles(matchTasks([t("Gupta ji ko folo up call")], ["followup"]))).toHaveLength(1);
  });
  it("case and punctuation insensitive", () => {
    expect(titles(matchTasks(all, ["SHARMA!!"]))).toEqual([SHARMA]);
  });
});

describe("matchTasks: false-positive guards", () => {
  const all = [t(SHARMA), t(WALL), t(DURG), t(FOLLOW)];
  it("rule: a spoken prefix of >=3 chars matches (pay -> payment)", () => {
    expect(titles(matchTasks(all, ["pay"]))).toEqual([SHARMA]);
  });
  it("2-char words never match", () => {
    expect(matchTasks(all, ["pa"])).toEqual([]);
    expect(matchTasks(all, ["sh"])).toEqual([]);
  });
  it("unrelated words do not match", () => {
    expect(matchTasks(all, ["bijli", "bill"])).toEqual([]);
    expect(matchTasks(all, ["rajesh"])).toEqual([]);
    expect(matchTasks(all, ["laptop"])).toEqual([]);
  });
  it("no fuzzy for words shorter than 5 chars", () => {
    expect(matchTasks([t("Ravi ko call")], ["ravo"])).toEqual([]);
    expect(matchTasks([t("Mohan ko call")], ["bohan"])).toEqual([]); // first letter differs
  });
  it("fuzzy needs same first letter", () => {
    expect(matchTasks([t("Mohan ko call")], ["sohan"])).toEqual([]);
  });
  it("distance 2 only for long words (>=8 chars)", () => {
    expect(matchTasks([t("Wallmark update")], ["wallmrak"])).toHaveLength(1);
    expect(matchTasks([t("Sharma payment")], ["shrxma"])).toEqual([]); // 6 chars, distance 2
    expect(matchTasks([t("Bilaspur shop visit")], ["bilasmor"])).toHaveLength(1); // 8 chars, distance 2
  });
  it("one spoken word is used for one title token only", () => {
    const x = t("Sharma sharma sharma");
    const r = matchTasks([x], ["sharma"]);
    expect(r).toHaveLength(1);
    const y = t("Sharma ji payment");
    expect(matchTasks([y], ["sharma"])[0].score).toBe(matchTasks([y], ["sharma", "sharmaji"])[0].score);
  });
  it("one title token cannot be matched twice", () => {
    const x = t("payment lena");
    expect(matchTasks([x], ["payment", "paiment"])[0].score).toBe(matchTasks([x], ["payment"])[0].score);
  });
});

describe("matchTasks: stop-words and empties", () => {
  const all = [t(SHARMA), t(WALL), t("Kaam wala task pending")];
  it("empty words -> []", () => {
    expect(matchTasks(all, [])).toEqual([]);
    expect(matchTasks(all, ["", "  "])).toEqual([]);
  });
  it("only stop-words -> []", () => {
    expect(matchTasks(all, ["wala", "task", "kaam", "ka", "ki", "ke", "hai", "se", "ko"])).toEqual([]);
  });
  it("stop-words are ignored beside real words", () => {
    expect(titles(matchTasks(all, ["sharma", "ji", "wala", "task"]))).toEqual([SHARMA]);
    expect(titles(matchTasks(all, ["wala", "payment", "wale", "kaam"]))).toEqual([SHARMA]);
  });
  it("no match returns [] and never filler", () => {
    expect(matchTasks(all, ["zzzzzz"])).toEqual([]);
  });
  it("empty task list", () => {
    expect(matchTasks([], ["sharma"])).toEqual([]);
  });
});

describe("matchTasks: status, ordering, limit", () => {
  it("excludes non-pending", () => {
    const p = t(SHARMA);
    const d = t(SHARMA, { status: "done" });
    const c = t(SHARMA, { status: "cancelled" });
    expect(matchTasks([d, p, c], ["sharma"]).map((m) => m.task)).toEqual([p]);
  });
  it("ties: urgent first, then earliest due", () => {
    const late = t("Sharma ji payment", { dueAt: "2026-11-30T04:30:00.000Z" });
    const early = t("Sharma ji payment", { dueAt: "2026-11-20T04:30:00.000Z" });
    const urgent = t("Sharma ji payment", { dueAt: "2026-12-30T04:30:00.000Z", urgent: true });
    const r = matchTasks([late, early, urgent], ["sharma", "payment"]);
    expect(r.map((m) => m.task)).toEqual([urgent, early, late]);
  });
  it("better match beats urgent", () => {
    const urgentWeak = t("Sharma ji ka stock", { urgent: true });
    const strong = t("Sharma ji payment");
    expect(matchTasks([urgentWeak, strong], ["sharma", "payment"])[0].task).toBe(strong);
  });
  it("deterministic regardless of input order", () => {
    const a = t("Sharma ji payment", { id: "a" });
    const b = t("Sharma ji payment", { id: "b" });
    expect(matchTasks([a, b], ["sharma"]).map((m) => m.task.id)).toEqual(["a", "b"]);
    expect(matchTasks([b, a], ["sharma"]).map((m) => m.task.id)).toEqual(["a", "b"]);
  });
  it("limit (default 8, custom, zero)", () => {
    const many = Array.from({ length: 12 }, (_, i) => t(`Sharma ji payment ${i}`));
    expect(matchTasks(many, ["sharma"])).toHaveLength(8);
    expect(matchTasks(many, ["sharma"], { limit: 3 })).toHaveLength(3);
    expect(matchTasks(many, ["sharma"], { limit: 0 })).toEqual([]);
  });
  it("does not mutate the input", () => {
    const arr = [t("b payment"), t("a payment")];
    const copy = [...arr];
    matchTasks(arr, ["payment"]);
    expect(arr).toEqual(copy);
  });
});

describe("matchTasks: Devanagari", () => {
  const all = [t(SHARMA), t(DURG), t(FOLLOW)];
  it("matches Devanagari words against Roman titles", () => {
    expect(titles(matchTasks(all, ["शर्मा", "जी"]))[0]).toBe(SHARMA);
    expect(titles(matchTasks(all, ["शर्माजी"]))[0]).toBe(SHARMA);
    expect(titles(matchTasks(all, ["स्टॉक"]))[0]).toBe(DURG);
    expect(titles(matchTasks(all, ["पेमेंट"]))[0]).toBe(SHARMA);
    expect(titles(matchTasks(all, ["दुर्ग"]))[0]).toBe(DURG);
  });
  it("matches Devanagari titles", () => {
    const dev = t("शर्मा जी से पेमेंट लेना");
    expect(matchTasks([dev], ["sharma", "payment"])).toHaveLength(1);
  });
});

describe("shortlist", () => {
  it("pending only, urgent first, then earliest due, limited", () => {
    const a = t("a", { dueAt: "2026-11-25T00:00:00.000Z" });
    const b = t("b", { dueAt: "2026-11-21T00:00:00.000Z" });
    const u = t("u", { dueAt: "2026-12-25T00:00:00.000Z", urgent: true });
    const d = t("d", { status: "done", dueAt: "2026-11-01T00:00:00.000Z" });
    expect(shortlist([a, d, b, u]).map((x) => x.title)).toEqual(["u", "b", "a"]);
    expect(shortlist([a, d, b, u], 2).map((x) => x.title)).toEqual(["u", "b"]);
  });
  it("does not mutate and handles empty", () => {
    const arr = [t("x", { dueAt: "2026-12-01T00:00:00.000Z" }), t("y", { dueAt: "2026-11-01T00:00:00.000Z" })];
    const copy = [...arr];
    shortlist(arr);
    expect(arr).toEqual(copy);
    expect(shortlist([])).toEqual([]);
  });
});

describe("performance", () => {
  it("500 tasks x 6 words is fast", () => {
    const names = ["Sharma", "Gupta", "Verma", "Wallmark", "Durg", "Raipur", "Bhilai", "Patel"];
    const things = ["payment lena", "stock check", "hisab milake update dena", "followup call", "bill bhejna", "delivery check"];
    const tasks = Array.from({ length: 500 }, (_, i) =>
      t(`${names[i % names.length]} ji ${things[i % things.length]} ${i}`, { dueAt: `2026-12-${String((i % 28) + 1).padStart(2, "0")}T04:30:00.000Z` }),
    );
    const words = ["sharmaji", "paiment", "stok", "follow", "up", "wallmrak"];
    matchTasks(tasks, words); // warm up
    const start = performance.now();
    const r = matchTasks(tasks, words);
    const ms = performance.now() - start;
    expect(r.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(50);
  });
});
