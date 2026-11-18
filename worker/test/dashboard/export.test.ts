import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/data/memoryStore";
import { issueToken } from "../../src/dashboard/auth";
import { addRoutes, handleApi } from "../../src/dashboard/api";
import { csvField, EXPORT_COLUMNS, exportDate, exportRoutes } from "../../src/dashboard/routes/export";
import type { Task } from "../../src/domain/types";
import type { Env } from "../../src/env";
import { ADMIN, ADMIN2, NOW, STAFF_RAIPUR, USERS, task } from "../helpers/bot";

const env: Env = {
  WEBHOOK_SECRET: "w".repeat(48),
  INTERAKT_API_KEY: "k",
  FIREBASE_PROJECT_ID: "p",
  FIREBASE_CLIENT_EMAIL: "e",
  FIREBASE_PRIVATE_KEY: "k",
  DASHBOARD_USER: "radhe",
  DASHBOARD_PASSWORD: "correct horse battery",
  DASHBOARD_ORIGINS: "https://dash.example",
};

addRoutes(exportRoutes);

async function get(store: MemoryStore, query: string, withToken = true): Promise<Response> {
  const headers: Record<string, string> = { Origin: "https://dash.example" };
  if (withToken) headers.Authorization = `Bearer ${await issueToken(env, null, NOW)}`;
  return handleApi(new Request(`https://w/api/export?${query}`, { headers }), env, store, NOW, async () => undefined);
}

/** Body text with the BOM kept (Response.text() strips it). */
const raw = async (res: Response): Promise<string> => new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(await res.arrayBuffer());

const remark = (text: string) => ({ at: "2026-10-20T00:00:00.000Z", byPhone: ADMIN.phone, byName: ADMIN.name, text });

/** Parses our own CSV (every field quoted). */
function parse(csv: string): string[][] {
  const lines = csv.replace(/^﻿/, "").replace(/\r\n$/, "").split("\r\n");
  return lines.map((line) => {
    const cells: string[] = [];
    const re = /"((?:[^"]|"")*)"(?:,|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) cells.push(m[1].replace(/""/g, '"'));
    return cells;
  });
}

const TASKS: Task[] = [
  task({
    id: "p1",
    title: 'Sharma ji "urgent" payment, kal',
    dueAt: "2026-10-28T10:30:00.000Z", // 28 Oct 4:00 PM IST
    dueHasTime: true,
    urgent: true,
    repeat: "weekly",
    remarks: [remark("pehla"), remark("Line one\nline two")],
  }),
  task({
    id: "d1",
    title: "Raipur stock",
    assigneePhone: STAFF_RAIPUR.phone,
    assigneeName: STAFF_RAIPUR.name,
    branch: "RAIPUR",
    createdByPhone: ADMIN2.phone,
    createdByName: ADMIN2.name,
    dueAt: "2026-10-27T04:30:00.000Z", // 27 Oct (date only)
    status: "done",
    doneAt: "2026-10-27T12:00:00.000Z", // 27 Oct 5:30 PM IST
    repeat: "monthly",
    nextReminderAt: null,
  }),
  task({ id: "c1", title: "Cancelled one", dueAt: "2026-10-29T04:30:00.000Z", status: "cancelled", cancelledAt: "2026-10-26T00:00:00.000Z", repeat: "every90", nextReminderAt: null }),
  task({ id: "x1", title: "Deleted junk", dueAt: "2026-10-28T04:30:00.000Z", status: "deleted", deletedFrom: "pending", deletedAt: "2026-10-26T00:00:00.000Z", nextReminderAt: null }),
  // 31 Oct 11:30 PM IST = 31 Oct 18:00 UTC; and 1 Nov 00:30 IST = 31 Oct 19:00 UTC (IST day boundary).
  task({ id: "late", title: "Late night", branch: null, assigneePhone: ADMIN.phone, assigneeName: ADMIN.name, dueAt: "2026-10-31T18:00:00.000Z", dueHasTime: true }),
  task({ id: "nov", title: "=HYPERLINK(\"x\")", dueAt: "2026-10-31T19:00:00.000Z", dueHasTime: true }),
];

const store = () => new MemoryStore({ users: USERS, tasks: TASKS });

describe("GET /api/export", () => {
  it("needs a session token", async () => {
    expect((await get(store(), "from=2026-10-01&to=2026-10-31", false)).status).toBe(401);
  });

  it("returns an Excel-friendly CSV with the contract headers and columns", async () => {
    const res = await get(store(), "from=2026-10-27&to=2026-10-31&status=all");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="radhe-tasks-2026-10-27-to-2026-10-31.csv"');
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://dash.example");
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe("Content-Disposition");
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const csv = await raw(res);
    expect(csv.startsWith('﻿"Task","Kisko","Branch","Diya","Due","Status","Done date","Urgent","Repeat","Last remark"\r\n')).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);

    const [head, ...rows] = parse(csv);
    expect(head).toEqual(EXPORT_COLUMNS);
    // Sorted by due; deleted never included; 1 Nov IST (the "nov" task) is outside the range.
    expect(rows).toEqual([
      ["Raipur stock", "Chikku", "Raipur", "Partner Two", "27 Oct 2026", "Done", "27 Oct 2026, 5:30 PM", "—", "Har mahine", ""],
      ['Sharma ji "urgent" payment, kal', "Hardware", "Durg", "Bhaskar", "28 Oct 2026, 4:00 PM", "Pending", "", "Haan", "Har hafte", "Line one\nline two"],
      ["Cancelled one", "Hardware", "Durg", "Bhaskar", "29 Oct 2026", "Cancelled", "", "—", "Har 90 min", ""],
      ["Late night", "Bhaskar", "—", "Bhaskar", "31 Oct 2026, 11:30 PM", "Pending", "", "—", "Ek baar", ""],
    ]);
    // Quotes doubled inside quoted fields.
    expect(csv).toContain('"Sharma ji ""urgent"" payment, kal"');
  });

  it("never contains phone numbers", async () => {
    const csv = await (await get(store(), "from=2026-01-01&to=2026-12-31")).text();
    for (const u of USERS) expect(csv).not.toContain(u.phone);
    expect(csv).not.toContain("Deleted junk");
  });

  it("filters by status; status defaults to all", async () => {
    const titles = async (q: string) => parse(await (await get(store(), q)).text()).slice(1).map((r) => r[0]);
    expect(await titles("from=2026-10-01&to=2026-11-30&status=pending")).toEqual(['Sharma ji "urgent" payment, kal', "Late night", "'=HYPERLINK(\"x\")"]);
    expect(await titles("from=2026-10-01&to=2026-11-30&status=done")).toEqual(["Raipur stock"]);
    expect(await titles("from=2026-10-01&to=2026-11-30&status=cancelled")).toEqual(["Cancelled one"]);
    expect(await titles("from=2026-10-01&to=2026-11-30")).toHaveLength(5);
  });

  it("uses the IST day of the due date, both ends inclusive", async () => {
    const titles = async (q: string) => parse(await (await get(store(), q)).text()).slice(1).map((r) => r[0]);
    expect(await titles("from=2026-10-31&to=2026-10-31")).toEqual(["Late night"]);
    expect(await titles("from=2026-11-01&to=2026-11-01")).toEqual(["'=HYPERLINK(\"x\")"]);
    expect(await titles("from=2026-12-01&to=2026-12-31")).toEqual([]);
  });

  it("an empty result still has the header row", async () => {
    const csv = await raw(await get(new MemoryStore({ users: USERS }), "from=2026-10-01&to=2026-10-31"));
    expect(csv).toBe(`﻿${EXPORT_COLUMNS.map((c) => `"${c}"`).join(",")}\r\n`);
  });

  it("400 bad_request on bad input, max 366 days", async () => {
    for (const q of [
      "",
      "from=2026-10-01",
      "to=2026-10-01",
      "from=2026-10-1&to=2026-10-31",
      "from=2026-02-30&to=2026-03-31",
      "from=2026-10-31&to=2026-10-01",
      "from=2026-10-01&to=2026-10-31&status=deleted",
      "from=2026-10-01&to=2026-10-31&status=open",
      "from=2025-01-01&to=2026-01-02", // 367 days
    ]) {
      const res = await get(store(), q);
      expect(res.status, q).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("bad_request");
    }
    expect((await get(store(), "from=2024-01-01&to=2024-12-31")).status).toBe(200); // leap year: 366 days
    expect((await get(store(), "from=2026-10-01&to=2026-10-01")).status).toBe(200);
  });
});

describe("export helpers", () => {
  it("exportDate always shows the year and IST time", () => {
    expect(exportDate("2026-10-28T10:30:00.000Z", true)).toBe("28 Oct 2026, 4:00 PM");
    expect(exportDate("2026-10-28T04:30:00.000Z", false)).toBe("28 Oct 2026");
    expect(exportDate("2026-12-31T18:45:00.000Z", true)).toBe("1 Jan 2027, 12:15 AM");
    expect(exportDate("2026-10-28T06:30:00.000Z", true)).toBe("28 Oct 2026, 12:00 PM");
  });

  it("csvField quotes, doubles quotes and defuses formulas", () => {
    expect(csvField('a "b", c')).toBe('"a ""b"", c"');
    expect(csvField("=1+2")).toBe(`"'=1+2"`);
    expect(csvField("+91 call")).toBe(`"'+91 call"`);
    expect(csvField("@x")).toBe(`"'@x"`);
    expect(csvField("—")).toBe('"—"');
    expect(csvField("")).toBe('""');
  });
});

describe("export reads", () => {
  it("queries by status only (never the deleted tasks)", async () => {
    const s = store();
    const seen: unknown[] = [];
    const orig = s.listTasks.bind(s);
    s.listTasks = async (f) => (seen.push(f), orig(f));
    await get(s, "from=2026-10-01&to=2026-10-31");
    expect(seen).toEqual([{ status: "pending" }, { status: "done" }, { status: "cancelled" }]);
    seen.length = 0;
    await get(s, "from=2026-10-01&to=2026-10-31&status=done");
    expect(seen).toEqual([{ status: "done" }]);
  });
});
