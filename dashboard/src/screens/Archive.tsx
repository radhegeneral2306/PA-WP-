import { useMemo, useState } from "react";
import { ArrowClockwise, Archive as ArchiveIcon } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { filterArchive, type ArchiveKind } from "../lib/filters";
import { formatClock } from "../lib/format";
import { useIsDesktop, useResource } from "../lib/hooks";
import type { Branch } from "../lib/types";
import { Chip, ChipRow, EmptyState, ErrorBanner, IconButton, SkeletonRows, TopBar } from "../components/ui";
import { TaskRow } from "../components/TaskRow";
import { TaskDetail } from "../components/TaskDetail";
import { DetailPlaceholder } from "../components/DetailPlaceholder";

export default function Archive({ branches }: { branches: Branch[] }) {
  const isDesktop = useIsDesktop();
  const archive = useResource(() => api.tasks("archive"));
  const [kind, setKind] = useState<ArchiveKind>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const all = archive.data?.tasks ?? [];
  const visible = useMemo(() => filterArchive(all, kind), [all, kind]);
  const selected = selectedId ? all.find((t) => t.id === selectedId) ?? null : null;
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

  if (isDesktop) {
    return (
      <div className="grid grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
        {list}
        {selected ? <TaskDetail task={selected} branches={branches} onClose={() => setSelectedId(null)} variant="panel" /> : <DetailPlaceholder />}
      </div>
    );
  }
  return (
    <>
      {list}
      {selected ? <TaskDetail task={selected} branches={branches} onClose={() => setSelectedId(null)} variant="sheet" /> : null}
    </>
  );
}
