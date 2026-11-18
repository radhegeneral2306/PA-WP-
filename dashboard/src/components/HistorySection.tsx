import { CaretDown, ArrowClockwise } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, errorText } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { historyDetail, historyLabel, historyTone, historyWho, sortHistory } from "../lib/history";
import type { HistoryEvent } from "../lib/types";

type State = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; events: HistoryEvent[] };

const DOT: Record<ReturnType<typeof historyTone>, string> = {
  ok: "bg-ok",
  danger: "bg-danger",
  accent: "bg-accent",
  muted: "bg-muted",
};

/**
 * Round 6: task history. Nothing is fetched until the admin opens the section (one read);
 * it is fetched again only when the task changed (updatedAt) while the section is open.
 */
export function HistorySection({ taskId, updatedAt }: { taskId: string; updatedAt: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const panelId = useId();
  const seq = useRef(0);
  const loadedFor = useRef<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const wantScroll = useRef(false);

  const load = useCallback(() => {
    const mine = ++seq.current;
    setState((s) => (s.kind === "ready" ? s : { kind: "loading" }));
    api
      .history(taskId)
      .then((r) => {
        if (mine !== seq.current) return;
        loadedFor.current = updatedAt;
        setState({ kind: "ready", events: sortHistory(r.events ?? []) });
      })
      .catch((e: unknown) => {
        if (mine !== seq.current) return;
        setState({ kind: "error", message: errorText(e) });
      });
  }, [taskId, updatedAt]);

  useEffect(() => {
    if (!open) return;
    if (loadedFor.current === updatedAt && state.kind === "ready") return;
    if (state.kind === "loading" || state.kind === "error") return;
    load();
  }, [open, updatedAt, state.kind, load]);

  // The sheet's footer covers the bottom, so once the content is there bring the section to the top (once per open).
  useEffect(() => {
    if (open && wantScroll.current && state.kind !== "idle") {
      wantScroll.current = false;
      if (state.kind !== "loading") requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ block: "start" }));
      else wantScroll.current = true;
    }
  }, [open, state.kind]);

  useEffect(() => () => void seq.current++, []);

  return (
    <section ref={sectionRef} aria-labelledby={`${panelId}-btn`} className="mt-5 border-t border-line pt-1">
      <button
        id={`${panelId}-btn`}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (!open) wantScroll.current = true;
          setOpen((o) => !o);
        }}
        className="press -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center justify-between gap-2 rounded-lg px-2 text-left text-body font-semibold"
      >
        History
        <CaretDown size={18} aria-hidden="true" className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div id={panelId} hidden={!open}>
        {open ? <HistoryBody state={state} onRetry={load} /> : null}
      </div>
    </section>
  );
}

function HistoryBody({ state, onRetry }: { state: State; onRetry: () => void }) {
  if (state.kind === "idle" || state.kind === "loading") {
    return (
      <p role="status" className="py-2 text-body text-muted">
        History load ho rahi hai…
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <div role="alert" className="my-2 rounded-lg border border-danger/40 bg-danger-soft p-3">
        <p className="text-body break-words">{state.message}</p>
        <button type="button" onClick={onRetry} className="press mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 font-medium text-accent">
          <ArrowClockwise size={18} aria-hidden="true" />
          Dobara try karein
        </button>
      </div>
    );
  }
  if (state.events.length === 0) return <p className="py-2 text-body text-muted">Abhi koi history nahi.</p>;
  return (
    <ol className="mt-2 pb-1" aria-label="Task history">
      {state.events.map((e, i) => {
        const detail = historyDetail(e);
        const last = i === state.events.length - 1;
        return (
          <li key={i} className="relative pb-4 pl-6 last:pb-1">
            {last ? null : <span aria-hidden="true" className="absolute top-3 bottom-0 left-[5px] w-px bg-line" />}
            <span aria-hidden="true" className={`absolute top-1.5 left-0 h-[11px] w-[11px] rounded-full ${DOT[historyTone(e.kind)]}`} />
            <p className="text-body font-medium">{historyLabel(e.kind)}</p>
            <p className="tnum text-meta text-muted">
              {formatDateTime(e.at)}
              <span aria-hidden="true"> · </span>
              <span className="sr-only">, </span>
              {historyWho(e)}
            </p>
            {detail ? <p className="mt-0.5 text-body break-words whitespace-pre-wrap">{detail}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
