import type { ReactNode } from "react";
import { ArrowClockwise, WarningCircle, WifiSlash } from "@phosphor-icons/react";

export function TopBar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="pt-safe sticky top-0 z-20 bg-bg/95 backdrop-blur">
      <div className="px-safe flex h-14 items-center gap-1">
        <h1 className="min-w-0 flex-1 truncate text-screen font-semibold">{title}</h1>
        {children}
      </div>
    </header>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  pressed,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className={`press flex h-11 w-11 items-center justify-center rounded-lg disabled:opacity-50 ${pressed ? "bg-accent-soft text-accent" : "text-text hover:bg-surface"}`}
    >
      {children}
    </button>
  );
}

export function Chip({
  selected,
  onClick,
  children,
  ariaLabel,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={ariaLabel}
      className={`press flex min-h-11 shrink-0 snap-start items-center gap-1.5 rounded-full border px-4 text-body font-medium whitespace-nowrap ${
        selected ? "border-accent bg-accent text-on-accent" : "border-line bg-surface text-text"
      }`}
    >
      {children}
    </button>
  );
}

export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="no-scrollbar px-safe flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto py-1">
      {children}
    </div>
  );
}

export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Load ho raha hai" className="divide-y divide-line">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="px-safe flex gap-3 py-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-[18px]" style={{ width: `${60 + ((i * 17) % 30)}%` }} />
            <div className="skeleton h-[14px] w-2/5" />
            {i % 2 === 0 ? <div className="skeleton h-[14px] w-3/4" /> : null}
          </div>
          <div className="w-20 space-y-2">
            <div className="skeleton ml-auto h-[14px] w-16" />
            <div className="skeleton ml-auto h-[14px] w-10" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-8 py-16 text-center">
      <div className="mb-3 text-muted" aria-hidden="true">
        {icon}
      </div>
      <p className="text-title font-medium">{title}</p>
      {hint ? <p className="mt-1 max-w-xs text-body text-muted">{hint}</p> : null}
      {children}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mx-4 my-3 flex items-start gap-3 rounded-lg border border-danger/40 bg-danger-soft p-3">
      <WarningCircle size={22} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-body break-words">{message}</p>
        <button type="button" onClick={onRetry} className="press mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg bg-surface px-3 font-medium text-accent border border-line">
          <ArrowClockwise size={18} aria-hidden="true" />
          Dobara try karein
        </button>
      </div>
    </div>
  );
}

export function OfflineBanner() {
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warn-soft px-4 py-2 text-meta font-medium text-text">
      <WifiSlash size={16} aria-hidden="true" className="text-warn" />
      Internet nahi hai. Data purana ho sakta hai.
    </div>
  );
}

export function Field({
  id,
  label,
  helper,
  error,
  children,
}: {
  id: string;
  label: string;
  helper?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-body font-medium">
        {label}
      </label>
      {children}
      {helper ? (
        <p id={`${id}-help`} className="mt-1 text-meta text-muted">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-meta text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "block h-12 w-full rounded-lg border border-line bg-surface px-3 text-[16px] text-text placeholder:text-muted focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

export function PrimaryButton({
  children,
  disabled,
  type = "button",
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="press flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-title font-medium text-on-accent disabled:opacity-60"
    >
      {children}
    </button>
  );
}
