import { describe, expect, it } from "vitest";
import { canSeeTask, describeTask } from "../../src/chat/taskInfo";
import type { Task, TaskStatus, User } from "../../src/domain/types";
import type { TaskField } from "../../src/chat/types";

const NOW = new Date("2026-11-19T10:00:00Z"); // 3:30 PM IST
const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Sharma payment",
  assigneePhone: "919000000001",
  assigneeName: "Pinky",
  branch: "DURG",
  createdByPhone: "919000000002",
  createdByName: "Bhaskar",
  dueAt: "2026-11-21T11:30:00Z", // 21 Nov, 5:00 PM IST
  dueHasTime: true,
  status: "pending",
  repeat: "none",
  nextReminderAt: null,
  remarks: [],
  createdAt: "2026-11-15T05:00:00Z",
  updatedAt: "2026-11-15T05:00:00Z",
  doneAt: null,
  ...over,
});
const user = (role: "admin" | "staff", phone: string): User => ({ phone, name: "X", role, branch: null, active: true, createdAt: "2026-01-01T00:00:00Z" });

describe("canSeeTask", () => {
  const statuses: TaskStatus[] = ["pending", "done", "cancelled", "deleted"];
  for (const status of statuses) {
    it(`admin: ${status}`, () => {
      expect(canSeeTask(user("admin", "919000000099"), task({ status }))).toBe(status !== "deleted");
    });
    it(`staff assignee / creator / other: ${status}`, () => {
      const vis = status !== "deleted";
      expect(canSeeTask(user("staff", "919000000001"), task({ status }))).toBe(vis);
      expect(canSeeTask(user("staff", "919000000002"), task({ status }))).toBe(vis);
      expect(canSeeTask(user("staff", "919000000003"), task({ status }))).toBe(false);
    });
  }
  it("admin who is the assignee still cannot see a deleted task", () => {
    expect(canSeeTask(user("admin", "919000000001"), task({ status: "deleted" }))).toBe(false);
  });
});

describe("describeTask", () => {
  it("due with IST time and no overdue note", () => {
    const s = describeTask(task(), "due", NOW);
    expect(s).toContain("*Sharma payment*");
    expect(s).toContain("21 Nov, 5:00 PM");
    expect(s).not.toContain("overdue");
  });
  it("due without time shows only the day", () => {
    expect(describeTask(task({ dueHasTime: false }), "due", NOW)).toContain("Due: 21 Nov");
    expect(describeTask(task({ dueHasTime: false }), "due", NOW)).not.toContain("PM");
  });
  it("overdue pending task has an overdue note; a done one does not", () => {
    const late = task({ dueAt: "2026-11-17T04:30:00Z" });
    expect(describeTask(late, "due", NOW)).toContain("overdue");
    expect(describeTask(late, "status", NOW)).toContain("Overdue");
    expect(describeTask({ ...late, status: "done", doneAt: "2026-11-18T05:00:00Z" }, "due", NOW)).not.toContain("overdue");
  });
  it("assignee, creator, creator = assignee", () => {
    expect(describeTask(task(), "assignee", NOW)).toContain("Pinky ko diya");
    expect(describeTask(task(), "creator", NOW)).toContain("Bhaskar ne");
    expect(describeTask(task({ createdByPhone: "919000000001", createdByName: "Pinky" }), "creator", NOW)).toContain("khud ke liye");
  });
  it("status for every state", () => {
    expect(describeTask(task(), "status", NOW)).toContain("pending");
    expect(describeTask(task({ status: "done", doneAt: "2026-11-18T05:00:00Z" }), "status", NOW)).toContain("Done ho chuka hai (18 Nov, 10:30 AM)");
    expect(describeTask(task({ status: "done", doneAt: null }), "status", NOW)).toContain("Done ho chuka hai.");
    expect(describeTask(task({ status: "cancelled", cancelledByName: "Bhaskar" }), "status", NOW)).toContain("band");
  });
  it("urgent yes and no", () => {
    expect(describeTask(task({ urgent: true }), "urgent", NOW)).toContain("Haan");
    expect(describeTask(task({ urgent: true }), "urgent", NOW)).toContain("🔴");
    expect(describeTask(task(), "urgent", NOW)).toContain("Nahi");
  });
  it("repeat texts", () => {
    expect(describeTask(task(), "repeat", NOW)).toContain("repeat nahi hota");
    expect(describeTask(task({ repeat: "weekly" }), "repeat", NOW)).toContain("Har hafte Shaniwar"); // 21 Nov 2026 is a Saturday
  });
  it("weekly weekday uses IST (late-night UTC rolls over)", () => {
    // 2026-11-20T20:00Z = 21 Nov 1:30 AM IST (Saturday)
    expect(describeTask(task({ repeat: "weekly", dueAt: "2026-11-20T20:00:00Z" }), "repeat", NOW)).toContain("Shaniwar");
  });
  it("monthly uses repeatDay, else the due day", () => {
    expect(describeTask(task({ repeat: "monthly", repeatDay: 31 }), "repeat", NOW)).toContain("31 tareekh");
    expect(describeTask(task({ repeat: "monthly" }), "repeat", NOW)).toContain("21 tareekh");
    expect(describeTask(task({ repeat: "every90" }), "repeat", NOW)).toContain("90 minute");
  });
  it("last remark with time, by whom", () => {
    const t = task({ remarks: [{ at: "2026-11-18T05:00:00Z", byPhone: "919000000001", byName: "Pinky", text: "Party ne kal bola" }] });
    const s = describeTask(t, "last_remark", NOW);
    expect(s).toContain("18 Nov, 10:30 AM");
    expect(s).toContain("Party ne kal bola");
    expect(s).toContain("Pinky");
  });
  it("no remark says so", () => {
    expect(describeTask(task(), "last_remark", NOW)).toContain("Abhi koi remark nahi hai.");
    expect(describeTask(task(), "remark_count", NOW)).toContain("Abhi koi remark nahi hai.");
  });
  it("skips voice / chat creation notes", () => {
    const r = (text: string, at: string) => ({ at, byPhone: "1", byName: "A", text });
    const t = task({ remarks: [r("Call kiya", "2026-11-17T05:00:00Z"), r("Voice se banaya", "2026-11-18T05:00:00Z"), r("Chat se banaya gaya", "2026-11-18T06:00:00Z")] });
    const s = describeTask(t, "last_remark", NOW);
    expect(s).toContain("Call kiya");
    expect(s).not.toContain("banaya");
    expect(describeTask(t, "remark_count", NOW)).toContain("1 remark hai");
    const onlyNotes = task({ remarks: [r("Voice se banaya (audio)", "2026-11-18T05:00:00Z")] });
    expect(describeTask(onlyNotes, "last_remark", NOW)).toContain("koi remark nahi");
  });
  it("remark count plural", () => {
    const r = (text: string) => ({ at: "2026-11-18T05:00:00Z", byPhone: "1", byName: "A", text });
    expect(describeTask(task({ remarks: [r("a"), r("b"), r("c")] }), "remark_count", NOW)).toContain("3 remark hain");
  });
  it("clips long remarks", () => {
    const long = "x".repeat(400);
    const s = describeTask(task({ remarks: [{ at: "2026-11-18T05:00:00Z", byPhone: "1", byName: "A", text: long }] }), "last_remark", NOW);
    expect(s.length).toBeLessThan(260);
    expect(s).toContain("…");
  });
  it("created and done_at, with and without data", () => {
    expect(describeTask(task(), "created", NOW)).toContain("15 Nov, 10:30 AM ko Bhaskar ne banaya");
    expect(describeTask(task(), "done_at", NOW)).toContain("pending");
    expect(describeTask(task({ status: "done", doneAt: "2026-11-18T05:00:00Z" }), "done_at", NOW)).toContain("18 Nov, 10:30 AM");
    expect(describeTask(task({ status: "done", doneAt: null }), "done_at", NOW)).toContain("record nahi");
    expect(describeTask(task({ status: "cancelled" }), "done_at", NOW)).toContain("done nahi");
  });
  it("all: at most 6 lines, with title, kisko, due, status, last remark", () => {
    const t = task({ urgent: true, repeat: "weekly", remarks: [{ at: "2026-11-18T05:00:00Z", byPhone: "1", byName: "A", text: "Call kiya" }] });
    const s = describeTask(t, "all", NOW);
    expect(s.split("\n").length).toBeLessThanOrEqual(6);
    expect(s).toContain("🔴 *Sharma payment*");
    expect(s).toContain("Kisko: Pinky");
    expect(s).toContain("Due: 21 Nov, 5:00 PM");
    expect(s).toContain("Status:");
    expect(s).toContain("Call kiya");
    expect(describeTask(task(), "all", NOW)).toContain("Abhi koi remark nahi hai.");
  });
  it("every field stays within 6 lines and never leaks phone numbers", () => {
    const t = task({
      title: "Call 919876543210 abhi",
      remarks: [{ at: "2026-11-18T05:00:00Z", byPhone: "919876543210", byName: "A", text: "Number 98765 43210 pe call" }],
    });
    const fields: TaskField[] = ["due", "assignee", "creator", "status", "urgent", "repeat", "last_remark", "remark_count", "created", "done_at", "all"];
    for (const f of fields) {
      const s = describeTask(t, f, NOW);
      expect(s.split("\n").length).toBeLessThanOrEqual(6);
      expect(s).not.toMatch(/\d{10}/);
      expect(s).not.toContain("9190000");
    }
  });
});
