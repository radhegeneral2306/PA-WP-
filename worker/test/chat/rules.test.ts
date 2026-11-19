import { describe, expect, it } from "vitest";
import { ruleRequest } from "../../src/chat/rules";
import type { ChatPerson, ChatRequest } from "../../src/chat/types";

const NOW = new Date("2026-10-26T09:30:00Z");
const PEOPLE: ChatPerson[] = [
  { name: "Bhaskar", label: "Admin" },
  { name: "Pinky", label: "Durg" },
  { name: "Pinku Sharma", label: "Raipur" },
  { name: "Ramesh Kumar", label: "Raipur" },
  { name: "Rakesh", label: "Jagdalpur" },
  { name: "Sunita Verma", label: "Office" },
];
const admin = (t: string) => ruleRequest(t, { role: "admin", self: "Bhaskar", people: PEOPLE, now: NOW });
const staff = (t: string) => ruleRequest(t, { role: "staff", self: "Pinky", people: [PEOPLE[1]], now: NOW });

const list = (when: string, extra: object = {}): ChatRequest => ({ kind: "list", filter: { scope: "mine", when, ...extra } as never });
const count = (when: string, extra: object = {}): ChatRequest => ({ kind: "count", filter: { scope: "mine", when, ...extra } as never });

describe("own tasks (staff and admin)", () => {
  it.each([
    ["mere tasks", list("all")],
    ["Mere Tasks!", list("all")],
    ["mera kaam", list("all")],
    ["mere kaam dikhao", list("all")],
    ["meri tasks list", list("all")],
    ["mujhe mere tasks batao", list("all")],
    ["tasks", list("all")],
    ["kaam", list("all")],
    ["aaj kya hai", list("today")],
    ["aaj kya hai?", list("today")],
    ["Aaj ke tasks", list("today")],
    ["aj ka kaam", list("today")],
    ["today tasks", list("today")],
    ["mere aaj ke kaam dikhao 🙏", list("today")],
    ["kal ka kaam", list("tomorrow")],
    ["kal kya karna hai", list("tomorrow")],
    ["kal kya hai", list("tomorrow")],
    ["kl ke tasks", list("tomorrow")],
    ["tomorrow tasks", list("tomorrow")],
    ["overdue", list("overdue")],
    ["overdue tasks", list("overdue")],
    ["late wale", list("overdue")],
    ["mere late wale kaam", list("overdue")],
    ["over due kaam", list("overdue")],
    ["is hafte ka kaam", list("week")],
    ["iss hafte ke tasks", list("week")],
    ["this week tasks", list("week")],
    ["urgent kaam", list("all", { urgentOnly: true })],
    ["mere urgent tasks", list("all", { urgentOnly: true })],
    ["aaj ke urgent kaam", list("today", { urgentOnly: true })],
    ["mera kya pending hai", list("all")],
    ["mere pending tasks", list("all")],
    ["baaki kaam kya hai", list("all")],
    ["pending", list("all")],
    ["pendng tasks", list("all")],
    ["TASKKKK", list("all")],
    ["kitne pending hain", count("all")],
    ["mere kitne tasks pending hain", count("all")],
    ["kitne overdue hain", count("overdue")],
    ["kitne tasks aaj ke hain", count("today")],
    ["how many tasks pending", count("all")],
    ["kitne kaam bache hain", count("all")],
    ["total pending tasks", count("all")],
    ["aaj kitne tasks hain", count("today")],
    ["kal ke kitne kaam hain", count("tomorrow")],
    ["is hafte kitne kaam hain", count("week")],
    ["tasks dikha do", list("all")],
    ["mere tasks bata do", list("all")],
  ])("%s", (text, expected) => {
    expect(staff(text)).toEqual(expected);
    expect(admin(text)).toEqual(expected);
  });

  it("names itself as the person -> mine", () => {
    expect(staff("Pinky ke tasks")).toEqual(list("all"));
    expect(admin("Bhaskar ke tasks")).toEqual(list("all"));
  });

  it("bare 'sab' means all of MY tasks for staff, everyone's for admin", () => {
    expect(staff("sab pending tasks")).toEqual(list("all"));
    expect(admin("sab pending")).toEqual({ kind: "list", filter: { scope: "all", when: "all" } });
    expect(admin("mere sab tasks")).toEqual(list("all"));
  });
});

describe("admin: person, branch, all", () => {
  it.each([
    ["Durg ke pending", { kind: "list", filter: { scope: "branch", branch: "DURG", when: "all" } }],
    ["durg ke tasks", { kind: "list", filter: { scope: "branch", branch: "DURG", when: "all" } }],
    ["Raipur mein kitne overdue", { kind: "count", filter: { scope: "branch", branch: "RAIPUR", when: "overdue" } }],
    ["raipur me kitne pending hain", { kind: "count", filter: { scope: "branch", branch: "RAIPUR", when: "all" } }],
    ["Jagdalpur ke aaj ke tasks", { kind: "list", filter: { scope: "branch", branch: "JAGDALPUR", when: "today" } }],
    ["jagdalpoor ka kaam", { kind: "list", filter: { scope: "branch", branch: "JAGDALPUR", when: "all" } }],
    ["raypur ke overdue", { kind: "list", filter: { scope: "branch", branch: "RAIPUR", when: "overdue" } }],
    ["Hardware ke pending", { kind: "list", filter: { scope: "branch", branch: "HARDWARE", when: "all" } }],
    ["hardwear ke tasks", { kind: "list", filter: { scope: "branch", branch: "HARDWARE", when: "all" } }],
    ["office ke tasks", { kind: "list", filter: { scope: "branch", branch: "OFFICE", when: "all" } }],
    ["ofice ke kitne pending", { kind: "count", filter: { scope: "branch", branch: "OFFICE", when: "all" } }],
    ["raipoor ke kitne tasks aaj ke", { kind: "count", filter: { scope: "branch", branch: "RAIPUR", when: "today" } }],
    ["Pinky ke tasks", { kind: "list", filter: { scope: "person", person: "Pinky", when: "all" } }],
    ["Pinky ka kaam kal ka", { kind: "list", filter: { scope: "person", person: "Pinky", when: "tomorrow" } }],
    ["pinky ke kitne overdue hain", { kind: "count", filter: { scope: "person", person: "Pinky", when: "overdue" } }],
    ["Sunita ke pending tasks", { kind: "list", filter: { scope: "person", person: "Sunita Verma", when: "all" } }],
    ["sunita verma ka kaam", { kind: "list", filter: { scope: "person", person: "Sunita Verma", when: "all" } }],
    ["Rame ke tasks", { kind: "list", filter: { scope: "person", person: "Ramesh Kumar", when: "all" } }],
    ["sabke overdue", { kind: "list", filter: { scope: "all", when: "overdue" } }],
    ["sabke pending", { kind: "list", filter: { scope: "all", when: "all" } }],
    ["sab ke pending", { kind: "list", filter: { scope: "all", when: "all" } }],
    ["sabke kitne overdue hain", { kind: "count", filter: { scope: "all", when: "overdue" } }],
    ["sabka aaj ka kaam", { kind: "list", filter: { scope: "all", when: "today" } }],
    ["sabke urgent tasks", { kind: "list", filter: { scope: "all", when: "all", urgentOnly: true } }],
  ])("%s", (text, expected) => {
    expect(admin(text)).toEqual(expected);
  });

  it("ambiguous or unknown names -> null", () => {
    expect(admin("Pin ke tasks")).toBeNull(); // too short / ambiguous
    expect(admin("Pinku ke tasks")).toEqual({ kind: "list", filter: { scope: "person", person: "Pinku Sharma", when: "all" } });
    expect(admin("Ra ke tasks")).toBeNull();
    expect(admin("Ram ke tasks")).toEqual({ kind: "list", filter: { scope: "person", person: "Ramesh Kumar", when: "all" } });
    expect(admin("Rak ke tasks")).toEqual({ kind: "list", filter: { scope: "person", person: "Rakesh", when: "all" } });
    expect(admin("Rajesh ke tasks")).toBeNull();
    expect(admin("Pinku Pinky ke tasks")).toBeNull();
  });

  it("two scopes in one sentence, or mere + someone else -> null", () => {
    expect(admin("Pinky Durg ke tasks")).toBeNull();
    expect(admin("Durg Raipur ke pending")).toBeNull();
    expect(admin("mere aur Pinky ke tasks")).toBeNull();
    expect(admin("mere Durg ke tasks")).toBeNull();
    expect(admin("sabke Durg ke tasks")).toBeNull();
  });
});

describe("staff asking for others: returned as asked (answer.ts refuses)", () => {
  it("branch and all", () => {
    expect(staff("Durg ke pending")).toEqual({ kind: "list", filter: { scope: "branch", branch: "DURG", when: "all" } });
    expect(staff("sabke overdue")).toEqual({ kind: "list", filter: { scope: "all", when: "overdue" } });
  });
  it("an unknown person -> null", () => {
    expect(staff("Ramesh ke tasks")).toBeNull();
  });
});

describe("write words -> null", () => {
  it.each([
    "mera task done kar do",
    "task done",
    "Sharma wala kaam ho gaya",
    "mere tasks me remark likh do",
    "kal ka kaam badlo",
    "kaam de do Pinky ko",
    "task bana do kal ke liye",
    "naya task banao",
    "tasks add kar do",
    "overdue tasks complete kar do",
    "mere kaam delete kar do",
    "task cancel karo",
    "urgent task banao",
    "Pinky ko kaam do",
    "aaj ka kaam hogaya",
  ])("%s", (t) => {
    expect(admin(t)).toBeNull();
    expect(staff(t)).toBeNull();
  });
});

describe("false positives: a keyword inside another meaning -> null", () => {
  it.each([
    "GST kya hai",
    "aaj ka rate kya hai",
    "aaj ka mausam kaisa hai",
    "kal meeting hai Raipur mein",
    "kal Durg jaana hai",
    "Raipur mein baarish ho rahi hai",
    "pending payment kya hai",
    "mere kaam ka koi fayda nahi",
    "mera kaam bahut accha chal raha hai",
    "kaam kaise karte hain",
    "overdue bill ka kya karna hai",
    "aaj kya karna chahiye business badhane ke liye",
    "late aana mat",
    "office mein aaj party hai",
    "is hafte meri chutti hai",
    "mere tasks aaj kal bahut zyada hain",
    "kitne bajे hain",
    "kitne paise hue",
    "hello",
    "ok",
    "thanks",
    "aaj",
    "kal",
    "hafte",
    "kitne hain",
    "Pinky",
    "Durg",
    "1",
    "",
    "   ",
    "😀",
    "mere tasks dikhao aur batao ki GST kya hai aur kab bharna hai",
    "aaj kal parso ka kaam",
    "aaj ke aur kal ke tasks",
    "overdue aaj ke tasks",
    "parso ka kaam",
  ])("%s", (t) => {
    expect(admin(t)).toBeNull();
    expect(staff(t)).toBeNull();
  });

  it("very long text -> null", () => {
    expect(admin("mere tasks ".repeat(30))).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Round 7: ruleFollowup
// ---------------------------------------------------------------------------------------------
import { looksLikeFollowup, ruleFollowup } from "../../src/chat/rules";
import type { ChatMemory } from "../../src/chat/types";

const mem = (over: Partial<ChatMemory> = {}, ageMin = 2): ChatMemory => ({
  v: 2,
  at: new Date(NOW.getTime() - ageMin * 60_000).toISOString(),
  query: { scope: "mine", when: "all" },
  shown: ["t1", "t2", "t3", "t4"],
  sel: "t2",
  ...over,
});
const fadmin = (t: string, m: ChatMemory | null = mem()) => ruleFollowup(t, { role: "admin", self: "Bhaskar", people: PEOPLE, now: NOW }, m);
const fstaff = (t: string, m: ChatMemory | null = mem()) => ruleFollowup(t, { role: "staff", self: "Pinky", people: [PEOPLE[1]], now: NOW }, m);
const open = (by: "index" | "last" | "selected", n?: number): ChatRequest =>
  ({ kind: "open", ref: by === "index" ? { by, n } : { by } }) as ChatRequest;
const ask = (field: string, extra: object = {}): ChatRequest => ({ kind: "ask_task", field, ...extra }) as ChatRequest;
const sel = { ref: { by: "selected" } };

describe("followup: open", () => {
  it.each([
    ["doosra wala kholo", open("index", 2)],
    ["dusra wala kholo", open("index", 2)],
    ["doosra", open("index", 2)],
    ["Dusra!", open("index", 2)],
    ["2nd", open("index", 2)],
    ["2", open("index", 2)],
    ["number 3", open("index", 3)],
    ["no 3", open("index", 3)],
    ["3 number wala", open("index", 3)],
    ["pehla", open("index", 1)],
    ["pehla wala", open("index", 1)],
    ["pahla wala kholo", open("index", 1)],
    ["teesra", open("index", 3)],
    ["chautha wala dikhao", open("index", 4)],
    ["4th", open("index", 4)],
    ["number 2 kholo", open("index", 2)],
    ["last wala", open("last")],
    ["last wala kholo", open("last")],
    ["aakhri wala", open("last")],
    ["isko kholo", open("selected")],
    ["ise kholo", open("selected")],
    ["3 task kholo", open("index", 3)],
  ])("%s", (t, want) => expect(fadmin(t)).toEqual(want));
  it("works for staff too", () => expect(fstaff("doosra wala kholo")).toEqual(open("index", 2)));
  it("out of range, zero and big numbers are null", () => {
    for (const t of ["5", "number 5", "0", "99", "paanchva wala", "chhatha"]) expect(fadmin(t)).toBeNull();
  });
  it("needs a fresh memory with shown", () => {
    for (const t of ["2", "doosra wala kholo", "last wala", "isko kholo"]) {
      expect(fadmin(t, null)).toBeNull();
      expect(fadmin(t, mem({}, 20))).toBeNull();
    }
    expect(fadmin("2", mem({ shown: [] }))).toBeNull();
    expect(fadmin("last wala", mem({ shown: undefined }))).toBeNull();
    expect(fadmin("isko kholo", mem({ sel: null }))).toBeNull();
  });
  it("bare 'task' without a verb, or unknown words, are null", () => {
    for (const t of ["2 tasks", "2 baje", "doosra wala kaam hai", "2 aur 3", "isko", "kholo"]) expect(fadmin(t)).toBeNull();
  });
});

describe("followup: refine", () => {
  it.each([
    ["sirf urgent wale", { urgentOnly: true }],
    ["urgent wale", { urgentOnly: true }],
    ["sirf urjent", { urgentOnly: true }],
    ["kal wale", { when: "tomorrow" }],
    ["sirf kal wale", { when: "tomorrow" }],
    ["aaj wale", { when: "today" }],
    ["overdue wale", { when: "overdue" }],
    ["late wale", { when: "overdue" }],
    ["is hafte wale", { when: "week" }],
    ["iss hafte ke wale", { when: "week" }],
    ["sab dikhao", { when: "all", urgentOnly: false }],
    ["sab wale", { when: "all", urgentOnly: false }],
    ["sirf aaj ke urgent wale", { when: "today", urgentOnly: true }],
  ])("%s (admin)", (t, changes) => expect(fadmin(t)).toEqual({ kind: "refine", changes }));
  it("staff may refine time and urgency", () => {
    expect(fstaff("sirf urgent wale")).toEqual({ kind: "refine", changes: { urgentOnly: true } });
    expect(fstaff("kal wale")).toEqual({ kind: "refine", changes: { when: "tomorrow" } });
    expect(fstaff("overdue wale")).toEqual({ kind: "refine", changes: { when: "overdue" } });
  });
  it("admin branch and person", () => {
    expect(fadmin("Durg ke")).toEqual({ kind: "refine", changes: { branch: "DURG" } });
    expect(fadmin("durg wale")).toEqual({ kind: "refine", changes: { branch: "DURG" } });
    expect(fadmin("sirf Raipur ke")).toEqual({ kind: "refine", changes: { branch: "RAIPUR" } });
    expect(fadmin("Pinky ke")).toEqual({ kind: "refine", changes: { person: "Pinky" } });
    expect(fadmin("sirf Rakesh ke")).toEqual({ kind: "refine", changes: { person: "Rakesh" } });
    expect(fadmin("durg ke urgent wale")).toEqual({ kind: "refine", changes: { branch: "DURG", urgentOnly: true } });
    expect(fadmin("bhaskar ke")).toEqual({ kind: "refine", changes: { scope: "mine" } });
  });
  it("staff: branch or person names are null", () => {
    for (const t of ["Durg ke", "sirf Raipur ke", "Pinky ke", "durg ke urgent wale", "Rakesh wale"]) expect(fstaff(t)).toBeNull();
  });
  it("ambiguous or unknown names, conflicts and weak phrases are null", () => {
    for (const t of ["Pin ke", "Ramesh Sharma ke", "kal aaj wale", "overdue aaj wale", "sab urgent wale", "durg raipur ke", "urgent", "kal", "aaj ke"]) expect(fadmin(t)).toBeNull();
  });
  it("needs a fresh memory", () => {
    expect(fadmin("sirf urgent wale", null)).toBeNull();
    expect(fadmin("sirf urgent wale", mem({}, 16))).toBeNull();
  });
  it("full list requests are left to ruleRequest", () => {
    for (const t of ["mere tasks", "aaj ke tasks", "urgent kaam", "kitne pending hain", "durg ke tasks"]) expect(fadmin(t)).toBeNull();
  });
});

describe("followup: more and reset", () => {
  it.each(["aur dikhao", "aur", "next", "show more", "baaki dikhao", "agla", "next page", "aur dikhaiye", "more"])("more: %s", (t) => {
    expect(fadmin(t)).toEqual({ kind: "more" });
    expect(fstaff(t)).toEqual({ kind: "more" });
  });
  it("more needs a fresh memory", () => {
    expect(fadmin("aur dikhao", null)).toBeNull();
    expect(fadmin("aur dikhao", mem({}, 30))).toBeNull();
  });
  it("'baaki kaam' is a list, not more", () => expect(fadmin("baaki kaam kya hai")).toBeNull());
  it.each(["shuru se", "reset", "Reset!", "naya", "clear", "phir se shuru", "sab clear"])("reset: %s (even without memory)", (t) => {
    expect(fadmin(t, null)).toEqual({ kind: "reset" });
    expect(fstaff(t, mem({}, 60))).toEqual({ kind: "reset" });
  });
  it("reset with other words is null", () => {
    for (const t of ["naya task", "naya kaam banao", "shuru se kar do"]) expect(fadmin(t, null)).toBeNull();
  });
});

describe("followup: questions about the selected task", () => {
  it.each([
    ["iski due date kya hai", "due"],
    ["iski due date kya hai?", "due"],
    ["iska due kab hai", "due"],
    ["kab tak hai", "due"],
    ["kab tak karna hai", "due"],
    ["is task ki deadline", "due"],
    ["iski last date", "due"],
    ["kisko diya hai", "assignee"],
    ["ye kisko diya hai", "assignee"],
    ["kiska hai", "assignee"],
    ["iska assignee kaun hai", "assignee"],
    ["kisne diya", "creator"],
    ["kisne diya hai", "creator"],
    ["kisne banaya", "creator"],
    ["status kya hai", "status"],
    ["iska status", "status"],
    ["pending hai ya done", "status"],
    ["last update kya tha", "last_remark"],
    ["iska last remark", "last_remark"],
    ["aakhri update kya hai", "last_remark"],
    ["kitne remark hai", "remark_count"],
    ["kitne remarks hain", "remark_count"],
    ["isme kitne updates hain", "remark_count"],
    ["kab banaya", "created"],
    ["ye kab banaya gaya", null],
    ["iska creation date", null],
    ["kab done hua", "done_at"],
    ["done kab hua", "done_at"],
    ["urgent hai kya", "urgent"],
    ["is task ki detail", "all"],
    ["iske baare mein batao", "all"],
    ["repeat hota hai kya", "repeat"],
    ["isko kisne diya", "creator"],
  ])("%s", (t, field) => {
    const want = field ? ask(field, sel) : null;
    expect(fadmin(t)).toEqual(want);
    if (field) expect(fstaff(t)).toEqual(want);
  });
  it("typo and Hinglish variants", () => {
    expect(fadmin("iski Due Date kya hai??")).toEqual(ask("due", sel));
    expect(fadmin("kitnee remark hai")).toEqual(ask("remark_count", sel));
    expect(fadmin("iski dueee date")).toEqual(ask("due", sel));
  });
  it("needs memory.sel (fresh)", () => {
    for (const t of ["iski due date kya hai", "kab tak hai", "kisko diya hai", "status kya hai"]) {
      expect(fadmin(t, null)).toBeNull();
      expect(fadmin(t, mem({ sel: null }))).toBeNull();
      expect(fadmin(t, mem({}, 30))).toBeNull();
    }
  });
  it("with an index reference uses shown (in range only)", () => {
    expect(fadmin("doosre wale ki due date kya hai")).toEqual(ask("due", { ref: { by: "index", n: 2 } }));
    expect(fadmin("2nd ka status")).toEqual(ask("status", { ref: { by: "index", n: 2 } }));
    expect(fadmin("last wale ka due kab hai")).toEqual(ask("due", { ref: { by: "last" } }));
    expect(fadmin("number 9 ka due kab hai")).toBeNull();
    expect(fadmin("doosre wale ka status", mem({ shown: [] }))).toBeNull();
    expect(fadmin("iska doosra due", mem())).toBeNull();
  });
  it("naming a task gives ask_task with taskWords, with or without memory", () => {
    expect(fadmin("Sharma payment ka due kab hai", null)).toEqual(ask("due", { taskWords: ["sharma", "payment"] }));
    expect(fstaff("sharma payment ka due kab hai")).toEqual(ask("due", { taskWords: ["sharma", "payment"] }));
    expect(fadmin("GST file kisko diya hai", mem({ sel: null }))).toEqual(ask("assignee", { taskWords: ["gst", "file"] }));
    expect(fadmin("Sharma payment ka status", mem({}, 40))).toEqual(ask("status", { taskWords: ["sharma", "payment"] }));
    expect(fadmin("bank task ke kitne remark hain", null)).toEqual(ask("remark_count", { taskWords: ["bank"] }));
  });
  it("a name together with 'iska' is null; too many or odd words are null", () => {
    expect(fadmin("iska sharma due")).toBeNull();
    expect(fadmin("a b c d e ka due kab hai")).toBeNull();
    expect(fadmin("mere task ka due kab hai")).toBeNull();
    expect(fadmin("kal ka due kab hai")).toBeNull();
    expect(fadmin("due urgent wale")).toBeNull();
  });
  it("two different questions at once are null", () => {
    expect(fadmin("iska due aur status")).toBeNull();
  });
});

describe("followup: write words always null", () => {
  it.each([
    "isko done kar do",
    "done",
    "iska due kal kar do",
    "iski due date badlo",
    "remark likh do ki call kiya",
    "doosra wala done kar do",
    "2 ko done mark karo",
    "iska update kar do",
    "urgent wale done kar do",
    "naya task banao",
    "aur remark daalo",
    "iski due date kal kar do",
    "kisko de do",
    "reset kar do",
    "isko Pinky ko assign karo",
    "kisne diya delete karo",
  ])("%s", (t) => {
    expect(fadmin(t)).toBeNull();
    expect(fadmin(t, null)).toBeNull();
    expect(fstaff(t)).toBeNull();
  });
});

describe("followup: junk and limits", () => {
  it("empty, long and unrelated text are null", () => {
    for (const t of ["", "   ", "🙏", "GST kya hai", "kaise ho", "namaste", "x".repeat(300), "hello bhai kaise ho aap sab log aaj kal", "thik hai"]) expect(fadmin(t)).toBeNull();
    expect(fadmin(undefined as never)).toBeNull();
  });
  it("too many words are null", () => {
    expect(fadmin("iski due date kya hai bataiye mujhe zara jaldi se ab")).toBeNull();
  });
});

describe("followup: number forms (Round 7 fix)", () => {
  it.each([
    ["2.", open("index", 2)], ["2)", open("index", 2)], ["#2", open("index", 2)], ["2 ji", open("index", 2)],
    ["task 2", open("index", 2)], ["task number 3", open("index", 3)], ["task no 1", open("index", 1)],
    ["number do", open("index", 2)], ["number teen", open("index", 3)], ["teen wala kholo", open("index", 3)],
    ["ek", open("index", 1)], ["do", open("index", 2)], ["teen", open("index", 3)], ["char", open("index", 4)],
    ["char wala", open("index", 4)], ["ek wala dikhao", open("index", 1)], ["number char kholo", open("index", 4)],
    ["dusra wala khol do", open("index", 2)], ["dusra wala open karo", open("index", 2)],
    ["dusra wala open kar do", open("index", 2)], ["pehla wala dikha do", open("index", 1)], ["teesra dikhao", open("index", 3)],
    ["isko khol do", open("selected")], ["last wala khol do", open("last")], ["1st", open("index", 1)], ["4th", open("index", 4)],
  ])("%s", (t, want) => expect(fadmin(t)).toEqual(want));
  it("out of range, no memory or stale memory: null", () => {
    for (const t of ["number paanch", "paanch", "task 7", "5.", "#9"]) expect(fadmin(t)).toBeNull();
    for (const t of ["2.", "number do", "task 2", "teen wala kholo"]) {
      expect(fadmin(t, null)).toBeNull();
      expect(fadmin(t, mem({}, 20))).toBeNull();
    }
  });
  it("write phrases still return null", () => {
    for (const t of [
      "kar do", "do", "de do", "dusra wala done kar do", "dusra wala delete karo", "pehla wala hata do", "2 done karo",
      "number do done kar do", "pehla wala badlo", "task 2 likh do", "isko Pinky ko de do", "khol do aur done kar do",
      "doosra wala kar do", "2 kar do", "teen wala karo", "last wala bana do", "pehla open karo done",
    ]) {
      if (t === "do") continue; // a lone "do" is the spoken number two (see above)
      expect(fadmin(t), t).toBeNull();
    }
  });
  it("a lone 'do' is task 2 only when the whole message is just the number", () => {
    expect(fadmin("do")).toEqual(open("index", 2));
    expect(fadmin("do ji")).toEqual(open("index", 2));
    expect(fadmin("kar do")).toBeNull();
    expect(fadmin("de do")).toBeNull();
  });
});

describe("looksLikeFollowup", () => {
  it.each([
    "2", "2.", "2)", "#2", "2 ji", "number 3", "task 2", "ek", "do", "teen", "number do", "teen wala kholo", "pehla", "doosra wala",
    "1st", "8th", "last wala", "aakhri wala", "isko kholo", "dusra wala khol do", "dusra wala open karo", "3 wala dikhao",
    "aur dikhao", "aur", "next", "show more", "baaki dikhao", "sirf urgent wale", "kal wale", "overdue wale", "aaj wale", "Durg ke wale",
    "sab dikhao", "iski due date kya hai", "kisko diya hai", "kisne diya", "last update kya tha", "kitne remark hain", "kab tak hai",
    "kab banaya", "status kya hai", "shuru se", "reset", "naya",
    "99",
  ])("true: %s", (t) => expect(looksLikeFollowup(t)).toBe(true));

  it.each([
    "Sharma ji ko payment ka reminder dena hai", "done kar do", "kar do", "de do", "2 done kar do", "dusra wala done kar do",
    "pehla wala delete karo", "isko Pinky ko de do", "task 2 likh do", "iski date badlo",
    "mere pending tasks", "mere tasks dikhao", "Pinky ke tasks", "kitne pending hain", "aaj ke tasks", "hi", "ok", "thanks", "menu", "",
    "0", "100", "2 baje", "3 tasks", "2 aur 3", "kholo", "khol do", "isko", "kal kya karna hai", "kal meeting hai",
    "Ramesh ko bolo", "x".repeat(10_000), "kab ".repeat(60), "is ".repeat(100),
  ])("false: %s", (t) => expect(looksLikeFollowup(t)).toBe(false));

  it("is safe and fast on huge or odd input", () => {
    const t0 = performance.now();
    for (const t of ["a".repeat(10_000), "2 ".repeat(5000), "\u0000".repeat(500), "😀".repeat(3000), "constructor", "__proto__"]) {
      expect(() => looksLikeFollowup(t)).not.toThrow();
      expect(looksLikeFollowup(t)).toBe(false);
    }
    expect(performance.now() - t0).toBeLessThan(200);
  });
  it("non-strings are false", () => expect(looksLikeFollowup(undefined as never)).toBe(false));
});
