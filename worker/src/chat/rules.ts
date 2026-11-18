// Round 5, Agent B: the deterministic Hinglish rules layer (no AI, no cost).
// It only answers when EVERY word of a short message is understood; one unknown word
// (a different meaning, a general question, a write request) returns null so the AI decides.
import { BRANCHES, type BranchId, type Role } from "../domain/types";
import type { ChatFilter, ChatPerson, ChatRequest, ChatWhen } from "./types";

const MAX_TOKENS = 9;

/** Lower-case, drop punctuation and emoji, collapse spaces and stretched letters ("taskkk"). */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/(.)\1{2,}/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// "dikha do" / "bata do" are show-requests, not writes: map them before the write check.
function preprocess(s: string): string {
  return s
    .replace(/\b(dikha|dikhaa|bata|batta|btao|dekh|dekha)\s*(do|de|dijiye|dijiyae|dijie|dena)\b/g, "dikhao")
    .replace(/\bhow many\b/g, "kitne")
    .replace(/\bover due\b/g, "overdue")
    .replace(/\bkitne\s+kitne\b/g, "kitne");
}

const WRITE_WORDS = new Set([
  "done", "kar", "kardo", "karo", "kardena", "do", "dedo", "de", "dena", "likh", "likho", "likhdo", "likhna",
  "badlo", "badal", "badalna", "badlein", "bana", "banao", "banado", "banana", "add", "create", "delete", "hatao",
  "hata", "remove", "cancel", "complete", "completed", "finish", "finished", "hogaya", "hogya", "ho", "gaya", "gya",
  "remark", "update", "reassign", "assign", "change", "set", "bhej", "bhejo", "send", "remind", "yaad", "mark", "close",
  "kardiya", "rakho", "dalo", "daal", "daalo", "likha",
]);
// "karna/karne" is fine in "kal kya karna hai"; "kar" / "kardo" never are.
const SOFT_WRITE = new Set(["karna", "karne", "karni", "krna", "kiya"]);

const OWN = new Set(["mera", "meri", "mere", "my", "mine", "mujhe", "mujhko", "meko", "apna", "apne", "apni", "hamare", "hamara"]);
const FILLER = new Set([
  "hai", "hain", "h", "he", "hein", "kya", "ka", "ke", "ki", "ko", "mein", "me", "wale", "wala", "wali", "walo", "is", "iss",
  "es", "ye", "yeh", "ab", "abhi", "please", "plz", "pls", "bhai", "bhaiya", "sir", "ji", "hi", "hello", "hey", "zara", "jara",
  "yaar", "kuch", "koi", "liye", "ke", "list", "show", "dikhao", "dikhaiye", "dikhaye", "batao", "bataiye", "bataye", "dekho",
  "dekhna", "dikha", "bata", "btao", "bolo", "the", "of", "this", "aur", "sabhi", "se", "ye", "yahan",
]);
const TASKISH = new Set(["task", "tasks", "taks", "tsk", "taask", "kaam", "kam", "kaamkaj", "work", "works", "todo", "todos", "kaaj"]);
const PENDING = new Set(["pending", "pendng", "pendin", "pendig", "penging", "baki", "baaki", "bacha", "bachi", "bache", "bakaya"]);
const OVERDUE = new Set(["overdue", "overdu", "overdues", "late", "delayed", "delay", "lete", "latt"]);
const URGENT = new Set(["urgent", "urjent", "jaruri", "zaruri", "jaroori", "zaroori", "urgnt"]);
const COUNT = new Set(["kitne", "kitna", "kitni", "ketne", "kitney", "count", "total", "gino", "gina"]);
const TODAY = new Set(["aaj", "aj", "today", "tday", "todays"]);
const TOMORROW = new Set(["kal", "kl", "tomorrow", "tomorow", "tmrw", "tmr", "tommorow"]);
const WEEK = new Set(["hafte", "hafta", "haftey", "hafte", "hfte", "week", "weeks", "saptah"]);
const ALL_SUFFIXED = new Set(["sabke", "sabka", "sabki", "sabko", "everyone", "sabhike", "sabhika", "sabhiki", "sabhiko", "saabke", "sbke"]);
const ALL_BARE = new Set(["sab", "saare", "sare", "all", "poore", "pure", "sbhi", "sbb"]);

const BRANCH_ALIASES: Record<BranchId, string[]> = {
  RAIPUR: ["raipur", "raypur", "raipoor", "raipure", "raipuur", "rayapur", "raipr"],
  JAGDALPUR: ["jagdalpur", "jagdalpoor", "jagdalpure", "jagdalpura", "jagdelpur", "jagdalpr", "jagdalpuur", "jagdalpur"],
  DURG: ["durg", "durrg", "durga"],
  HARDWARE: ["hardware", "hardwear", "hardwere", "hardwair", "hardwre"],
  OFFICE: ["office", "ofice", "offis", "ofis", "ofiss", "aafis", "afis"],
};
const FUZZY_BRANCHES: [string, BranchId][] = [
  ["raipur", "RAIPUR"], ["jagdalpur", "JAGDALPUR"], ["hardware", "HARDWARE"], ["office", "OFFICE"],
];
// Keeps BRANCHES (domain list) authoritative: aliases only apply to ids that exist there.
const KNOWN_BRANCHES = new Set<string>(BRANCHES.map((b) => b.id));

function branchOf(token: string): BranchId | null {
  for (const [id, aliases] of Object.entries(BRANCH_ALIASES) as [BranchId, string[]][]) {
    if (KNOWN_BRANCHES.has(id) && aliases.includes(token)) return id;
  }
  return null;
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

function fuzzyBranch(token: string): BranchId | null {
  if (token.length < 6) return null;
  const hit = FUZZY_BRANCHES.filter(([name]) => editDistanceAtMost1(token, name));
  return hit.length === 1 ? hit[0][1] : null;
}

type PersonMatch = { kind: "none" } | { kind: "ambiguous" } | { kind: "one"; name: string };

function matchPerson(phrase: string, people: ChatPerson[]): PersonMatch {
  if (phrase.length < 3) return { kind: "none" };
  const named = people.map((p) => ({ name: p.name, n: normalizeText(p.name) }));
  const exact = named.filter((p) => p.n === phrase);
  if (exact.length === 1) return { kind: "one", name: exact[0].name };
  if (exact.length > 1) return { kind: "ambiguous" };
  const hit = named.filter((p) => p.n.startsWith(phrase) || p.n.split(" ").some((w) => w === phrase || (phrase.length >= 3 && w.startsWith(phrase) && p.n.split(" ")[0] === w)));
  if (hit.length === 1) return { kind: "one", name: hit[0].name };
  return hit.length > 1 ? { kind: "ambiguous" } : { kind: "none" };
}

export function ruleRequest(
  text: string,
  ctx: { role: Role; self: string; people: ChatPerson[]; now: Date },
): ChatRequest | null {
  if (typeof text !== "string" || text.length > 200) return null;
  const norm = preprocess(normalizeText(text));
  if (!norm) return null;
  const tokens = norm.split(" ");
  if (tokens.length > MAX_TOKENS) return null;

  // Writes (done, kar do, likh do, badlo, de do, banao ...) are for the AI + confirm buttons.
  if (tokens.some((t) => WRITE_WORDS.has(t) && !SOFT_WRITE.has(t))) return null;

  let own = false;
  let allSuffixed = false;
  let allBare = false;
  let task = false;
  let pendingWord = false;
  let overdue = false;
  let urgent = false;
  let count = false;
  const whens = new Set<ChatWhen>();
  let branch: BranchId | null = null;
  let branchCount = 0;
  const leftover: { i: number; t: string }[] = [];

  tokens.forEach((t, i) => {
    if (OWN.has(t)) own = true;
    else if (ALL_SUFFIXED.has(t)) allSuffixed = true;
    else if (ALL_BARE.has(t)) allBare = true;
    else if (TASKISH.has(t)) task = true;
    else if (PENDING.has(t)) pendingWord = true;
    else if (OVERDUE.has(t)) overdue = true;
    else if (URGENT.has(t)) urgent = true;
    else if (COUNT.has(t)) count = true;
    else if (TODAY.has(t)) whens.add("today");
    else if (TOMORROW.has(t)) whens.add("tomorrow");
    else if (WEEK.has(t)) whens.add("week");
    else if (FILLER.has(t) || SOFT_WRITE.has(t)) return;
    else {
      const b = branchOf(t);
      if (b) {
        branch = b;
        branchCount++;
      } else leftover.push({ i, t });
    }
  });

  // Name words: one contiguous phrase that matches exactly one listed person, else a fuzzy branch spelling.
  let person: string | null = null;
  if (leftover.length > 0) {
    const contiguous = leftover.every((w, k) => k === 0 || w.i === leftover[k - 1].i + 1);
    if (!contiguous) return null;
    const phrase = leftover.map((w) => w.t).join(" ");
    const m = matchPerson(phrase, ctx.people);
    if (m.kind === "one") person = m.name;
    else if (m.kind === "ambiguous") return null;
    else {
      const fb = leftover.length === 1 ? fuzzyBranch(leftover[0].t) : null;
      if (!fb) return null;
      branch = fb;
      branchCount++;
    }
  }

  // Need a real signal: never act on filler alone.
  if (!(task || pendingWord || overdue || urgent || whens.size > 0)) return null;
  // A bare "aaj" / "kal" / "hafte" with nothing else is too vague.
  if (tokens.length === 1 && whens.size > 0) return null;
  if (branchCount > 1 || (branch && person)) return null;
  if (whens.size > 1) return null;
  if (overdue && whens.size > 0) return null;

  const selfNorm = normalizeText(ctx.self);
  const personIsSelf = person !== null && normalizeText(person) === selfNorm;
  const othersAsked = (person !== null && !personIsSelf) || branch !== null || allSuffixed;
  if (own && othersAsked) return null;
  if (allSuffixed && (person || branch)) return null;

  // Scope.
  let scope: ChatFilter["scope"] = "mine";
  if (allSuffixed) scope = "all";
  else if (person && !personIsSelf) scope = "person";
  else if (branch) scope = "branch";
  else if (allBare && !own && ctx.role === "admin") scope = "all";

  let when: ChatWhen = "all";
  if (overdue) when = "overdue";
  else if (whens.size === 1) when = [...whens][0];

  const filter: ChatFilter = { scope, when };
  if (scope === "person") filter.person = person;
  if (scope === "branch") filter.branch = branch;
  if (urgent) filter.urgentOnly = true;
  return { kind: count ? "count" : "list", filter };
}
