# min-tid

A lightweight, mobile-first punch clock for time tracking. Built for employees to stamp in and out, review their hours, and share a formatted time report.

The entire UI is in Swedish.

## Features

- **Punch in / out** — one large button to start and stop a session, with a live running timer
- **Per-day schedule** — configure start time, end time, and lunch minutes per weekday; net work time = shift − lunch
- **Manual time entry** — add or edit sessions by date, start time, and end time, with a live net-time preview
- **Absence logging** — record VAB, semester, and other absence types
- **History view** — sessions grouped by week and date; weekly totals compared against your norm
- **Share report** — generates a plain-text time report for copying or sharing via the native OS share sheet
- **Short-session guard** — sessions under 1 minute trigger a warning and can be discarded instead of saved
- **Persisted locally** — all data lives in `localStorage` under key `punchclock_v2`; no server, no account required
- **PWA-ready** — `apple-mobile-web-app-capable` and theme-color meta tags configured for installation on iOS

## Tech stack

| Layer | Choice |
|---|---|
| Framework | React 19 |
| Routing | TanStack Router (file-based) |
| Build | Vite 7 |
| Styling | Tailwind CSS v4 + custom `pc-*` design tokens |
| Language | TypeScript |
| Deployment | Docker + nginx (static SPA) |

## Getting started

```bash
npm install
npm run dev
```

Then open `http://localhost:5000`.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |

## Deployment

A `Dockerfile` is included. It builds the static assets with `npm run build` and serves them with nginx on port 80.

```bash
docker build -t min-tid .
docker run -p 80:80 min-tid
```

In Coolify, point at this repo — Coolify auto-detects port 80 with no extra configuration needed.

## Project structure

```
src/
  components/
    PunchClock.tsx       # Main app — clock, history, share views and all modals
    Onboarding.tsx       # First-run flow; exports WeekScheduleEditor
    SettingsModal.tsx    # Edit name and department
    AbsenceModal.tsx     # Log absence entries
  lib/
    schedule.ts          # Schedule types, net-time calculations, localStorage migration
  routes/
    __root.tsx           # Root layout (bare Outlet + 404)
    index.tsx            # / route — mounts PunchClock
  styles.css             # Tailwind v4 config + pc-* design tokens
  router.tsx             # TanStack Router setup
```

## Design tokens

Custom colors defined in `src/styles.css` under the `pc-` namespace:

| Token | Value | Usage |
|---|---|---|
| `pc-orange` | `#ff5f00` | Primary action colour |
| `pc-orange-deep` | `#fb4f00` | Hover / active states |
| `pc-ink` | `#2d1717` | Body text |
| `pc-muted` | `#9a8a82` | Secondary text |
| `pc-bg` | `#faf6f1` | Page background |
| `pc-peach` | `#fff1cd` | Informational callouts |
| `pc-apricot` | `#fdf6ee` | Stat card background |

## Business rules

- A session shorter than **1 minute** cannot be saved (short-session guard).
- Net work time per day = shift window (end − start) minus `lunchMinutes`.
- Weekly norm = sum of net minutes across all active days.
- Default schedule: Mon–Fri 08:00–17:00 with 60 min lunch = 8 h/day, 40 h/week.
