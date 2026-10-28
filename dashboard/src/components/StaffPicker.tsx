import { useMemo, useState } from "react";
import { Check, MagnifyingGlass } from "@phosphor-icons/react";
import { Sheet } from "./Sheet";
import { groupUsers } from "../lib/filters";
import type { Branch, UserDTO } from "../lib/types";
import { inputClass } from "./ui";

interface Props {
  users: UserDTO[];
  branches: Branch[];
  counts: Map<string, number>;
  selected: string | null;
  onSelect: (phone: string | null) => void;
  onClose: () => void;
  /** Sheet title. Default "Staff chuniye". */
  title?: string;
  /** Show the "Sab staff" row (filter use). Default true. */
  allOption?: boolean;
  /** Hide this user (Assign badlo hides the current assignee). */
  excludePhone?: string;
}

export function StaffPicker({ users, branches, counts, selected, onSelect, onClose, title = "Staff chuniye", allOption = true, excludePhone }: Props) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => (excludePhone ? users.filter((u) => u.phone !== excludePhone) : users), [users, excludePhone]);
  const groups = useMemo(() => groupUsers(shown, branches, query), [shown, branches, query]);

  function choose(phone: string | null) {
    onSelect(phone);
    onClose();
  }

  const itemCls = "press flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-bg";

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="sticky top-0 z-10 bg-surface pb-3">
        <label htmlFor="staff-search" className="mb-1.5 block text-meta font-medium text-muted">
          Naam se khojein
        </label>
        <div className="relative">
          <MagnifyingGlass size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input id="staff-search" className={`${inputClass} pl-10`} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
        </div>
      </div>
      {allOption && !query ? (
        <button type="button" className={itemCls} onClick={() => choose(null)} aria-pressed={selected === null}>
          <span className="flex-1 text-title">Sab staff</span>
          {selected === null ? <Check size={20} className="text-accent" aria-hidden="true" /> : null}
        </button>
      ) : null}
      {groups.length === 0 ? <p className="py-8 text-center text-body text-muted">{query ? "Is naam ka koi nahi mila" : "Koi aur active user nahi mila"}</p> : null}
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label} className="mt-3">
          <h3 className="px-3 pb-1 text-meta font-semibold tracking-wide text-muted uppercase">{g.label}</h3>
          <ul>
            {g.users.map((u) => {
              const n = counts.get(u.phone) ?? 0;
              return (
                <li key={u.phone}>
                  <button type="button" className={itemCls} onClick={() => choose(u.phone)} aria-pressed={selected === u.phone}>
                    <span className="min-w-0 flex-1 truncate text-title">{u.name}</span>
                    <span className="tnum text-meta text-muted">{n} pending</span>
                    {selected === u.phone ? <Check size={20} className="text-accent" aria-hidden="true" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Sheet>
  );
}
