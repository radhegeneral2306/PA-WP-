// Finds the existing task a voice note is about (Round 4). Pure functions, no I/O.
//
// MATCHING RULES
// 1. Only `status === "pending"` tasks are ever returned.
// 2. Normalisation (both spoken words and title words, so spelling variants meet in the middle):
//    lower-case, accents/punctuation stripped, Devanagari transliterated to Roman, then
//    ph->f, ow->o ("follow"->"folo"), w->v, ee->i, oo->u, ay/ai/ey/ei/e->ai (so "payment" == "paiment" == "pement"), y->i, c->k (c before e/i/y ->s),
//    q->k, z->j, x->ks, aspirates bh/kh/gh/dh/jh->b/k/g/d/j, chh->ch, doubled letters collapsed,
//    a trailing "h" after a vowel dropped ("sharmah"), and the "ji" honorific removed
//    ("sharma ji" == "sharmaji" == "sharma jee").
// 3. Spoken words shorter than 3 chars (after normalisation) and Hinglish stop-words
//    (wala, ka, ki, ke, ko, se, hai, task, kaam, kar, do ...) are ignored. Nothing left -> [].
// 4. A spoken word matches ONE title token when, after normalisation, it is
//    - equal                                  (exact, weight 3)
//    - a prefix of the token, >= 3 chars      (prefix, weight 2): "pay" matches "payment" by design,
//      and a title token of >= 4 chars that is a prefix of the spoken word ("payments" -> "payment")
//    - within edit distance (transposition = 1) (fuzzy, weight 1): distance 1 when the longer word has
//      5-7 chars, 2 when >= 8 chars, never for shorter words; both words >= 4 chars and the first
//      letter must be equal (guards "mohan" vs "sohan").
//    Two adjacent spoken words may match one title token joined ("follow up" vs "followup"), and one
//    spoken word may match two adjacent title tokens joined ("followup" vs "follow up").
// 5. Each spoken word and each title token is used at most once (greedy, best quality first).
// 6. Score = 10 * (number of matches) + sum of weights, so more distinct matched words always wins,
//    and exact beats prefix beats fuzzy. Ties: urgent first, earliest due, then id (deterministic).
// 7. A task with no match is never returned (no filler).

import type { Task } from "../domain/types";

export interface TaskMatch {
  task: Task;
  /** Higher = better. Only tasks with score > 0 are returned. */
  score: number;
}

const W_EXACT = 3;
const W_PREFIX = 2;
const W_FUZZY = 1;

const STOP_RAW = [
  "wala", "wale", "wali", "ka", "ki", "ke", "ko", "se", "hai", "hain", "ho", "tha", "thi", "the",
  "mein", "me", "par", "pe", "aur", "ya", "ye", "yeh", "wo", "woh", "ek", "bhi", "kar", "karo",
  "karna", "karni", "kardo", "do", "task", "tasks", "kaam", "kam", "liye", "lie", "sir", "madam",
  "wo", "vala", "vale", "walaa", "uska", "uski", "uske", "iska", "iski", "iske", "vala", "vale",
];

// ---- Devanagari -> Roman (basic) ----
const DEV_CONS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
  "ष": "sh", "स": "s", "ह": "h", "ळ": "l",
};
const DEV_VOWEL: Record<string, string> = {
  "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
  "ऋ": "ri", "ऑ": "o",
};
const DEV_MATRA: Record<string, string> = {
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ृ": "ri", "ॉ": "o", "ॅ": "e",
};
const DEV_SIGN: Record<string, string> = { "ं": "n", "ँ": "n", "ः": "h" };

function hasDevanagari(s: string): boolean {
  return /[ऀ-ॿ]/.test(s);
}

export function transliterateDevanagari(input: string): string {
  if (!hasDevanagari(input)) return input;
  const s = input.normalize("NFD").replace(/़/g, "").replace(/ज्ञ/g, "gy").replace(/क्ष/g, "ksh");
  let out = "";
  let needA = false; // previous char was a consonant with an inherent "a" not yet emitted
  for (const ch of s) {
    const isLetter = ch in DEV_CONS || ch in DEV_VOWEL || ch in DEV_SIGN;
    if (needA && isLetter) out += "a";
    if (ch in DEV_CONS) {
      out += DEV_CONS[ch];
      needA = true;
      continue;
    }
    needA = false;
    if (ch in DEV_VOWEL) out += DEV_VOWEL[ch];
    else if (ch in DEV_MATRA) out += DEV_MATRA[ch];
    else if (ch in DEV_SIGN) out += DEV_SIGN[ch];
    else if (ch === "्") continue; // virama
    else out += ch;
  }
  return out;
}

// ---- Normalisation ----
function normToken(raw: string): string {
  let t = raw;
  t = t.replace(/ph/g, "f");
  t = t.replace(/o+w/g, "o");
  t = t.replace(/w/g, "v");
  t = t.replace(/ee/g, "i").replace(/oo/g, "u");
  t = t.replace(/c(?=[eiy])/g, "s").replace(/c(?!h)/g, "k");
  t = t.replace(/q/g, "k").replace(/z/g, "j").replace(/x/g, "ks");
  t = t.replace(/chh/g, "ch").replace(/bh/g, "b").replace(/kh/g, "k").replace(/gh/g, "g").replace(/dh/g, "d").replace(/jh/g, "j");
  t = t.replace(/[ae][iy]/g, "e").replace(/y/g, "i").replace(/e/g, "ai");
  t = t.replace(/(.)\1+/g, "$1");
  if (t.length > 3) t = t.replace(/(?<=[aeiou])h$/, "");
  if (t.length >= 6 && t.endsWith("ji")) t = t.slice(0, -2);
  return t;
}

/** Normalised tokens of free text (standalone "ji" removed). */
export function normalizeTokens(text: string): string[] {
  return tokenPairs(text).map((p) => p.n);
}

/** Tokens as {raw (lower-case, plain letters), n (normalised)}; standalone "ji" removed. */
function tokenPairs(text: string): { raw: string; n: string }[] {
  const base = transliterateDevanagari(String(text ?? ""))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const out: { raw: string; n: string }[] = [];
  for (const part of base.split(/[^a-z0-9]+/)) {
    if (!part) continue;
    const n = normToken(part);
    if (n && n !== "ji") out.push({ raw: part, n });
  }
  return out;
}

// Stop-words are compared on the RAW spelling (normalised forms collide: "pay" and "pe" are both "pai").
const STOP = new Set(STOP_RAW);

// ---- Word comparison ----
/** Optimal-string-alignment distance; returns max+1 when above `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length;
  const m = b.length;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[m];
}

/** "ai" -> "e" so that a spoken "pay" (-> "pai") is still a prefix of "payment" (-> "paimaint"). */
function loose(w: string): string {
  return w.replace(/ai/g, "e");
}

/** Weight of the best match of spoken `s` against title token `t` (0 = no match). */
function wordWeight(s: string, t: string): number {
  if (s === t) return W_EXACT;
  if (s.length >= 3 && (t.startsWith(s) || loose(t).startsWith(loose(s)))) return W_PREFIX;
  if (t.length >= 4 && s.length - t.length <= 3 && (s.startsWith(t) || loose(s).startsWith(loose(t)))) return W_PREFIX;
  const longer = Math.max(s.length, t.length);
  const maxD = longer >= 8 ? 2 : longer >= 5 ? 1 : 0;
  if (maxD > 0 && Math.min(s.length, t.length) >= 4 && s[0] === t[0] && editDistance(s, t, maxD) <= maxD) return W_FUZZY;
  return 0;
}

interface Spoken {
  kept: string[]; // usable single words
  keptIdx: number[]; // index in raw
  raw: string[];
}

function prepareSpoken(words: string[]): Spoken | null {
  const pairs: { raw: string; n: string }[] = [];
  for (const w of words ?? []) pairs.push(...tokenPairs(w));
  const raw = pairs.map((p) => p.n);
  const kept: string[] = [];
  const keptIdx: number[] = [];
  pairs.forEach((p, i) => {
    if (p.raw.length >= 3 && p.n.length >= 3 && !STOP.has(p.raw)) {
      kept.push(p.n);
      keptIdx.push(i);
    }
  });
  return kept.length ? { kept, keptIdx, raw } : null;
}

interface Cand {
  w: number;
  s: number[]; // raw spoken indices used
  t: number[]; // title token indices used
}

function scoreTitle(title: string, sp: Spoken): number {
  const T = normalizeTokens(title);
  if (T.length === 0) return 0;
  const cands: Cand[] = [];
  const keptSet = new Set(sp.keptIdx);
  // single spoken vs single title token, and single spoken vs joined title pair
  for (let k = 0; k < sp.kept.length; k++) {
    const s = sp.kept[k];
    const si = sp.keptIdx[k];
    for (let j = 0; j < T.length; j++) {
      const w = wordWeight(s, T[j]);
      if (w) cands.push({ w, s: [si], t: [j] });
      if (j + 1 < T.length) {
        const wj = wordWeight(s, T[j] + T[j + 1]);
        if (wj) cands.push({ w: wj, s: [si], t: [j, j + 1] });
      }
    }
  }
  // joined spoken pair vs single title token
  for (let i = 0; i + 1 < sp.raw.length; i++) {
    if (!keptSet.has(i) && !keptSet.has(i + 1)) continue;
    const joined = sp.raw[i] + sp.raw[i + 1];
    for (let j = 0; j < T.length; j++) {
      const w = wordWeight(joined, T[j]);
      if (w) cands.push({ w, s: [i, i + 1], t: [j] });
    }
  }
  if (cands.length === 0) return 0;
  cands.sort((a, b) => b.w - a.w || a.s[0] - b.s[0] || a.t[0] - b.t[0]);
  const usedS = new Set<number>();
  const usedT = new Set<number>();
  let count = 0;
  let sum = 0;
  for (const c of cands) {
    if (c.s.some((x) => usedS.has(x)) || c.t.some((x) => usedT.has(x))) continue;
    c.s.forEach((x) => usedS.add(x));
    c.t.forEach((x) => usedT.add(x));
    count++;
    sum += c.w;
  }
  return count * 10 + sum;
}

function byUrgentThenDue(a: Task, b: Task): number {
  const u = Number(!!b.urgent) - Number(!!a.urgent);
  if (u) return u;
  if (a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Pending tasks whose title matches the spoken `words` (customer / item words), best first;
 * ties: urgent first, then earliest due. Returns [] when `words` is empty or nothing matches.
 */
export function matchTasks(tasks: Task[], words: string[], opts: { limit?: number } = {}): TaskMatch[] {
  const limit = opts.limit ?? 8;
  const sp = prepareSpoken(words);
  if (!sp || limit <= 0) return [];
  const out: TaskMatch[] = [];
  for (const task of tasks) {
    if (task.status !== "pending") continue;
    const score = scoreTitle(task.title, sp);
    if (score > 0) out.push({ task, score });
  }
  out.sort((a, b) => b.score - a.score || byUrgentThenDue(a.task, b.task));
  return out.slice(0, limit);
}

/** Pending tasks to show when no words matched: urgent first, then earliest due. */
export function shortlist(tasks: Task[], limit = 8): Task[] {
  return tasks
    .filter((t) => t.status === "pending")
    .sort(byUrgentThenDue)
    .slice(0, limit);
}
