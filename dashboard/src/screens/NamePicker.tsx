import { useState } from "react";
import { CaretRight, SpinnerGap, UserCircle, ArrowLeft } from "@phosphor-icons/react";
import { api, errorText } from "../lib/api";
import { ErrorBanner, EmptyState, SkeletonRows } from "../components/ui";

interface Props {
  admins: string[] | null; // null = still loading
  loadError: string | null;
  onRetryLoad: () => void;
  current: string | null;
  onPicked: (token: string, name: string) => void;
  onBack?: () => void;
}

export function NamePicker({ admins, loadError, onRetryLoad, current, onPicked, onBack }: Props) {
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(name: string) {
    setBusyName(name);
    setError(null);
    try {
      const r = await api.actor(name);
      onPicked(r.token, r.name);
    } catch (e) {
      setError(errorText(e));
      setBusyName(null);
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <main className="pt-safe pb-safe mx-auto w-full max-w-md flex-1 py-6">
        <div className="px-safe mb-4">
          {onBack ? (
            <button type="button" onClick={onBack} className="press -ml-3 mb-2 flex h-11 items-center gap-1 rounded-lg px-3 text-accent font-medium">
              <ArrowLeft size={20} aria-hidden="true" />
              Wapas
            </button>
          ) : null}
          <h1 className="text-screen font-semibold">Aap kaun ho?</h1>
          <p className="mt-1 text-body text-muted">Apna naam chuniye. Dashboard se kiye kaam isi naam se dikhenge.</p>
        </div>

        {error ? <ErrorBanner message={error} onRetry={() => setError(null)} /> : null}

        {admins === null && loadError ? <ErrorBanner message={loadError} onRetry={onRetryLoad} /> : null}
        {admins === null && !loadError ? <SkeletonRows count={3} /> : null}
        {admins !== null && admins.length === 0 ? (
          <EmptyState icon={<UserCircle size={40} />} title="Koi admin nahi mila" hint="WhatsApp bot mein admin add karein, phir dobara try karein.">
            <button type="button" onClick={onRetryLoad} className="press mt-4 min-h-11 rounded-lg border border-line px-4 font-medium text-accent">
              Dobara try karein
            </button>
          </EmptyState>
        ) : null}
        {admins && admins.length > 0 ? (
          <ul className="mx-4 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {admins.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => pick(name)}
                  disabled={busyName !== null}
                  className="press flex min-h-14 w-full items-center gap-3 px-4 text-left disabled:opacity-60"
                >
                  <UserCircle size={24} className="shrink-0 text-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-title font-medium">{name}</span>
                  {current === name ? <span className="text-meta text-muted">Abhi</span> : null}
                  {busyName === name ? (
                    <SpinnerGap size={20} className="animate-spin text-muted" aria-label="Ho raha hai" />
                  ) : (
                    <CaretRight size={20} className="text-muted" aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </main>
    </div>
  );
}
