# min-tid

> **Version: 1.0.0-beta.1** — Feature-complete and self-hostable. APIs and storage shape may still shift before 1.0 stable.

A lightweight, mobile-first punch clock for tracking work time, absences and expenses. Built for employees to stamp in and out, review their hours, log expenses, and share a formatted time report.

The entire UI is in Swedish. The app works fully offline — sync between devices is optional and additive.

## Features

- **Punch in / out** — one large button to start and stop a session, with a live running timer
- **Per-day schedule** — configure start time, end time, and lunch minutes per weekday; net work time = shift − lunch
- **Manual time entry** — add or edit sessions by date, start time, and end time, with a live net-time preview
- **Absence logging** — record VAB, semester, sjuk, vård, flex, friskvård, övrigt
- **Expense logging** — milersättning (with km), traktamente, resetimmar, parkering, kost, representation, övrigt; receipts can be flagged for later attachment
- **Flex balance** — automatic flex bank: actual net time vs scheduled norm, day by day; flex-leave absences deduct from the bank
- **History view** — list and calendar modes; sessions grouped by week, weekly totals compared against norm
- **CSV export** — month-by-month export for payroll / accounting
- **Share report** — generates a plain-text time + expense report for copying or sharing via the native OS share sheet; receipt reminders surfaced as an amber card
- **Multi-device sync** *(optional)* — username + secret pair via a tiny self-hostable backend. No e-mail, no personal data — bcrypt-hashed secret + JWT only
- **Short-session guard** — sessions under 1 minute trigger a warning and can be discarded instead of saved
- **PWA-ready** — `apple-mobile-web-app-capable` and theme-color meta tags configured for installation on iOS

## Tech stack

| Layer | Choice |
|---|---|
| Frontend framework | React 19 |
| Routing | TanStack Router (file-based) |
| Build | Vite 7 |
| Styling | Tailwind CSS v4 + custom `pc-*` design tokens |
| Language | TypeScript 5.8 |
| Backend *(optional sync)* | Express 4 + bcryptjs + jsonwebtoken |
| Storage | `localStorage` on client; JSON file (`data.json`) on server |
| Deployment | Single Docker image (`node:22-slim`) serving both SPA and `/api` |

## Getting started

```bash
# Frontend only
npm install
npm run dev          # Vite on :5000

# With sync backend (separate terminal)
npm run server:install   # first time only — creates server/node_modules and server/package-lock.json
npm run server:dev       # Express on :3001
```

Then open `http://localhost:5000`. Vite proxies `/api` → `http://localhost:3001` automatically.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server with HMR (port 5000) |
| `npm run server:dev` | Express server with `node --watch` (port 3001) |
| `npm run server:install` | Install server dependencies (first-time only) |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |

There are no unit tests. Run `npm run build` to surface TypeScript errors.

## Deployment

The included `Dockerfile` builds the SPA and bundles it with the Express server into a single `node:22-slim` image that serves both static assets and `/api` on port 3000.

```bash
# Local production test
docker compose up --build
# → http://localhost
```

`docker-compose.yml` uses a host bind mount `./data:/app/data` so the JSON store is directly inspectable and trivially backed up. For Coolify, the `expose: 3000` directive lets Coolify's reverse proxy route external traffic in — no host port binding required.

**Required environment variables for production:**

| Variable | Notes |
|---|---|
| `JWT_SECRET` | Long random string — must be set, do not ship the default |
| `DATA_PATH` | Defaults to `/app/data/data.json` in Docker; persist this directory |

See [CLAUDE.md](CLAUDE.md) for the full sync API spec, debugging tips, and architecture details.

## Project structure

```
src/
  components/
    PunchClock.tsx       # Main shell — clock, history, expenses, share views, all sub-components
    Onboarding.tsx       # First-run flow: welcome (new vs returning) → info → schedule → sync
    SettingsModal.tsx    # Edit name + department; sync control + version
    AbsenceModal.tsx     # Log absence entries
    ExpenseModal.tsx     # Log expense entries (with km field for milersättning)
    SyncModal.tsx        # Set up or restore sync for an existing device
  lib/
    schedule.ts          # Schedule types, net-time calculations, storage migration
    sync.ts              # Thin fetch wrapper over the sync API
  routes/
    __root.tsx           # Root layout (bare Outlet + 404)
    index.tsx            # / route — mounts PunchClock
  styles.css             # Tailwind v4 config + pc-* design tokens
  router.tsx             # TanStack Router setup
  env.d.ts               # Type declarations (__APP_VERSION__)

server/
  index.js               # Express app — auth, sync, account routes
  package.json           # Server deps (pure JS only — no native modules)
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
- Flex bank = Σ(actual net − scheduled net) for each past day with sessions, minus any flex-leave absences.
- Sync usernames are 3–20 chars (`a–z 0–9 _ -`), case-insensitive, must be unique.
- Inactive sync accounts (no login or push in **60 days**) are auto-deleted by the server.

## Versioning

This project follows semver. Beta builds use the `-beta.N` suffix. The current displayed version comes from `package.json` and is surfaced at the bottom of the settings modal.

## Licence

Private project — not yet open-sourced.
