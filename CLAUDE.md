# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
  sessions, absences, expenses, flexBaseMinutes
}
localStorage["sync_token"] = "<JWT>"   // set only when sync is configured
```

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

### Components

| File | Responsibility |
|---|---|
| `PunchClock.tsx` | Main app shell — clock, history, expenses, share views; all inline sub-components |
| `Onboarding.tsx` | 4-step first-run flow (name → schedule choice → schedule editor → sync). Exports `WeekScheduleEditor` used by both onboarding and the "Planera dagar" modal |
| `SettingsModal.tsx` | Bottom sheet for editing name + department only |
| `AbsenceModal.tsx` | Bottom sheet for logging absence entries (VAB, semester, etc.) |
| `ExpenseModal.tsx` | Bottom sheet for logging expense entries (milersättning, kost, etc.) |
| `SyncModal.tsx` | Bottom sheet for setting up sync on an existing device (create code or restore) |
| `src/lib/schedule.ts` | Pure schedule types, constants, calculations, and localStorage migration |
| `src/lib/sync.ts` | Thin fetch wrapper for all sync API calls |

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

A minimal Express + Node.js server. No database — state is stored in a single JSON file (`data.json`). No personal identifiers — only a bcrypt-hashed secret and a generated UUID per user.

**Zero native dependencies.** All packages are pure JavaScript (`express`, `bcryptjs`, `jsonwebtoken`). This is intentional: native C++ modules (like `better-sqlite3`) fail to compile in Nixpacks/Alpine environments.

### Files

| File | Purpose |
|---|---|
| `server/index.js` | Express app — all routes + JSON store logic |
| `server/package.json` | Server dependencies |
| `server/package-lock.json` | **Must be committed.** Required for `npm ci` in Docker/Nixpacks. If missing, builds fail with `EUSAGE`. Regenerate with `npm run server:install`. |
| `server/data.json` | Runtime data file — gitignored, created automatically on first write |

### Data model

```
data.json = {
  users: {
    "<lookupKey>": {
      id: "<uuid>",
      secretHash: "<bcrypt>",
      state: <StorageShape without onboardingDone> | null,
      createdAt: <ms>,
      updatedAt: <ms>
    }
  }
}
```

`lookupKey` = `HMAC-SHA256("min-tid-lookup", secret).slice(0, 32)` — allows login with only the secret (no username), with timing-safe lookup.

### API endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | none | Hash secret, create user, return JWT |
| POST | `/api/auth/login` | none | Verify secret, return JWT + stored state |
| GET | `/api/sync` | Bearer JWT | Return current stored state |
| PUT | `/api/sync` | Bearer JWT | Replace stored state |
| DELETE | `/api/account` | Bearer JWT | Delete user record |

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
4. `syncStatus` state (`"idle" | "syncing" | "ok" | "error"`) drives the sync status card in the clock view.
5. On restore (login): replaces all state variables from the server response, stores token.

**Key invariant:** `onboardingDone` is never synced — it is always set to `true` on the local device after any onboarding path completes.

### Debugging 405 errors

A 405 from `Allow: GET, HEAD` always means a static file server (Caddy or nginx) is handling the request instead of Express. Common causes:

1. **Build failed, old container still running.** Check deployment logs for errors. Most common failure: `npm ci` in `server/` fails with `EUSAGE` because `server/package-lock.json` is missing. Fix: run `npm run server:install` locally, commit `server/package-lock.json`, redeploy.
2. **Coolify switched back to Nixpacks.** Verify the build pack is set to "Dockerfile" in Coolify → app settings. The `nixpacks.toml` in the repo should prevent Caddy if Nixpacks is used, but Dockerfile mode is preferred.
3. **`NODE_ENV` not set to `production`.** Without it, Express does not serve static files and the SPA catch-all is not registered — but this would cause 404, not 405.

---

## Deployment

### Production (Coolify / Docker)

The `Dockerfile` builds the frontend and packages the Express server into a single `node:22-slim` image. The Express server serves both the static `dist/` files and the `/api` routes on port `3000`.

```bash
# Via docker-compose (local production test)
docker compose up --build

# In Coolify
# Build pack: Dockerfile
# Persistent volume: /app/data  (prevents data loss on redeploy)
# Environment variable: JWT_SECRET=<long random string>
```

### Development

```bash
# Terminal 1
npm run dev            # Vite on :5000, proxies /api → localhost:3001

# Terminal 2 (first time: npm run server:install)
npm run server:dev     # Express on :3001
```

The Vite proxy (`server.proxy` in `vite.config.ts`) forwards all `/api` requests to the backend automatically — no CORS configuration needed.
