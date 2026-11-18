import { useRef, useState } from "react";
import { SpinnerGap } from "@phosphor-icons/react";
import { api, ApiError, errorText, isTaskClosed } from "../lib/api";
import { isUrgent } from "../lib/filters";
import { useOnline } from "../lib/hooks";
import type { TaskDTO } from "../lib/types";
import { useToast } from "./Toast";
import { UrgentMark } from "./TaskRow";

/** F5: task detail toggle (admins, pending tasks). No WhatsApp, no extra reminders: it only sorts the task first. */
export function UrgentToggle({ task, onSaved, onStale }: { task: TaskDTO; onSaved: (t: TaskDTO) => void; onStale: () => void }) {
  const online = useOnline();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const urgent = isUrgent(task);

  async function toggle() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await api.setUrgent(task.id, !urgent);
      toast(isUrgent(res.task) ? "Urgent kar diya" : "Urgent hata diya");
      onSaved(res.task);
    } catch (e) {
      setError(errorText(e));
      if (isTaskClosed(e) || (e instanceof ApiError && e.status === 404)) onStale();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          {urgent ? <UrgentMark decorative /> : null}
          {urgent ? <span className="font-medium text-danger">Haan, sabse upar dikhega</span> : <span>Nahi</span>}
        </span>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy || !online}
          aria-busy={busy || undefined}
          className="press -my-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-body font-medium text-text hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <SpinnerGap size={16} className="animate-spin" aria-hidden="true" /> : urgent ? null : <UrgentMark decorative />}
          {urgent ? "Urgent hatao" : "Urgent karo"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-meta text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
