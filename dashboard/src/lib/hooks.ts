import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "./api";

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
  reload: () => void;
}

/** Fetches on mount and on reload(). Keeps the last good data while refreshing. */
export function useResource<T>(fetcher: () => Promise<T>): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
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
  return { data, error, loading, updatedAt, reload };
}
