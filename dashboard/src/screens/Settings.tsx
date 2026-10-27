import { useState } from "react";
import { DeviceMobile, SignOut, UserCircle, AndroidLogo, AppleLogo } from "@phosphor-icons/react";
import { applyTheme, getTheme, type ThemeChoice } from "../lib/theme";
import { TopBar } from "../components/ui";

interface Props {
  name: string | null;
  onChangeName: () => void;
  onLogout: () => void;
}

const THEMES: { key: ThemeChoice; label: string }[] = [
  { key: "system", label: "System" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="px-safe pb-2 text-meta font-semibold tracking-wide text-muted uppercase">{title}</h2>
      <div className="mx-4 rounded-lg border border-line bg-surface">{children}</div>
    </section>
  );
}

export default function Settings({ name, onChangeName, onLogout }: Props) {
  const [theme, setTheme] = useState<ThemeChoice>(getTheme);

  function choose(t: ThemeChoice) {
    setTheme(t);
    applyTheme(t);
  }

  return (
    <div className="pb-8 lg:max-w-[560px]">
      <TopBar title="Settings" />

      <Section title="Aap">
        <div className="flex items-center gap-3 p-4">
          <UserCircle size={32} className="shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-title font-medium">{name ?? "Naam nahi chuna"}</p>
            <p className="text-meta text-muted">Dashboard ke kaam is naam se dikhenge</p>
          </div>
        </div>
        <div className="border-t border-line p-3">
          <button type="button" onClick={onChangeName} className="press min-h-11 w-full rounded-lg border border-line px-4 font-medium text-accent">
            Naam badlein
          </button>
        </div>
      </Section>

      <Section title="Theme">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2 p-3">
          {THEMES.map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={theme === t.key}
              onClick={() => choose(t.key)}
              className={`press min-h-11 rounded-lg border font-medium ${theme === t.key ? "border-accent bg-accent text-on-accent" : "border-line text-text"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Phone pe install karein">
        <div className="space-y-4 p-4 text-body">
          <div className="flex gap-3">
            <AndroidLogo size={24} className="shrink-0 text-muted" aria-hidden="true" />
            <div>
              <p className="font-medium">Android (Chrome)</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
                <li>Upar right mein teen dot wala menu kholein.</li>
                <li>"Install app" ya "Add to Home screen" dabayein.</li>
                <li>"Install" dabayein. Home screen pe "Tasks" icon aa jayega.</li>
              </ol>
            </div>
          </div>
          <div className="flex gap-3">
            <AppleLogo size={24} className="shrink-0 text-muted" aria-hidden="true" />
            <div>
              <p className="font-medium">iPhone (Safari)</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
                <li>Ye page Safari mein kholein.</li>
                <li>Neeche Share button (dabba aur upar teer) dabayein.</li>
                <li>"Add to Home Screen" chunein, phir "Add" dabayein.</li>
              </ol>
            </div>
          </div>
          <p className="flex items-center gap-2 text-meta text-muted">
            <DeviceMobile size={16} aria-hidden="true" />
            Install ke baad app full screen mein khulega.
          </p>
        </div>
      </Section>

      <div className="mx-4 mt-6">
        <button type="button" onClick={onLogout} className="press flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-danger/50 font-medium text-danger">
          <SignOut size={20} aria-hidden="true" />
          Logout
        </button>
        <p className="mt-3 text-center text-meta text-muted">Radhe Tasks v{__APP_VERSION__}</p>
      </div>
    </div>
  );
}
