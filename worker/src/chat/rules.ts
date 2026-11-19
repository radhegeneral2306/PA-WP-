// Round 5, Agent B: the deterministic Hinglish rules layer (no AI, no cost).
// It only answers when EVERY word of a short message is understood; one unknown word
// (a different meaning, a general question, a write request) returns null so the AI decides.
import { BRANCHES, type BranchId, type Role } from "../domain/types";
import { memoryFresh, resolveRef } from "./refs";
import type { ChatFilter, ChatMemory, ChatPerson, ChatRequest, ChatWhen, FilterChanges, TaskField } from "./types";

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

// ---------------------------------------------------------------------------------------------
// Round 7, Agent B: follow-ups against the chat memory ("doosra wala kholo", "sirf urgent wale",
// "iski due date kya hai", "aur dikhao", "shuru se"). Same strictness as ruleRequest: every word
// must be understood, writes and unknown words return null so the AI path decides.
// ---------------------------------------------------------------------------------------------

const MAX_FOLLOWUP_TOKENS = 10;

// Multi-word phrases become one "@field" token BEFORE the write check ("kitne remark", "kab done hua",
// "last update" contain write words but are questions). Order matters: specific phrases first.
const FIELD_PHRASES: [RegExp, string][] = [
  [/\bkitn[eiy]+\s+(remarks?|updates?|comments?)\b|\b(remarks?|updates?|comments?)\s+kitn[eiy]+\b|\bremarks?\s+count\b/g, "@rcount"],
  [/\b(last|latest|aakhri|akhri|aakhiri)\s+(update|remark|comment|note)s?\b/g, "@lastremark"],
  [/\bkab\s+(done|complete|completed|khatam|hogaya|ho\s+gaya)\s+(hua|hui|hue|kiya|huya)\b|\b(done|complete|completed)\s+kab\s+(hua|hui|hue|kiya)\b|\bkab\s+hua\s+done\b|\bkab\s+(done|complete)\b|\bdone\s+date\b/g, "@donetime"],
  [/\bkab\s+(banaya|bana|banai|banayi|bani|create|created|daala|dala)\b|\b(banaya|bana|banai|create|created)\s+kab\b|\bcreated?\s+date\b|\bbanne\s+ki\s+date\b/g, "@created"],
  [/\b(kisne|kis\s*ne|kisse|kaun\s*ne|kon\s*ne)\s+(diya|di|dia|banaya|bnaya|dala|daala|bheja|likha|assign\s+kiya|assign\s+kia)\b|\bkisne\s+assign\b|\bcreator\b/g, "@creator"],
  [/\b(kis\s?ko|kisiko)\s+assign(\s+(kiya|kia))?\b|\b(kisko|kiske\s+paas|kiske\s+naam|kiska|kiski|kaun\s+karega|kon\s+karega|kaun\s+kar\s+raha|assignee)\b/g, "@assignee"],
  [/\bdue\s*date\b|\bdue\s+kab\b|\bkab\s+due\b|\bkab\s+tak\b|\bdeadline\b|\blast\s+date\b|\bdue\b|\bkab\s+karna\b/g, "@due"],
  [/\bstatus\b|\bkya\s+haal\b|\b(pending|baki|baaki)\s+(hai\s+)?(ya|or)\s+(done|complete|completed)\b|\b(done|complete)\s+(hai\s+)?(ya|or)\s+(pending|baki|baaki)\b/g, "@status"],
  [/\b(urgent|urjent|urgnt|jaruri|zaruri|jaroori|zaroori)\s+(hai|he|h)(\s+kya)?\b|\bkya\s+(urgent|urjent|urgnt|jaruri|zaruri)\s+(hai|he|h)\b/g, "@urgent"],
  [/\b(repeat|repeats|repeating|ripeat)\b|\bkitni\s+baar\b/g, "@repeat"],
  [/\b(details?|jaa?nkari|summary|sab\s+kuch|baare\s+mein|baare\s+me|bare\s+mein|bare\s+me)\b/g, "@all"],
];
const FIELD_OF: Record<string, TaskField> = {
  "@rcount": "remark_count", "@lastremark": "last_remark", "@donetime": "done_at", "@created": "created",
  "@creator": "creator", "@assignee": "assignee", "@due": "due", "@status": "status", "@urgent": "urgent",
  "@repeat": "repeat", "@all": "all",
};

const ORDINALS: Record<string, number> = {};
[
  [1, "pehla pehle pehli pahla pahle pahli pehala first 1st"],
  [2, "doosra doosre doosri dusra dusre dusri dosra dosre dosri duusra doosara dusara second 2nd"],
  [3, "teesra teesre teesri tisra tisre tisri tesra tesre third 3rd"],
  [4, "chautha chauthe chauthi chotha fourth 4th"],
  [5, "paanchva paanchve paanchvi panchva panchve paanchwa panchwa fifth 5th"],
  [6, "chhatha chhatwa chatha sixth 6th"],
  [7, "saatva saatve satva seventh 7th"],
  [8, "aathva aathve athva eighth 8th"],
].forEach(([n, words]) => (words as string).split(" ").forEach((w) => (ORDINALS[w] = n as number)));
const LAST_WORDS = new Set(["last", "aakhri", "akhri", "aakhiri", "antim", "latest"]);
const NUMWORDS = new Set(["number", "no", "nmbr", "nambar", "num", "nmber"]);
const OPEN_VERBS = new Set(["kholo", "kholiye", "kholna", "khol", "kholein", "kholen", "open", "dikhao", "dikhaiye", "dikhaye", "dikha", "dekho", "dekhna", "batao", "bataiye"]);
const SELECTORS = new Set(["isko", "ise", "yahi", "yehi", "isi"]);
const PRONOUNS = new Set(["iska", "iski", "iske", "isme", "uska", "uski", "uske", "usme", "iskaa"]);
const DETERMINERS = new Set(["is", "iss", "es", "ye", "yeh", "this"]);
const ASK_FILLER = new Set(["hota", "hoti", "hote", "kab", "tak", "tha", "thi", "the", "hua", "hui", "hue", "diya", "dia", "di", "mila", "kaun", "kaunsa", "kaunse", "kon"]);
const MORE_TRIGGER = new Set(["aur", "next", "more", "agla", "aage", "baaki", "baki"]);
const MORE_OK = new Set(["show", "dikhao", "dikhaiye", "dikhaye", "dikha", "dekho", "page", "hai", "hain", "hi", "please", "plz", "pls", "bhi", "kuch", "koi", "wale", "wala", "ab", "abhi"]);
const RESET_TRIGGER = new Set(["shuru", "reset", "naya", "nayi", "naye", "clear", "restart", "start", "new"]);
const RESET_OK = new Set(["se", "sab", "phir", "fir", "dobara", "again", "over", "chat", "memory", "saaf", "please", "plz", "pls", "ab", "abhi", "ji"]);
const STRONG_MARK = new Set(["sirf", "bas", "only", "wale", "wala", "wali", "walo", "wale"]);

type FollowCtx = { role: Role; self: string; people: ChatPerson[]; now: Date };

// "khol do" / "open karo" are open-requests (the "do"/"karo" is politeness), not writes.
function openPhrases(s: string): string {
  return s
    .replace(/\b(khol|kholo|kholiye)\s+(do|dijiye|dijiyae|dena|de)\b/g, "kholo")
    .replace(/\bopen\s+(karo|kar\s+do|kardo|kijiye|kar\s+dijiye|kar\s+de|kar\s+dena)\b/g, "open");
}

const SPOKEN: Record<string, string> = {
  ek: "1", do: "2", teen: "3", char: "4", chaar: "4", paanch: "5", panch: "5", chhe: "6", chhah: "6", saat: "7", aath: "8",
};
const SPOKEN_NEXT = new Set(["wala", "wali", "wale", "number", "nmbr"]);

/** "number do" / "teen wala" / a lone "ek" -> digits, so "do" is not mistaken for the write word. */
function spokenToDigits(tokens: string[]): string[] {
  return tokens.map((t, i) => {
    if (!Object.prototype.hasOwnProperty.call(SPOKEN, t)) return t;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    const alone = tokens.length === 1 || (tokens.length === 2 && (tokens[1 - i] === "ji"));
    if ((prev !== undefined && NUMWORDS.has(prev)) || (next !== undefined && SPOKEN_NEXT.has(next)) || alone) return SPOKEN[t];
    return t;
  });
}

function canonical(norm: string): string {
  let s = ` ${norm} `;
  for (const [re, tag] of FIELD_PHRASES) s = s.replace(re, ` ${tag} `);
  return s.replace(/\s+/g, " ").trim();
}

/** 1-based index from a token ("2", "2nd", "doosra"), "last", or null. */
function refToken(t: string): { by: "index"; n: number } | { by: "last" } | null {
  if (/^\d{1,2}$/.test(t)) return { by: "index", n: Number(t) };
  const ord = /^(\d{1,2})(st|nd|rd|th)$/.exec(t);
  if (ord) return { by: "index", n: Number(ord[1]) };
  if (ORDINALS[t]) return { by: "index", n: ORDINALS[t] };
  if (LAST_WORDS.has(t)) return { by: "last" };
  return null;
}

function otherVocabulary(t: string): boolean {
  return (
    OWN.has(t) || TODAY.has(t) || TOMORROW.has(t) || WEEK.has(t) || URGENT.has(t) || OVERDUE.has(t) || PENDING.has(t) ||
    COUNT.has(t) || ALL_SUFFIXED.has(t) || ALL_BARE.has(t) || branchOf(t) !== null
  );
}

export function ruleFollowup(text: string, ctx: FollowCtx, memory: ChatMemory | null): ChatRequest | null {
  if (typeof text !== "string" || text.length > 200) return null;
  const norm0 = openPhrases(preprocess(normalizeText(text)));
  if (!norm0) return null;
  const tokens = spokenToDigits(canonical(norm0).split(" "));
  if (tokens.length > MAX_FOLLOWUP_TOKENS) return null;
  // Writes always go to the AI path with confirm buttons.
  if (tokens.some((t) => WRITE_WORDS.has(t) && !SOFT_WRITE.has(t))) return null;

  const fresh = memoryFresh(memory, ctx.now);
  const shownCount = fresh && memory?.shown ? memory.shown.length : 0;
  const refOk = (ref: { by: "index"; n: number } | { by: "last" } | { by: "selected" }) => fresh && resolveRef(memory, ref, ctx.now).ok;

  // reset: works without memory.
  if (tokens.some((t) => RESET_TRIGGER.has(t)) && tokens.every((t) => RESET_TRIGGER.has(t) || RESET_OK.has(t))) return { kind: "reset" };

  // Questions about one task.
  const fieldTokens = new Set(tokens.filter((t) => t.startsWith("@")));
  if (fieldTokens.size > 1) return null;
  if (fieldTokens.size === 1) return askTask(tokens, FIELD_OF[[...fieldTokens][0]], ctx, memory, fresh, refOk);

  if (!fresh) return null;

  // more
  if (tokens.some((t) => MORE_TRIGGER.has(t)) && tokens.every((t) => MORE_TRIGGER.has(t) || MORE_OK.has(t))) return { kind: "more" };

  // open
  const open = openRule(tokens, refOk);
  if (open !== undefined) return open;

  return refineRule(tokens, ctx);
}

function askTask(
  tokens: string[],
  field: TaskField,
  ctx: FollowCtx,
  memory: ChatMemory | null,
  fresh: boolean,
  refOk: (r: { by: "index"; n: number } | { by: "last" } | { by: "selected" }) => boolean,
): ChatRequest | null {
  const refs: ({ by: "index"; n: number } | { by: "last" })[] = [];
  const leftover: string[] = [];
  let pronoun = false;
  let sawTask = false;
  let sawDet = false;
  for (const t of tokens) {
    if (t.startsWith("@")) continue;
    const r = refToken(t);
    if (r) refs.push(r);
    else if (PRONOUNS.has(t) || SELECTORS.has(t)) pronoun = true;
    else if (TASKISH.has(t)) sawTask = true;
    else if (DETERMINERS.has(t) || FILLER.has(t) || ASK_FILLER.has(t) || NUMWORDS.has(t) || SOFT_WRITE.has(t) || OPEN_VERBS.has(t)) {
      if (DETERMINERS.has(t)) sawDet = true;
    } else if (otherVocabulary(t)) return null;
    else leftover.push(t);
  }
  if (sawTask && sawDet) pronoun = true;
  if (refs.length > 1) return null;

  if (refs.length === 1) {
    if (pronoun || leftover.length > 0) return null;
    return refOk(refs[0]) ? { kind: "ask_task", field, ref: refs[0] } : null;
  }
  if (leftover.length > 0) {
    if (pronoun || leftover.length > 4 || leftover.some((w) => w.length < 2)) return null;
    return { kind: "ask_task", field, taskWords: leftover };
  }
  // "iski due date", "kab tak hai": the selected task.
  if (!fresh || !memory?.sel) return null;
  return { kind: "ask_task", field, ref: { by: "selected" } };
}

function openRule(
  tokens: string[],
  refOk: (r: { by: "index"; n: number } | { by: "last" } | { by: "selected" }) => boolean,
): ChatRequest | null | undefined {
  const refs: ({ by: "index"; n: number } | { by: "last" })[] = [];
  let selector = false;
  let verb = false;
  let task = false;
  let taskBefore = false; // "task 2", "task number 2": the singular word comes first
  for (const t of tokens) {
    const r = refToken(t);
    if (r) refs.push(r);
    else if (SELECTORS.has(t)) selector = true;
    else if (OPEN_VERBS.has(t)) verb = true;
    else if (TASKISH.has(t)) {
      task = true;
      if (t === "task" && refs.length === 0 && !selector) taskBefore = true;
    }
    else if (NUMWORDS.has(t) || FILLER.has(t) || DETERMINERS.has(t)) continue;
    else return undefined; // not an open phrase: let the refine rule look at it
  }
  if (refs.length === 0 && !selector) return undefined;
  if (refs.length + (selector ? 1 : 0) !== 1) return null;
  if (task && !verb && !taskBefore) return null;
  if (selector) return verb && refOk({ by: "selected" }) ? { kind: "open", ref: { by: "selected" } } : null;
  return refOk(refs[0]) ? { kind: "open", ref: refs[0] } : null;
}

function refineRule(tokens: string[], ctx: FollowCtx): ChatRequest | null {
  const whens = new Set<ChatWhen>();
  let overdue = false;
  let urgent = false;
  let all = false;
  let strong = false;
  let weak = false;
  let branch: BranchId | null = null;
  let branchCount = 0;
  const leftover: { i: number; t: string }[] = [];
  tokens.forEach((t, i) => {
    if (STRONG_MARK.has(t)) strong = true;
    else if (t === "ke" || t === "ki") weak = true;
    else if (URGENT.has(t)) urgent = true;
    else if (OVERDUE.has(t)) overdue = true;
    else if (TODAY.has(t)) whens.add("today");
    else if (TOMORROW.has(t)) whens.add("tomorrow");
    else if (WEEK.has(t)) whens.add("week");
    else if (t === "sab" || t === "sabhi" || t === "all") all = true;
    else if (FILLER.has(t)) return;
    else if (t.startsWith("@") || OWN.has(t) || TASKISH.has(t) || PENDING.has(t) || COUNT.has(t) || ALL_SUFFIXED.has(t)) leftover.push({ i: -1, t: "?" });
    else {
      const b = branchOf(t);
      if (b) {
        branch = b;
        branchCount++;
      } else leftover.push({ i, t });
    }
  });
  if (leftover.some((l) => l.i < 0)) return null;

  let person: string | null = null;
  if (leftover.length > 0) {
    const contiguous = leftover.every((w, k) => k === 0 || w.i === leftover[k - 1].i + 1);
    if (!contiguous) return null;
    const m = matchPerson(leftover.map((w) => w.t).join(" "), ctx.people);
    if (m.kind === "one") person = m.name;
    else if (m.kind === "ambiguous") return null;
    else {
      const fb = leftover.length === 1 ? fuzzyBranch(leftover[0].t) : null;
      if (!fb) return null;
      branch = fb;
      branchCount++;
    }
  }
  // Branch and person filters are admin-only; staff never get them.
  if ((branch || person) && ctx.role !== "admin") return null;
  if (branchCount > 1 || (branch && person)) return null;
  if (whens.size > 1 || (overdue && whens.size > 0)) return null;
  if (all && (urgent || overdue || whens.size > 0 || branch || person)) return null;

  const changes: FilterChanges = {};
  if (all) {
    changes.when = "all";
    changes.urgentOnly = false;
  }
  if (overdue) changes.when = "overdue";
  else if (whens.size === 1) changes.when = [...whens][0];
  if (urgent) changes.urgentOnly = true;
  if (branch) changes.branch = branch;
  if (person) {
    if (normalizeText(person) === normalizeText(ctx.self)) changes.scope = "mine";
    else changes.person = person;
  }
  if (Object.keys(changes).length === 0) return null;
  const onlyWho = !all && !overdue && whens.size === 0 && !urgent;
  if (!(strong || all || (onlyWho && weak))) return null;
  return { kind: "refine", changes };
}

// A permissive memory (99 shown tasks, one selected) so ruleFollowup judges only the FORM of a message.
const FORM_NOW = new Date(0);
const FORM_CTX: FollowCtx = { role: "admin", self: "", people: [], now: FORM_NOW };
const FORM_MEMORY: ChatMemory = {
  v: 2,
  at: FORM_NOW.toISOString(),
  query: { scope: "mine", when: "all" },
  shown: Array.from({ length: 99 }, () => "x"),
  sel: "x",
};

/**
 * True when the text is, in form, a follow-up the memory rules understand (a bare number or ordinal in any
 * spelling, "number 3", "aur dikhao", "iski due date kya hai", "sirf urgent wale", "shuru se"), whether or not a
 * memory exists. The chat flow uses it to answer such messages without the AI. Conservative: write words and
 * anything ruleRequest answers (except the refine and more families, which only make sense after a list) give false.
 */
export function looksLikeFollowup(text: string): boolean {
  if (typeof text !== "string" || text.length > 200) return false;
  const r = ruleFollowup(text, FORM_CTX, FORM_MEMORY);
  if (!r) return false;
  if (r.kind === "refine" || r.kind === "more") return true;
  return ruleRequest(text, FORM_CTX) === null;
}
