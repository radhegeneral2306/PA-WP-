# Dashboard PWA: Design Spec

*27 Oct 2026 · Applies to Batch 5 Phase 3+ (`dashboard/`). Every agent building UI follows this file.*

Source: owner asked to use the `design-taste-frontend` skill wherever appropriate. That skill is written for landing pages and portfolios and lists dashboards as **out of scope** (its Section 13). So we take only the parts that fit an internal mobile app: anti-default color and type choices, full UI states, accessibility, dark mode, reduced motion, icon discipline, copy rules. Its landing-page rules (hero, bento, logo walls, scroll animations) do not apply here.

---

## 1. Design read

**Reading this as:** a mobile-first internal operations app (installable PWA) for 2-3 non-technical business admins at Radhe Tiles World, used many times a day on Android phones, with a calm, trust-first, utility language, leaning toward React + Tailwind v4 + native CSS tokens, minimal motion.

**Dials** (reasoned from the brief, not the skill's landing-page baseline):

| Dial | Value | Why |
|---|---|---|
| `DESIGN_VARIANCE` | 3 | A daily tool must be predictable. Same layout every screen. |
| `MOTION_INTENSITY` | 3 | Motion only for feedback and state change (sheet open, toast, press). Nothing decorative. |
| `VISUAL_DENSITY` | 6 | Task lists need title, person, branch, due and remark at a glance, but must stay readable on a 6-inch screen. |

---

## 2. Stack

| Part | Choice | Notes |
|---|---|---|
| Build | Vite + React 18 + TypeScript | Cloudflare Pages runs `npm run build`, output `dist`, root dir `dashboard` |
| Styling | Tailwind v4 (`@tailwindcss/vite`) + CSS variables for theme tokens | One strategy: CSS variables (so dark mode is one place) |
| Icons | `@phosphor-icons/react`, weight `regular`, size 20/24 | One family only. No hand-drawn SVG icons. **No emojis in the dashboard UI** (the WhatsApp bot keeps its emojis) |
| Font | Geist Sans, self-hosted (`geist` npm package / `@font-face`, `font-display: swap`) | Not Inter. `font-variant-numeric: tabular-nums` for dates and counts |
| Motion | CSS transitions; `motion/react` only for the bottom sheet and list item exit | All of it off under `prefers-reduced-motion` |
| PWA | `vite-plugin-pwa` (manifest + Workbox service worker) | API is **network-only**, never cached (Section 8) |
| State | React state + a tiny fetch hook; no global store needed | |

---

## 3. Color

One neutral family (Zinc) + one accent (Cobalt). Status colors are semantic only, never decorative. No purple, no gradients, no glows, no pure `#000` / `#fff`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f6f6f7` | `#0f1012` | page |
| `--surface` | `#ffffff`-ish `#fdfdfd` | `#17181b` | sheets, list background |
| `--line` | `#e4e4e7` | `#2a2b30` | dividers |
| `--text` | `#18181b` | `#ececee` | primary text |
| `--muted` | `#5b5b63` | `#a1a1aa` | secondary text (AA on both) |
| `--accent` | `#2450d6` | `#7c9cff` | primary buttons, active tab, links |
| `--on-accent` | `#ffffff`-ish `#fcfcfd` | `#0f1012` | text on accent |
| `--danger` | `#c0262d` | `#ff7a7f` | overdue, Cancel action |
| `--warn` | `#a15c00` | `#f0b35a` | due today |
| `--ok` | `#1f7a3d` | `#5fd18a` | done |

Rules: status is never shown by color alone. Overdue rows say **"Overdue"** in text, and the color is extra. Every text/background pair must pass WCAG AA (4.5:1 body, 3:1 large). Theme follows `prefers-color-scheme`; a manual Light/Dark/System toggle lives in Settings.

---

## 4. Shape, spacing, type

- **Radius:** one scale. `8px` for inputs, buttons and chips, `16px` for the top of bottom sheets. No pills except filter chips (fully rounded, documented exception).
- **Spacing:** 4px grid. Screen gutter 16px. Row padding 12px vertical.
- **Tap targets:** at least 44 by 44 px. Inputs use 16px font (stops iOS zoom).
- **Type scale:** 13 (meta) / 15 (body, list) / 17 (row title, buttons) / 22 (screen title). Weight 400/500/600 only.
- **Shadows:** almost none. Only the bottom sheet and the floating "+" get a soft shadow tinted to the background.
- **Cards:** not by default. Task rows are a list separated by spacing and a hairline, not boxed cards.

---

## 5. Layout

### Phone (default, below 1024px)
- **Top bar (56px):** screen title left, search icon right.
- **Summary strip** (nice-to-have, Phase 7): three numbers, Pending / Overdue / Aaj due. Tapping one filters the list.
- **Filter chips:** horizontal scroll-snap row: Branch (Sab, Raipur, Jagdalpur, Durg, Hardware, Office, Admins), then Staff (opens a picker sheet).
- **Task list:** overdue first (sorted by due), then the rest by due. Row = title (1 line, ellipsis), second line "Person · Branch", right side due date/time, third line last remark (muted, 1 line) when present. Repeat type as a small icon (Phosphor `Repeat` / `ArrowsClockwise` / `CalendarBlank`) with an accessible label.
- **Bottom tab bar** (thumb zone, safe-area aware): **Tasks · Archive · Approvals · Settings**. Approvals shows a count badge when requests are pending.
- **Task detail:** bottom sheet (draggable, closes on swipe down / backdrop / Esc). Shows full details + remark history, then actions: **Done**, **Remark**, **Date badlo**, **Assign badlo**, and **Cancel** (danger, separated at the bottom).

### Desktop (1024px and up, secondary)
- Left rail navigation instead of bottom tabs. List on the left (max ~480px), detail panel on the right instead of a sheet. Same components, no separate design.

---

## 6. Screens and states

Every screen ships all states: loading, empty, error, success.

| Screen | Loading | Empty | Error |
|---|---|---|---|
| Login | button shows "Login ho raha hai…" and disables | n/a | inline under the form: wrong password, locked ("15 min baad try karein"), not configured |
| "Aap kaun ho?" | skeleton list | "Koi admin nahi mila" | inline retry |
| Tasks | 6 skeleton rows shaped like real rows | "Koi pending task nahi" + hint to check filters | inline banner with "Dobara try karein" |
| Archive | skeleton rows | "Abhi archive khaali hai" | same |
| Approvals | skeleton rows | "Koi approval pending nahi" | same |

- **Offline:** a slim banner "Internet nahi hai. Data purana ho sakta hai." Writes are disabled while offline (no queued writes in v1).
- **Session expired (401):** go back to Login with a short message.
- **Success feedback:** small toast at the bottom ("Done ho gaya"), 3 seconds, not for errors that need action.
- **Cancel confirmation:** modal dialog, title "Pakka cancel karna hai?", body names the task, buttons "Haan, cancel karo" (danger) and "Nahi" (default focus). No undo in v1, so the wording is explicit.
- **Pressed state:** buttons and rows `scale(0.98)` on `:active`.

---

## 7. Forms

- Label above input, helper text below, error text below in `--danger`. Never placeholder-as-label.
- Date: native `<input type="date">` (min = today). Time: native `<input type="time">`, optional; empty means 10:00 AM (say so in helper text).
- Remark: textarea, 500 characters max with a counter.
- Assign: searchable picker sheet grouped by branch, admins at the end.
- Primary button labels are 1-3 words: "Login", "Save", "Done karo", "Assign karo".

---

## 8. PWA rules

- Manifest: name "Radhe Tasks", short name "Tasks", `display: standalone`, `start_url: /`, theme and background colors from the tokens (light), icons 192, 512 and a 512 **maskable**, plus `apple-touch-icon` 180. Icon = simple monogram "RT" on the accent color (no hand-drawn illustration).
- Service worker precaches the app shell only. **`/api/*` is NetworkOnly.** Never show cached task data as if it were fresh.
- New version available → small banner "Naya version aaya hai" with a "Reload" button.
- Settings screen has "Phone pe install karein" help (Android: menu → Add to Home screen / Install app; iPhone: Share → Add to Home Screen).

---

## 9. Copy rules

- Hinglish in Roman script, short, friendly, same tone as the bot.
- **No em-dash or en-dash anywhere.** Use a period, comma, colon or hyphen.
- Middle dot at most once per line ("Hema · Durg").
- Dates in IST: "28 Oct, 4:00 PM"; year only when not the current year.
- Actor in remarks: "Done from dashboard by Bhaskar".

---

## 10. Accessibility and performance

- WCAG AA in both themes; visible focus ring (2px accent outline, offset 2px).
- All icon-only buttons have `aria-label`. Sheets and dialogs trap focus and return it.
- `prefers-reduced-motion`: sheets and toasts appear instantly.
- Viewport units: `min-h-[100dvh]`, never `h-screen`. Respect `env(safe-area-inset-*)`.
- Targets: LCP under 2.5s on a mid Android over 4G, CLS under 0.1. Lazy-load the Archive and Approvals screens.

---

## 11. Pre-flight (dashboard version)

- [ ] Design read and dials unchanged, or change recorded here
- [ ] Zero em/en-dashes in visible text
- [ ] One accent, one neutral family, semantic colors only for status
- [ ] One radius scale; filter chips are the only pills
- [ ] AA contrast checked in light and dark
- [ ] Loading, empty, error and offline states on every screen
- [ ] Overdue shown in text, not only color
- [ ] Phosphor icons only; no emoji in the UI
- [ ] `/api` never cached by the service worker
- [ ] Installable on Android and iPhone; maskable icon present
- [ ] Reduced motion respected; `100dvh` used
