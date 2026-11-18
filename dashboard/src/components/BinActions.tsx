import { useRef, useState } from "react";
import { ArrowUUpLeft, SpinnerGap, Trash, WifiSlash } from "@phosphor-icons/react";
import { api, ApiError, errorText, isNeedDate } from "../lib/api";
import { STATUS_LABELS } from "../lib/format";
import { useOnline } from "../lib/hooks";
import type { TaskDTO } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { FormError } from "./formParts";
import { DueSheet } from "./TaskActions";
import { useToast } from "./Toast";

interface Props {
  task: TaskDTO;
  /** Only the super admin sees "Hamesha ke liye hatao" (the Worker checks it too). */
  superAdmin: boolean;
  /** Restore or purge worked: close the detail and refresh the lists. */
  onRemoved: () => void;
  /** 409/404: no longer in the bin; refresh. */
  onStale: () => void;
}

/** F8 recycle bin: "Wapas laao" for any admin, "Hamesha ke liye hatao" for the super admin. No WhatsApp either way. */
export function BinActions({ task, superAdmin, onRemoved, onStale }: Props) {
  const online = useOnline();
  const toast = useToast();
  const [busy, setBusy] = useState<"restore" | "purge" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needDate, setNeedDate] = useState(false);
  const [purgeAsk, setPurgeAsk] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const back = task.deletedFrom ? STATUS_LABELS[task.deletedFrom] : "Pending";

  function isStale(e: unknown): boolean {
    return e instanceof ApiError && (e.status === 409 || e.status === 404);
  }

  /** Returns null on success, else the error text (the date sheet shows it inline). */
  async function restore(date?: string, time?: string | null): Promise<string | null> {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy("restore");
    setError(null);
    try {
      await api.restoreTask(task.id, date, time);
      toast(`Wapas aa gaya (${back})`);
      setNeedDate(false);
      onRemoved();
      return null;
    } catch (e) {
      if (isNeedDate(e) && !needDate) {
        // Its due date has passed: ask for a new one, then retry with it.
        setNeedDate(true);
        return null;
      }
      if (isStale(e)) onStale();
      const msg = errorText(e);
      if (!needDate) setError(msg);
      return msg;
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function purge() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("purge");
    setPurgeError(null);
    try {
      await api.purgeTask(task.id);
      toast("Hamesha ke liye hata diya");
      setPurgeAsk(false);
      onRemoved();
    } catch (e) {
      setPurgeError(errorText(e));
      if (isStale(e)) onStale();
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const disabled = busy !== null || !online;

  return (
    <div className="pb-3">
      {!online ? (
        <p role="status" className="mb-2 flex items-center justify-center gap-2 text-meta font-medium text-muted">
          <WifiSlash size={16} aria-hidden="true" className="text-warn" />
          Internet nahi hai
        </p>
      ) : null}
      {error ? (
        <div className="mb-2">
          <FormError message={error} />
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => void restore()}
        disabled={disabled}
        aria-busy={busy === "restore" || undefined}
        className="press flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent text-title font-medium text-on-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy === "restore" && !needDate ? <SpinnerGap size={20} className="animate-spin" aria-hidden="true" /> : <ArrowUUpLeft size={20} aria-hidden="true" />}
        {busy === "restore" && !needDate ? "Wapas aa raha hai…" : "Wapas laao"}
      </button>
      <p className="mt-2 text-center text-meta text-muted">{back} mein wapas jayega. Kisi ko WhatsApp message nahi jayega.</p>

      {superAdmin ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setPurgeError(null);
            setPurgeAsk(true);
          }}
          className="press mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-danger/40 text-body font-medium text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash size={18} aria-hidden="true" />
          Hamesha ke liye hatao
        </button>
      ) : null}

      {needDate ? (
        <DueSheet
          task={task}
          busy={busy === "restore"}
          online={online}
          onClose={() => setNeedDate(false)}
          onSubmit={(date, time) => restore(date, time)}
          text={{
            title: "Nayi date chuniye",
            subtitle: "Iski due date nikal chuki hai. Nayi date se reminders phir shuru honge.",
            remarkLabel: null,
            saveLabel: "Wapas laao",
            busyLabel: "Wapas aa raha hai…",
          }}
        />
      ) : null}

      {purgeAsk ? (
        <ConfirmDialog
          title="Hamesha ke liye hatana hai?"
          body={`"${task.title}" aur uske saare remarks poori tarah mit jayenge. Ye kabhi wapas nahi aayega.`}
          confirmLabel="Haan, hamesha ke liye hatao"
          busyLabel="Hat raha hai…"
          danger
          busy={busy === "purge"}
          error={purgeError ?? (!online ? "Internet nahi hai" : null)}
          onConfirm={() => {
            if (online) void purge();
          }}
          onCancel={() => {
            setPurgeAsk(false);
            setPurgeError(null);
          }}
        />
      ) : null}
    </div>
  );
}
