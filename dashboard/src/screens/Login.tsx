import { useState, type FormEvent } from "react";
import { Eye, EyeSlash, SpinnerGap } from "@phosphor-icons/react";
import { api, errorText } from "../lib/api";
import { useOnline } from "../lib/hooks";
import { Field, OfflineBanner, PrimaryButton, inputClass } from "../components/ui";
import type { LoginResponse } from "../lib/types";

export function Login({ notice, onLoggedIn }: { notice: string | null; onLoggedIn: (r: LoginResponse) => void }) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = useOnline();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user.trim() || !password) {
      setError("ID aur password dono bharein.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.login(user.trim(), password);
      onLoggedIn(r);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {!online ? <OfflineBanner /> : null}
      <main className="pt-safe pb-safe px-safe mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
        <div className="mb-8">
          <img src="/icon-192.png" alt="" width={56} height={56} className="mb-5 rounded-xl" />
          <h1 className="text-screen font-semibold">Radhe Tasks</h1>
          <p className="mt-1 text-body text-muted">Apne admin ID aur password se login karein.</p>
        </div>

        {notice ? (
          <p role="status" className="mb-4 rounded-lg bg-warn-soft px-3 py-2.5 text-body">
            {notice}
          </p>
        ) : null}

        <form onSubmit={submit} noValidate className="space-y-4">
          <Field id="login-user" label="Admin ID">
            <input
              id="login-user"
              className={inputClass}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={user}
              onChange={(e) => setUser(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
          </Field>
          <Field id="login-password" label="Password">
            <div className="relative">
              <input
                id="login-password"
                className={`${inputClass} pr-12`}
                type={show ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "login-error" : undefined}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Password chhupayein" : "Password dikhayein"}
                aria-pressed={show}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-muted"
              >
                {show ? <EyeSlash size={22} /> : <Eye size={22} />}
              </button>
            </div>
          </Field>

          {error ? (
            <p id="login-error" role="alert" className="text-body text-danger">
              {error}
            </p>
          ) : null}

          <PrimaryButton type="submit" disabled={busy}>
            {busy ? (
              <>
                <SpinnerGap size={20} className="animate-spin" aria-hidden="true" />
                Login ho raha hai…
              </>
            ) : (
              "Login karein"
            )}
          </PrimaryButton>
        </form>
      </main>
    </div>
  );
}
