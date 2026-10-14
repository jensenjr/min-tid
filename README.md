# min-tid

> **Version 1.0.0**

A lightweight, mobile-first time report for employees: keep your hours, absences, expenses and flex balance in one place and hand in a correct report at the end of the month. You can report **"Enligt schema"** (the schedule is your time and you only note what deviates) or **punch in and out** like a clock.

The entire UI is in Swedish. The app works fully offline: your data lives on your device, and sync between devices is optional and end-to-end encrypted.

**Try it without touching your own data:** open the app with `?demo=1` (for example `http://localhost:5000/?demo=1`). You get eight weeks of made-up data for "Anna Demo". Nothing is saved, nothing is sent to a server, and "Avsluta demo" takes you back to your own app.

## What it does

- **Idag** — in "Enligt schema" mode: _Enligt schema ✓_, _Justera dag_ (start, end, break, note, travel time) and _Frånvaro_, plus the time you can leave. In punch mode: one large button with a live timer. Both show the flex balance and **Att åtgärda** (days to confirm or fill in, receipts to attach, a forgotten check-out, "Bekräfta <månad>").
- **Kalender** — a month grid coloured by day status (registered, absent, missing, unconfirmed, locked month) and a list mode. Tap a day to see what was registered and _Så räknades dagen_, a line-by-line explanation of the calculation.
- **Rapport** — period totals, absences by type, expenses, vacation balance and travel time, and export as text, CSV and Excel.
- **Mer** — profile, schedule and reporting mode, absence rules, travel rules, vacation, sync and security, Excel import, automation and "Om appen".
- **Flex that adds up** — one calculation (`evaluateDay`) drives the flex card, the calendar and every export, so the numbers always agree.
- **Rotating schedules** — 1–8 week rotations and schedule periods ("gäller från"), so history keeps its norm when your schedule changes.
- **Confirm and lock months** — confirm a month ("Bekräfta oktober") and it is locked against edits until you unlock it; every confirm and unlock is logged.
- **Vacation balance** — "Semester: 17 av 25 dagar kvar", counted per scheduled day, with half days, planned vacation and an opening balance.
- **Travel time (Restid)** — trips with from/to times; time inside the schedule is worked time, time outside goes to payroll or to flex according to your rules.
- **Excel import and export** — import your history from a template (with preview and undo) and export a report with the same sheets.
- **Expenses** — milersättning, traktamente, parkering, kost, representation and more, with receipts flagged for later attachment.
- **Absence logging** — VAB, semester, sjuk, föräldraledighet, friskvård, flex, helgdag and more.
- **Automation** — punch with a QR code, NFC tag or WiFi automation via `?action=in|out|toggle`.
- **PWA-ready** — installable on iOS and Android; a network-first service worker keeps deploys fresh.

### Encrypted sync (optional)

Sync is a username and a secret code, no e-mail and no personal data. Everything is **encrypted on the device with AES-256 before it is sent**: the key is derived from your secret code (PBKDF2-SHA256, 600 000 iterations) and never leaves the device, so the server stores ciphertext it cannot read. You get a recovery key (shown once) in case you forget the code; SMS recovery returns the account, and the recovery key unlocks the data. The app pulls when it opens or returns to the foreground and pushes shortly after each change, and edits made offline are merged, not overwritten. Details are in [CLAUDE.md](CLAUDE.md).

## Tech stack

| Layer                     | Choice                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------- |
| Frontend framework        | React 19                                                                              |
| Routing                   | TanStack Router (file-based)                                                          |
| Build                     | Vite 7                                                                                |
| Styling                   | Tailwind CSS v4 + custom `pc-*` design tokens                                         |
| Language                  | TypeScript                                                                            |
| Tests                     | Vitest (`TZ=Europe/Stockholm`)                                                        |
| Backend _(optional sync)_ | Express 4 + bcryptjs + jsonwebtoken, pure JS, one JSON file                           |
| Crypto                    | Web Crypto (PBKDF2, HKDF, AES-GCM, AES-KW); keys in IndexedDB                         |
| Excel                     | SheetJS 0.20.3, vendored in `vendor/` and loaded on demand                            |
| Storage                   | `localStorage` on the client (`punchclock_v2`); JSON file (`data.json`) on the server |
| Deployment                | Single Docker image (`node:22-slim`) serving both the SPA and `/api`                  |

## Getting started

```bash
npm install
npm run dev              # Vite on :5000 (the app works fully without a server)

# Optional: the sync backend, in a second terminal
npm run server:install   # first time only: creates server/node_modules
npm run server:dev       # Express on :3001; Vite proxies /api there automatically

npm test                 # Vitest, including the server policy tests
```

Then open `http://localhost:5000`, or `http://localhost:5000/?demo=1` for the demo.

## Scripts

| Command                  | Description                                                  |
| ------------------------ | ------------------------------------------------------------ |
| `npm run dev`            | Vite dev server with HMR (port 5000)                         |
| `npm run server:dev`     | Express server with `node --watch` (port 3001)               |
| `npm run server:install` | Install server dependencies (first time only)                |
| `npm run build`          | Production build → `dist/` (also surfaces TypeScript errors) |
| `npm run preview`        | Preview the production build locally                         |
| `npm run lint`           | Run ESLint                                                   |
| `npm test`               | Run the Vitest suite                                         |
| `npm run format`         | Run Prettier                                                 |

A change is done when `npm ci && npm run lint && npm run build && npm test` pass.

## Deployment

The included `Dockerfile` builds the SPA and bundles it with the Express server into a single `node:22-slim` image that serves both static assets and `/api` on port 3000.

```bash
# Local production test
docker compose up --build
# → http://localhost
```

`docker-compose.yml` uses a host bind mount `./data:/app/data` so the JSON store is directly inspectable and trivially backed up. For Coolify, the `expose: 3000` directive lets Coolify's reverse proxy route external traffic in; no host port binding is required.

**Required environment variables for production:**

| Variable     | Notes                                                               |
| ------------ | ------------------------------------------------------------------- |
| `JWT_SECRET` | Long random string — must be set, do not ship the default           |
| `DATA_PATH`  | Defaults to `/app/data/data.json` in Docker; persist this directory |

See [CLAUDE.md](CLAUDE.md) for the full sync API spec, debugging tips, and architecture details.

## Project structure

```
src/
  components/
    PunchClock.tsx       # The shell: state, load/save, sync engine, sheets, bottom nav
    Onboarding.tsx       # First-run flow: welcome (new vs returning) → info → schedule → sync
    AdjustDaySheet.tsx, DaySheet.tsx, AttendCard.tsx, ConfirmSheet.tsx, ...
    ImportModal.tsx      # Excel import (lazy-loaded)
    SyncModal.tsx, SyncSecuritySheet.tsx, RecoveryKeySheet.tsx   # Sync setup and security
    schedule/            # Schedule editor (periods, rotation)
  views/                 # The four tabs: Today, Calendar, Report, More (props only)
  lib/
    days.ts, flex.ts     # evaluateDay and the flex fold: the one source of truth for hours
    schedule.ts          # Periods, rotations, effective day config, migration
    confirm.ts           # Confirm and lock months, audit log
    vacation.ts, travel.ts, report.ts, attend.ts, fill.ts
    excel/               # Import, export, template, undo
    sync.ts, crypto.ts, keyStore.ts   # Encrypted sync client
    demo.ts              # Demo seed and storage/sync gating for ?demo=1
    __tests__/           # Vitest tests
  routes/                # __root.tsx and index.tsx (mounts PunchClock)
  styles.css             # Tailwind v4 config + pc-* design tokens

server/
  index.js               # Express glue: routes, JSON store, SMS, cleanup
  core.js                # Account and sync policy (pure, tested)
  __tests__/             # Policy and protocol tests
```

## Design tokens

Custom colors defined in `src/styles.css` under the `pc-` namespace:

| Token            | Value     | Usage                  |
| ---------------- | --------- | ---------------------- |
| `pc-orange`      | `#ff5f00` | Primary action colour  |
| `pc-orange-deep` | `#fb4f00` | Hover / active states  |
| `pc-ink`         | `#2d1717` | Body text              |
| `pc-muted`       | `#9a8a82` | Secondary text         |
| `pc-bg`          | `#faf6f1` | Page background        |
| `pc-peach`       | `#fff1cd` | Informational callouts |
| `pc-apricot`     | `#fdf6ee` | Stat card background   |

## Business rules

- Day keys are local dates (`YYYY-MM-DD`); a session belongs to the local day it starts on.
- Net work time per day = shift window (end − start) minus lunch. The weekly norm is the sum across active days. Default schedule: Mon–Fri 08:00–17:00 with 60 min lunch = 8 h/day, 40 h/week.
- The schedule lunch is deducted only when a day has exactly one session longer than 5 hours; a break you register yourself always wins.
- Flex for a day = worked − (norm − excused absence). A day with nothing registered does not change the flex balance; it shows up as _saknas_ (punch) or _ej bekräftad_ (Enligt schema) until you fill it in.
- Absence only counts on scheduled days and never exceeds the day's norm.
- A confirmed month is locked: its days cannot be edited until you unlock it.
- A session shorter than **1 minute** cannot be saved.
- Sync usernames are 3–20 chars (`a–z 0–9 _ -`), case-insensitive, and unique. Sync accounts with no activity for **60 days** are deleted by the server.

## Versioning

Semver. The version in `package.json` and `server/package.json` moves in lockstep, and the running version is shown under Mer → Om appen. See [CHANGELOG.md](CHANGELOG.md).

## Licence

Private project — not yet open-sourced.
