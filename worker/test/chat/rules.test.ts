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
