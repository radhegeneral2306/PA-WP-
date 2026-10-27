import { useRegisterSW } from "virtual:pwa-register/react";

/** Service worker uses registerType "prompt": we ask before switching to a new version. */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Check for a new version every hour while the app stays open.
      if (reg) window.setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000);
    },
  });

  if (!needRefresh) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 bg-accent px-4 py-2 text-body text-on-accent">
      <span>Naya version aaya hai</span>
      <div className="flex gap-1">
        <button type="button" onClick={() => setNeedRefresh(false)} className="min-h-11 rounded-lg px-3 font-medium">
          Baad mein
        </button>
        <button type="button" onClick={() => void updateServiceWorker(true)} className="min-h-11 rounded-lg bg-on-accent px-3 font-semibold text-accent">
          Reload
        </button>
      </div>
    </div>
  );
}
