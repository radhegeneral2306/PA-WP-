import { describe, expect, it } from "vitest";
import { branchStats } from "./branchStats";
import { ADMINS } from "./filters";
import type { Branch, TaskDTO, UserDTO } from "./types";

const branches: Branch[] = [
  { id: "RAIPUR", name: "Raipur" },
  { id: "DURG", name: "Durg" },
];
const users: UserDTO[] = [
  { phone: "1", name: "Hema", role: "staff", branch: "DURG" },
  { phone: "2", name: "Ravi", role: "staff", branch: "RAIPUR" },
  { phone: "3", name: "Bhaskar", role: "admin", branch: null },
  { phone: "4", name: "Nobranch", role: "staff", branch: null },
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

describe("branchStats", () => {
  it("counts pending, overdue and aaj due per branch in API order", () => {
    const s = branchStats(
      [
        task({ id: "a", overdue: true }),
        task({ id: "b", dueToday: true, urgent: true }),
        task({ id: "c", assigneePhone: "2", branch: "RAIPUR" }),
      ],
      users,
      branches,
    );
    expect(s.rows.map((r) => r.key)).toEqual(["RAIPUR", "DURG"]);
    expect(s.rows[0]).toMatchObject({ pending: 1, overdue: 0, today: 0 });
    expect(s.rows[1]).toMatchObject({ pending: 2, overdue: 1, today: 1 });
  });
  it("lists every branch even with no tasks, Admins only when it has some", () => {
    const empty = branchStats([], users, branches);
    expect(empty.rows.map((r) => r.pending)).toEqual([0, 0]);
    const withAdmin = branchStats([task({ id: "x", assigneePhone: "3", branch: null, overdue: true })], users, branches);
    const last = withAdmin.rows[withAdmin.rows.length - 1];
    expect(last).toMatchObject({ key: ADMINS, label: "Admins", pending: 1, overdue: 1 });
    expect(withAdmin.rows[0].pending).toBe(0);
  });
  it("excludes closed tasks and keeps tasks without a branch out of branch rows", () => {
    const s = branchStats(
      [
        task({ id: "d", status: "done" }),
        task({ id: "c", status: "cancelled" }),
        task({ id: "r", status: "deleted" }),
        task({ id: "n", assigneePhone: "4", branch: null, dueToday: true }),
        task({ id: "u", assigneePhone: "9", branch: null }),
      ],
      users,
      branches,
    );
    expect(s.rows.find((r) => r.key === "DURG")?.pending).toBe(0);
    expect(s.other).toEqual({ pending: 1, overdue: 0, today: 1 });
    expect(s.rows.find((r) => r.key === ADMINS)?.pending).toBe(1);
  });
  it("counts an admin's task under Admins even when it has a branch", () => {
    const s = branchStats([task({ assigneePhone: "3", branch: "DURG" })], users, branches);
    expect(s.rows.find((r) => r.key === "DURG")?.pending).toBe(0);
    expect(s.rows.find((r) => r.key === ADMINS)?.pending).toBe(1);
  });
});
