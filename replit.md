# Tidrapport (Punch Clock)

A React-based employee time tracking app — check in/out, view session history by date, and generate shareable text reports.

## Run & Operate

- **Dev:** `npm run dev` (port 5000)
- **Build:** `npm run build`
- **Preview:** `npm run preview`

## Stack

- React 19 + TanStack Router + TanStack React Start
- Vite 7 (via `@lovable.dev/vite-tanstack-config`)
- Tailwind CSS v4 + Radix UI (Shadcn-style components)
- TypeScript 5.8
- Node.js 22

## Where things live

- `src/routes/` — TanStack file-based routes (`__root.tsx`, `index.tsx`)
- `src/components/PunchClock.tsx` — main app component
- `src/components/ui/` — Radix/Shadcn UI primitives
- `src/styles.css` — Tailwind v4 theme + CSS variables
- `src/lib/utils.ts` — `cn()` helper
- `vite.config.ts` — Vite config (extends Lovable preset)

## Architecture decisions

- Uses `@lovable.dev/vite-tanstack-config` preset which bundles TanStack Start, Tailwind, React, tsconfig paths, and Cloudflare build plugin — do NOT add those manually
- Port overridden to 5000 with `host: "0.0.0.0"` and `allowedHosts: true` for Replit proxy compatibility
- Deployed as a static site (`dist/client` output dir from TanStack Start build)
- `wrangler.jsonc` is present for Cloudflare Workers compatibility but not used in Replit dev mode

## Product

- Clock in/out with a single button
- Session history grouped by date
- Generate and share a plain-text time report

## User preferences

_Populate as you build_

## Gotchas

- `@tanstack/react-start` requires Node.js >= 22.12.0 — use `nodejs-22` module
- The Lovable vite config defaults to port 8080; the override in `vite.config.ts` forces port 5000
- Do not add duplicate plugins (tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare) — they are already included by the Lovable preset
