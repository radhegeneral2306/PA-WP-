import { describe, expect, it } from "vitest";
import { historyDetail, historyLabel, historyTone, historyWho, sortHistory } from "./history";
import type { HistoryEvent } from "./types";

const ev = (p: Partial<HistoryEvent>): HistoryEvent => ({ at: "2026-10-01T04:30:00Z", kind: "remark", by: "Hema", text: "x", ...p });

describe("history helpers", () => {
  it("labels every kind in Hinglish", () => {
    expect(historyLabel("created")).toBe("Task bana");
    expect(historyLabel("remark")).toBe("Remark");
    expect(historyLabel("done")).toBe("Done");
    expect(historyLabel("cancelled")).toBe("Cancel");
    expect(historyLabel("deleted")).toBe("Delete");
    expect(historyLabel("restored")).toBe("Wapas liya");
    expect(historyLabel("something_new")).toBe("Badlav");
  });
  it("picks a tone", () => {
    expect(historyTone("done")).toBe("ok");
    expect(historyTone("deleted")).toBe("danger");
    expect(historyTone("created")).toBe("accent");
    expect(historyTone("remark")).toBe("muted");
  });
  it("sorts oldest first, stable, bad dates last", () => {
    const a = ev({ at: "2026-10-03T00:00:00Z", text: "a" });
    const b = ev({ at: "2026-10-01T00:00:00Z", text: "b" });
    const c = ev({ at: "2026-10-01T00:00:00Z", text: "c" });
    const d = ev({ at: "garbage", text: "d" });
    const input = [d, a, c, b];
    expect(sortHistory(input).map((e) => e.text)).toEqual(["c", "b", "a", "d"]);
    expect(input[0]).toBe(d);
  });
  it("shows who and detail", () => {
    expect(historyWho(ev({ by: null }))).toBe("-");
    expect(historyWho(ev({ by: " " }))).toBe("-");
    expect(historyWho(ev({ by: "Ravi" }))).toBe("Ravi");
    expect(historyDetail(ev({ kind: "created", text: "Task bana" }))).toBe("");
    expect(historyDetail(ev({ text: " Maal aa gaya " }))).toBe("Maal aa gaya");
  });
});
