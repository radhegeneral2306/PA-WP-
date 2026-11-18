import { useMemo, useState, type ReactNode } from "react";
import { ArrowClockwise, Archive as ArchiveIcon, Trash } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { filterArchive, sortBin, type ArchiveKind } from "../lib/filters";
import { BIN_DAYS, formatClock } from "../lib/format";
import { useIsDesktop, useResource } from "../lib/hooks";
import { getItem, setItem } from "../lib/storage";
import type { Branch, TaskDTO } from "../lib/types";
import { Chip, ChipRow, EmptyState, ErrorBanner, IconButton, SkeletonRows, TopBar } from "../components/ui";
import { TaskRow } from "../components/TaskRow";
import { TaskDetail } from "../components/TaskDetail";
import { DetailPlaceholder } from "../components/DetailPlaceholder";

type View = "archive" | "bin";
const VIEW_KEY = "rt.archiveView";

interface Props {
  branches: Branch[];
  /** Lets the app refresh its pending list after a task comes back (reopened or restored) or leaves (deleted). */
  onReopened: () => void;
}

/** Archive (done + cancelled) and, as a second segment, the F8 Recycle bin. */
export default function Archive({ branches, onReopened }: Props) {
  const [view, setView] = useState<View>(() => (getItem(VIEW_KEY) === "bin" ? "bin" : "archive"));

  function choose(v: View) {
    setView(v);
    setItem(VIEW_KEY, v);
  }

  const segment = (
    <div className="px-safe pb-2">
      <div role="radiogroup" aria-label="Kya dikhayein" className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface p-1">
        {(
          [
            { key: "archive", label: "Archive", icon: <ArchiveIcon size={18} aria-hidden="true" /> },
            { key: "bin", label: "Recycle bin", icon: <Trash size={18} aria-hidden="true" /> },
          ] as const
        ).map((s) => (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={view === s.key}
            onClick={() => choose(s.key)}
            className={`press flex min-h-11 items-center justify-center gap-1.5 rounded-md text-body font-medium ${
              view === s.key ? "bg-accent text-on-accent" : "text-text hover:bg-bg"
            }`}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );

  return view === "bin" ? (
    <BinView branches={branches} segment={segment} onChanged={onReopened} />
  ) : (
    <ArchiveView branches={branches} segment={segment} onChanged={onReopened} />
  );
}

interface ViewProps {
  branches: Branch[];
  segment: ReactNode;
  onChanged: () => void;
}

function ArchiveView({ branches, segment, onChanged }: ViewProps) {
  const isDesktop = useIsDesktop();
  const archive = useResource(() => api.tasks("archive"));
  const [kind, setKind] = useState<ArchiveKind>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const all = archive.data?.tasks ?? [];
  const visible = useMemo(() => filterArchive(all, kind), [all, kind]);
  const selected = selectedId ? all.find((t) => t.id === selectedId) ?? null : null;
  const reopened = () => {
    setSelectedId(null);
    archive.reload();
    onChanged();
  };
  // A done/cancelled task going to the bin does not change the pending list: no extra read for it.
  const deleted = () => {
    setSelectedId(null);
    archive.reload();
  };
  const detail = selected ? (
    <TaskDetailFor task={selected} branches={branches} onClose={() => setSelectedId(null)} onReopened={reopened} onRemoved={deleted} onStale={archive.reload} />
  ) : null;
  const kinds: { key: ArchiveKind; label: string }[] = [
    { key: "all", label: "Sab" },
    { key: "done", label: "Done" },
    { key: "cancelled", label: "Cancelled" },
  ];

  const list = (
    <div className="min-w-0">
      <TopBar title="Archive">
        <IconButton label="Refresh karein" onClick={archive.reload} disabled={archive.loading}>
          <ArrowClockwise size={22} className={archive.loading ? "animate-spin" : ""} />
        </IconButton>
      </TopBar>
      {segment}
      <ChipRow label="Archive filter">
        {kinds.map((k) => (
          <Chip key={k.key} selected={kind === k.key} onClick={() => setKind(k.key)}>
            {k.label}
          </Chip>
        ))}
      </ChipRow>
      <p className="px-safe tnum flex min-h-9 items-center pt-1 text-meta text-muted">
        {archive.updatedAt ? `Last updated ${formatClock(archive.updatedAt)}` : archive.loading ? "Load ho raha hai…" : ""}
      </p>
      {archive.error ? <ErrorBanner message={archive.error} onRetry={archive.reload} /> : null}
      {archive.loading && !archive.data ? <SkeletonRows count={6} /> : null}
      {archive.data && visible.length === 0 ? (
        <EmptyState
          icon={<ArchiveIcon size={40} />}
          title={kind === "all" ? "Abhi archive khaali hai" : kind === "done" ? "Koi done task nahi" : "Koi cancelled task nahi"}
          hint="Done aur cancel hue tasks yahan dikhenge."
        />
      ) : null}
      {visible.length > 0 ? (
        <ul className="divide-y divide-line border-t border-line pb-4" aria-label="Archive tasks">
          {visible.map((t) => (
            <TaskRow key={t.id} task={t} branches={branches} selected={isDesktop && t.id === selectedId} onOpen={(x) => setSelectedId(x.id)} mode="archive" />
          ))}
        </ul>
      ) : null}
    </div>
  );

  return <Layout list={list} detail={detail} />;
}

function BinView({ branches, segment, onChanged }: ViewProps) {
  const isDesktop = useIsDesktop();
  const bin = useResource(() => api.tasks("bin"));
  // Only the super admin may empty the bin for good; asked once when the bin opens.
  const me = useResource(() => api.me());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const all = useMemo(() => sortBin(bin.data?.tasks ?? []), [bin.data]);
  const selected = selectedId ? all.find((t) => t.id === selectedId) ?? null : null;
  const done = () => {
    setSelectedId(null);
    bin.reload();
    onChanged();
  };
  const detail = selected ? (
    <TaskDetailFor
      task={selected}
      branches={branches}
      onClose={() => setSelectedId(null)}
      onRemoved={done}
      onStale={bin.reload}
      superAdmin={me.data?.superAdmin === true}
    />
  ) : null;

  const list = (
    <div className="min-w-0">
      <TopBar title="Archive">
        <IconButton label="Refresh karein" onClick={bin.reload} disabled={bin.loading}>
          <ArrowClockwise size={22} className={bin.loading ? "animate-spin" : ""} />
        </IconButton>
      </TopBar>
      {segment}
      <p className="px-safe pt-1 text-meta text-muted">Delete hue tasks {BIN_DAYS} din tak yahan rehte hain, phir apne aap hat jaate hain.</p>
      <p className="px-safe tnum flex min-h-9 items-center text-meta text-muted">
        {bin.updatedAt ? `Last updated ${formatClock(bin.updatedAt)}` : bin.loading ? "Load ho raha hai…" : ""}
      </p>
      {bin.error ? <ErrorBanner message={bin.error} onRetry={bin.reload} /> : null}
      {bin.loading && !bin.data ? <SkeletonRows count={6} /> : null}
      {bin.data && all.length === 0 ? <EmptyState icon={<Trash size={40} />} title="Recycle bin khaali hai" hint="Task detail mein Delete dabane par task yahan aata hai." /> : null}
      {all.length > 0 ? (
        <ul className="divide-y divide-line border-t border-line pb-4" aria-label="Recycle bin tasks">
          {all.map((t) => (
            <TaskRow key={t.id} task={t} branches={branches} selected={isDesktop && t.id === selectedId} onOpen={(x) => setSelectedId(x.id)} mode="bin" />
          ))}
        </ul>
      ) : null}
    </div>
  );

  return <Layout list={list} detail={detail} />;
}

type DetailFor = Omit<React.ComponentProps<typeof TaskDetail>, "variant"> & { task: TaskDTO };

/** The detail as a sheet on phones and a side panel on desktop. */
function TaskDetailFor(props: DetailFor) {
  const isDesktop = useIsDesktop();
  return <TaskDetail key={props.task.id} {...props} variant={isDesktop ? "panel" : "sheet"} />;
}

function Layout({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  const isDesktop = useIsDesktop();
  if (isDesktop) {
    return (
      <div className="grid grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
        {list}
        {detail ?? <DetailPlaceholder />}
      </div>
    );
  }
  return (
    <>
      {list}
      {detail}
    </>
  );
}
