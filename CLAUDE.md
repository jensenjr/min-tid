# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Current version: 1.0.0-beta.1.** Exposed to the UI via `__APP_VERSION__` (set by Vite from the root `package.json`) and shown at the bottom of the settings modal. Bump versions in both `package.json` and `server/package.json` together.

## Commands

```bash
# Frontend
npm run dev          # Vite dev server on port 5000 (host 0.0.0.0)
npm run build        # Production build → dist/
npm run lint         # ESLint
npm run format       # Prettier

# Backend (run in a second terminal alongside npm run dev)
npm run server:install   # First-time only: installs server/node_modules
npm run server:dev       # node --watch server/index.js  (port 3001)
```

There are no tests. To verify a change works, run `npm run build` — Vite will surface TypeScript errors at transform time.

> **Note:** `vite` is not on PATH; always invoke via `npm run` or `node_modules/.bin/vite` directly.

## Architecture

The app is a client-side SPA with an optional lightweight sync backend.

All local state lives in `localStorage` under the key `punchclock_v2`. The entire UI is in Swedish. Sync is additive — the app works fully offline; the backend is only used to push/pull state between devices.

### Routing

TanStack Router with file-based routes. There is one real route:

- `src/routes/index.tsx` → mounts `<PunchClock />`
- `src/routes/__root.tsx` → bare `<Outlet />` + 404 component
- `src/router.tsx` → `getRouter()` factory; `routeTree.gen.ts` is auto-generated on build

### State management

`PunchClock.tsx` owns all runtime state (sessions, absences, expenses, name, schedule, view). It loads from `localStorage` on mount and saves on every state change via a `useEffect`. There is no external state library.

```
localStorage["punchclock_v2"] = {
  name, department, schedule, onboardingDone,
  sessions, absences, expenses,
  flexBaseMinutes, trackingStartDate
}
localStorage["sync_token"] = "<JWT>"   // set only when sync is configured
```

`trackingStartDate` (YYYY-MM-DD, optional) anchors flex accrual. Set automatically to today on a user's first punch-in; for migrating users it's backfilled in `load()` from the earliest session date so historic flex stays sensible. It also round-trips through sync (`SyncState.trackingStartDate`).

### Mobile layout invariant

The bottom nav is **not** `fixed bottom-0` — that breaks on mobile Safari when the URL bar appears/disappears. Instead:

- Outer wrapper: `fixed inset-0` (locks to viewport)
- Inner container: `h-full flex flex-col`
- `<header>` and `<nav>`: `shrink-0`
- `<main>`: `flex-1 min-h-0 overflow-y-auto`

This keeps the nav anchored to the visible viewport bottom while only the main area scrolls. Don't reintroduce `min-h-screen` + `fixed bottom-0`.

### Schedule data model (`src/lib/schedule.ts`)

Everything time-related flows through this file. Key types and functions:

```ts
DayConfig = { active, startTime, endTime, lunchMinutes }
shiftMinutes(cfg)      // gross: endTime − startTime
netDayMin(cfg)         // net: shiftMinutes − lunchMinutes (0 if inactive)
weeklyNetMin(schedule) // sum of netDayMin across all 7 days
```

`DEFAULT_SCHEDULE` = Mon–Fri 08:00–17:00 with 60 min lunch (8 h net, 40 h/week).

`migrateSchedule()` handles three historical storage formats — always pass raw localStorage data through it when loading.

### Flex bank

`computeFlexMinutes(sessions, absences, schedule, trackingStartDate, rangeStart?, rangeEnd?)` in `PunchClock.tsx`:

- Strict day-by-day accrual from `trackingStartDate` to today (or the provided range).
- For each day in range: `flex += actual_net − norm`, where `norm = netDayMin(cfg) − non_flex_absence_min` (clamped at 0). Flex-leave absences additionally drain the bank by their own minutes.
- **Only completed sessions count** — active sessions never shift the saldo. The live running timer stays in the "Idag" card only.
- Total displayed = `flexBaseMinutes + computeFlexMinutes(...)`; `flexBaseMinutes` is a one-time correction users can set on first sync. The month/week sub-stats and 12-week breakdown call the same function with a `rangeStart`/`rangeEnd` and intentionally exclude `flexBaseMinutes`.
- `computeWeeklyFlexBreakdown(...)` is a thin wrapper that calls the per-week computation for the last N weeks (newest first), stopping when a week ends before `trackingStartDate`.

### Components

| File | Responsibility |
|---|---|
| `PunchClock.tsx` | Main app shell — clock, history, expenses, share views; all inline sub-components |
| `Onboarding.tsx` | First-run flow with welcome → info/login → choice → schedule → sync. Exports `WeekScheduleEditor` used by both onboarding and the "Planera dagar" modal |
| `SettingsModal.tsx` | Bottom sheet for editing name + department, controlling sync (activate / disconnect), and showing app version |
| `AbsenceModal.tsx` | Bottom sheet for logging absence entries (VAB, semester, etc.) |
| `ExpenseModal.tsx` | Bottom sheet for logging expense entries (milersättning with km, kost, etc.) |
| `SyncModal.tsx` | Bottom sheet for setting up sync on an existing device (create code or restore) — collects username + secret |
| `FlexBreakdownModal.tsx` | Bottom sheet showing total flex + the last 12 weeks of flex broken down individually |
| `LatePunchoutModal.tsx` | Bottom sheet that intercepts punch-outs after a 4+ hour active session — offers "use now", a custom end-time picker, or cancel |
| `src/lib/schedule.ts` | Pure schedule types, constants, calculations, and localStorage migration |
| `src/lib/sync.ts` | Thin fetch wrapper for all sync API calls; passes `username` + `secret` |

### Onboarding flow

The onboarding component is a small state machine on `step`:

```
welcome ─┬─► info → choice → schedule → sync (create / restore / skip) → done
         └─► login (username + secret → syncLogin) → done
```

- **welcome** asks "Ny användare" vs "Återkommande användare"
- **login** is a returning-user shortcut: one screen with username + secret, calls `syncLogin`, and seeds the local state from the synced payload (name, department, schedule, sessions, absences, expenses, flexBaseMinutes) — the user never re-enters anything
- **sync** within the new-user flow has three sub-steps: choose / create / restore. "Create" requires a unique username paired with a secret.

`StepDots` shows `current={N} total={3}` only for the post-welcome screens.

### Modal pattern

All modals are bottom sheets. They use `if (!open) return null` — the component instance stays mounted, so **state does not auto-reset on close**. Any modal that re-opens with fresh prop values must sync them via:

```ts
useEffect(() => {
  if (open) { setState(prop); }
}, [open]); // eslint-disable-line react-hooks/exhaustive-deps
```

### Styling

Tailwind CSS v4 with custom `pc-*` design tokens defined in `src/styles.css`. Key tokens: `pc-orange` (#ff5f00 — primary), `pc-ink` (#2d1717 — body text), `pc-bg` (#faf6f1 — background). All components use inline styles for dynamic values and Tailwind classes for layout/spacing.

---

## Sync backend (`server/`)

### Overview

A minimal Express + Node.js server. No database — state is stored in a single JSON file (`data.json`). Users are identified by a username paired with a bcrypt-hashed secret; no e-mail or other personal identifiers are stored.

**Zero native dependencies.** All packages are pure JavaScript (`express`, `bcryptjs`, `jsonwebtoken`). This is intentional: native C++ modules (like `better-sqlite3`) fail to compile in Nixpacks/Alpine environments.

### Files

| File | Purpose |
|---|---|
| `server/index.js` | Express app — all routes, JSON store logic, and 60-day inactive-account cleanup |
| `server/package.json` | Server dependencies |
| `server/package-lock.json` | **Must be committed.** Required for `npm ci` in Docker/Nixpacks. If missing, builds fail with `EUSAGE`. Regenerate with `npm run server:install`. |
| `server/data.json` | Runtime data file — gitignored, created automatically on first write |

### Data model

```
data.json = {
  users: {
    "<username_lower>": {
      id:           "<uuid>",
      username:     "<original-case username>",
      secretHash:   "<bcrypt>",
      state:        <StorageShape without onboardingDone> | null,
      createdAt:    <ms>,
      lastActivity: <ms>
    }
  }
}
```

- The map key is the lowercased username, enforcing case-insensitive uniqueness (`carl` blocks another `carl` but `carl2` is fine).
- `lastActivity` is updated on every login and every `PUT /api/sync`.
- Usernames must match `^[a-zA-Z0-9_-]{3,20}$`. Validation lives in both server (`isValidUsername` in `server/index.js`) and client (regex in `SyncModal.tsx` + `Onboarding.tsx`).

### 60-day inactivity cleanup

`cleanupInactive()` in `server/index.js`:

- Runs on server startup and every 24 hours via `setInterval`.
- Deletes any user whose `lastActivity` is older than `60 * 24 * 60 * 60 * 1000` ms.
- Logs `Cleaned up N inactive account(s).` when it removes anything.

### API endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | none | Body: `{ username, secret }`. Hash secret, create user, return JWT. 409 if username taken. |
| POST | `/api/auth/login` | none | Body: `{ username, secret }`. Verify, update `lastActivity`, return JWT + stored state. |
| GET | `/api/sync` | Bearer JWT | Return current stored state |
| PUT | `/api/sync` | Bearer JWT | Replace stored state, update `lastActivity` |
| DELETE | `/api/account` | Bearer JWT | Delete user record |

Login errors are deliberately ambiguous ("Fel användarnamn eller synk-kod") so the existence of a username can't be probed.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` (dev) / `3000` (prod) | Port the server listens on |
| `JWT_SECRET` | `dev-secret-change-in-production` | **Must be overridden in production** |
| `DATA_PATH` | `server/data.json` | Path to the JSON data file |
| `NODE_ENV` | — | Set to `production` to enable static file serving from `dist/` |

### How sync works in `PunchClock.tsx`

1. On mount: reads `sync_token` from `localStorage`, sets `syncToken` state.
2. Save effect (`useEffect` on all state deps): after writing to `localStorage`, if `syncToken` is set, schedules a `syncPush` call via a 3-second debounce timer.
3. `syncPush` calls `PUT /api/sync` with the full state payload (excluding `onboardingDone`).
4. `syncStatus` state (`"idle" | "syncing" | "ok" | "error"`) drives the sync status card inside `SettingsModal`.
5. On restore (login): replaces all state variables from the server response, stores token.

**Key invariant:** `onboardingDone` is never synced — it is always set to `true` on the local device after any onboarding path completes.

### Debugging 405 errors

A 405 from `Allow: GET, HEAD` always means a static file server (Caddy or nginx) is handling the request instead of Express. Common causes:

1. **Build failed, old container still running.** Check deployment logs for errors. Most common failure: `npm ci` in `server/` fails with `EUSAGE` because `server/package-lock.json` is missing. Fix: run `npm run server:install` locally, commit `server/package-lock.json`, redeploy.
2. **Coolify switched back to Nixpacks.** Verify the build pack is set to "Dockerfile" in Coolify → app settings. The `nixpacks.toml` in the repo overrides Caddy if Nixpacks is used, but Dockerfile mode is preferred.
3. **`NODE_ENV` not set to `production`.** Without it, Express does not serve static files and the SPA catch-all is not registered — but this would cause 404, not 405.

---

## Deployment

### Production (Coolify / Docker)

The `Dockerfile` builds the frontend and packages the Express server into a single `node:22-slim` image. The Express server serves both the static `dist/` files and the `/api` routes on port `3000`.

```bash
# Via docker-compose (local production test)
docker compose up --build
# → http://localhost
```

`docker-compose.yml` uses:

- `expose: "3000"` (no host port binding) — Coolify's reverse proxy already owns port 80, so binding `80:3000` fails with `port is already allocated`. If you want to run outside Coolify, pass `-p 80:3000` to `docker run`.
- A bind mount `./data:/app/data` so the JSON store is on the host filesystem (gitignored via `data/`) and easy to back up.

In Coolify:

- Build pack: **Dockerfile** (preferred). If Nixpacks is selected instead, the `nixpacks.toml` in the repo overrides Caddy with `node server/index.js`.
- Persistent volume: `/app/data`
- Environment variable: `JWT_SECRET=<long random string>`

### Development

```bash
# Terminal 1
npm run dev            # Vite on :5000, proxies /api → localhost:3001

# Terminal 2 (first time: npm run server:install)
npm run server:dev     # Express on :3001
```

The Vite proxy (`server.proxy` in `vite.config.ts`) forwards all `/api` requests to the backend automatically — no CORS configuration needed.

---

## Versioning

This project follows semver with `-beta.N` suffixes during pre-1.0.

- Source of truth: root `package.json` `version` field.
- `server/package.json` must be bumped in lockstep.
- `vite.config.ts` reads `package.json` and exposes the version as the `__APP_VERSION__` global; `src/env.d.ts` declares the type.
- The version is rendered in the footer of `SettingsModal.tsx` as `min-tid v{__APP_VERSION__}`.

When making a version bump:

1. Edit `package.json` and `server/package.json`.
2. Run `npm install` once at the root if the lockfile cares about `name`/`version` drift (it doesn't usually).
3. `npm run build` to confirm Vite injects the new value.
4. Commit both files plus any `CHANGELOG.md` updates.
