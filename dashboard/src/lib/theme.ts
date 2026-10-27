import { getItem, removeItem, setItem } from "./storage";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "rt.theme";

export function getTheme(): ThemeChoice {
  const t = getItem(KEY);
  return t === "light" || t === "dark" ? t : "system";
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") {
    root.removeAttribute("data-theme");
    removeItem(KEY);
  } else {
    root.setAttribute("data-theme", choice);
    setItem(KEY, choice);
  }
  syncThemeColor();
}

/** Keep the browser bar color in step with the page background. */
export function syncThemeColor(): void {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute("content", bg);
}
