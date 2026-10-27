import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { useFocusTrap } from "./useFocusTrap";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Element to focus when the sheet opens (default: the first focusable, the close button). */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Optional line under the title (e.g. the task a form is about). */
  subtitle?: string;
}

/** Bottom sheet for phones. Closes on backdrop tap, Esc, close button or swipe down on the handle. */
export function Sheet({ title, onClose, children, footer, initialFocus, subtitle }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);
  useFocusTrap(ref, true, onClose, initialFocus);

  function onPointerDown(e: React.PointerEvent) {
    startY.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (startY.current === null) return;
    setDrag(Math.max(0, e.clientY - startY.current));
  }
  function onPointerUp() {
    if (startY.current === null) return;
    startY.current = null;
    if (drag > 110) onClose();
    else setDrag(0);
  }

  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col justify-end lg:justify-center lg:px-4">
      <div className="anim-fade absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="anim-sheet relative flex max-h-[92dvh] flex-col rounded-t-2xl lg:mx-auto lg:max-h-[85dvh] lg:w-full lg:max-w-xl lg:rounded-2xl lg:pt-3 bg-surface shadow-[var(--shadow)]"
        style={{ transform: drag ? `translateY(${drag}px)` : undefined, transition: startY.current === null ? "transform 160ms ease" : "none" }}
      >
        <div
          className="flex cursor-grab touch-none justify-center pb-1 pt-2 lg:hidden"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="h-1 w-10 rounded-full bg-line" aria-hidden="true" />
        </div>
        <div className="flex items-start gap-2 px-4 pb-2">
          <div className="min-w-0 flex-1 pt-2.5">
            <h2 id={titleId} className="text-title font-semibold break-words">
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 text-meta text-muted break-words">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Band karein"
            className="press -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-bg"
          >
            <X size={22} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
        {footer ? <div className="pb-safe border-t border-line px-4 pt-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
