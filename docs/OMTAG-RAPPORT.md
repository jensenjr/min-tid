# OMTAG-RAPPORT — min-tid 1.0

Run of `docs/OMTAG.md`, 2026-10-13 – 2026-10-14. Orchestrator: Claude Opus 5.5. Integration
branch `omtag/v1`; `main` was never touched. Final state of `omtag/v1`: version 1.0.0,
`npm ci && npm run lint && npm run build && npm test` green — 0 lint errors (7 pre-existing
warnings), 541 tests.

## Status per PR

| PR  | Title                                            | Status | Link                                               | Tests after merge (new) |
| --- | ------------------------------------------------ | ------ | -------------------------------------------------- | ----------------------- |
| 1   | Core logic out of the screen                     | merged | [#6](https://github.com/jensenjr/min-tid/pull/6)   | 44 (+43)                |
| 2   | Encrypted sync                                   | merged | [#7](https://github.com/jensenjr/min-tid/pull/7)   | 155 (+111)              |
| 4   | Rotating schedules and schedule periods          | merged | [#8](https://github.com/jensenjr/min-tid/pull/8)   | 185 (+30)               |
| 3   | Correct calculation, day status, reporting modes | merged | [#9](https://github.com/jensenjr/min-tid/pull/9)   | 313 (+128)              |
| —   | fix: Idag shows 0 before anything is worked      | merged | [#10](https://github.com/jensenjr/min-tid/pull/10) | 313                     |
| 5   | New navigation + "Enligt schema"                 | merged | [#14](https://github.com/jensenjr/min-tid/pull/14) | 361 (+48)               |
| 6   | Excel import and export                          | merged | [#13](https://github.com/jensenjr/min-tid/pull/13) | 438 (+77)               |
| 7   | Vacation balance                                 | merged | [#11](https://github.com/jensenjr/min-tid/pull/11) | 464 (+26)               |
| 8   | Travel time                                      | merged | [#12](https://github.com/jensenjr/min-tid/pull/12) | 524 (+60)               |
| 9   | Demo and 1.0                                     | merged | [#15](https://github.com/jensenjr/min-tid/pull/15) | 540 (+16)               |
| —   | fix: report ignores days before the flex start   | merged | [#16](https://github.com/jensenjr/min-tid/pull/16) | 541 (+1)                |
| —   | fix: copy vendor dir before npm ci (Dockerfile)  | merged | [#17](https://github.com/jensenjr/min-tid/pull/17) | 541                     |

Nothing is open or blocked. No STOP rule fired.

## Process deviations (orchestrator)

- **Setup commits on `omtag/v1`.** `main` was never prettier-clean (`npm run lint` failed with
  ~1 500 formatting errors), so `chore: apply prettier to the whole repo` landed before any PR.
  The Vitest scaffold (`npm test`, `vitest.config.ts` with `TZ=Europe/Stockholm`) also landed in
  setup instead of PR 1, because PR 1 and PR 2 ran in parallel and both needed `npm test`.
  `.claude/` was added to the ESLint ignores (agent worktrees live there).
- **Agents.** The custom `omtag-builder` / `omtag-critical` agent types cannot be loaded mid-
  session, so builders ran as `general-purpose` with model aliases `sonnet` / `opus` (the plan's
  fallback) and the plan's effort per PR.
- **Merging.** Auto-mode permissions blocked the orchestrator from merging its own sub-agents'
  PRs; the user switched the session's permission mode and merging continued as planned. Every
  merge used `--match-head-commit` on the exact commit the orchestrator had tested, and the
  resulting `omtag/v1` tree was compared byte-for-byte with that commit.
- **PR 4** was briefly closed by GitHub when a command chain deleted its head branch after a
  failed merge; the branch was re-pushed, the PR reopened and merged normally. Nothing was lost.
- **Three fixes outside the plan**: #10 (the user saw "Idag −7 h 15 min" in red before punching
  in), #16 (found in the final walk-through) and #17 — opened by the Railway app when the user's
  deploy of `omtag/v1` failed: PR 6's `file:vendor/xlsx-0.20.3.tgz` dependency was missing at the
  Dockerfile's `npm ci` step. Verified by simulating that step with an empty npm cache (ENOENT
  without `vendor/`, success with it) before merging; Docker itself was not running locally, so
  the image was not built here.
- **`stage` branch** was created on request and removed again on request; the user hosts
  `omtag/v1` directly for testing.
- Several agents were interrupted by network drops and usage limits and resumed from their
  worktrees; no work was lost.

## Deviations and TODOs per PR

### PR 1 — core lib

- `AbsenceEntry`/`ExpenseEntry` stay declared next to their modals; `types.ts` re-exports them.
- `weekRangeLabel`, `groupByDate`, `expandAbsenceDates`, `computeWeekNet` stayed in the UI.

### PR 2 — encrypted sync

- Protocol details beyond the spec: salt minted by `GET /api/auth/salt` before register;
  migration is one atomic `PUT /api/auth/secret` guarded by `baseRev`; pushes carry the salt as
  key id; old clients are told apart by `X-Sync-Protocol: 2` and get 409 (they can no longer
  register); a secret change issues a **new** recovery key.
- Server hardening: atomic `data.json` writes, refuses to start on a corrupt store, monotonic
  revisions, races fixed, 8 MB body limit.
- TODO: the 6-character minimum secret is now the weakest link — raise it (copy in Onboarding
  and SettingsModal). No "create a new recovery key" button (needs the secret). Printing the
  recovery key is untested on a real iPhone. The dev-only SMS fallback logs phone + code when
  46elks credentials are missing (pre-existing). A stolen 30-day token can overwrite or re-key
  the account, though not read it.

### PR 3 — day status

- Interpretations: lunch is deducted only for exactly one session strictly longer than the
  threshold (300 min); partial absence without sessions in punch mode → the rest of the day is
  `missing`; absence capped at the norm (excused before flex); adjustment beats sessions,
  sessions beat a confirmation; session times count in whole minutes; a payload without
  `reportingMode` gets the default rule applied.
- Locked month: an unregistered day reads as reported per schedule; registered days keep their
  real values. `confirmMonth` refuses while missing days exist, for a locked month, and for a
  month that hasn't started.

### PR 4 — rotation

- A date before the first period uses the first period. The editor adds a start-week selector
  ("the week containing the start date is week N"). The legacy `schedule` field is still written
  (week 1 of the period valid today) for rollback.

### PR 5 — navigation

- The weekly history list became "Lista" in Kalender; Utlägg moved into Rapport; header gear
  removed (everything is under Mer).
- CSV and share text are now one row per day (Status, Källa, Start, Slut, Rast, Arbetad, Norm,
  Flex) instead of one row per session — anyone consuming the old CSV must adapt.
- Live punching stays allowed today in a locked month (documented in CLAUDE.md).
- TODO: no UI for `autoLunchThresholdMin`; "Frånvaroregler" is an info sheet only.

### PR 6 — Excel

- `buildTemplate()` returns `docs/min-tid-importmall.xlsx` byte-for-byte (embedded as base64 in
  `templateData.ts`) because SheetJS Community cannot write validations, styles or comments.
  **Regenerate `templateData.ts` whenever the docs file changes** (a test catches drift).
- The template's Saldon sheet is a key/value list, not four columns; the parser reads both.
- Tarball sha512: `oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`.
  SheetJS, the template and ImportModal are separate lazy chunks; main bundle ~533 kB.
- `flexBaseDate` rule lives in `evaluateDay` (balance at the end of "Per datum").
- TODO: the template's Listor sheet lacks "Övertid (betald)" and "Helgdag".

### PR 7 — vacation

- An `hours` semester entry below the norm counts as 1 day when half days are off; when on, it
  rounds to the nearest half day (min 0.5). An opening balance from an earlier vacation year is
  ignored. Planned semester counts as consumed. The AbsenceModal warning never blocks saving.

### PR 8 — travel

- Rule decided by the orchestrator: outside-schedule travel with rule `flex` adds to flex on
  every counting day (not future, not before the flex start or inside an imported balance, not
  today while ongoing); inside-schedule travel is never added to worked time (already covered by
  schedule/punch/adjustment); payroll never touches flex. Factor applies to outside minutes,
  then the per-day cap. Duration-only (migrated) entries count as outside.
- Old "Resetimmar" expenses: an amount 0 < x ≤ 24 is read as hours and becomes an imported
  travel entry; anything else stays an expense. **Awaiting the user's confirmation** (see below).
- TODO: midnight-crossing and duration-only trips are exported to Excel but the importer
  rejects them (needs Från < Till).

### PR 9 — demo and 1.0

- Demo edits live in memory, mirrored to `punchclock_demo`, removed on `pagehide` and on exit;
  re-seeded on every `?demo=1`. The window is 8–11 weeks so one full past month can be locked.
- After 17:00, today also shows as unconfirmed in the demo (so "Enligt schema" can be tried).

## Final verification (orchestrator, 375 px, built-in browser)

`?demo=1` → banner "Demoläge – inget sparas" → Idag "Enligt schema ✓" (day becomes
"Bekräftad enligt schema", counter drops) → Justera dag with restid 15:00–19:00 ("2 h under
arbetstid · 2 h utanför arbetstid (2 h till lön)") → Kalender day sheet "Så räknades dagen"
(norm, adjustment, restid inside/outside, flex) → Rapport (Restid 4 h / 2 h till lön,
"Semester: 21 av 25 dagar kvar", receipts, Exportera Excel present) → Mer → Synk och säkerhet
("Av i demoläget", AES-256 row) → Avsluta demo. No `/api` request during the demo;
`punchclock_v2` byte-identical afterwards; `punchclock_demo` removed. The Excel download itself
was not clicked (covered by the export → import round-trip tests). Found and fixed #16.

Not re-run after the final merges: a real Express server end-to-end sync run (PR 2 did one with
real bcrypt/JWT before merge).

## Before deploying

- Give any test instance its own data volume and `JWT_SECRET`. Logging in to a test server that
  shares production's `data.json` migrates the account to encrypted, after which older clients
  get 409 "uppdatera appen".
- Existing users see changed numbers: missing days no longer drain flex, the lunch rule changed,
  day keys are local. The CHANGELOG says so plainly.

## Open questions

- Which collective agreement applies (bankavtalet)? Decides travel-time defaults, half-day
  vacation and any flex cap.
- Should the future admin app read employees' data? It conflicts with end-to-end encryption.
- Recovery key vs. "restore only from another device" — default implemented: recovery key.
- Old "Resetimmar" expenses: did users type hours or kronor in the amount field? Current
  migration reads 0 < amount ≤ 24 as hours.
