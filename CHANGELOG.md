# Changelog

All notable changes to **min-tid** are recorded here. Format loosely follows [Keep a Changelog](https://keepachangelog.com).

**Versioning policy:**
- Pre-1.0 we use `1.0.0-beta.N`. Each batch of changes that ships → bump `-beta.N` (no patch suffix inside a beta).
- After 1.0.0 stable: standard semver — `1.0.1` for bug fixes, `1.1.0` for new features, `2.0.0` for breaking changes.
- The version in `package.json` and `server/package.json` must move in lockstep. The running version is shown at the bottom of the settings modal.
- Add a section here for every bump. Never let it slip — traceability over polish.

## [Unreleased]

_Nothing yet._

## [1.0.0-beta.5] — 2026-05-29

### Added
- **Multi-day percentage entry in "Lägg till tid".** The add-time sheet now has an "En dag / Flera dagar" toggle (single-day stays the default). In "Flera dagar" mode a **Från/Till** range picker appears plus **100 % / 75 % / 50 % / 25 %** presets — the same percentage idea already in "Avvikelse". Saving creates one session per scheduled day in the range, each worth that percentage of *that day's* scheduled net.
  - Covers the two real cases: VAB 50 % shared with a partner while still working 50 % (→ log 50 % of the workday), and "forgot to punch a whole week, nothing changed" (→ 100 % for every day that week).
  - **Inactive/weekend days are skipped** (no schedule = nothing added), and **days that already have a session are skipped** so re-running can't double-count. A live preview shows how many days will be filled, the total time, and how many were skipped (lediga / redan registrerade).
  - Each generated session respects the lunch convention: raw length = `pct% of net + lunchMinutes`, so the resulting net matches the chosen percentage. A 100 % day reproduces the exact scheduled shift.
  - Range capped at ~4 months as a fat-finger guard.

### Internal
- `SessionModal` gained `existingSessions` and `onSaveMany` props. New module-level `ymdLocal()` helper formats local `YYYY-MM-DD` to avoid the UTC date-shift `toISOString` can cause near midnight (also now used for the edit-session initial date).

## [1.0.0-beta.4] — 2026-05-27

### Added
- **Lunch convention surfaced in the UI.** The schedule editor (both onboarding and "Planera dagar") now opens with a small info card: 🍽️ Lunch räknas av automatiskt — stämpla inte ut för lunch, minuterna nedan dras från din punchade tid. Removes a hidden assumption that bit users by tying lunch deduction to a number they couldn't see acting.
- **Lunch reminder under the leave-time predictor.** When today's schedule has `lunchMinutes > 0` and a session is active, a faint line below "Du kan gå hem kl. HH:MM" reads `🍽️ Inkl. NN min lunch (räknas av automatiskt)` so users see exactly why the predicted leave time is later than `start + target`.

## [1.0.0-beta.3] — 2026-05-27

### Fixed
- **Leave-time predictor was telling users to leave too early.** The line assumed sessions were pure work (lunch punched out), but the flex calc auto-deducts `lunchMinutes` from raw punched time. So a user with an 8 h target + 1 h lunch who punched in continuously was told to leave at 8 h raw — and got penalised −1 h flex when net came out to 7 h. The predictor now uses `target + lunch` raw minutes (matching `computeDayMinutes.net`) so the predicted leave-time, the "Mål uppnått" banner, and the flex contribution all agree.
- **Late punch-out modal was firing on normal workdays.** The 4 h threshold triggered the "långt pass — välj sluttid" sheet at 8 h 09 min on a regular 8 h day. Threshold is now schedule-aware: `max(10 h, scheduled shift duration + 4 h)`. A standard 8-17 shift won't trigger it until ~13 h punched in; a 6 h shift not until 10 h. Real forgotten-punch-out cases (overnight, 12+ h) still fire.
- The "Sätt annan sluttid" picker in `LatePunchoutModal` defaults to `sessionStart + (target + lunch)` to match the predictor, so confirming the default credits a full day's net.

### Internal
- `shiftMinutes` is now imported from `schedule.ts`. `LONG_SESSION_THRESHOLD_MS` constant replaced by the `lateThresholdMs(todayCfg)` helper.

## [1.0.0-beta.2] — 2026-05-27

### Added
- **Per-day "Avvikelse" button** in the calendar day card and per-day rows of the history list — alongside the existing "Tid" button, so you can register absence on any day directly from history. `AbsenceModal` now accepts `initialDate` and `schedule` props.
- **Percentage presets** (100% / 75% / 50% / 25%) in `AbsenceModal` when "Ange timmar" is active. Each preset fills the manual-hours field with that fraction of the start day's scheduled net hours (or 8 h fallback). Snapped to 0.5 h. Numeric input still editable.
- **Optional `amount` on `ExpenseEntry`** — milersättning entries can be saved with only km, no SEK amount required. The label gets a "(valfri — räcker med km)" hint when milersättning is selected.
- **Flex section on home view** — replaces the small flex line in the today card. Shows total flex plus an "Idag · Veckan · Månaden" 3-stat row and opens a bottom sheet with the last 12 weeks broken down individually.
- **`trackingStartDate`** in root state — flex accrues from this day forward. Set automatically on first punch; existing users get it backfilled from their earliest session so historic flex stays consistent.
- **Leave-time predictor** — when an active session is running on an active workday, the clock view shows "Du kan gå hem kl. HH:MM" (or "Mål uppnått — du kan gå hem" once today's net target is reached). Sessions are treated as pure work time — lunch is not auto-added.
- **Late punch-out modal** — punching out after a 4+ hour session opens a bottom sheet offering "Stämpla ut nu", a custom end-time picker (defaults to start + today's net target), or cancel. Saving with end ≤ start or end > now is disabled with inline validation.
- New components: `FlexBreakdownModal.tsx`, `LatePunchoutModal.tsx`.

### Changed
- **`computeFlexMinutes`** rewritten for day-by-day accrual from `trackingStartDate`. Every scheduled workday strictly **before today** contributes `actual − scheduled net`; non-flex absences (VAB, semester, etc.) reduce that day's norm but don't drain the bank; flex-leave absences still deduct from the bank.
- **Today rolls in when you punch out — not the next morning.** New `computeTodayContribution` adds today's `actual − target` to the total flex (and the week/month sub-stats + the current-week row in the breakdown) the moment the day is "settled" (no active session AND at least one completed session today). During an active session today contributes 0 — no red −8 h in the morning.
- **Live "Idag" sub-stat** = `worked today − today's target`. Green if ≥ 0, red if < 0. Independent of whether the contribution has rolled into total yet.
- **Active sessions never count toward total flex.** Only completed sessions feed the bank; the "Idag" sub-stat is the in-progress signal.
- **Expense displays** (list, share text, receipt reminder, month total) handle missing amounts gracefully — km and amount are shown only if present, joined by " · ", with the total summing `e.amount ?? 0`.
- The single "Lägg till tid" action per day in history split into two compact buttons ("+ Tid" / "+ Avvikelse").
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
[1.0.0-beta.2]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.2
[1.0.0-beta.3]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.3
[1.0.0-beta.4]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.4
[1.0.0-beta.5]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.5
