import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { SpinnerGap } from "@phosphor-icons/react";
import { api, errorText, setAuthHandlers } from "./lib/api";
import { approvalCount } from "./lib/filters";
import { useIsDesktop, useOnline, useResource } from "./lib/hooks";
import { clearToken, getItem, getToken, setItem, setToken } from "./lib/storage";
import { syncThemeColor } from "./lib/theme";
import { Login } from "./screens/Login";
import { NamePicker } from "./screens/NamePicker";
import { Tasks } from "./screens/Tasks";
import { BottomTabs, SideRail, type Tab } from "./components/Nav";
import { ErrorBanner, OfflineBanner, SkeletonRows } from "./components/ui";
import { UpdateBanner } from "./components/UpdateBanner";

const Archive = lazy(() => import("./screens/Archive"));
const Approvals = lazy(() => import("./screens/Approvals"));
const Settings = lazy(() => import("./screens/Settings"));

type AuthState =
  | { kind: "checking" }
  | { kind: "checkFailed"; error: string }
  | { kind: "login"; notice: string | null }
  | { kind: "pick"; admins: string[] | null; error: string | null; current: string | null; canGoBack: boolean }
  | { kind: "app"; name: string };

export default function App() {
  return (
    <>
      <UpdateBanner />
      <AuthGate />
    </>
  );
}

function AuthGate() {
  const [auth, setAuth] = useState<AuthState>(() => (getToken() ? { kind: "checking" } : { kind: "login", notice: null }));
  const [name, setName] = useState<string | null>(null);

  const loadPicker = useCallback((current: string | null, canGoBack: boolean) => {
    setAuth({ kind: "pick", admins: null, error: null, current, canGoBack });
    api
      .me()
      .then((me) => setAuth((s) => (s.kind === "pick" ? { ...s, admins: me.admins } : s)))
      .catch((e) => setAuth((s) => (s.kind === "pick" ? { ...s, error: errorText(e) } : s)));
  }, []);

  const checkSession = useCallback(() => {
    setAuth({ kind: "checking" });
    api
      .me()
      .then((me) => {
        if (me.name) {
          setName(me.name);
          setAuth({ kind: "app", name: me.name });
        } else {
          setAuth({ kind: "pick", admins: me.admins, error: null, current: null, canGoBack: false });
        }
      })
      .catch((e) => {
        // 401 is handled by the api client (it moves us to Login).
        if ((e as { status?: number }).status === 401) return;
        setAuth({ kind: "checkFailed", error: errorText(e) });
      });
  }, []);

  useEffect(() => {
    setAuthHandlers({
      onUnauthorized: (msg) => setAuth({ kind: "login", notice: msg }),
      onNeedName: () => loadPicker(null, false),
    });
    syncThemeColor();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", syncThemeColor);
    if (getToken()) checkSession();
    return () => mq.removeEventListener("change", syncThemeColor);
  }, [checkSession, loadPicker]);

  switch (auth.kind) {
    case "checking":
      return (
        <div className="flex min-h-[100dvh] items-center justify-center" aria-busy="true">
          <SpinnerGap size={28} className="animate-spin text-muted" aria-label="Load ho raha hai" />
        </div>
      );
    case "checkFailed":
      return (
        <div className="flex min-h-[100dvh] flex-col">
          <ConnectionBanners />
          <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
            <ErrorBanner message={auth.error} onRetry={checkSession} />
          </div>
        </div>
      );
    case "login":
      return (
        <Login
          notice={auth.notice}
          onLoggedIn={(r) => {
            setToken(r.token);
            setAuth({ kind: "pick", admins: r.admins, error: null, current: null, canGoBack: false });
          }}
        />
      );
    case "pick":
      return (
        <NamePicker
          admins={auth.admins}
          loadError={auth.error}
          onRetryLoad={() => loadPicker(auth.current, auth.canGoBack)}
          current={auth.current}
          onBack={auth.canGoBack && name ? () => setAuth({ kind: "app", name }) : undefined}
          onPicked={(token, picked) => {
            setToken(token);
            setName(picked);
            setAuth({ kind: "app", name: picked });
          }}
        />
      );
    case "app":
      return (
        <Shell
          name={auth.name}
          onChangeName={() => loadPicker(auth.name, true)}
          onLogout={() => {
            clearToken();
            setName(null);
            setAuth({ kind: "login", notice: null });
          }}
        />
      );
  }
}

function ConnectionBanners() {
  const online = useOnline();
  return !online ? <OfflineBanner /> : null;
}

const TAB_KEY = "rt.tab";
function initialTab(): Tab {
  const t = getItem(TAB_KEY);
  return t === "archive" || t === "approvals" || t === "settings" ? t : "tasks";
}

function Shell({ name, onChangeName, onLogout }: { name: string; onChangeName: () => void; onLogout: () => void }) {
  const isDesktop = useIsDesktop();
  const [tab, setTab] = useState<Tab>(initialTab);
  const pending = useResource(() => api.tasks("pending"));
  const users = useResource(() => api.users());
  const approvals = approvalCount(pending.data?.tasks ?? []);

  function change(t: Tab) {
    setTab(t);
    setItem(TAB_KEY, t);
    if (t === "tasks" && !pending.loading) pending.reload();
    window.scrollTo({ top: 0 });
  }

  const screen = (
    <Suspense fallback={<SkeletonRows count={6} />}>
      {tab === "tasks" ? <Tasks pending={pending} users={users} /> : null}
      {tab === "archive" ? <Archive branches={users.data?.branches ?? []} onReopened={pending.reload} /> : null}
      {tab === "approvals" ? <Approvals count={approvals} /> : null}
      {tab === "settings" ? <Settings name={name} onChangeName={onChangeName} onLogout={onLogout} /> : null}
    </Suspense>
  );

  if (isDesktop) {
    return (
      <div className="flex min-h-[100dvh]">
        <SideRail tab={tab} onChange={change} approvals={approvals} />
        <div className="min-w-0 flex-1">
          <ConnectionBanners />
          <main>{screen}</main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-[calc(64px+env(safe-area-inset-bottom))]">
      <ConnectionBanners />
      <main>{screen}</main>
      <BottomTabs tab={tab} onChange={change} approvals={approvals} />
    </div>
  );
}
