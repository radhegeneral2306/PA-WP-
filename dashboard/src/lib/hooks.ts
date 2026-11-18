import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "./api";
import { AUTO_REFRESH_MS, canAutoRefresh, MIN_REFRESH_GAP_MS, nextAutoDelay } from "./refresh";

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setMatch(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [query]);
  return match;
}

export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: Date | null;
  /** When the last fetch started (ms since epoch), whether it worked or not. */
  startedAt: number | null;
  reload: () => void;
}

/** Fetches on mount and on reload(). Keeps the last good data while refreshing. */
export function useResource<T>(fetcher: () => Promise<T>): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setStartedAt(Date.now());
    fetcherRef
      .current()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setUpdatedAt(new Date());
      })
      .catch((e: unknown) => {
        if (alive) setError(errorText(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, updatedAt, startedAt, reload };
}

function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/**
 * Silent background refresh for a resource (see lib/refresh.ts for the read budget):
 * once when the tab/app becomes visible again, and every AUTO_REFRESH_MS while visible.
 * Never while hidden, never sooner than MIN_REFRESH_GAP_MS after the last fetch.
 * Returns `maybeReload`, the same throttled reload for other automatic triggers.
 */
export function useAutoRefresh(res: Pick<Resource<unknown>, "reload" | "loading" | "startedAt">): () => void {
  const state = useRef(res);
  state.current = res;
  // Set the moment we ask for a reload, before React re-renders with the new startedAt,
  // so a focus event right after visibilitychange is swallowed.
  const askedAt = useRef<number | null>(null);

  const lastAt = useCallback(() => {
    const a = state.current.startedAt;
    const b = askedAt.current;
    return a === null ? b : b === null ? a : Math.max(a, b);
  }, []);

  const maybeReload = useCallback(() => {
    const now = Date.now();
    if (!canAutoRefresh({ lastAt: lastAt(), now, visible: pageVisible(), busy: state.current.loading }, MIN_REFRESH_GAP_MS)) return;
    askedAt.current = now;
    state.current.reload();
  }, [lastAt]);

  // Timer: re-armed after every fetch (manual ones included), stopped while hidden.
  const [visible, setVisible] = useState(pageVisible);
  useEffect(() => {
    if (!visible || res.loading) return;
    const id = window.setTimeout(maybeReload, nextAutoDelay(lastAt(), Date.now(), AUTO_REFRESH_MS));
    return () => window.clearTimeout(id);
  }, [visible, res.loading, res.startedAt, maybeReload, lastAt]);

  useEffect(() => {
    const onVisibility = () => {
      const v = pageVisible();
      setVisible(v);
      if (v) maybeReload();
    };
    const onFocus = () => maybeReload();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [maybeReload]);

  return maybeReload;
}
