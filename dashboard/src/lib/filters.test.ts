import { describe, expect, it } from "vitest";
import { ADMINS, ALL, applyFilters, applySummary, approvalCount, filterArchive, groupUsers, summaryCounts } from "./filters";
import type { Branch, TaskDTO, UserDTO } from "./types";

const branches: Branch[] = [
  { id: "RAIPUR", name: "Raipur" },
  { id: "DURG", name: "Durg" },
];
const users: UserDTO[] = [
  { phone: "1", name: "Hema", role: "staff", branch: "DURG" },
  { phone: "2", name: "Ravi", role: "staff", branch: "RAIPUR" },
  { phone: "3", name: "Bhaskar", role: "admin", branch: null },
];

function task(p: Partial<TaskDTO>): TaskDTO {
  return {
    id: "t", title: "Task", assigneePhone: "1", assigneeName: "Hema", branch: "DURG",
    createdByPhone: "3", createdByName: "Bhaskar", dueAt: "2026-10-28T04:30:00Z", dueHasTime: true,
    status: "pending", repeat: "none", repeatDay: null, nextReminderAt: null, lastReminderAt: null,
    dateRequest: null, remarks: [], createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    doneAt: null, cancelledAt: null, cancelledByName: null, overdue: false, dueToday: false,
    closedAt: null, lastRemark: null, ...p,
  };
}

const tasks = [
  task({ id: "a", title: "Tiles stock check", overdue: true }),
  task({ id: "b", title: "GST file", assigneePhone: "2", assigneeName: "Ravi", branch: "RAIPUR", dueToday: true }),
  task({ id: "c", title: "Bank visit", assigneePhone: "3", assigneeName: "Bhaskar", branch: null }),
];

describe("filters", () => {
  it("searches title and assignee name, case-insensitive", () => {
    expect(applyFilters(tasks, { branch: ALL, staffPhone: null, query: "gst" }, users).map((t) => t.id)).toEqual(["b"]);
    expect(applyFilters(tasks, { branch: ALL, staffPhone: null, query: "HEMA" }, users).map((t) => t.id)).toEqual(["a"]);
    expect(applyFilters(tasks, { branch: ALL, staffPhone: null, query: "  " }, users)).toHaveLength(3);
  });
  it("filters by branch and admins", () => {
    expect(applyFilters(tasks, { branch: "RAIPUR", staffPhone: null, query: "" }, users).map((t) => t.id)).toEqual(["b"]);
    expect(applyFilters(tasks, { branch: ADMINS, staffPhone: null, query: "" }, users).map((t) => t.id)).toEqual(["c"]);
  });
  it("filters by staff", () => {
    expect(applyFilters(tasks, { branch: ALL, staffPhone: "1", query: "" }, users).map((t) => t.id)).toEqual(["a"]);
  });
  it("counts summary and filters by it", () => {
    expect(summaryCounts(tasks)).toEqual({ pending: 3, overdue: 1, today: 1 });
    expect(applySummary(tasks, "overdue").map((t) => t.id)).toEqual(["a"]);
    expect(applySummary(tasks, "today").map((t) => t.id)).toEqual(["b"]);
    expect(applySummary(tasks, "all")).toHaveLength(3);
  });
  it("counts date requests", () => {
    const req = { dueAt: "2026-12-01T04:30:00Z", hasTime: false, remark: "", byPhone: "1", byName: "Hema", requestedAt: "2026-10-26T04:30:00Z" };
    expect(approvalCount([...tasks, task({ id: "d", dateRequest: req })])).toBe(1);
  });
  it("filters and sorts archive newest first", () => {
    const arch = [
      task({ id: "x", status: "done", closedAt: "2026-10-20T00:00:00Z" }),
      task({ id: "y", status: "cancelled", closedAt: "2026-10-25T00:00:00Z" }),
      task({ id: "z", status: "done", closedAt: "2026-10-26T00:00:00Z" }),
    ];
    expect(filterArchive(arch, "all").map((t) => t.id)).toEqual(["z", "y", "x"]);
    expect(filterArchive(arch, "done").map((t) => t.id)).toEqual(["z", "x"]);
    expect(filterArchive(arch, "cancelled").map((t) => t.id)).toEqual(["y"]);
  });
  it("groups users by branch with admins last", () => {
    expect(groupUsers(users, branches, "").map((g) => g.label)).toEqual(["Raipur", "Durg", "Admins"]);
    expect(groupUsers(users, branches, "bha").map((g) => g.label)).toEqual(["Admins"]);
  });
});
