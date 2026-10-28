import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import type { Health, Task } from "../../src/domain/types";
import { alertDueAt, alertRecipients, recordProblems, runHealthCheck, SUPER_ADMIN_NAME } from "../../src/scheduler/health";
import { ADMIN, ADMIN2, INACTIVE, NOW, STAFF_DURG, USERS, task } from "../helpers/bot";

// NOW = 2026-10-26 15:00 IST; the real cron runs at 10:00 IST.
const CHECK = new Date("2026-10-27T04:30:00Z"); // 27 Oct 10:00 IST
const HOUR = 3_600_000;
const INACTIVE_ADMIN = { ...ADMIN2, phone: "919000000098", name: "Old Admin", active: false };

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function healthyStore(tasks: Task[] = []): MemoryStore {
  const s = new MemoryStore({ users: [...USERS, INACTIVE_ADMIN], tasks });
  s.lastWebhookAt = new Date(CHECK.getTime() - 2 * HOUR);
  return s;
}

const alerts = (s: MemoryStore) => [...s.tasks.values()].filter((t) => t.title.startsWith("Bot check:"));

describe("recordProblems", () => {
  it("creates system/health with since = now", async () => {
    const s = new MemoryStore();
    await recordProblems(s, NOW, { sendFailures: 2, problem: "text send failed 401" });
    expect(s.health).toEqual<Health>({
      since: NOW.toISOString(),
      sendFailures: 2,
      templateFailures: 0,
      errors: 0,
      lastProblem: "text send failed 401",
      lastProblemAt: NOW.toISOString(),
      lastCheckAt: null,
    });
  });

  it("accumulates and keeps since", async () => {
    const s = new MemoryStore();
    await recordProblems(s, NOW, { sendFailures: 1, templateFailures: 1 });
    const later = new Date(NOW.getTime() + HOUR);
    await recordProblems(s, later, { sendFailures: 2, errors: 1, problem: "cron reminders failed" });
    expect(s.health).toMatchObject({
      since: NOW.toISOString(),
      sendFailures: 3,
      templateFailures: 1,
      errors: 1,
      lastProblem: "cron reminders failed",
      lastProblemAt: later.toISOString(),
    });
  });

  it("does nothing when there is nothing to record", async () => {
    const s = new MemoryStore();
    await recordProblems(s, NOW, { sendFailures: 0 });
    expect(s.health).toBeNull();
  });

  it("masks phone numbers in the problem text", async () => {
    const s = new MemoryStore();
    await recordProblems(s, NOW, { errors: 1, problem: "bot failed for 919000000011" });
    expect(s.health!.lastProblem).toBe("bot failed for ***");
  });

  it("never throws, even when the store fails", async () => {
    const s = new MemoryStore();
    vi.spyOn(s, "getHealth").mockRejectedValue(new Error("firestore down"));
    await expect(recordProblems(s, NOW, { errors: 1 })).resolves.toBeUndefined();
    vi.spyOn(s, "getHealth").mockResolvedValue(null);
    vi.spyOn(s, "saveHealth").mockRejectedValue(new Error("firestore down"));
    await expect(recordProblems(s, NOW, { errors: 1 })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("runHealthCheck", () => {
  it("creates nothing when all is well, but still records the check", async () => {
    const s = healthyStore([task({ nextReminderAt: new Date(CHECK.getTime() + HOUR).toISOString() })]);
    expect(await runHealthCheck(s, CHECK)).toEqual([]);
    expect(alerts(s)).toHaveLength(0);
    expect(s.health).toMatchObject({ since: CHECK.toISOString(), lastCheckAt: CHECK.toISOString(), sendFailures: 0 });
  });

  it("a. alerts on counters since the last check", async () => {
    const s = healthyStore();
    await recordProblems(s, NOW, { sendFailures: 3, templateFailures: 1, errors: 2, problem: "template task_reminder_v1 failed 400, fell back to text" });
    await runHealthCheck(s, CHECK);
    const [a] = alerts(s);
    expect(a.title).toMatch(/^Bot check: 3 message fail hue, 1 template fail \(text bheja\), 2 error aaye\./);
    expect(a.title).toContain("template task_reminder_v1 failed 400");
    expect(a.title.length).toBeLessThanOrEqual(200);
  });

  it("b. alerts when no webhook arrived for 48 hours", async () => {
    const s = healthyStore();
    s.lastWebhookAt = new Date(CHECK.getTime() - 50 * HOUR);
    await runHealthCheck(s, CHECK);
    expect(alerts(s)[0].title).toBe("Bot check: 50 ghante se koi message nahi aaya. Interakt/Cloudflare check karein");
  });

  it("b. does not alert at 47 hours of silence", async () => {
    const s = healthyStore();
    s.lastWebhookAt = new Date(CHECK.getTime() - 47 * HOUR);
    await runHealthCheck(s, CHECK);
    expect(alerts(s)).toHaveLength(0);
  });

  it("b. alerts when no webhook was ever logged", async () => {
    const s = healthyStore();
    s.lastWebhookAt = null;
    await runHealthCheck(s, CHECK);
    expect(alerts(s)[0].title).toContain("koi incoming message record nahi mila");
  });

  it("c. alerts on a reminder backlog older than 60 minutes", async () => {
    const late = (min: number) => new Date(CHECK.getTime() - min * 60_000).toISOString();
    const s = healthyStore([
      task({ id: "a", nextReminderAt: late(90) }),
      task({ id: "b", nextReminderAt: late(61) }),
      task({ id: "c", nextReminderAt: late(30) }), // within the hour: fine
      task({ id: "d", nextReminderAt: late(300), status: "done" }),
      task({ id: "e", nextReminderAt: null }),
    ]);
    await runHealthCheck(s, CHECK);
    expect(alerts(s)[0].title).toBe("Bot check: 2 reminder 60 min se zyada late (reminder cron atka?). Interakt/Cloudflare check karein");
  });

  it("c. ignores late reminders of inactive assignees", async () => {
    const s = healthyStore([
      task({ assigneePhone: INACTIVE.phone, assigneeName: INACTIVE.name, nextReminderAt: new Date(CHECK.getTime() - 5 * HOUR).toISOString() }),
    ]);
    await runHealthCheck(s, CHECK);
    expect(alerts(s)).toHaveLength(0);
  });

  it("combines several problems into one title", async () => {
    const s = healthyStore();
    s.lastWebhookAt = new Date(CHECK.getTime() - 60 * HOUR);
    await recordProblems(s, NOW, { sendFailures: 3 });
    await runHealthCheck(s, CHECK);
    expect(alerts(s)[0].title).toBe("Bot check: 3 message fail hue, 60 ghante se koi message nahi aaya. Interakt/Cloudflare check karein");
  });

  it("alerts only the super admin (Bhaskar), not other admins or staff", async () => {
    const s = healthyStore();
    s.lastWebhookAt = null;
    const outs = await runHealthCheck(s, CHECK);
    const a = alerts(s);
    expect(ADMIN.name).toBe(SUPER_ADMIN_NAME);
    expect(a.map((t) => t.assigneePhone)).toEqual([ADMIN.phone]);
    expect(a[0]).toMatchObject({ createdByName: "Bot", createdByPhone: "", repeat: "none", status: "pending", dueHasTime: true });
    expect(a[0].dueAt).toBe("2026-10-27T05:30:00.000Z"); // 11:00 IST
    expect(outs).toHaveLength(1);
    expect(outs[0]).toMatchObject({ to: ADMIN.phone, kind: "template", template: "task_assigned_v1" });
    expect(outs.map((o) => o.to)).not.toContain(ADMIN2.phone);
    expect(outs.map((o) => o.to)).not.toContain(STAFF_DURG.phone);
  });

  it("falls back to every active admin when the super admin is missing or inactive", async () => {
    expect(alertRecipients([ADMIN, ADMIN2, STAFF_DURG]).map((u) => u.phone)).toEqual([ADMIN.phone]);
    const noOwner = alertRecipients([{ ...ADMIN, active: false }, ADMIN2, INACTIVE_ADMIN, STAFF_DURG]);
    expect(noOwner.map((u) => u.phone)).toEqual([ADMIN2.phone]);
    expect(alertRecipients([STAFF_DURG])).toEqual([]);
  });

  it("does not add another alert while a Bot check task is pending", async () => {
    const s = healthyStore();
    s.lastWebhookAt = null;
    await runHealthCheck(s, CHECK);
    const next = new Date(CHECK.getTime() + 24 * HOUR);
    expect(await runHealthCheck(s, next)).toEqual([]);
    expect(alerts(s)).toHaveLength(1);

    // Once the alert is closed, the next day's check alerts again.
    await s.updateTask(alerts(s)[0].id, { status: "done" });
    const outs = await runHealthCheck(s, new Date(next.getTime() + 24 * HOUR));
    expect(outs.map((o) => o.to)).toEqual([ADMIN.phone]);
  });

  it("resets the counters after the check and keeps the last problem", async () => {
    const s = healthyStore();
    await recordProblems(s, NOW, { sendFailures: 2, errors: 1, problem: "text send failed 500" });
    await runHealthCheck(s, CHECK);
    expect(s.health).toEqual<Health>({
      since: CHECK.toISOString(),
      sendFailures: 0,
      templateFailures: 0,
      errors: 0,
      lastProblem: "text send failed 500",
      lastProblemAt: NOW.toISOString(),
      lastCheckAt: CHECK.toISOString(),
    });
  });

  it("never puts phone numbers in the summary text or the notices' title", async () => {
    const s = healthyStore();
    s.lastWebhookAt = null;
    await recordProblems(s, NOW, { sendFailures: 1, problem: `send to ${STAFF_DURG.phone} failed` });
    const outs = await runHealthCheck(s, CHECK);
    for (const t of alerts(s)) expect(t.title).not.toMatch(/\d{7,}/);
    for (const o of outs) if (o.kind === "template") expect(o.bodyValues[2]).not.toMatch(/\d{7,}/);
  });

  it("only logs when Firestore cannot be read", async () => {
    const s = healthyStore();
    vi.spyOn(s, "listTasks").mockRejectedValue(new Error("firestore down"));
    const save = vi.spyOn(s, "saveHealth");
    await expect(runHealthCheck(s, CHECK)).resolves.toEqual([]);
    expect(console.error).toHaveBeenCalledWith("health: check could not read Firestore", expect.stringContaining("firestore down"));
    expect(save).not.toHaveBeenCalled();
  });
});

describe("alertDueAt", () => {
  const ist = (hhmm: string) => new Date(`2026-10-27T${hhmm}:00+05:30`);

  it("is the next full hour during the day", () => {
    expect(alertDueAt(ist("10:00"))).toEqual(ist("11:00"));
    expect(alertDueAt(ist("10:59"))).toEqual(ist("11:00"));
    expect(alertDueAt(ist("19:30"))).toEqual(ist("20:00"));
  });

  it("is 10:00 next morning from 20:00 IST", () => {
    expect(alertDueAt(ist("20:00"))).toEqual(new Date("2026-10-28T10:00:00+05:30"));
    expect(alertDueAt(ist("23:45"))).toEqual(new Date("2026-10-28T10:00:00+05:30"));
  });

  it("is 10:00 the same day early in the morning", () => {
    expect(alertDueAt(ist("02:00"))).toEqual(ist("10:00"));
  });

  it("puts the alert at 10:00 tomorrow when the check runs late in the evening", async () => {
    const s = healthyStore();
    s.lastWebhookAt = null;
    await runHealthCheck(s, ist("21:10"));
    expect(alerts(s)[0].dueAt).toBe(new Date("2026-10-28T10:00:00+05:30").toISOString());
  });
});

describe("acting on a Bot check task (creator phone '')", () => {
  it("Done and remark work and notify nobody", async () => {
    const { MemoryStore } = await import("../../src/data/memoryStore");
    const { markDone, addRemark } = await import("../../src/bot/taskActions");
    const s = new MemoryStore({ users: USERS });
    s.lastWebhookAt = null;
    await runHealthCheck(s, CHECK);
    const alert = (await s.listTasks({ status: "pending" })).find((t) => t.title.startsWith("Bot check:"))!;
    const r1 = await addRemark(s, alert, { phone: ADMIN.phone, name: ADMIN.name }, "dekh liya", CHECK);
    expect(r1).toMatchObject({ ok: true, outs: [] });
    const r2 = await markDone(s, (await s.getTask(alert.id))!, { phone: ADMIN.phone, name: ADMIN.name }, CHECK);
    expect(r2).toMatchObject({ ok: true, outs: [] });
  });
});
