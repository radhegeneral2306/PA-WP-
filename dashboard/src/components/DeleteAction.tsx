import { useRef, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { api, ApiError, errorText, isTaskClosed } from "../lib/api";
import { BIN_DAYS } from "../lib/format";
import { useOnline } from "../lib/hooks";
import type { TaskDTO } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "./Toast";

interface Props {
  task: TaskDTO;
  /** The parent's own busy / offline / stale state. */
  disabled?: boolean;
  /** Delete worked: close the detail and refresh the list. */
  onDeleted: () => void;
  /** 409/404: already deleted or gone; refresh the list. */
  onStale: () => void;
}

/** F8: soft delete into the recycle bin. Any status except deleted. No WhatsApp goes out. */
export function DeleteAction({ task, disabled = false, onDeleted, onStale }: Props) {
  const online = useOnline();
  const toast = useToast();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.deleteTask(task.id);
      toast("Recycle bin mein daal diya");
      setAsk(false);
      onDeleted();
    } catch (e) {
      setError(errorText(e));
      if (isTaskClosed(e) || (e instanceof ApiError && e.status === 404)) onStale();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (task.status === "deleted") return null;

  return (
    <>
      <button
        type="button"
        disabled={disabled || !online}
        onClick={() => {
          setError(null);
          setAsk(true);
        }}
        className="press mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg text-body font-medium text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Trash size={18} aria-hidden="true" />
        Delete
      </button>
      {ask ? (
        <ConfirmDialog
          title="Recycle bin mein daalein?"
          body={`"${task.title}" ke reminders band ho jayenge. ${BIN_DAYS} din baad apne aap hat jayega, tab tak Archive ke Recycle bin se wapas la sakte hain. Kisi ko WhatsApp message nahi jayega.`}
          confirmLabel="Haan, delete karo"
          busyLabel="Delete ho raha hai…"
          danger
          busy={busy}
          error={error ?? (!online ? "Internet nahi hai" : null)}
          onConfirm={() => {
            if (online) void confirm();
          }}
          onCancel={() => {
            setAsk(false);
            setError(null);
          }}
        />
      ) : null}
    </>
  );
}
