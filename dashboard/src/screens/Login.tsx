import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeSlash, SpinnerGap, UserCircle } from "@phosphor-icons/react";
import { api, errorText } from "../lib/api";
import { useOnline } from "../lib/hooks";
import { getItem, setItem } from "../lib/storage";
import { Field, OfflineBanner, PrimaryButton, inputClass } from "../components/ui";
import type { LoginResponse } from "../lib/types";

const LAST_NAME_KEY = "rt.loginName";

/** Profile-picker login: tap your name, type the shared password. No ID to remember. */
export function Login({ notice, onLoggedIn }: { notice: string | null; onLoggedIn: (r: LoginResponse) => void }) {
  const [admins, setAdmins] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = useOnline();

  useEffect(() => {
    // If the names can't load, the password alone still works ("Aap kaun ho?" comes after login).
    api
      .loginNames()
      .then((r) => {
        setAdmins(r.admins);
        const last = getItem(LAST_NAME_KEY);
        setSelected(last && r.admins.includes(last) ? last : r.admins.length === 1 ? r.admins[0] : null);
      })
      .catch(() => setAdmins([]));
  }, []);

  const needsPick = admins !== null && admins.length > 0 && !selected;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (needsPick) {
      setError("Pehle apna naam chuniye.");
      return;
    }
    if (!password) {
      setError("Password daaliye.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.login(password, selected);
      if (r.name) setItem(LAST_NAME_KEY, r.name);
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
        <div className="mb-6">
          <img src="/icon-192.png" alt="" width={56} height={56} className="mb-5 rounded-xl" />
          <h1 className="text-screen font-semibold">Radhe Tasks</h1>
          <p className="mt-1 text-body text-muted">Apna naam chuno aur password daalo.</p>
        </div>

        {notice ? (
          <p role="status" className="mb-4 rounded-lg bg-warn-soft px-3 py-2.5 text-body">
            {notice}
          </p>
        ) : null}

        <form onSubmit={submit} noValidate className="space-y-4">
          {admins === null ? (
            <div className="grid grid-cols-2 gap-2" aria-busy="true" aria-label="Naam load ho rahe hain">
              <div className="skeleton h-12 rounded-lg" />
              <div className="skeleton h-12 rounded-lg" />
            </div>
          ) : admins.length > 0 ? (
            <div role="radiogroup" aria-label="Aap kaun ho?" className="grid grid-cols-2 gap-2">
              {admins.map((name) => {
                const on = selected === name;
                return (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setSelected(name);
                      setError(null);
                    }}
                    className={`press flex min-h-12 items-center gap-2 rounded-lg border px-3 text-left font-medium ${
                      on ? "border-accent bg-accent-soft text-text" : "border-line bg-surface text-text"
                    }`}
                  >
                    <UserCircle size={22} weight={on ? "fill" : "regular"} className={on ? "shrink-0 text-accent" : "shrink-0 text-muted"} aria-hidden="true" />
                    <span className="min-w-0 truncate">{name}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* Lets the phone's password manager save the password under the picked name. */}
          <input type="text" name="username" autoComplete="username" value={selected ?? ""} readOnly hidden />

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
