import { Archive, CalendarCheck, Gear, ListChecks, type Icon } from "@phosphor-icons/react";

export type Tab = "tasks" | "archive" | "approvals" | "settings";

const TABS: { key: Tab; label: string; icon: Icon }[] = [
  { key: "tasks", label: "Tasks", icon: ListChecks },
  { key: "archive", label: "Archive", icon: Archive },
  { key: "approvals", label: "Approvals", icon: CalendarCheck },
  { key: "settings", label: "Settings", icon: Gear },
];

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="tnum absolute -top-1.5 left-1/2 ml-1.5 min-w-5 rounded-full bg-danger px-1.5 text-center text-[11px] leading-5 font-semibold text-on-accent">
      {count > 99 ? "99+" : count}
    </span>
  );
}

interface Props {
  tab: Tab;
  onChange: (t: Tab) => void;
  approvals: number;
}

export function BottomTabs({ tab, onChange, approvals }: Props) {
  return (
    <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {TABS.map(({ key, label, icon: I }) => {
          const active = key === tab;
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => onChange(key)}
                aria-current={active ? "page" : undefined}
                aria-label={key === "approvals" && approvals > 0 ? `${label}, ${approvals} pending` : undefined}
                className={`press flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[12px] font-medium ${active ? "text-accent" : "text-muted"}`}
              >
                <span className="relative">
                  <I size={24} weight={active ? "fill" : "regular"} aria-hidden="true" />
                  {key === "approvals" ? <Badge count={approvals} /> : null}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SideRail({ tab, onChange, approvals }: Props) {
  return (
    <nav aria-label="Main" className="sticky top-0 flex h-[100dvh] w-56 shrink-0 flex-col border-r border-line bg-surface px-3 py-4">
      <div className="mb-6 flex items-center gap-2 px-2">
        <img src="/icon-192.png" alt="" width={32} height={32} className="rounded-lg" />
        <span className="text-title font-semibold">Radhe Tasks</span>
      </div>
      <ul className="space-y-1">
        {TABS.map(({ key, label, icon: I }) => {
          const active = key === tab;
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => onChange(key)}
                aria-current={active ? "page" : undefined}
                className={`press flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-body font-medium ${active ? "bg-accent-soft text-accent" : "text-text hover:bg-bg"}`}
              >
                <I size={22} weight={active ? "fill" : "regular"} aria-hidden="true" />
                <span className="flex-1 text-left">{label}</span>
                {key === "approvals" && approvals > 0 ? (
                  <span className="tnum rounded-full bg-danger px-2 text-meta font-semibold text-on-accent" aria-label={`${approvals} pending`}>
                    {approvals}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
