# Changelog

All notable changes to **min-tid** are recorded here. Format loosely follows [Keep a Changelog](https://keepachangelog.com); the project follows semver with `-beta.N` suffixes during pre-1.0.

## [Unreleased]

### Added
- **Per-day "Avvikelse" button** in the calendar day card and per-day rows of the history list — alongside the existing "Tid" button, so you can register absence on any day directly from history. AbsenceModal now accepts `initialDate` and `schedule` props.
- **Percentage presets** (100% / 75% / 50% / 25%) in `AbsenceModal` when "Ange timmar" is active. Each preset fills the manual-hours field with that fraction of the start day's scheduled net hours (or 8 h fallback). Snapped to 0.5 h. Numeric input still editable.
- **`amount` is now optional on `ExpenseEntry`** — milersättning entries can be saved with only km, no SEK amount required. The label gets a "(valfri — räcker med km)" hint when the milersättning category is selected.

### Changed
- **Expense displays** (list, share text, receipt reminder, month total) handle missing amounts gracefully — km and amount are shown only if present, joined by " · ", with the total summing `e.amount ?? 0`.
- The single "Lägg till tid" action button per day in history split into two compact buttons ("+ Tid" / "+ Avvikelse").

### Added
- **Flex section on home view** — replaces the small flex line in the today card. Shows total flex, "Den här månaden", "Den här veckan", and opens a bottom sheet with the last 12 weeks broken down individually.
- **`trackingStartDate`** in root state — flex accrues from this day forward. Set automatically on first punch; existing users get it backfilled from their earliest session so historic flex stays consistent.
- **Leave-time predictor** — when an active session is running on an active workday, the clock view shows "Du kan gå hem kl. HH:MM" (or "Mål uppnått — du kan gå hem" once today's net target is reached). Sessions are treated as pure work time — lunch is not auto-added.
- **Late punch-out modal** — punching out after a 4+ hour session opens a bottom sheet offering "Stämpla ut nu", a custom end-time picker (defaults to start + today's net target), or cancel. Saving with end ≤ start or end > now is disabled with inline validation.
- New components: `FlexBreakdownModal.tsx`, `LatePunchoutModal.tsx`.

### Changed
- **`computeFlexMinutes`** rewritten for day-by-day accrual from `trackingStartDate`. Every scheduled workday strictly **before today** contributes `actual − scheduled net`; non-flex absences (VAB, semester, etc.) reduce that day's norm but don't drain the bank; flex-leave absences still deduct from the bank.
- **Today rolls in when you punch out — not the next morning.** New `computeTodayContribution` adds today's `actual − target` to the total flex (and the week/month sub-stats + the current-week row in the breakdown) the moment the day is "settled" (no active session AND at least one completed session today). During an active session today contributes 0 — no red −8 h in the morning.
- **New "Idag" sub-stat in the flex section** — live `worked today − today's target`. Green if ≥ 0, red if < 0. Shows you in real time how today is going against the target, independent of whether the contribution has rolled into total yet. Flex section is now a 3-column grid: Idag · Veckan · Månaden.
- **Active sessions still never count toward total flex.** Only completed sessions feed the bank; the "Idag" sub-stat is the in-progress signal.
- Sync `SyncState` includes `trackingStartDate`; it round-trips with login/restore and the debounced push.

### Skipped (intentionally)
- Push notifications for long sessions — reliable background firing on iOS PWAs requires Service Worker + Web Push + backend infra. The late punch-out modal is the durable safety net instead.

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
