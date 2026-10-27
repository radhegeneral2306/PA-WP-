import { CalendarDots, CheckCircle, ChatText, UserSwitch, XCircle, X } from "@phosphor-icons/react";
import { useEffect } from "react";
import { formatDateTime, formatDue } from "../lib/format";
import { branchLabel } from "../lib/filters";
import type { Branch, TaskDTO } from "../lib/types";
import { repeatText } from "./TaskRow";
import { Sheet } from "./Sheet";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2">
      <dt className="w-28 shrink-0 text-meta text-muted pt-px">{label}</dt>
      <dd className="tnum min-w-0 flex-1 text-body break-words">{children}</dd>
    </div>
  );
}

function StatusText({ t }: { t: TaskDTO }) {
  if (t.status === "done") return <span className="font-medium text-ok">Done</span>;
  if (t.status === "cancelled") return <span className="font-medium text-danger">Cancelled</span>;
  if (t.overdue) return <span className="font-medium text-danger">Pending, Overdue</span>;
  if (t.dueToday) return <span className="font-medium text-warn">Pending, aaj due</span>;
  return <span>Pending</span>;
}

function DetailBody({ t, branches }: { t: TaskDTO; branches: Branch[] }) {
  const remarks = t.remarks ?? [];
  return (
    <div>
      <dl className="divide-y divide-line">
        <Row label="Status">
          <StatusText t={t} />
        </Row>
        <Row label="Kiska task">
          {t.assigneeName} · {branchLabel(t.branch, branches)}
        </Row>
        <Row label="Due">{formatDue(t.dueAt, t.dueHasTime)}{t.dueHasTime ? "" : " (10:00 AM)"}</Row>
        <Row label="Repeat">{repeatText(t)}</Row>
        <Row label="Kisne banaya">
          {t.createdByName}, {formatDateTime(t.createdAt)}
        </Row>
        {t.status === "pending" && t.lastReminderAt ? <Row label="Last reminder">{formatDateTime(t.lastReminderAt)}</Row> : null}
        {t.status === "pending" && t.nextReminderAt ? <Row label="Next reminder">{formatDateTime(t.nextReminderAt)}</Row> : null}
        {t.status === "done" && t.doneAt ? <Row label="Done hua">{formatDateTime(t.doneAt)}</Row> : null}
        {t.status === "cancelled" && t.cancelledAt ? (
          <Row label="Cancel hua">
            {formatDateTime(t.cancelledAt)}
            {t.cancelledByName ? `, by ${t.cancelledByName}` : ""}
          </Row>
        ) : null}
      </dl>

      {t.dateRequest ? (
        <section aria-labelledby="dr-title" className="mt-3 rounded-lg border border-accent/40 bg-accent-soft p-3">
          <h3 id="dr-title" className="flex items-center gap-2 text-body font-semibold">
            <CalendarDots size={18} aria-hidden="true" className="text-accent" />
            Date badalne ki request
          </h3>
          <p className="tnum mt-1 text-body">
            Nayi date: <span className="font-medium">{formatDue(t.dateRequest.dueAt, t.dateRequest.hasTime)}</span>
          </p>
          <p className="tnum text-meta text-muted">
            {t.dateRequest.byName}, {formatDateTime(t.dateRequest.requestedAt)}
          </p>
          {t.dateRequest.remark ? <p className="mt-1 text-body break-words">{t.dateRequest.remark}</p> : null}
        </section>
      ) : null}

      <section aria-labelledby="remarks-title" className="mt-5">
        <h3 id="remarks-title" className="text-body font-semibold">
          Remarks ({remarks.length})
        </h3>
        {remarks.length === 0 ? (
          <p className="mt-1 text-body text-muted">Abhi koi remark nahi.</p>
        ) : (
          <ol className="mt-2 space-y-3">
            {remarks.map((r, i) => (
              <li key={i} className="border-l-2 border-line pl-3">
                <p className="tnum text-meta text-muted">
                  <span className="font-medium text-text">{r.byName}</span>, {formatDateTime(r.at)}
                </p>
                <p className="text-body break-words whitespace-pre-wrap">{r.text}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** Phase 3: actions are shown but disabled so the layout is final. Phase 4 wires them. */
function Actions() {
  const btn = "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg border border-line bg-surface px-1 py-1.5 text-meta font-medium whitespace-nowrap text-muted disabled:cursor-not-allowed";
  return (
    <div className="pb-3">
      <button type="button" disabled className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent text-title font-medium text-on-accent opacity-50 disabled:cursor-not-allowed">
        <CheckCircle size={20} aria-hidden="true" />
        Done karo
      </button>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <button type="button" disabled className={btn}>
          <ChatText size={18} aria-hidden="true" />
          Remark
        </button>
        <button type="button" disabled className={btn}>
          <CalendarDots size={18} aria-hidden="true" />
          Date badlo
        </button>
        <button type="button" disabled className={btn}>
          <UserSwitch size={18} aria-hidden="true" />
          Assign badlo
        </button>
      </div>
      <button type="button" disabled className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-danger/40 text-body font-medium text-danger opacity-60 disabled:cursor-not-allowed">
        <XCircle size={18} aria-hidden="true" />
        Cancel
      </button>
      <p className="mt-2 text-center text-meta text-muted">Jaldi aa raha hai. Abhi ye kaam WhatsApp se karein.</p>
    </div>
  );
}

interface Props {
  task: TaskDTO;
  branches: Branch[];
  onClose: () => void;
  variant: "sheet" | "panel";
}

export function TaskDetail({ task, branches, onClose, variant }: Props) {
  const footer = task.status === "pending" ? <Actions /> : null;
  if (variant === "sheet") {
    return (
      <Sheet title={task.title} onClose={onClose} footer={footer}>
        <DetailBody t={task} branches={branches} />
      </Sheet>
    );
  }
  return <Panel task={task} branches={branches} onClose={onClose} footer={footer} />;
}

function Panel({ task, branches, onClose, footer }: { task: TaskDTO; branches: Branch[]; onClose: () => void; footer: React.ReactNode }) {
  // Not modal on desktop (the list stays usable), so no focus trap. Esc still closes.
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [onClose]);
  return (
    <aside aria-label="Task detail" className="sticky top-0 flex h-[100dvh] flex-col border-l border-line bg-surface">
      <div className="flex items-start gap-2 px-5 pt-4 pb-2">
        <h2 className="min-w-0 flex-1 pt-2.5 text-title font-semibold break-words">{task.title}</h2>
        <button type="button" onClick={onClose} aria-label="Band karein" className="press -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-bg">
          <X size={22} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        <DetailBody t={task} branches={branches} />
      </div>
      {footer ? <div className="border-t border-line px-5 pt-3">{footer}</div> : null}
    </aside>
  );
}
