import { useMemo, useRef, useState } from "react";
import { ArrowClockwise, ArrowRight, CalendarCheck, Check, X } from "@phosphor-icons/react";
import { api, ApiError, errorText } from "../lib/api";
import { branchLabel } from "../lib/filters";
import { formatClock, formatDateTime, formatDue } from "../lib/format";
import { useOnline, type Resource } from "../lib/hooks";
import type { Branch, TaskDTO, TasksResponse } from "../lib/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { EmptyState, ErrorBanner, IconButton, SkeletonRows, TopBar } from "../components/ui";

type Decision = "approve" | "reject";
type Ask = { task: TaskDTO; decision: Decision };

/** Staff requests to move a due date beyond 25 days. Same rules as WhatsApp "Approvals" (oldest request first). */
export default function Approvals({ pending, branches }: { pending: Resource<TasksResponse>; branches: Branch[] }) {
  const online = useOnline();
  const toast = useToast();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const requests = useMemo(
    () =>
      (pending.data?.tasks ?? [])
        .filter((t) => t.status === "pending" && t.dateRequest)
        .sort((a, b) => a.dateRequest!.requestedAt.localeCompare(b.dateRequest!.requestedAt)),
    [pending.data],
  );

  async function decide() {
    if (!ask?.task.dateRequest || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const { task, decision } = ask;
    try {
      await (decision === "approve" ? api.approveDate : api.rejectDate)(task.id, task.dateRequest!.requestedAt);
      toast(decision === "approve" ? `Approve ho gaya. ${task.dateRequest!.byName} ko bata diya.` : `Reject ho gaya. ${task.dateRequest!.byName} ko bata diya.`);
      setAsk(null);
      pending.reload();
    } catch (e) {
      // 409/404: handled elsewhere (WhatsApp, another admin), replaced, or the task closed; nothing to retry, so close and refresh.
      if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
        setAsk(null);
        toast(errorText(e));
        pending.reload();
      } else {
        setError(errorText(e));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="lg:max-w-[640px]">
      <TopBar title="Approvals">
        <IconButton label="Refresh karein" onClick={pending.reload} disabled={pending.loading}>
          <ArrowClockwise size={22} className={pending.loading ? "animate-spin" : ""} />
        </IconButton>
      </TopBar>
      <p className="px-safe tnum flex min-h-9 items-center text-meta text-muted">
        {pending.updatedAt ? `Last updated ${formatClock(pending.updatedAt)}` : pending.loading ? "Load ho raha hai…" : ""}
      </p>
      {pending.error ? <ErrorBanner message={pending.error} onRetry={pending.reload} /> : null}
      {pending.loading && !pending.data ? <SkeletonRows count={3} /> : null}
      {pending.data && requests.length === 0 ? (
        <EmptyState icon={<CalendarCheck size={40} />} title="Koi request pending nahi" hint="Staff jab 25 din se aage ki date maangega, request yahan aayegi." />
      ) : null}

      {requests.length > 0 ? (
        <ul className="space-y-3 px-safe pb-6" aria-label="Date requests">
          {requests.map((t) => {
            const r = t.dateRequest!;
            return (
              <li key={t.id} className="rounded-xl border border-line bg-surface p-4">
                <p className="text-title font-medium break-words">{t.title}</p>
                <p className="text-meta text-muted">
                  {t.assigneeName} · {branchLabel(t.branch, branches)}
                </p>
                <div className="tnum mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-body">
                  <span className="text-muted line-through decoration-muted/60">{formatDue(t.dueAt, t.dueHasTime)}</span>
                  <ArrowRight size={16} aria-label="se" className="text-muted" />
                  <span className="font-semibold text-accent">{formatDue(r.dueAt, r.hasTime)}</span>
                </div>
                {r.remark ? <p className="mt-2 rounded-lg bg-bg px-3 py-2 text-body break-words">{r.remark}</p> : null}
                <p className="tnum mt-2 text-meta text-muted">
                  Request: {r.byName}, {formatDateTime(r.requestedAt)}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!online}
                    onClick={() => {
                      setError(null);
                      setAsk({ task: t, decision: "reject" });
                    }}
                    className="press flex h-11 items-center justify-center gap-1.5 rounded-lg border border-line text-body font-medium text-text hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <X size={18} aria-hidden="true" />
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={!online}
                    onClick={() => {
                      setError(null);
                      setAsk({ task: t, decision: "approve" });
                    }}
                    className="press flex h-11 items-center justify-center gap-1.5 rounded-lg bg-accent text-body font-medium text-on-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Check size={18} aria-hidden="true" />
                    Approve
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {ask?.task.dateRequest ? (
        <ConfirmDialog
          title={ask.decision === "approve" ? "Nayi date approve karein?" : "Request reject karein?"}
          body={
            ask.decision === "approve"
              ? `"${ask.task.title}" ki date ${formatDue(ask.task.dateRequest.dueAt, ask.task.dateRequest.hasTime)} ho jayegi.`
              : `"${ask.task.title}" ki date ${formatDue(ask.task.dueAt, ask.task.dueHasTime)} hi rahegi.`
          }
          confirmLabel={ask.decision === "approve" ? "Haan, approve karo" : "Haan, reject karo"}
          busyLabel={ask.decision === "approve" ? "Approve ho raha hai…" : "Reject ho raha hai…"}
          danger={ask.decision === "reject"}
          busy={busy}
          error={error ?? (!online ? "Internet nahi hai" : null)}
          onConfirm={() => {
            if (online) void decide();
          }}
          onCancel={() => {
            setAsk(null);
            setError(null);
          }}
        />
      ) : null}
    </div>
  );
}
