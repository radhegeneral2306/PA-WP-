import { useMemo, useState } from "react";
import { ArrowClockwise, CaretDown, ClipboardText, MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { ADMINS, ALL, applyFilters, applySummary, summaryCounts, type SummaryFilter } from "../lib/filters";
import { formatClock } from "../lib/format";
import { useIsDesktop, type Resource } from "../lib/hooks";
import type { TaskDTO, TasksResponse, UsersResponse } from "../lib/types";
import { Chip, ChipRow, EmptyState, ErrorBanner, IconButton, SkeletonRows, TopBar, inputClass } from "../components/ui";
import { TaskRow } from "../components/TaskRow";
import { TaskDetail } from "../components/TaskDetail";
import { StaffPicker } from "../components/StaffPicker";
import { DetailPlaceholder } from "../components/DetailPlaceholder";
import { NewTaskSheet } from "../components/NewTaskSheet";

interface Props {
  pending: Resource<TasksResponse>;
  users: Resource<UsersResponse>;
}

export function Tasks({ pending, users }: Props) {
  const isDesktop = useIsDesktop();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState<string>(ALL);
  const [staffPhone, setStaffPhone] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryFilter>("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const allTasks = pending.data?.tasks ?? [];
  const userList = users.data?.users ?? [];
  const branches = users.data?.branches ?? [];

  const base = useMemo(() => applyFilters(allTasks, { branch, staffPhone, query }, userList), [allTasks, branch, staffPhone, query, userList]);
  const counts = useMemo(() => summaryCounts(base), [base]);
  const visible = useMemo(() => applySummary(base, summary), [base, summary]);
  const perStaff = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of allTasks) m.set(t.assigneePhone, (m.get(t.assigneePhone) ?? 0) + 1);
    return m;
  }, [allTasks]);

  // After a write we show the task the API returned until the refreshed list catches up
  // (whichever copy has the newer updatedAt wins). After a 409/404 the copy is pinned so the
  // detail stays open with the error even when the refreshed list no longer has the task.
  const [local, setLocal] = useState<{ task: TaskDTO; pinned: boolean } | null>(null);
  const listTask = selectedId ? allTasks.find((t) => t.id === selectedId) ?? null : null;
  const localTask = local && local.task.id === selectedId ? local : null;
  let selected: TaskDTO | null = listTask;
  if (localTask) {
    if (localTask.pinned) selected = localTask.task;
    else if (!listTask || Date.parse(localTask.task.updatedAt) >= Date.parse(listTask.updatedAt)) selected = localTask.task;
  }

  function openTask(id: string | null) {
    setSelectedId(id);
    setLocal(null);
  }
  const detailProps = selected
    ? {
        task: selected,
        branches,
        users: userList,
        counts: perStaff,
        onClose: () => openTask(null),
        onSaved: (t: TaskDTO) => {
          setLocal({ task: t, pinned: false });
          pending.reload();
        },
        onDone: () => {
          openTask(null);
          pending.reload();
        },
        onStale: () => {
          const current = selected;
          if (current) setLocal({ task: current, pinned: true });
          pending.reload();
        },
      }
    : null;
  const staffName = staffPhone ? userList.find((u) => u.phone === staffPhone)?.name ?? allTasks.find((t) => t.assigneePhone === staffPhone)?.assigneeName ?? "Staff" : null;
  const filtersActive = branch !== ALL || staffPhone !== null || query.trim() !== "" || summary !== "all";

  function clearFilters() {
    setBranch(ALL);
    setStaffPhone(null);
    setQuery("");
    setSummary("all");
  }

  const loadingFirst = pending.loading && !pending.data;
  const summaryItems: { key: SummaryFilter; label: string; value: number; tone: string }[] = [
    { key: "all", label: "Pending", value: counts.pending, tone: "text-text" },
    { key: "overdue", label: "Overdue", value: counts.overdue, tone: "text-danger" },
    { key: "today", label: "Aaj due", value: counts.today, tone: "text-warn" },
  ];

  const list = (
    <div className="min-w-0">
      <TopBar title="Tasks">
        {isDesktop ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="press mr-1 flex h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-body font-medium text-on-accent"
          >
            <Plus size={18} weight="bold" aria-hidden="true" />
            Naya task
          </button>
        ) : null}
        <IconButton label="Refresh karein" onClick={pending.reload} disabled={pending.loading}>
          <ArrowClockwise size={22} className={pending.loading ? "animate-spin" : ""} />
        </IconButton>
        <IconButton
          label={searchOpen ? "Search band karein" : "Search karein"}
          pressed={searchOpen}
          onClick={() => {
            if (searchOpen) setQuery("");
            setSearchOpen((s) => !s);
          }}
        >
          {searchOpen ? <X size={22} /> : <MagnifyingGlass size={22} />}
        </IconButton>
      </TopBar>

      {searchOpen ? (
        <div className="px-safe pb-2">
          <label htmlFor="task-search" className="mb-1.5 block text-meta font-medium text-muted">
            Task ya staff ka naam
          </label>
          <div className="relative">
            <MagnifyingGlass size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input id="task-search" type="search" autoFocus className={`${inputClass} pl-10`} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" enterKeyHint="search" />
          </div>
        </div>
      ) : null}

      <div className="px-safe grid grid-cols-3 gap-2 pb-2" role="group" aria-label="Summary">
        {summaryItems.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSummary(s.key === summary ? "all" : s.key)}
            aria-pressed={summary === s.key}
            className={`press flex min-h-14 flex-col items-start justify-center rounded-lg border px-3 py-2 text-left ${
              summary === s.key ? "border-accent bg-accent-soft" : "border-line bg-surface"
            }`}
          >
            <span className={`tnum text-screen leading-7 font-semibold ${s.tone}`}>{pending.data ? s.value : "-"}</span>
            <span className="text-meta text-muted">{s.label}</span>
          </button>
        ))}
      </div>

      <ChipRow label="Branch filter">
        <Chip selected={branch === ALL} onClick={() => setBranch(ALL)}>
          Sab
        </Chip>
        {branches.map((b) => (
          <Chip key={b.id} selected={branch === b.id} onClick={() => setBranch(b.id)}>
            {b.name}
          </Chip>
        ))}
        <Chip selected={branch === ADMINS} onClick={() => setBranch(ADMINS)}>
          Admins
        </Chip>
        <Chip selected={staffPhone !== null} onClick={() => setPickerOpen(true)} ariaLabel={staffName ? `Staff filter: ${staffName}. Badalne ke liye dabayein` : "Staff chuniye"}>
          {staffName ?? "Staff"}
          <CaretDown size={16} aria-hidden="true" />
        </Chip>
      </ChipRow>

      <div className="px-safe flex min-h-9 items-center justify-between gap-2 pt-1 text-meta text-muted">
        <span className="tnum">{pending.updatedAt ? `Last updated ${formatClock(pending.updatedAt)}` : pending.loading ? "Load ho raha hai…" : ""}</span>
        {filtersActive ? (
          <button type="button" onClick={clearFilters} className="press -mr-2 min-h-9 rounded-lg px-2 font-medium text-accent">
            Filter hatayein
          </button>
        ) : null}
      </div>

      {pending.error ? <ErrorBanner message={pending.error} onRetry={pending.reload} /> : null}
      {users.error && !pending.error ? <ErrorBanner message={`Staff list load nahi hui. ${users.error}`} onRetry={users.reload} /> : null}

      {loadingFirst ? <SkeletonRows count={6} /> : null}
      {pending.data && visible.length === 0 ? (
        <EmptyState
          icon={<ClipboardText size={40} />}
          title="Koi pending task nahi"
          hint={filtersActive ? "Filter ya search badal kar dekhein." : "Sab kaam ho gaye. Naya task WhatsApp se ya \"Naya task\" button se banaiye."}
        >
          {filtersActive ? (
            <button type="button" onClick={clearFilters} className="press mt-4 min-h-11 rounded-lg border border-line px-4 font-medium text-accent">
              Filter hatayein
            </button>
          ) : null}
        </EmptyState>
      ) : null}
      {visible.length > 0 ? (
        <ul className="divide-y divide-line border-t border-line pb-24 lg:pb-4" aria-label="Pending tasks">
          {visible.map((t) => (
            <TaskRow key={t.id} task={t} branches={branches} selected={isDesktop && t.id === selectedId} onOpen={(x) => openTask(x.id)} mode="pending" />
          ))}
        </ul>
      ) : null}
    </div>
  );

  return (
    <>
      {isDesktop ? (
        <div className="grid grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
          {list}
          {detailProps ? (
            <TaskDetail key={detailProps.task.id} {...detailProps} variant="panel" />
          ) : (
            <DetailPlaceholder />
          )}
        </div>
      ) : (
        <>
          {list}
          {detailProps ? <TaskDetail key={detailProps.task.id} {...detailProps} variant="sheet" /> : null}
        </>
      )}
      {!isDesktop ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="press fixed right-4 bottom-[calc(80px+env(safe-area-inset-bottom))] z-20 flex h-14 items-center gap-2 rounded-full bg-accent pr-5 pl-4 text-title font-medium text-on-accent shadow-lg"
        >
          <Plus size={22} weight="bold" aria-hidden="true" />
          Naya task
        </button>
      ) : null}
      {creating ? (
        <NewTaskSheet
          users={userList}
          branches={branches}
          counts={perStaff}
          initialAssignee={staffPhone}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            pending.reload();
          }}
        />
      ) : null}
      {pickerOpen ? (
        <StaffPicker users={userList} branches={branches} counts={perStaff} selected={staffPhone} onSelect={setStaffPhone} onClose={() => setPickerOpen(false)} />
      ) : null}
    </>
  );
}
