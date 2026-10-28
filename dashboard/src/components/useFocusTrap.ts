import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Nested overlays (a form sheet on top of the detail sheet) each install a trap.
// Only the top-most one handles Esc and Tab, so Esc closes one layer at a time.
const stack: object[] = [];

/**
 * While active: keeps Tab inside the container, closes on Escape, and returns
 * focus to whatever was focused before when it deactivates.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
): void {
  // The effect runs once per activation, so read the latest onEscape through a ref. A captured
  // first-render callback made Esc skip "Form band karein?" on a dirty form and close a busy one.
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const token = {};
    stack.push(token);
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = initialFocus?.current ?? node?.querySelector<HTMLElement>(FOCUSABLE) ?? node;
    first?.focus({ preventScroll: true });

    function onKey(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== token) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        escapeRef.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = stack.indexOf(token);
      if (i >= 0) stack.splice(i, 1);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
