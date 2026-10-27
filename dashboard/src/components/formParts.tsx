// Small form pieces shared by the task forms (remark, date, reopen, new task).
import { SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { REMARK_MAX } from "../lib/due";

export function Counter({ id, length, max = REMARK_MAX }: { id: string; length: number; max?: number }) {
  return (
    <span id={id} className={`tnum text-meta ${length >= max ? "text-danger" : "text-muted"}`}>
      {length}/{max}
    </span>
  );
}

export function SaveButton({ busy, disabled, label = "Save karo", busyLabel = "Save ho raha hai…" }: { busy: boolean; disabled: boolean; label?: string; busyLabel?: string }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      aria-busy={busy || undefined}
      className="press flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-title font-medium text-on-accent disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? <SpinnerGap size={20} className="animate-spin" aria-hidden="true" /> : null}
      {busy ? busyLabel : label}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-body break-words">
      <WarningCircle size={20} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

export const textareaClass =
  "block w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 text-[16px] leading-6 text-text placeholder:text-muted focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-accent aria-[invalid=true]:border-danger";

export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const list = ids.filter(Boolean) as string[];
  return list.length ? list.join(" ") : undefined;
}
