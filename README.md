# min-tid

A lightweight, mobile-first punch clock for time tracking. Built for employees to stamp in and out, review their hours, and share a formatted time report.

The entire UI is in Swedish.

## Features

- **Punch in / out** — one large button to start and stop a session, with a live running timer
- **Automatic lunch deduction** — 45 minutes are deducted from the day's net time whenever total raw time exceeds 5 hours
- **Manual time entry** — add or edit sessions by date, start time, and end time, with a live net-time preview
- **History view** — sessions grouped by date, newest first; each day shows net hours and individual passes
- **Share report** — generates a plain-text time report (last 14 days) for copying or sharing via the native OS share sheet
- **Short-session guard** — sessions under 1 minute trigger a warning and can be discarded instead of saved
- **Persisted locally** — all data lives in `localStorage` under key `punchclock_v2`; no server, no account required
- **PWA-ready** — `apple-mobile-web-app-capable` and theme-color meta tags configured for installation on iOS

## Tech stack

| Layer | Choice |
|---|---|
| Framework | [React 19](https://react.dev) |
| Routing / SSR | [TanStack Router](https://tanstack.com/router) + [TanStack Start](https://tanstack.com/start) |
| Build | [Vite 7](https://vitejs.dev) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) + custom design tokens |
| UI primitives | [Radix UI](https://www.radix-ui.com) (shadcn/ui scaffold) |
| Deployment | [Cloudflare Workers](https://workers.cloudflare.com) via Wrangler |
| Language | TypeScript |

## Getting started

```bash
# Install dependencies
npm install

# Start the dev server
npm run dev
```

Then open `http://localhost:5173`.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Production build |
| `npm run preview` | Preview the production build locally |
| `npm start` | Start the Node.js server (`serve.js`) |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |

## Deployment

The app targets Cloudflare Workers. Deploy with:

```bash
npx wrangler deploy
```

The worker name and compatibility date are configured in [`wrangler.jsonc`](wrangler.jsonc).

## Project structure

```
src/
  components/
    PunchClock.tsx   # Entire app — clock, history, share views and all sub-components
  routes/
    __root.tsx       # Root layout
    index.tsx        # / route — mounts PunchClock, sets page meta
  styles.css         # Tailwind v4 config
  router.tsx         # TanStack Router setup
  lib/utils.ts       # cn() helper
```

## Design tokens

Custom colors are defined in [`src/styles.css`](src/styles.css) under the `pc-` namespace:

| Token | Value | Usage |
|---|---|---|
| `pc-orange` | `#ff5f00` | Primary action color |
| `pc-orange-deep` | `#fb4f00` | Hover / active states |
| `pc-ink` | `#2d1717` | Body text |
| `pc-muted` | `#9a8a82` | Secondary text |
| `pc-bg` | `#faf6f1` | Page background |
| `pc-peach` | `#fff1cd` | Informational callouts |
| `pc-apricot` | `#fdf6ee` | Stat card background |

## Business rules

- A session shorter than **1 minute** cannot be saved (short-session guard).
- If total raw time for a day exceeds **5 hours**, **45 minutes** are automatically deducted as a lunch break.
- Sessions marked as manually entered are tagged with a ✏️ indicator.
