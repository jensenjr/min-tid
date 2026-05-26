# Changelog

All notable changes to **min-tid** are recorded here. Format loosely follows [Keep a Changelog](https://keepachangelog.com); the project follows semver with `-beta.N` suffixes during pre-1.0.

## [1.0.0-beta.1] — 2026-05-26

First public beta. The app is feature-complete for time, absence and expense tracking; the optional sync backend is self-hostable; the deployment story is settled.

### Added

- **Onboarding** — welcome screen splits flow into "Ny användare" (full setup) vs "Återkommande användare" (one-screen username + secret login that pulls all state from sync).
- **Sync** — multi-device sync via a self-hostable Express backend. Users register with `username + secret`; the server stores only a bcrypt hash + JWT-issued tokens. No e-mail, no personal data.
- **Expense tracking** — new "Utlägg" tab with categories (milersättning, traktamente, resetimmar, parkering, kost, representation, övrigt). Milersättning entries include a `km` field; receipts can be flagged for later attachment. Expenses are included in the shared time report with a receipt-reminder card.
- **Flex bank** — automatic computation of flex balance from past sessions vs scheduled norm; flex-leave absences deduct from the bank. `flexBaseMinutes` lets users set a one-time correction on first sync.
- **CSV export** — month-by-month export including absences and notes, BOM-prefixed for Excel UTF-8 detection.
- **History calendar view** — toggleable list/calendar mode on the History page.
- **Server cleanup** — sync accounts inactive for 60+ days are auto-deleted on server startup and every 24 h.
- **App version display** — `__APP_VERSION__` from `package.json` is rendered at the bottom of the settings modal.

### Changed

- **Mobile layout** — bottom nav is no longer `fixed bottom-0`; the outer container is `fixed inset-0` with `<main>` scrolling internally. This stops the nav from drifting when mobile Safari shows/hides the URL bar.
- **Sync UI location** — moved from the clock view to the settings (gear) modal.
- **Sync identity** — registration now requires a unique username (3–20 chars, `a–z 0–9 _ -`, case-insensitive) paired with the secret. The earlier secret-only `HMAC` lookup is gone.
- **Settings modal** — also surfaces sync state (active / activate / disconnect) and the running app version.
- **Storage shape** — `expenses: ExpenseEntry[]` added to `punchclock_v2`; `ExpenseEntry` gained an optional `km?: number` field for milersättning.
- **24-hour time format** throughout the UI.
- **Fork-plate-knife icon** for kost/lunch instead of the coffee cup.

### Fixed

- Flex balance no longer excludes today's entries.
- Lunch deduction during ongoing sessions used the wrong base — fixed.
- `AbsenceModal` state reset on re-open.
- Settings modal stale-state bug (`useEffect([open])` sync from props).
- Duplicate schedule editor when reopening "Planera dagar".
- "Friskvard" typo → "Friskvård".

### Infrastructure

- **Dockerfile** uses `node:22-slim` (Debian) — Alpine was abandoned because `npm ci` was fragile around native modules; the server is now pure JS so this is no longer load-bearing, but the slimmer image is still useful.
- **`docker-compose.yml`** uses `expose: 3000` (no host port binding) so Coolify's reverse proxy can route to it. A host bind mount `./data:/app/data` keeps `data.json` directly inspectable on the host. `data/` is gitignored.
- **`server/package-lock.json`** is now committed — without it `npm ci` in Docker/Nixpacks fails with `EUSAGE`.
- **`nixpacks.toml`** overrides the default Caddy start command if Coolify falls back to Nixpacks instead of Dockerfile.
- **Zero native deps** on the server — `better-sqlite3` was replaced with a plain JSON file store.

[1.0.0-beta.1]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.1
