# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Current version: 1.0.0-beta.12.** Exposed to the UI via `__APP_VERSION__` (set by Vite from the root `package.json`) and shown at the bottom of the settings modal. Bump versions in both `package.json` and `server/package.json` together.

## Commands

```bash
# Frontend
npm run dev          # Vite dev server on port 5000 (host 0.0.0.0)
npm run build        # Production build → dist/
npm run lint         # ESLint
npm test             # Vitest (runs with TZ=Europe/Stockholm)
npm run format       # Prettier

# Backend (run in a second terminal alongside npm run dev)
npm run server:install   # First-time only: installs server/node_modules
npm run server:dev       # node --watch server/index.js  (port 3001)
```

Tests live in `src/lib/__tests__/` (Vitest, `vitest.config.ts` pins `TZ=Europe/Stockholm`). Definition of done: `npm ci && npm run lint && npm run build && npm test`. `npm run build` also surfaces TypeScript errors at transform time.

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
localStorage["sync_token"]    = "<JWT>"   // set only when sync is configured
localStorage["sync_username"] = "<username>"
localStorage["sync_rev"]      = "<ms>"    // last server revision this device has seen
localStorage["sync_dirty"]    = "1"       // local edits the server hasn't acknowledged
localStorage["sync_error_log"] = [...]    // last 10 sync failures (device-local, never synced)
```

`trackingStartDate` (YYYY-MM-DD, optional) anchors flex accrual. Set automatically to today on a user's first punch-in; for migrating users it's backfilled in `load()` from the earliest session date so historic flex stays sensible. It also round-trips through sync (`SyncState.trackingStartDate`).

### Date-key gotcha (local vs UTC)

Session timestamps are converted to `YYYY-MM-DD` day-keys with `new Date(ms).toISOString().slice(0,10)` throughout the flex/share code. That's fine for work-hour timestamps but **wrong for a local-midnight `Date`** in a positive-UTC-offset timezone (Sweden is UTC+1/+2): `toISOString()` rolls back to the previous day. The calendar grid builds cells from local-midnight `Date` objects, so it must use the local `ymdLocal(d)` helper (not `toISOString`) — otherwise every cell is off by one day. If you add a new surface that maps a midnight `Date` → day-key, use `ymdLocal`.

### Mobile layout invariant

The bottom nav is **not** `fixed bottom-0` — that breaks on mobile Safari when the URL bar appears/disappears. Instead:

- Outer wrapper: `fixed inset-0` (locks to viewport)
- Inner container: `h-full flex flex-col`
- `<header>` and `<nav>`: `shrink-0`
- `<main>`: `flex-1 min-h-0 overflow-y-auto`

This keeps the nav anchored to the visible viewport bottom while only the main area scrolls. Don't reintroduce `min-h-screen` + `fixed bottom-0`.

### Schedule data model (`src/lib/schedule.ts`)

Everything time-related flows through this file. The schedule is a list of **periods**, each holding a **rotation** of 1–8 weekly schedules:

```ts
DayConfig = { active, startTime, endTime, lunchMinutes };
WeekSchedule = Record<DayKey, DayConfig>;
ScheduleRotation = { weeks: WeekSchedule[] }; // 1–8 weeks (MAX_ROTATION_WEEKS)
SchedulePeriod = { validFrom, anchorMonday, rotation }; // YYYY-MM-DD, local dates
ScheduleSource = WeekSchedule | SchedulePeriod[];
shiftMinutes(cfg); // gross: endTime − startTime
netDayMin(cfg); // net: shiftMinutes − lunchMinutes (0 if inactive)
weeklyNetMin(week); // sum of netDayMin across all 7 days
weeklyNetMinFor(source, date); // net norm of the week containing date
```

- **State.** `PunchClock` holds `schedules: SchedulePeriod[]` (sorted by `validFrom`), persisted as `schedules` in `punchclock_v2` and in the sync payload. `reportingMode?: "schedule" | "punch"` sits next to it (`undefined` = not chosen yet; the UI shows it as "Stämpla"; the default rule belongs to the day-status work, not here).
- **Lookup.** `getEffectiveDayConfig(date, source, exceptions = {})` = `periodFor(date)` → `rotation.weeks[mod(weeksBetween(anchorMonday, mondayOfStr(date)), n)]` → weekday, then a `ScheduleException` overrides `endTime`/`lunchMinutes` on top of that day. `periodFor` is the last period with `validFrom <= date`; a date before the first period uses the first one. The modulo is positive, so dates before the anchor work. A plain `WeekSchedule` is accepted everywhere a `ScheduleSource` is (one 1-week period valid forever); `toPeriods(source)` normalises either form. `days.ts`/`flex.ts` take a `ScheduleSource`, so callers pass `schedules`.
- **Dates.** Monday math is string-based on whole-day numbers (`mondayOfStr`, `weeksBetween`, `addDaysStr`), so DST can never shift a week. Weeks run Monday–Sunday; the weekend belongs to the week whose Monday precedes it.
- **Editing.** `ScheduleEditorModal` ("Planera dagar", `src/components/schedule/`) asks "Gäller från" (default today) and calls `appendPeriod` — it adds a period (or replaces one with the same `validFrom`) and never edits earlier ones, so history keeps its norm. The anchor is derived from the start date plus "the week containing the start date is week N" (default: keeps the current rhythm if the length is unchanged, else week 1). It offers rotation length 1–8, tabs "Vecka 1…N", "Kopiera vecka 1 till alla" and the reporting-mode choice (Enligt schema / Stämpla). `WeekScheduleEditor` (Onboarding.tsx) edits a single week and is reused per tab; onboarding still produces one week, wrapped with `periodFromWeek`.
- **Migration & rollback.** `migrateSchedules({ schedules, schedule, normHours, trackingStartDate })` is the only way to load: `schedules` if valid (`parsePeriods` drops junk, caps at 8 weeks, snaps anchors to Mondays), otherwise the old single `schedule` (via `migrateSchedule`) or `normHours` becomes one period with `validFrom = trackingStartDate ?? "2000-01-01"`. `save()` also writes the legacy `schedule` field = week 1 of the period valid today (`legacyScheduleOf`), so an older build still finds a schedule.
- **Sync.** `SyncState` carries `schedules` and `reportingMode` next to the legacy `schedule`. The dirty-merge unions periods by `validFrom` (`mergePeriods`, local wins).

`DEFAULT_SCHEDULE` = Mon–Fri 08:00–17:00 with 60 min lunch (8 h net, 40 h/week).

`migrateSchedule()` handles three historical storage formats for a single week and `migrateSchedules()` wraps it for periods — always pass raw localStorage data through it when loading. The `ScheduleException` type is in `src/lib/types.ts`.

### Flex bank

Flex logic lives in pure, tested modules (no React): `src/lib/flex.ts` (the four functions below), `src/lib/days.ts` (`computeDayMinutes`, `getAbsencesForDate`), `src/lib/dates.ts` (`ymdLocal`, `todayLocal`, week helpers, `isoWeekNumber`) and `src/lib/types.ts` (`Session`, `ScheduleException`, `AppState`, re-exports of absence/expense types). Tests are in `src/lib/__tests__/`; `it.fails` cases there document known bugs (scheduled empty day = −norm, flex absence counted twice, lunch deducted despite lunch punch-out, 00:00–02:00 sessions on the previous UTC day). Day keys here still use UTC `toISOString` — kept on purpose until the bug-fix PR.

Three flex functions in `src/lib/flex.ts`:

**`computeFlexMinutes(sessions, absences, schedule, trackingStartDate, rangeStart?, rangeEnd?)`**

- Day-by-day accrual over **completed past days only** (date < today).
- For each day in range: `flex += actual_net − norm`, where `norm = netDayMin(cfg) − non_flex_absence_min` (clamped at 0). Flex-leave absences additionally drain the bank.
- Only completed sessions count. Today is excluded — see the two helpers below for in-progress and just-finished signals.

**`computeTodayContribution(sessions, absences, schedule, today, trackingStartDate)`**

- Returns today's `actual − norm` only when today looks "settled": no active session AND ≥ 1 completed session today (or a flex absence on today).
- Added to total flex, the week/month sub-stats and the current-week row in the breakdown the moment the user punches out. During an active session it returns 0 — keeps the morning from going red on an unworked day.

**`computeTodayDelta(todaySessions, todayCfg)`**

- Pure live computation: `liveNet − todayTarget`. Updates every tick. Drives the "Idag" sub-stat in the flex section so the user can see in-progress status (− while behind, + once overshoot).
- Never feeds total flex — it's display-only.

Total displayed = `flexBaseMinutes + computeFlexMinutes(...) + computeTodayContribution(...)`. `flexBaseMinutes` is a one-time correction users can set on first sync. The "Idag" sub-stat uses `computeTodayDelta`; "Veckan" / "Månaden" use the past-day range computation plus `todayContribution`.

`computeWeeklyFlexBreakdown(...)` is a thin wrapper that calls the per-week computation for the last N weeks (newest first); the current week's row adds `todayContribution` so it stays consistent with the "Veckan" sub-stat. Stops when a week ends before `trackingStartDate`.

### Components

| File                     | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PunchClock.tsx`         | Main app shell — clock, history, expenses, share views; all inline sub-components. `SessionModal` ("Lägg till tid") supports single-day time entry and a "Flera dagar" mode that fills a date range with a percentage (100/75/50/25) of each scheduled day's net, skipping inactive/weekend days and days that already have a session. The "Dela" tab is a report builder: choose a month or a custom date range, then `buildShareText`/`buildCsvExport` generate a text + CSV report for that exact `[start, end]` window |
| `Onboarding.tsx`         | First-run flow with welcome → info/login → choice → schedule → sync. Exports `WeekScheduleEditor` used by both onboarding and the "Planera dagar" modal                                                                                                                                                                                                                                                                                                                                                                    |
| `SettingsModal.tsx`      | Bottom sheet for editing name + department, controlling sync (activate / disconnect), opening the automation sheet, and showing app version                                                                                                                                                                                                                                                                                                                                                                                |
| `AbsenceModal.tsx`       | Bottom sheet for logging absence entries (VAB, semester, etc.)                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ExpenseModal.tsx`       | Bottom sheet for logging expense entries (milersättning with km, kost, etc.)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `SyncModal.tsx`          | Bottom sheet for setting up sync on an existing device (create code or restore) — collects username + secret                                                                                                                                                                                                                                                                                                                                                                                                               |
| `FlexBreakdownModal.tsx` | Bottom sheet showing total flex + the last 12 weeks of flex broken down individually                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `LatePunchoutModal.tsx`  | Bottom sheet that intercepts punch-outs after a 4+ hour active session — offers "use now", a custom end-time picker, or cancel                                                                                                                                                                                                                                                                                                                                                                                             |
| `AutomationModal.tsx`    | Bottom sheet ("Automatisera in/ut-checkning", opened from settings) — QR codes (via `uqr`), printable office signs, iOS Shortcuts recipes for WiFi/NFC punching, install-to-home-screen instructions                                                                                                                                                                                                                                                                                                                       |
| `src/lib/schedule.ts`    | Pure schedule types, constants, calculations, and localStorage migration                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/lib/sync.ts`        | Thin fetch wrapper for all sync API calls; passes `username` + `secret`                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/lib/actions.ts`     | URL actions (`?action=in\|out\|toggle&source=…`): parse-and-strip from the address bar, build trigger URLs, 2-min dedupe window                                                                                                                                                                                                                                                                                                                                                                                            |

### URL actions & automation

Any trigger that can open a URL punches the clock — printed QR codes, NFC tags and WiFi join/leave via iOS Shortcuts automations, and PWA home-screen shortcuts. See `docs/ios-automation.md`. Invariants:

- `consumeActionFromUrl()` strips the params via `history.replaceState` so a reload never re-punches. Call it only once, on mount.
- Execution is schedule-aware: auto check-in on an inactive day requires confirmation; duplicates within 2 minutes are swallowed; auto check-out goes through the same short-session/late-punchout guards as the button.
- Sessions record their trigger in `Session.source` (optional — absent for plain button punches); it round-trips through localStorage and sync untouched.
- Schedule nudge banners ("Enligt schemat började du 08:00 — checka in?") are derived state re-evaluated by the 10 s tick; per-day dismissals live in `localStorage["punchclock_banner_dismissed"]` (device-local, never synced).

### PWA

`public/` holds `manifest.webmanifest` (standalone display + app shortcuts that use URL actions), `icon.svg`, `apple-touch-icon.png` (regenerate with `node scripts/gen-icons.mjs`) and `sw.js` — a network-first service worker (fresh deploys always win; offline falls back to cache; `/api` is never intercepted). The SW is registered from `src/main.tsx` in production builds only.

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
  if (open) {
    setState(prop);
  }
}, [open]); // eslint-disable-line react-hooks/exhaustive-deps
```

### Styling

Tailwind CSS v4 with custom `pc-*` design tokens defined in `src/styles.css`. Key tokens: `pc-orange` (#ff5f00 — primary), `pc-ink` (#2d1717 — body text), `pc-bg` (#faf6f1 — background). All components use inline styles for dynamic values and Tailwind classes for layout/spacing.

---

## Sync backend (`server/`)

### Overview

A minimal Express + Node.js server. No database — state is stored in a single JSON file (`data.json`). Users are identified by a username paired with a bcrypt-hashed credential; no e-mail or other personal identifiers are stored (a phone number only if the user adds one for SMS recovery).

**Sync is end-to-end encrypted.** The server stores and returns only ciphertext (`{ v: 1, iv, ct }`) and never sees the secret or the encryption key. See "End-to-end encryption" below.

**Zero native dependencies.** All packages are pure JavaScript (`express`, `bcryptjs`, `jsonwebtoken`). This is intentional: native C++ modules (like `better-sqlite3`) fail to compile in Nixpacks/Alpine environments. The crypto is Node's / the browser's built-in Web Crypto.

### Files

| File                                                                  | Purpose                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/index.js`                                                     | Express glue: routes, JSON store (atomic temp-file + rename writes; refuses to start on an unparsable `data.json`), SMS/OTP, 60-day cleanup, body-free error handler                                          |
| `server/core.js`                                                      | All account/sync **policy** (register, login, salt, sync GET/PUT, secret change/migration, recovered session). Pure: no express/bcrypt/jwt imports — `index.js` injects them, root vitest imports it directly |
| `server/__tests__/core.test.js`                                       | Policy tests against `core.js` with fake bcrypt/jwt                                                                                                                                                           |
| `server/__tests__/protocol.test.js`                                   | End-to-end: the real client (`src/lib/sync.ts`) against `core.js` through a fake `fetch`, one key store per simulated device                                                                                  |
| `src/lib/crypto.ts`                                                   | Web Crypto only: `deriveKeys`, `encryptState` / `decryptState`, recovery key generate/normalize/format, `unwrapEncKey`                                                                                        |
| `src/lib/keyStore.ts`                                                 | Device key + not-yet-acknowledged recovery key in IndexedDB (`min-tid-sync` / `keys`), with an in-memory fallback                                                                                             |
| `src/lib/sync.ts`                                                     | Client API. Same exported signatures as before encryption; derives keys, encrypts, decrypts, migrates and re-keys internally                                                                                  |
| `src/components/SyncModal.tsx`, `src/components/RecoveryKeySheet.tsx` | Sync setup / restore / re-login / SMS recovery UI; the one-time recovery-key sheet                                                                                                                            |
| `server/package.json`                                                 | Server dependencies                                                                                                                                                                                           |
| `server/package-lock.json`                                            | **Must be committed.** Required for `npm ci` in Docker/Nixpacks. If missing, builds fail with `EUSAGE`. Regenerate with `npm run server:install`.                                                             |
| `server/data.json`                                                    | Runtime data file — gitignored, created automatically on first write                                                                                                                                          |

### Data model

```
data.json = {
  users: {
    "<username_lower>": {
      id:             "<uuid>",
      username:       "<original-case username>",
      secretHash:     "<bcrypt(authKey)>",   // legacy accounts: bcrypt(secret)
      encrypted:      true,                  // absent on legacy (pre-encryption) accounts
      salt:           "<base64, 16 bytes>",  // PBKDF2 salt; also identifies the current key
      state:          { v: 1, iv, ct } | null, // legacy accounts: plaintext StorageShape | null
      stateUpdatedAt: <ms>,                  // revision marker — strictly increasing, bumped on every state write
      recovery:       { v: 1, wrappedKey, updatedAt } | null, // AES-KW(encKey) under the recovery key
      phone?:         "+46…",               // only if added for SMS recovery
      createdAt:      <ms>,
      lastActivity:   <ms>
    }
  }
}
```

- The map key is the lowercased username, enforcing case-insensitive uniqueness (`carl` blocks another `carl` but `carl2` is fine).
- `lastActivity` is updated on every login, SMS recovery, secret change and `PUT /api/sync`.
- Usernames must match `^[a-zA-Z0-9_-]{3,20}$`. Validation lives in both server (`isValidUsername` in `server/core.js`) and client (regex in `SyncModal.tsx` + `Onboarding.tsx`).
- Invariants enforced in `core.js`: an encrypted account only ever holds an envelope (or null); a legacy account never holds an envelope (an old client would adopt it as its state and wipe its data); no `await` sits between reading a record and writing it back.

### End-to-end encryption

```
secret ──PBKDF2-SHA256, 600 000 iterations, per-account salt──► master
master ──HKDF "min-tid/v1/auth"──► authKey   32 bytes, sent base64, server bcrypts it
master ──HKDF "min-tid/v1/enc" ──► encKey    AES-GCM-256, non-extractable, IndexedDB only
state  ──AES-GCM(encKey, fresh 12-byte IV, AAD "min-tid/v1/state")──► { v: 1, iv, ct }
recovery key (24 Crockford base32 = 120 bits) ──HKDF──► AES-KW key ──wraps──► encKey
```

- **Salt.** `GET /api/auth/salt?username=` returns the account's salt, or a fresh random salt for an unused name (which `register` then commits and returns). For a legacy account it returns `encrypted: false` plus a fresh salt for the migration.
- **Protocol marker.** Encrypting clients send `X-Sync-Protocol: 2` on every request. Requests without it are pre-encryption builds: on an encrypted account they get **409 `NEEDS_UPDATE`** ("Uppdatera appen…") and never see or overwrite ciphertext. Legacy accounts keep working for them until migrated. Old clients can no longer register.
- **Key id.** The salt identifies the key. `PUT /api/sync` sends `{ state: envelope, salt }`; a salt that is not the account's current one gets **409 `KEY_CHANGED`**, and `syncPull` compares the returned salt before decrypting. That is what stops a device still on an old secret from overwriting data with ciphertext nobody else can read.
- **Extractability.** `wrapKey` needs an extractable key, but the stored encKey must not be. `deriveKeys` keeps the (non-extractable) HKDF base key in a closure; `wrapEncKey(recoveryKey)` derives a short-lived extractable twin, wraps it inside Web Crypto and drops it. Raw key bytes never enter JS memory. The recovery KEK is never stored.
- **Migration (legacy account).** `syncLogin` sees `encrypted: false`, logs in once with the raw secret, derives keys, mints a recovery key and calls `PUT /api/auth/secret { authKey, salt, state: envelope, recovery, baseRev }` — **one atomic write** replaces the hash, sets `encrypted`, stores the envelope (deleting the plaintext) and the wrapped key. `baseRev` must equal `stateUpdatedAt` or the server answers 409 `CONFLICT`; the client re-reads and retries (an old client may push mid-migration).
- **Secret change** (`syncChangeSecret`): pull + decrypt with the device key, derive a new key from a new salt, re-encrypt, mint a **new** recovery key (the old one stops working — the device cannot re-wrap without the recovery key, and the stored encKey is non-extractable), same atomic `PUT /api/auth/secret`. Other devices then get `KEY_CHANGED` until they log in with the new secret.
- **SMS recovery** restores the account (a token), not the data. `syncRecoverConfirm` → `syncRecoverUnlock(recoveryKey)` (unwraps the old encKey, decrypts in memory) → `syncRecoverComplete(newSecret)` re-keys under a new secret. Without the recovery key, `syncRecoverComplete` refuses (`RECOVERY_KEY_REQUIRED`) unless the user explicitly chose `discardCloudData` ("Börja om"), which sends `discardState: true`; the server never drops an existing state without that flag. Nothing silently leaves undecryptable ciphertext behind.
- **Recovery key display.** Every flow that mints one stores it as "pending" in IndexedDB (tagged with the salt) before the request; `RecoveryKeySheet` shows it while it matches the device key's salt, with "Skriv ut / kopiera" and a required checkbox, and deletes it on "Klar". `SyncModal` keeps the sheet mounted even while closed, so a key minted from Settings (secret change) or a restore pops up too; onboarding mounts it on the step after "Skapa konto".
- **Device without a key** (token from a pre-encryption build, or IndexedDB cleared): `syncPush` / `syncPull` throw `SyncApiError` 401 `NO_KEY` before any request. Nothing local is touched.
- `sync.ts` runs every key-touching operation through one queue, so a push never encrypts with a key a concurrent secret change is about to retire. Test hook: `__setSyncTestHooks({ keyStore, iterations })` (production never calls it; a test pins the 600 000 default).

**Threat model.** The server (or a stolen `data.json`) sees usernames, timestamps, sizes, phone numbers, bcrypt(authKey), salts, wrapped keys and ciphertext — enough for an offline guess at PBKDF2-600k cost per guess, so a weak 6-character secret is the weakest link. It cannot read or undetectably alter data (AES-GCM). A stolen 30-day token lets an attacker overwrite or re-key the account (as before) but not read it.

### 60-day inactivity cleanup

`cleanupInactive()` in `server/index.js`:

- Runs on server startup and every 24 hours via `setInterval`.
- Deletes any user whose `lastActivity` is older than `60 * 24 * 60 * 60 * 1000` ms.
- Logs `Cleaned up N inactive account(s).` when it removes anything.

### API endpoints

| Method | Path                        | Auth       | Description                                                                                                                                                                                                       |
| ------ | --------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/auth/salt?username=`  | none       | `{ salt, encrypted }` — see "End-to-end encryption"                                                                                                                                                               |
| POST   | `/api/auth/register`        | none       | `{ username, authKey, salt, recovery: { v: 1, wrappedKey } }` → `{ userId, token, salt }`. 409 if taken; 409 `NEEDS_UPDATE` for a raw `secret`                                                                    |
| POST   | `/api/auth/login`           | none       | `{ username, authKey }` (legacy accounts: `{ username, secret }`) → `{ userId, username, token, state, updatedAt, encrypted, salt? }`. Raw secret on an encrypted account → 409 (`NEEDS_UPDATE` / `USE_AUTH_KEY`) |
| GET    | `/api/sync`                 | Bearer JWT | `{ state, updatedAt, encrypted, salt? }`; the envelope is returned untouched, and only to protocol-2 clients (else 409 `NEEDS_UPDATE`)                                                                            |
| PUT    | `/api/sync`                 | Bearer JWT | Encrypted: `{ state: { v, iv, ct }, salt }` only (409 `KEY_CHANGED` on a stale salt, 400 on a malformed envelope). Legacy: `{ state }` from old clients only. → `{ ok, updatedAt }`                               |
| PUT    | `/api/auth/secret`          | Bearer JWT | `{ authKey, salt, state, recovery, baseRev, discardState? }` → atomic migration / secret change / post-SMS reset; 409 `CONFLICT` on a stale `baseRev`. Legacy accounts also accept `{ newSecret }`                |
| POST   | `/api/auth/recover/confirm` | SMS code   | → `{ userId, username, token, state, updatedAt, encrypted, salt?, recovery? }`; encrypted account + old client → 409                                                                                              |
| DELETE | `/api/account`              | Bearer JWT | Delete user record                                                                                                                                                                                                |

Phone endpoints (`/api/auth/phone`, `/phone/verify`, `/recover/request`) are unchanged. Login errors are deliberately ambiguous ("Fel användarnamn eller synk-kod") and an unknown username costs a bcrypt compare like a known one. Registration does reveal that a name is taken (by design — you need to know to pick another).

**Never log request bodies** — they carry auth keys, ciphertext and phone numbers. `core.js` has no logging at all; `index.js` replaces Express's default error handler (which would print a JSON parse error including a body excerpt) and logs only method, path and error name for 5xx. The one remaining log of user data is the dev-only SMS fallback (`[sms] … would send to <phone>: <code>` when 46elks credentials are missing).

### Environment variables

| Variable     | Default                           | Description                                                    |
| ------------ | --------------------------------- | -------------------------------------------------------------- |
| `PORT`       | `3001` (dev) / `3000` (prod)      | Port the server listens on                                     |
| `JWT_SECRET` | `dev-secret-change-in-production` | **Must be overridden in production**                           |
| `DATA_PATH`  | `server/data.json`                | Path to the JSON data file                                     |
| `NODE_ENV`   | —                                 | Set to `production` to enable static file serving from `dist/` |

### How sync works in `PunchClock.tsx`

Sync is **two-way**: pull on open/foreground, debounced push on change. (Up to beta.10 it
only ever pushed, so whichever device you opened last silently overwrote the other one's day.)

State lives in refs so timers and event listeners never act on a stale closure:

| Ref               | Meaning                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `syncRevRef`      | Last server revision seen (`updatedAt`, mirrored in `localStorage["sync_rev"]`)                                                |
| `dirtyRef`        | Local edits the server hasn't acknowledged (mirrored in `localStorage["sync_dirty"]`, so it survives a reload/offline session) |
| `hydratedRef`     | We have read the server at least once this session                                                                             |
| `suppressPushRef` | The next save-effect run comes from applying server data, not from the user                                                    |
| `stateRef`        | Latest `SyncState` payload                                                                                                     |

**Pull** (`pullNow`) runs on mount with a token, on `visibilitychange`/`focus`/`online`, and from
the "Hämta nu" button in settings:

1. `syncPull` → `GET /api/sync`, decrypted inside `sync.ts` → `{ state, updatedAt }`
   (`syncPush` likewise encrypts; PunchClock never sees ciphertext).
2. `state === null` → the account has never been written; this device seeds it (`pushSoon(0)`).
3. `updatedAt === syncRevRef` → nothing new; only a queued dirty push is sent.
4. Otherwise, if the device is **clean** → adopt the server state wholesale (so deletions made on
   the other device propagate). If it is **dirty** → `mergeSyncState()`: union `sessions` /
   `absences` / `expenses` by `id` (local wins on a collision), local scalars win, earliest
   `trackingStartDate` wins — then the save effect pushes the union back.

**Push** (`pushSoon` → `pushNow`, 3 s debounce) is gated on `hydratedRef`: a device never
overwrites the server before it has read it. Edits made while offline stay `dirty` and go up on the
next successful pull. A `pagehide` listener flushes a pending push.

`syncStatus` (`"idle" | "syncing" | "pulling" | "ok" | "error"`) plus `syncError` drive the status
card in `SettingsModal`.

**Key invariants:**

- `onboardingDone` is never synced — it is always set to `true` on the local device after any onboarding path completes.
- Persisted state is read **synchronously** into `useState` initializers via `load()` (a `bootRef`), not in an effect. Loading in an effect let the save effect fire once with empty defaults first.
- Restore paths (`SyncModal`, onboarding login/restore) call `adoptRestoredState()`, which sets the revision, clears `dirty`, and replaces local state. If the server has **no** state, the UI now says so instead of silently keeping the local data.
- "Koppla från här" only drops the local token. Deleting the account is a separate, explicitly confirmed action ("Radera synk-konto").

### Surfacing sync failures

A silently broken sync is the one failure a user cannot discover on their own — the
app keeps working offline, so nothing looks wrong until weeks of hours are missing on
the other device. The motivating case: a corporate WiFi serves the static app fine but
its proxy answers **403 on `/api`**.

- `SyncApiError` (`src/lib/sync.ts`) carries `status` / `path` / `method` and an optional
  `code`. `status === 0` means the request never got a response (offline, DNS/TLS, captive
  portal, filtering) — `fetch` only rejects in that case. Encryption adds three statuses a
  proxy never produces: **401 `NO_KEY`** (token but no key on this device), **409
  `KEY_CHANGED`** (secret changed elsewhere), **422 `DECRYPT_FAILED`** (cloud copy won't decrypt).
- `src/lib/syncDiagnostics.ts` owns everything user-facing about a failure:
  `explainSyncError()` maps a `SyncFailure` to `{ headline, cause, fixes[], networkBlocked, relogin }`
  in plain Swedish (403/407/451/0 → "byt nät"; 401/409/422 → logga in igen, `relogin: true`;
  405 → deploy pågår; 5xx → serverfel), a rolling 10-entry log in `localStorage["sync_error_log"]`, and
  `buildSyncReportMailto()` which composes the felanmälan to `christian@krut.it`
  (subject `mintid sync error kl HH:MM`). **The report never includes the JWT or the secret.**
- `PunchClock.noteSyncFailure()` is the single funnel: every failed pull/push records the
  failure, appends to the log, and sets `syncStatus = "error"`. `clearSyncFailure()` runs on
  every success.
- `<SyncErrorBanner>` renders red between `<header>` and `<main>` (both `shrink-0`, so it
  stays visible on every tab and never scrolls away). Dismissal is keyed to
  `syncFailure.at` — hiding one failure, not all future ones.
- "Läs mer och åtgärda" opens `SettingsModal` with `openSyncHelp`, which expands the
  troubleshooting panel and scrolls `#sync-help` into view. The panel holds the cause, the
  numbered fixes, a reassurance line driven by the `dirty` flag, "Försök igen" (`onPullNow`)
  and "Skicka fellogg" (the mailto).
- When `relogin` is true the panel also shows **"Logga in igen"** (`onSetupSync`). It opens
  `SyncModal` while a token is still set, which puts it in re-login mode: the username is
  fixed to `sync_username`, and success goes through `onToken` (not `onRestore`), so
  `handleSyncToken` marks the device dirty and the next pull **merges** local edits into
  the cloud copy instead of replacing them. ("Koppla från" + "Återställ" would replace.)

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

### Policy

**Pre-1.0 (we are here):** every batch of changes that ships → bump `-beta.N`. So beta.1 → beta.2 → beta.3, etc. There is no patch suffix inside a beta — each shipped beta is the next integer. The "1.0.0" prefix doesn't move until we declare 1.0.0 stable.

**Post-1.0 stable:** standard semver:

- `1.0.1` — backwards-compatible bug fixes
- `1.1.0` — backwards-compatible new features
- `2.0.0` — breaking change (storage shape, API, etc.)

### When to bump

Bump (and add a `CHANGELOG.md` section) whenever you ship anything user-visible — a feature, a UI tweak, a bug fix, a behavioural change. Not for pure internal refactors that have no observable effect, but err on the side of bumping. Traceability matters more than version-number frugality.

### How to bump

1. Edit `package.json` and `server/package.json` to the new version (lockstep).
2. In `CHANGELOG.md`: move whatever is under `[Unreleased]` into a new `[X.Y.Z] — YYYY-MM-DD` section just above the previous release. Leave a fresh `_Nothing yet._` under `[Unreleased]`. Add the link at the bottom.
3. `npm run build` to confirm Vite injects the new value.
4. Commit (`package.json`, `server/package.json`, `CHANGELOG.md`, plus the actual change). Push.
5. If publishing a GitHub release: tag `v1.0.0-beta.N` and the changelog links resolve.

### When work is in flight

Smaller in-progress changes can land under `[Unreleased]` in the changelog without a version bump. When the next deploy goes out, roll `[Unreleased]` into the new beta number. Don't ship to users without bumping.

---

## Framtida riktning: admin + schemaläggning (separat app)

**Status: bara plan. Ingenting av det här är byggt, och det ska inte byggas in i min-tid.**

Nästa steg är en **arbetsgivarsida** — en admin som ser flera anställdas tid och lägger ut
scheman centralt. Den bryter mot i stort sett varje antagande den här appen vilar på och
blir därför en egen app i ett eget (privat) repo, forkat härifrån för att återanvända
UI-språket och tidslogiken.

### Varför det inte kan bo här

| min-tid idag                                      | Vad admin kräver                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| Ett konto = en person = ett JSON-blob             | Relationer: organisation → avdelning → anställd → pass           |
| Användarnamn + delad hemlighet, ingen identitet   | Riktig identitet: inbjudan, e-post/BankID, sessioner, utloggning |
| Ingen auktorisation — har du token äger du datan  | Roller (anställd / chef / löneadmin) och per-post-behörighet     |
| `data.json`, hela state skrivs om vid varje PUT   | Databas med per-entitet-skrivningar, historik och audit          |
| Schemat är lokalt och personligt (`WeekSchedule`) | Scheman läggs ut centralt, anställd ser och avviker mot dem      |
| Offline-först, enheten äger sanningen             | Servern äger sanningen, klienten är en vy                        |

Att lägga admin ovanpå dagens JSON-store skulle betyda att en token ger läsning av
andras tid. Det är en säkerhetsmodell, inte en refaktorering — därför nytt repo.

### Vad som bör återanvändas

- **`src/lib/schedule.ts`** — `DayConfig`, `netDayMin`, `weeklyNetMin` och lunchkonventionen
  gäller oförändrat. Flyttas till delad kod (eller kopieras och hålls i synk).
- **Flexberäkningen** i `src/lib/flex.ts` (`computeFlexMinutes` + hjälparna) — reglerna för
  norm, frånvaro och flexuttag är samma på arbetsgivarsidan.
- **Designspråket** (`pc-*`-tokens, bottom sheets, banners) så de två apparna hör ihop.
- **`buildShareText` / `buildCsvExport`** — rapportformatet chefen ska godkänna är samma
  som den anställde redan skickar.

### Vad min-tid får för roll

Klienten kan i princip vara oförändrad — den är redan offline-först och pratar med servern
genom ett tunt lager (`src/lib/sync.ts`). Byter man endpoint och auth där kan samma app
peka på det nya backendet, med tillägget att scheman kan komma _utifrån_ (serverns schema
blir grunden, `scheduleExceptions` blir avvikelser mot den). Gaffla inte frontend i onödan.

### Öppna frågor att ta ställning till innan bygget

1. Behåller anställda sina egna konton (personlig app, delar frivilligt) eller ägs kontot av
   arbetsgivaren? Det avgör hela integritets- och GDPR-hållningen.
2. Godkännandeflöde: attesterar chefen tid i efterhand, eller är utlagt schema sanningen som
   den anställde avviker från?
3. Vad händer med data när en anställning tar slut? (Dagens svar: 60-dagarsstädning av
   inaktiva konton — det håller inte för en arbetsgivare med bevarandekrav.)
