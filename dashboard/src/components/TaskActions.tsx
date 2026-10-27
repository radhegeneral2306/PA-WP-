import { useId, useRef, useState } from "react";
import { CalendarDots, CheckCircle, ChatText, SpinnerGap, UserSwitch, WarningCircle, WifiSlash, XCircle } from "@phosphor-icons/react";
import { api, ApiError, errorText, isTaskClosed } from "../lib/api";
import { REMARK_MAX, todayIst, validateDue, validateRemark, type DueError } from "../lib/due";
import { formatDue } from "../lib/format";
import { useOnline } from "../lib/hooks";
import type { Branch, TaskActionResponse, TaskDTO, UserDTO } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { Sheet } from "./Sheet";
import { StaffPicker } from "./StaffPicker";
import { useToast } from "./Toast";
import { inputClass } from "./ui";

type Kind = "done" | "remark" | "due" | "assign";
type Form = null | "remark" | "due" | "assign-pick";

type RunResult = { ok: true; res: TaskActionResponse } | { ok: false; error: string; stale: boolean };

interface Props {
  task: TaskDTO;
  branches: Branch[];
  users: UserDTO[];
  counts: Map<string, number>;
  onSaved: (task: TaskDTO) => void;
  onDone: () => void;
  onStale: () => void;
}

/** Done, Remark, Date badlo, Assign badlo (Phase 4). Cancel stays disabled until Phase 5. */
export function TaskActions({ task, branches, users, counts, onSaved, onDone, onStale }: Props) {
  const online = useOnline();
  const toast = useToast();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [form, setForm] = useState<Form>(null);
  const [doneError, setDoneError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState<UserDTO | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  // Guards against a double tap before React re-renders the disabled button.
  const inFlight = useRef(false);

  const disabled = busy !== null || !online || staleNotice !== null;

  async function run(kind: Kind, call: () => Promise<TaskActionResponse>): Promise<RunResult> {
    if (inFlight.current) return { ok: false, error: "", stale: false };
    inFlight.current = true;
    setBusy(kind);
    try {
      return { ok: true, res: await call() };
    } catch (e) {
      const stale = isTaskClosed(e) || (e instanceof ApiError && e.status === 404);
      const error = errorText(e);
      if (stale) {
        setForm(null);
        setAssignTo(null);
        setStaleNotice(error || "Ye task ab khula nahi hai.");
        onStale();
      }
      return { ok: false, error, stale };
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function markDone() {
    setDoneError(null);
    const r = await run("done", () => api.done(task.id));
    if (r.ok) {
      const next = r.res.next;
      toast(next ? `Done ho gaya. Agla task: ${formatDue(next.dueAt, next.dueHasTime)}` : "Done ho gaya");
      onDone();
    } else if (!r.stale && r.error) {
      setDoneError(r.error);
    }
  }

  async function confirmAssign() {
    if (!assignTo) return;
    setAssignError(null);
    const r = await run("assign", () => api.assign(task.id, assignTo.phone));
    if (r.ok) {
      toast(`${r.res.task.assigneeName || assignTo.name} ko assign ho gaya`);
      setAssignTo(null);
      onSaved(r.res.task);
    } else if (!r.stale && r.error) {
      setAssignError(r.error);
    }
  }

  const secondary =
    "press flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg border border-line bg-surface px-1 py-1.5 text-meta font-medium whitespace-nowrap text-text hover:bg-bg disabled:cursor-not-allowed disabled:text-muted disabled:opacity-60";

  return (
    <div className="pb-3">
      {staleNotice ? (
        <p role="alert" className="mb-2 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-body break-words">
          <WarningCircle size={20} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          <span>{staleNotice} List refresh ho rahi hai.</span>
        </p>
      ) : null}
      {!online ? (
        <p role="status" className="mb-2 flex items-center justify-center gap-2 text-meta font-medium text-muted">
          <WifiSlash size={16} aria-hidden="true" className="text-warn" />
          Internet nahi hai
        </p>
      ) : null}

      <button
        type="button"
        onClick={markDone}
        disabled={disabled}
        aria-busy={busy === "done" || undefined}
        className={`press flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent text-title font-medium text-on-accent disabled:cursor-not-allowed ${busy === "done" ? "disabled:opacity-80" : "disabled:opacity-50"}`}
      >
        {busy === "done" ? <SpinnerGap size={20} className="animate-spin" aria-hidden="true" /> : <CheckCircle size={20} aria-hidden="true" />}
        {busy === "done" ? "Done ho raha hai…" : "Done karo"}
      </button>
      {doneError ? (
        <p role="alert" className="mt-1.5 text-meta text-danger break-words">
          {doneError}
        </p>
      ) : null}

      <div className="mt-2 grid grid-cols-3 gap-2">
        <button type="button" disabled={disabled} className={secondary} onClick={() => setForm("remark")}>
          <ChatText size={18} aria-hidden="true" />
          Remark
        </button>
        <button type="button" disabled={disabled} className={secondary} onClick={() => setForm("due")}>
          <CalendarDots size={18} aria-hidden="true" />
          Date badlo
        </button>
        <button
          type="button"
          disabled={disabled}
          className={secondary}
          onClick={() => {
            setAssignError(null);
            setForm("assign-pick");
          }}
        >
          <UserSwitch size={18} aria-hidden="true" />
          Assign badlo
        </button>
      </div>

      <button
        type="button"
        disabled
        aria-describedby="cancel-soon"
        className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-danger/40 text-body font-medium text-danger opacity-60 disabled:cursor-not-allowed"
      >
        <XCircle size={18} aria-hidden="true" />
        Cancel
      </button>
      <p id="cancel-soon" className="mt-2 text-center text-meta text-muted">
        Cancel jaldi aa raha hai
      </p>

      {form === "remark" ? (
        <RemarkSheet
          task={task}
          busy={busy === "remark"}
          online={online}
          onClose={() => setForm(null)}
          onSubmit={async (text) => {
            const r = await run("remark", () => api.remark(task.id, text));
            if (r.ok) {
              toast("Remark save ho gaya");
              setForm(null);
              onSaved(r.res.task);
              return null;
            }
            return r.stale ? null : r.error;
          }}
        />
      ) : null}

      {form === "due" ? (
        <DueSheet
          task={task}
          busy={busy === "due"}
          online={online}
          onClose={() => setForm(null)}
          onSubmit={async (date, time, remark) => {
            const r = await run("due", () => api.changeDue(task.id, date, time, remark));
            if (r.ok) {
              toast("Date badal di");
              setForm(null);
              onSaved(r.res.task);
              return null;
            }
            return r.stale ? null : r.error;
          }}
        />
      ) : null}

      {form === "assign-pick" ? (
        <StaffPicker
          title="Kisko assign karein?"
          users={users}
          branches={branches}
          counts={counts}
          selected={null}
          allOption={false}
          excludePhone={task.assigneePhone}
          onSelect={(phone) => setAssignTo(users.find((u) => u.phone === phone) ?? null)}
          onClose={() => setForm(null)}
        />
      ) : null}

      {assignTo ? (
        <ConfirmDialog
          title={`"${task.title}" ab ${assignTo.name} ko dein?`}
          body={`Abhi ye task ${task.assigneeName} ke paas hai.`}
          confirmLabel="Haan, assign karo"
          busyLabel="Assign ho raha hai…"
          busy={busy === "assign"}
          error={assignError ?? (!online ? "Internet nahi hai" : null)}
          onConfirm={() => {
            if (online) void confirmAssign();
          }}
          onCancel={() => {
            setAssignTo(null);
            setAssignError(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Counter({ id, length }: { id: string; length: number }) {
  return (
    <span id={id} className={`tnum text-meta ${length >= REMARK_MAX ? "text-danger" : "text-muted"}`}>
      {length}/{REMARK_MAX}
    </span>
  );
}

function SaveButton({ busy, disabled }: { busy: boolean; disabled: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      aria-busy={busy || undefined}
      className="press flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-title font-medium text-on-accent disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? <SpinnerGap size={20} className="animate-spin" aria-hidden="true" /> : null}
      {busy ? "Save ho raha hai…" : "Save karo"}
    </button>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-body break-words">
      <WarningCircle size={20} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

const textareaClass =
  "block w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 text-[16px] leading-6 text-text placeholder:text-muted focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-accent aria-[invalid=true]:border-danger";

function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const list = ids.filter(Boolean) as string[];
  return list.length ? list.join(" ") : undefined;
}

/** Returns null on success (the parent closes the sheet), or the server error to show inline. */
type Submit<A extends unknown[]> = (...args: A) => Promise<string | null>;

function RemarkSheet({ task, busy, online, onClose, onSubmit }: { task: TaskDTO; busy: boolean; online: boolean; onClose: () => void; onSubmit: Submit<[string]> }) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const err = validateRemark(text);
    setFieldError(err);
    setServerError(null);
    if (err) {
      ref.current?.focus();
      return;
    }
    const res = await onSubmit(text.trim());
    if (res) setServerError(res);
  }

  return (
    <Sheet title="Remark jodo" subtitle={task.title} onClose={onClose} initialFocus={ref}>
      <form onSubmit={submit} noValidate className="space-y-4 pt-1">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <label htmlFor={`${id}-text`} className="text-body font-medium">
              Remark
            </label>
            <Counter id={`${id}-count`} length={text.length} />
          </div>
          <textarea
            ref={ref}
            id={`${id}-text`}
            rows={4}
            maxLength={REMARK_MAX}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (fieldError) setFieldError(null);
            }}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={describedBy(`${id}-count`, fieldError && `${id}-err`)}
            className={textareaClass}
          />
          {fieldError ? (
            <p id={`${id}-err`} className="mt-1 text-meta text-danger">
              {fieldError}
            </p>
          ) : null}
        </div>
        <FormError message={serverError ?? (!online ? "Internet nahi hai. Net aane par save karein." : null)} />
        <SaveButton busy={busy} disabled={busy || !online} />
      </form>
    </Sheet>
  );
}

function DueSheet({
  task,
  busy,
  online,
  onClose,
  onSubmit,
}: {
  task: TaskDTO;
  busy: boolean;
  online: boolean;
  onClose: () => void;
  onSubmit: Submit<[string, string | null, string]>;
}) {
  const id = useId();
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [remark, setRemark] = useState("");
  const [fieldError, setFieldError] = useState<DueError | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const min = todayIst();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const err = validateDue(date, time || null);
    setFieldError(err);
    setServerError(null);
    if (err) {
      (err.field === "time" ? timeRef : dateRef).current?.focus();
      return;
    }
    const res = await onSubmit(date, time || null, remark);
    if (res) setServerError(res);
  }

  const dateErr = fieldError?.field === "date" ? fieldError.message : null;
  const timeErr = fieldError?.field === "time" ? fieldError.message : null;

  return (
    <Sheet title="Date badlo" subtitle={`Abhi ki date: ${formatDue(task.dueAt, task.dueHasTime)}${task.dueHasTime ? "" : ", 10:00 AM"}`} onClose={onClose} initialFocus={dateRef}>
      <form onSubmit={submit} noValidate className="space-y-4 pt-1">
        <div>
          <label htmlFor={`${id}-date`} className="mb-1.5 block text-body font-medium">
            Nayi date
          </label>
          <input
            ref={dateRef}
            id={`${id}-date`}
            type="date"
            min={min}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setFieldError(null);
            }}
            aria-invalid={dateErr ? true : undefined}
            aria-describedby={dateErr ? `${id}-date-err` : undefined}
            className={`${inputClass} aria-[invalid=true]:border-danger`}
            required
          />
          {dateErr ? (
            <p id={`${id}-date-err`} className="mt-1 text-meta text-danger">
              {dateErr}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor={`${id}-time`} className="mb-1.5 block text-body font-medium">
            Time (optional)
          </label>
          <input
            ref={timeRef}
            id={`${id}-time`}
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setFieldError(null);
            }}
            aria-invalid={timeErr ? true : undefined}
            aria-describedby={describedBy(`${id}-time-help`, timeErr && `${id}-time-err`)}
            className={`${inputClass} aria-[invalid=true]:border-danger`}
          />
          <p id={`${id}-time-help`} className="mt-1 text-meta text-muted">
            Time nahi diya toh 10:00 AM
          </p>
          {timeErr ? (
            <p id={`${id}-time-err`} className="mt-1 text-meta text-danger">
              {timeErr}
            </p>
          ) : null}
        </div>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <label htmlFor={`${id}-remark`} className="text-body font-medium">
              Remark (kyun badli?)
            </label>
            <Counter id={`${id}-count`} length={remark.length} />
          </div>
          <textarea
            id={`${id}-remark`}
            rows={2}
            maxLength={REMARK_MAX}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            aria-describedby={`${id}-count`}
            className={textareaClass}
          />
        </div>
        <FormError message={serverError ?? (!online ? "Internet nahi hai. Net aane par save karein." : null)} />
        <SaveButton busy={busy} disabled={busy || !online} />
      </form>
    </Sheet>
  );
}
