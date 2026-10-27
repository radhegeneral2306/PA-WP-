import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "./useFocusTrap";

interface Props {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Built for Phase 5 (Cancel). "Nahi" gets the default focus so a stray Enter does nothing harmful. */
export function ConfirmDialog({ title, body, confirmLabel, cancelLabel = "Nahi", danger = false, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useFocusTrap(ref, true, onCancel, cancelRef);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="anim-fade absolute inset-0 bg-black/50" onClick={onCancel} aria-hidden="true" />
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
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={cancelRef} type="button" onClick={onCancel} className="press h-11 rounded-lg border border-line px-4 text-title font-medium">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`press h-11 rounded-lg px-4 text-title font-medium ${danger ? "bg-danger text-on-accent" : "bg-accent text-on-accent"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
