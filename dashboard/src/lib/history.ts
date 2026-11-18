import type { HistoryEvent, HistoryKind } from "./types";

/** Hinglish label per event kind (no emoji). Unknown kinds from a newer Worker fall back to "Badlav". */
export const HISTORY_LABELS: Record<HistoryKind, string> = {
  created: "Task bana",
  remark: "Remark",
  done: "Done",
  cancelled: "Cancel",
  deleted: "Delete",
  restored: "Wapas liya",
};

export function historyLabel(kind: string): string {
  return (HISTORY_LABELS as Record<string, string>)[kind] ?? "Badlav";
}

/** Colour tone of the timeline dot. */
export function historyTone(kind: string): "ok" | "danger" | "accent" | "muted" {
  if (kind === "done") return "ok";
  if (kind === "cancelled" || kind === "deleted") return "danger";
  if (kind === "created" || kind === "restored") return "accent";
  return "muted";
}

/** Oldest first (the API already sends this; sorting guards against a different order). Stable for equal times. */
export function sortHistory(events: HistoryEvent[]): HistoryEvent[] {
  return events
    .map((e, i) => ({ e, i, t: Date.parse(e.at) }))
    .sort((a, b) => {
      const at = Number.isNaN(a.t) ? Infinity : a.t;
      const bt = Number.isNaN(b.t) ? Infinity : b.t;
      return at - bt || a.i - b.i;
    })
    .map((x) => x.e);
}

/** The "who" line: the name, or a dash when the Worker has none. */
export function historyWho(e: Pick<HistoryEvent, "by">): string {
  return e.by && e.by.trim() ? e.by : "-";
}

/** Text under the label. "Task bana" / done etc. repeat the label, so only show text that adds something. */
export function historyDetail(e: HistoryEvent): string {
  const text = (e.text ?? "").trim();
  if (!text) return "";
  if (text.toLocaleLowerCase("en-IN") === historyLabel(e.kind).toLocaleLowerCase("en-IN")) return "";
  return text;
}
