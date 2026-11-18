import { useId, useRef, useState } from "react";
import { DownloadSimple, SpinnerGap } from "@phosphor-icons/react";
import { api, errorText } from "../lib/api";
import { EXPORT_STATUSES, saveBlob, thisMonthRange, validateExportRange, type RangeError } from "../lib/export";
import { useOnline } from "../lib/hooks";
import type { ExportStatus } from "../lib/types";
import { FormError } from "./formParts";
import { useToast } from "./Toast";
import { inputClass } from "./ui";

/** F9 "Excel download": CSV of tasks by due date (IST) and status. Deleted tasks and phone numbers are never in it. */
export function ExportSection() {
  const id = useId();
  const online = useOnline();
  const toast = useToast();
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const [range, setRange] = useState(() => thisMonthRange());
  const [status, setStatus] = useState<ExportStatus>("all");
  const [fieldError, setFieldError] = useState<RangeError | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || inFlight.current) return;
    const err = validateExportRange(range.from, range.to);
    setFieldError(err);
    setServerError(null);
    if (err) {
      (err.field === "from" ? fromRef : toRef).current?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const { blob, filename } = await api.exportCsv(range.from, range.to, status);
      saveBlob(blob, filename);
      toast("Excel file download ho gayi");
    } catch (err2) {
      setServerError(errorText(err2));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const fromErr = fieldError?.field === "from" ? fieldError.message : null;
  const toErr = fieldError?.field === "to" ? fieldError.message : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-4 p-4">
      <p className="text-meta text-muted">Due date ke hisaab se tasks ki file (CSV), Excel mein khulti hai. Phone number nahi hote.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <label htmlFor={`${id}-from`} className="mb-1.5 block text-body font-medium">
            Se
          </label>
          <input
            ref={fromRef}
            id={`${id}-from`}
            type="date"
            value={range.from}
            onChange={(e) => {
              setRange((r) => ({ ...r, from: e.target.value }));
              setFieldError(null);
            }}
            aria-invalid={fromErr ? true : undefined}
            aria-describedby={fromErr ? `${id}-from-err` : undefined}
            className={`${inputClass} aria-[invalid=true]:border-danger`}
          />
          {fromErr ? (
            <p id={`${id}-from-err`} className="mt-1 text-meta text-danger">
              {fromErr}
            </p>
          ) : null}
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-to`} className="mb-1.5 block text-body font-medium">
            Tak
          </label>
          <input
            ref={toRef}
            id={`${id}-to`}
            type="date"
            min={range.from || undefined}
            value={range.to}
            onChange={(e) => {
              setRange((r) => ({ ...r, to: e.target.value }));
              setFieldError(null);
            }}
            aria-invalid={toErr ? true : undefined}
            aria-describedby={toErr ? `${id}-to-err` : undefined}
            className={`${inputClass} aria-[invalid=true]:border-danger`}
          />
          {toErr ? (
            <p id={`${id}-to-err`} className="mt-1 text-meta text-danger">
              {toErr}
            </p>
          ) : null}
        </div>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-body font-medium">Status</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {EXPORT_STATUSES.map((s) => (
            <label
              key={s.key}
              className={`press flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-center text-body font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                status === s.key ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-text"
              }`}
            >
              <input type="radio" name={`${id}-status`} value={s.key} checked={status === s.key} onChange={() => setStatus(s.key)} className="sr-only" />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      <FormError message={serverError ?? (!online ? "Internet nahi hai. Net aane par download karein." : null)} />
      <button
        type="submit"
        disabled={busy || !online}
        aria-busy={busy || undefined}
        className="press flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-title font-medium text-on-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? <SpinnerGap size={20} className="animate-spin" aria-hidden="true" /> : <DownloadSimple size={20} aria-hidden="true" />}
        {busy ? "Download ho raha hai…" : "Excel download"}
      </button>
    </form>
  );
}
