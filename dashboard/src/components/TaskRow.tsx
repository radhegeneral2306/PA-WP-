import { ArrowsClockwise, CalendarDots, Microphone, Repeat } from "@phosphor-icons/react";
import { formatDateTime, formatDue } from "../lib/format";
import { branchLabel, isVoiceTask } from "../lib/filters";
import type { Branch, TaskDTO } from "../lib/types";

export function RepeatIcon({ repeat, size = 16 }: { repeat: TaskDTO["repeat"]; size?: number }) {
  if (repeat === "monthly") return <Repeat size={size} role="img" aria-label="Har mahine repeat" className="shrink-0 text-muted" />;
  if (repeat === "every90") return <ArrowsClockwise size={size} role="img" aria-label="Har 90 min reminder" className="shrink-0 text-muted" />;
  return null;
}

export function VoiceIcon({ size = 16 }: { size?: number }) {
  return (
    <span title="Voice se bana" className="inline-flex shrink-0">
      <Microphone size={size} role="img" aria-label="Voice se bana" className="text-muted" />
    </span>
  );
}

export function repeatText(t: TaskDTO): string {
  if (t.repeat === "monthly") return t.repeatDay ? `Har mahine, ${t.repeatDay} tareekh` : "Har mahine";
  if (t.repeat === "every90") return "Har 90 min reminder (10 AM se 8 PM)";
  return "Ek baar";
}

interface Props {
  task: TaskDTO;
  branches: Branch[];
  selected: boolean;
  onOpen: (t: TaskDTO) => void;
  mode: "pending" | "archive";
}

export function TaskRow({ task: t, branches, selected, onOpen, mode }: Props) {
  const person = `${t.assigneeName} · ${branchLabel(t.branch, branches)}`;
  let statusLabel: { text: string; cls: string } | null = null;
  if (mode === "pending") {
    if (t.overdue) statusLabel = { text: "Overdue", cls: "text-danger" };
    else if (t.dueToday) statusLabel = { text: "Aaj", cls: "text-warn" };
  } else {
    statusLabel = t.status === "done" ? { text: "Done", cls: "text-ok" } : { text: "Cancelled", cls: "text-danger" };
  }

  let third: string | null = null;
  if (mode === "pending") {
    third = t.lastRemark ? `${t.lastRemark.byName}: ${t.lastRemark.text}` : null;
  } else {
    const when = t.closedAt ? formatDateTime(t.closedAt) : "";
    third = t.status === "cancelled" && t.cancelledByName ? `${when} · by ${t.cancelledByName}` : when;
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(t)}
        aria-current={selected ? "true" : undefined}
        className={`press px-safe relative flex w-full gap-3 py-3 text-left ${selected ? "bg-accent-soft" : "hover:bg-surface"}`}
      >
        {mode === "pending" && t.overdue ? <span className="absolute inset-y-2 left-0 w-1 rounded-r bg-danger" aria-hidden="true" /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 truncate text-title font-medium">{t.title}</p>
            <RepeatIcon repeat={t.repeat} />
            {isVoiceTask(t) ? <VoiceIcon /> : null}
            {mode === "pending" && t.dateRequest ? (
              <CalendarDots size={16} role="img" aria-label="Date request pending" className="shrink-0 text-accent" />
            ) : null}
          </div>
          <p className="truncate text-body text-muted">{person}</p>
          {third ? <p className="truncate text-meta text-muted">{third}</p> : null}
        </div>
        <div className="tnum shrink-0 text-right">
          {mode === "pending" ? <p className={`text-meta ${t.overdue ? "text-danger" : "text-text"}`}>{formatDue(t.dueAt, t.dueHasTime)}</p> : null}
          {statusLabel ? <p className={`text-meta font-semibold ${statusLabel.cls}`}>{statusLabel.text}</p> : null}
        </div>
      </button>
    </li>
  );
}
