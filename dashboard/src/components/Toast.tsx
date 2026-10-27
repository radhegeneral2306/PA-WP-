import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type ShowToast = (message: string) => void;
const ToastContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

/** One toast at a time, bottom of the screen, 3 seconds. For success messages only. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback<ShowToast>((m) => {
    setMessage(m);
    setKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (message === null) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(timer.current);
  }, [message, key]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 lg:bottom-6">
        {message ? (
          <div key={key} className="anim-pop rounded-lg bg-text px-4 py-3 text-body font-medium text-bg shadow-[var(--shadow)]">
            {message}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
