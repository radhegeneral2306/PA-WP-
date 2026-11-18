import { CaretDown } from "@phosphor-icons/react";
import { useId, useState } from "react";
import type { BranchStats } from "../lib/branchStats";
import { ALL } from "../lib/filters";

/** Round 6: compact "Branch-wise" card from the loaded pending list. Tapping a row filters like the chips. */
export function BranchWise({ stats, selected, onSelect }: { stats: BranchStats; selected: string; onSelect: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const otherCount = stats.other.pending;
  return (
    <section aria-label="Branch-wise" className="px-safe pb-2">
      <div className="rounded-lg border border-line bg-surface">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="press flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-body font-medium"
        >
          Branch-wise
          <CaretDown size={18} aria-hidden="true" className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <div id={id} hidden={!open}>
          {open ? (
            <div className="border-t border-line">
              <div className="tnum grid grid-cols-[minmax(0,1fr)_3.25rem_3.5rem_3.5rem] items-center gap-1 px-3 pt-2 text-meta text-muted" aria-hidden="true">
                <span />
                <span className="text-right">Pending</span>
                <span className="text-right">Overdue</span>
                <span className="text-right">Aaj due</span>
              </div>
              <ul className="pb-1">
                {stats.rows.map((r) => {
                  const on = selected === r.key;
                  return (
                    <li key={r.key}>
                      <button
                        type="button"
                        aria-pressed={on}
                        aria-label={`${r.label}: ${r.pending} pending, ${r.overdue} overdue, ${r.today} aaj due`}
                        onClick={() => onSelect(on ? ALL : r.key)}
                        className={`press tnum grid min-h-11 w-full grid-cols-[minmax(0,1fr)_3.25rem_3.5rem_3.5rem] items-center gap-1 px-3 text-left text-body ${on ? "bg-accent-soft" : ""}`}
                      >
                        <span className={`truncate ${on ? "font-semibold" : "font-medium"}`}>{r.label}</span>
                        <span className="text-right">{r.pending}</span>
                        <span className={`text-right ${r.overdue ? "font-semibold text-danger" : "text-muted"}`}>{r.overdue}</span>
                        <span className={`text-right ${r.today ? "font-semibold text-warn" : "text-muted"}`}>{r.today}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {otherCount > 0 ? (
                <p className="px-3 pb-2 text-meta text-muted">
                  Bina branch ke staff ke {otherCount} pending task sirf &quot;Sab&quot; mein dikhte hain.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
