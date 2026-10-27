import { useId, useRef, useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { api, errorText } from "../lib/api";
import { TITLE_MAX, todayIst, validateNewTask, type NewTaskErrors } from "../lib/due";
import { branchLabel } from "../lib/filters";
import { useOnline } from "../lib/hooks";
import type { Branch, TaskDTO, TaskRepeat, UserDTO } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { Counter, describedBy, FormError, SaveButton, textareaClass } from "./formParts";
import { Sheet } from "./Sheet";
import { StaffPicker } from "./StaffPicker";
import { useToast } from "./Toast";
import { inputClass } from "./ui";

const REPEATS: { key: TaskRepeat; label: string; hint: (day: number | null) => string }[] = [
  { key: "none", label: "Ek baar", hint: () => "Due time pe reminder. Done na ho toh roz subah 11 baje yaad dilayega." },
  { key: "every90", label: "Har 90 min", hint: () => "Due time se har 90 min (10 AM se 8 PM). Jawab aane par agle din tak rukega." },
  {
    key: "monthly",
    label: "Har mahine",
    hint: (day) => `Har mahine ${day ? `${day} tareekh` : "isi tareekh"} ko. Done karne par agle mahine ka task apne aap banega.`,
  },
];

type FieldErrors = NewTaskErrors;

interface Props {
  users: UserDTO[];
  branches: Branch[];
  counts: Map<string, number>;
  /** Pre-picks the staff member the list is filtered to. */
  initialAssignee: string | null;
  onClose: () => void;
  onCreated: (task: TaskDTO) => void;
}

/** "Naya task" from the dashboard: who, what, when, how often. Mirrors the WhatsApp wizard (no 25-day limit for admins). */
export function NewTaskSheet({ users, branches, counts, initialAssignee, onClose, onCreated }: Props) {
  const id = useId();
  const online = useOnline();
  const toast = useToast();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const whoRef = useRef<HTMLButtonElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<string | null>(initialAssignee && users.some((u) => u.phone === initialAssignee) ? initialAssignee : null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [repeat, setRepeat] = useState<TaskRepeat>("none");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const person = assignee ? users.find((u) => u.phone === assignee) ?? null : null;
  const dirty = title.trim() !== "" || date !== "" || time !== "" || repeat !== "none" || assignee !== (initialAssignee ?? null);
  const day = date ? Number(date.slice(8, 10)) : null;

  function close() {
    if (busy) return;
    if (dirty) setAskDiscard(true);
    else onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || inFlight.current) return;
    const t = title.trim();
    const next = validateNewTask({ title, assignee: person?.phone ?? null, date, time });
    setErrors(next);
    setServerError(null);
    if (next.title) return titleRef.current?.focus();
    if (next.assignee) return whoRef.current?.focus();
    if (next.due) return (next.due.field === "time" ? timeRef : dateRef).current?.focus();
    if (!person) return;

    inFlight.current = true;
    setBusy(true);
    try {
      const res = await api.createTask({ title: t, assigneePhone: person.phone, date, time: time || null, repeat });
      toast(`Task ban gaya: ${res.task.assigneeName || person.name}`);
      onCreated(res.task);
    } catch (err) {
      setServerError(errorText(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const dateErr = errors.due?.field === "date" ? errors.due.message : null;
  const timeErr = errors.due?.field === "time" ? errors.due.message : null;
  const repeatHint = REPEATS.find((r) => r.key === repeat)!.hint(day);

  return (
    <>
      <Sheet title="Naya task" subtitle="Jisko doge usko WhatsApp pe message jayega" onClose={close} initialFocus={titleRef}>
        <form onSubmit={submit} noValidate className="space-y-5 pt-1">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <label htmlFor={`${id}-title`} className="text-body font-medium">
                Task kya hai?
              </label>
              <Counter id={`${id}-count`} length={title.length} max={TITLE_MAX} />
            </div>
            <textarea
              ref={titleRef}
              id={`${id}-title`}
              rows={2}
              maxLength={TITLE_MAX}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errors.title) setErrors({ ...errors, title: undefined });
              }}
              enterKeyHint="next"
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={describedBy(`${id}-count`, errors.title && `${id}-title-err`)}
              className={textareaClass}
            />
            {errors.title ? (
              <p id={`${id}-title-err`} className="mt-1 text-meta text-danger">
                {errors.title}
              </p>
            ) : null}
          </div>

          <div>
            <p id={`${id}-who-label`} className="mb-1.5 text-body font-medium">
              Kisko dena hai?
            </p>
            <button
              ref={whoRef}
              type="button"
              onClick={() => setPicking(true)}
              aria-labelledby={`${id}-who-label ${id}-who-value`}
              aria-invalid={errors.assignee ? true : undefined}
              aria-describedby={errors.assignee ? `${id}-who-err` : undefined}
              className="press flex min-h-12 w-full items-center gap-3 rounded-lg border border-line bg-surface px-3 text-left hover:bg-bg aria-[invalid=true]:border-danger"
            >
              <span id={`${id}-who-value`} className="min-w-0 flex-1">
                {person ? (
                  <>
                    <span className="block truncate text-title">{person.name}</span>
                    <span className="block text-meta text-muted">{person.role === "admin" ? "Admin" : branchLabel(person.branch, branches)}</span>
                  </>
                ) : (
                  <span className="text-title text-muted">Chuniye</span>
                )}
              </span>
              <CaretRight size={18} aria-hidden="true" className="shrink-0 text-muted" />
            </button>
            {errors.assignee ? (
              <p id={`${id}-who-err`} className="mt-1 text-meta text-danger">
                {errors.assignee}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-date`} className="mb-1.5 block text-body font-medium">
                Due date
              </label>
              <input
                ref={dateRef}
                id={`${id}-date`}
                type="date"
                min={todayIst()}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setErrors({ ...errors, due: undefined });
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
                  setErrors({ ...errors, due: undefined });
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
          </div>

          <fieldset>
            <legend className="mb-1.5 text-body font-medium">Reminder</legend>
            <div className="grid grid-cols-3 gap-2" aria-describedby={`${id}-repeat-help`}>
              {REPEATS.map((r) => (
                <label
                  key={r.key}
                  className={`press flex min-h-12 cursor-pointer items-center justify-center rounded-lg border px-2 text-center text-body font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                    repeat === r.key ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-text"
                  }`}
                >
                  <input type="radio" name={`${id}-repeat`} value={r.key} checked={repeat === r.key} onChange={() => setRepeat(r.key)} className="sr-only" />
                  {r.label}
                </label>
              ))}
            </div>
            <p id={`${id}-repeat-help`} className="mt-1.5 text-meta text-muted">
              {repeatHint}
            </p>
          </fieldset>

          <FormError message={serverError ?? (!online ? "Internet nahi hai. Net aane par banaiye." : null)} />
          <SaveButton busy={busy} disabled={busy || !online} label="Task banao" busyLabel="Task ban raha hai…" />
        </form>
      </Sheet>

      {picking ? (
        <StaffPicker
          title="Kisko dena hai?"
          users={users}
          branches={branches}
          counts={counts}
          selected={assignee}
          allOption={false}
          onSelect={(phone) => {
            setAssignee(phone);
            setErrors((e) => ({ ...e, assignee: undefined }));
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}

      {askDiscard ? (
        <ConfirmDialog
          title="Form band karein?"
          body="Jo likha hai wo mit jayega. Task nahi banega."
          confirmLabel="Haan, band karo"
          danger
          onConfirm={onClose}
          onCancel={() => setAskDiscard(false)}
        />
      ) : null}
    </>
  );
}
