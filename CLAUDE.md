# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server on port 5000 (host 0.0.0.0)
npm run build      # Production build → dist/
npm run lint       # ESLint
npm run format     # Prettier
```

There are no tests. To verify a change works, run `npm run build` — Vite will surface TypeScript errors at transform time.

> **Note:** `vite` is not on PATH; always invoke via `npm run` or `node_modules/.bin/vite` directly.

## Architecture

The app is a 100 % client-side SPA. There is no server, no API, no auth. All state lives in `localStorage` under the key `punchclock_v2`. The entire UI is in Swedish.

### Routing

TanStack Router with file-based routes. There is one real route:

- `src/routes/index.tsx` → mounts `<PunchClock />`
- `src/routes/__root.tsx` → bare `<Outlet />` + 404 component
- `src/router.tsx` → `getRouter()` factory; `routeTree.gen.ts` is auto-generated on build

### State management

`PunchClock.tsx` owns all runtime state (sessions, absences, name, schedule, view). It loads from `localStorage` on mount and saves on every state change via a `useEffect`. There is no external state library.

```
localStorage["punchclock_v2"] = {
  name, department, schedule, onboardingDone, sessions, absences
}
```

### Schedule data model (`src/lib/schedule.ts`)

Everything time-related flows through this file. Key types and functions:

```ts
DayConfig = { active, startTime, endTime, lunchMinutes }
shiftMinutes(cfg)   // gross: endTime − startTime
netDayMin(cfg)      // net: shiftMinutes − lunchMinutes (0 if inactive)
weeklyNetMin(schedule) // sum of netDayMin across all 7 days
```

`DEFAULT_SCHEDULE` = Mon–Fri 08:00–17:00 with 60 min lunch (8 h net, 40 h/week).

`migrateSchedule()` handles three historical storage formats — always pass raw localStorage data through it when loading.

### Components

| File | Responsibility |
|---|---|
| `PunchClock.tsx` | Main app shell — clock, history, share views; all inline sub-components (`SessionModal`, `ScheduleEditorModal`, `ShortSessionWarning`, etc.) |
| `Onboarding.tsx` | 3-step first-run flow (name → choice → schedule). Also exports `WeekScheduleEditor` — the shared schedule editing widget used by both onboarding and the "Planera dagar" modal |
| `SettingsModal.tsx` | Bottom sheet for editing name + department only (no schedule) |
| `AbsenceModal.tsx` | Bottom sheet for logging absence entries (VAB, semester, etc.) |
| `src/lib/schedule.ts` | Pure schedule types, constants, calculations, and localStorage migration |

### Modal pattern

All modals are bottom sheets. They use `if (!open) return null` — the component instance stays mounted, so **state does not auto-reset on close**. Any modal that re-opens with fresh prop values must sync them via:

```ts
useEffect(() => {
  if (open) { setState(prop); }
}, [open]); // eslint-disable-line react-hooks/exhaustive-deps
```

`SettingsModal` and `ScheduleEditorModal` already follow this pattern.

### Styling

Tailwind CSS v4 with custom `pc-*` design tokens defined in `src/styles.css`. Key tokens: `pc-orange` (#ff5f00 — primary), `pc-ink` (#2d1717 — body text), `pc-bg` (#faf6f1 — background). All components use inline styles for dynamic values and Tailwind classes for layout/spacing.

## Deployment

Docker → nginx static server on port 80. The `Dockerfile` runs `npm ci && npm run build` then serves `dist/` with `nginx.conf`. No SSR, no Node runtime in production.
