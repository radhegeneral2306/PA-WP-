import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { SpinnerGap } from "@phosphor-icons/react";
import { useFocusTrap } from "./useFocusTrap";

interface Props {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** While the request runs: both buttons disabled, confirm shows busyLabel. */
  busy?: boolean;
  busyLabel?: string;
  /** Inline error under the body (e.g. the server said no). */
  error?: string | null;
}

/** Used by Assign badlo (Phase 4) and Cancel (Phase 5). "Nahi" gets the default focus so a stray Enter does nothing harmful. */
export function ConfirmDialog({ title, body, confirmLabel, cancelLabel = "Nahi", danger = false, onConfirm, onCancel, busy = false, busyLabel, error }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const cancelFn = useRef(onCancel);
  cancelFn.current = onCancel;
  useFocusTrap(ref, true, () => {
    if (!busyRef.current) cancelFn.current();
  }, cancelRef);
  // Disabled buttons drop focus; bring it back into the dialog when the request ends.
  useEffect(() => {
    if (!busy && ref.current && !ref.current.contains(document.activeElement)) cancelRef.current?.focus({ preventScroll: true });
  }, [busy]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="anim-fade absolute inset-0 bg-black/50" onClick={busy ? undefined : onCancel} aria-hidden="true" />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="anim-pop relative w-full max-w-sm rounded-2xl bg-surface p-5 shadow-[var(--shadow)]"
      >
        <h2 id={titleId} className="text-title font-semibold">
          {title}
        </h2>
        <p id={bodyId} className="mt-2 text-body text-muted break-words">
          {body}
        </p>
        {error ? (
          <p role="alert" className="mt-3 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-body text-danger break-words">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="press h-11 rounded-lg border border-line px-4 text-title font-medium disabled:opacity-60">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
            className={`press inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-title font-medium disabled:opacity-70 ${danger ? "bg-danger text-on-accent" : "bg-accent text-on-accent"}`}
          >
            {busy ? <SpinnerGap size={20} className="animate-spin" aria-hidden="true" /> : null}
            {busy ? busyLabel ?? confirmLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
