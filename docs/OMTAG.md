# OMTAG.md — min-tid rework, run plan for Claude Code

You are the **orchestrator**. This file is the whole assignment. Work through it top to bottom without
asking for confirmation unless a STOP rule below says so. Everything happens on the integration branch
`omtag/v1`; `main` is never touched.

Background, rationale and Swedish UI wording live in the planning doc "min-tid – omtag inför produktion".
CLAUDE.md in the repo stays the source of truth for conventions (mobile layout invariant, modal pattern,
`pc-*` tokens, Swedish UI, local-date day keys).

---

## 0. Ground rules (apply to you and every sub-agent)

- **Never push to, merge into, rebase, or force-push `main`.** The only final step towards `main` is
  opening a PR that a human merges.
- All feature branches are created from the **current tip of `omtag/v1`** and merged back into it.
- Each PR owns the files listed for it. Touching another PR's files is only allowed for a one-line import
  or entry-point button. If a PR needs more, stop and note it in the report instead of doing it.
- **No version bumps** in PR 1–8. Each PR adds its own subsection under `## [Unreleased]` in CHANGELOG.md
  (Swedish, user-facing wording). PR 9 bumps to `1.0.0`.
- Each PR updates only *its own* section of CLAUDE.md.
- Definition of done for every PR: `npm ci && npm run lint && npm run build && npm test` all pass, the
  app starts with `npm run dev`, and no existing localStorage data is lost (load old state → migrate →
  save → reload works).
- Commit messages: conventional style, e.g. `feat(day-status): …`, with the attribution trailer your
  environment requires.
- UI copy is Swedish. Code, comments, commit messages and PR descriptions are English.
- Day keys are always LOCAL dates (`ymdLocal`). Never `toISOString().slice(0,10)` for a day key.

---

## 1. Setup

```bash
git fetch origin
git checkout main && git pull --ff-only
git checkout -b omtag/v1
mkdir -p docs && cp <this file> docs/OMTAG.md    # skip if already there
git add docs/OMTAG.md && git commit -m "docs: add OMTAG run plan"
git push -u origin omtag/v1
```

Check whether `gh` is authenticated (`gh auth status`). If yes, use PRs (section 3). If not, use the
local-merge fallback in section 3 and say so in the report.

Create a task list with one item per PR plus "Final verification" and "Report".

---

## 2. Waves

Run the waves in order. Inside a wave, start **one sub-agent per PR in parallel**, each with
`isolation: "worktree"`. Give each sub-agent: the PR section below verbatim, section 0, and the
instruction "Read CLAUDE.md and docs/OMTAG.md first. Branch from the current origin/omtag/v1."

| Wave | PRs (parallel) | Merge order into `omtag/v1` |
|---|---|---|
| 1 | PR 1, PR 2 | 1, then 2 |
| 2 | PR 3, PR 4 | 4, then 3 (PR 3 rebases onto 4's `getEffectiveDayConfig`) |
| 3 | PR 5, PR 6, PR 7, PR 8 | 5 first, then 6, 7, 8 — each rebased onto the new tip and its entry point moved into the *Mer* view |
| 4 | PR 9 | 9 |

Do not start a wave until every PR of the previous wave is merged and `omtag/v1` passes the full check.

### Models

The orchestrator (you) runs on **Claude Opus 5.5 at effort `high`** (the human starts the session that
way): planning, reviewing each sub-agent's diff against its spec, resolving merge conflicts and writing
the report. Opus is reserved for the PRs where a subtle mistake costs money or data.

| PR | Builder agent | Model | Effort | Why |
|---|---|---|---|---|
| 1 Core lib | `omtag-builder` | `claude-sonnet-5-5` | `medium` | Mechanical move, guarded by tests |
| 2 Encrypted sync | `omtag-critical` | `claude-opus-5-5` | `xhigh` | Security and data migration |
| 3 Day status | `omtag-critical` | `claude-opus-5-5` | `xhigh` | The calculation everything else trusts |
| 4 Rotation | `omtag-builder` | `claude-sonnet-5-5` | `high` | Date math, well-specified |
| 5 Navigation | `omtag-builder` | `claude-sonnet-5-5` | `high` | Large UI restructuring |
| 6 Excel | `omtag-builder` | `claude-sonnet-5-5` | `high` | Parsing + UI |
| 7 Vacation | `omtag-builder` | `claude-sonnet-5-5` | `medium` | Small, tested |
| 8 Travel time | `omtag-builder` | `claude-sonnet-5-5` | `high` | Rules with edge cases |
| 9 Demo & 1.0 | `omtag-builder` | `claude-sonnet-5-5` | `medium` | Seed data and docs |

**How to apply it.** During setup (section 1), create two agent definitions locally and keep them out of
git (`echo ".claude/agents/omtag-*" >> .git/info/exclude`):

```markdown
<!-- .claude/agents/omtag-builder.md -->
---
name: omtag-builder
description: Builds one PR from docs/OMTAG.md on its own branch and reports back.
model: claude-sonnet-5-5
effort: high
isolation: worktree
permissionMode: acceptEdits
---
You build exactly one PR from docs/OMTAG.md. Read CLAUDE.md and docs/OMTAG.md sections 0 and 3 first.
Stay inside the files your PR owns. Finish with the report described in section 3.
```

```markdown
<!-- .claude/agents/omtag-critical.md -->
---
name: omtag-critical
description: Builds a security- or calculation-critical PR from docs/OMTAG.md.
model: claude-opus-5-5
effort: xhigh
isolation: worktree
permissionMode: acceptEdits
---
(same body as omtag-builder, plus:) Write the tests before the implementation and list every edge case
you covered in your report.
```

Then start each builder with `subagent_type` set to the agent in the table, and pass the table's
`effort` per call (supported from Claude Code v2.1.292; on older versions the frontmatter value
applies). If `claude-sonnet-5-5` is not available in this account, fall back to the alias `sonnet` and
note it in the report. Do not set `CLAUDE_CODE_EFFORT_LEVEL` — it would override all of this.

Escalation: if an `omtag-builder` fails its checks after 3 fix rounds, retry that PR once with
`omtag-critical` from a fresh branch before applying the STOP rule. Before merging any PR, review its diff
yourself against the spec and the ownership table; send it back to its builder (SendMessage) with
concrete fixes rather than fixing large things yourself.

---

## 3. What a sub-agent does, and how you merge

**Sub-agent** (per PR):

1. `git fetch origin && git checkout -b <branch> origin/omtag/v1`
2. Implement the spec. Write tests first for anything in `src/lib/`.
3. Run the definition-of-done checks. Fix until green (max 3 fix rounds).
4. Push the branch. With `gh`: `gh pr create --base omtag/v1 --head <branch> --title "<PR title>" --body "<summary, test notes, screenshots if UI>"`.
5. Return to the orchestrator: branch name, PR URL, files changed, test count, anything left undone.

**Orchestrator** (per PR, in the merge order above):

1. `git fetch origin` and check the branch rebases cleanly onto `origin/omtag/v1`.
   - Conflict → resolve keeping both sides' intent (ownership table decides who wins), re-run the full
     check, push with `--force-with-lease` **to the feature branch only**.
2. Re-run `npm ci && npm run lint && npm run build && npm test` on the rebased branch.
3. Merge:
   - With `gh`: `gh pr merge <url> --squash --delete-branch`
   - Fallback: `git checkout omtag/v1 && git merge --squash <branch> && git commit && git push`
4. After the last PR of a wave: full check on `omtag/v1` tip. Tick the task list.

### STOP rules

- A PR still fails its checks after 3 fix rounds → leave its PR open, do **not** merge it, mark dependent
  PRs as blocked, continue with independent ones, and explain in the report.
- A change would delete or corrupt existing user data without a migration → stop that PR.
- Anything requiring a push to `main` → don't; put it in the report.

---

## 4. PR specs

### PR 1 — Core logic out of the screen · `omtag/01-core-lib` · wave 1

Goal: move all time/flex logic out of `src/components/PunchClock.tsx` into pure, tested modules with
**zero behaviour change**.

1. Create `src/lib/types.ts` (Session, AbsenceEntry, AbsenceCategory, Expense, ScheduleException,
   AppState), `src/lib/dates.ts` (ymdLocal, todayLocal, week helpers, isoWeekNumber),
   `src/lib/days.ts` (computeDayMinutes, getAbsencesForDate), `src/lib/flex.ts` (computeFlexMinutes,
   computeTodayContribution, computeTodayDelta, computeWeeklyFlexBreakdown). Move
   `getEffectiveDayConfig` into `src/lib/schedule.ts`.
2. Keep current semantics exactly, including the UTC `toISOString` day keys. Do not fix bugs here.
3. Add vitest (`npm test`). Tests in `src/lib/__tests__/` pin current behaviour, plus `it.fails` cases
   documenting known bugs: (a) scheduled past day with no session and no absence gives −norm flex;
   (b) full-day flex absence deducts 2× norm; (c) schedule lunch deducted even when the user punched out
   for lunch; (d) sessions between 00:00–02:00 local land on the previous day.
4. `PunchClock.tsx`: only delete moved code and add imports. No UI change.
5. CLAUDE.md: update "Flex bank" and "Schedule data model" to point at the new files.

### PR 2 — Encrypted sync · `omtag/02-e2e-sync` · wave 1

Goal: end-to-end encrypt synced state so the server only stores ciphertext. Own `src/lib/crypto.ts`
(new), `src/lib/sync.ts`, `server/index.js`, `src/components/SyncModal.tsx`.

1. `crypto.ts`, Web Crypto only: `deriveKeys(secret, saltB64)` → PBKDF2-SHA256, 600 000 iterations →
   HKDF into `{ authKey (bytes, base64 for transport), encKey (AES-GCM-256, non-extractable) }`.
   `encryptState(state, encKey)` → `{ v: 1, iv, ct }` with a fresh 12-byte IV; `decryptState`.
2. Server: register creates a random per-account salt and returns it; add
   `GET /api/auth/salt?username=`. Login/register receive `authKey` instead of the raw secret (bcrypt it
   as today). Once an account has `encrypted: true`, `PUT /api/sync` accepts only `{ v:1, iv, ct }`;
   `GET` returns the envelope untouched. Never log request bodies.
3. Migration for existing accounts: log in once with the legacy secret, derive keys, replace the auth
   hash via `PUT /api/auth/secret`, upload the encrypted envelope; server sets `encrypted: true` and
   deletes the plaintext state. Old clients must get a clear 409 telling them to update.
4. Recovery key: on enabling sync, generate a 24-char Crockford base32 recovery key that wraps `encKey`
   (AES-KW); store the wrapped key on the server. Show it once with "Skriv ut / kopiera" and a required
   checkbox. UI states plainly: SMS recovery restores the account; data is restored only with the
   recovery key.
5. SyncModal: green status row "Krypterad på enheten · AES-256" and a short explainer of what the server
   can and cannot see.
6. Tests: round-trip, wrong key → clear error, tampered `ct` → error.
7. CLAUDE.md: "Sync backend" section.

### PR 3 — Correct calculation, day status, reporting modes · `omtag/03-day-status` · wave 2

Own `src/lib/{days,flex,absence,confirm}.ts` and their tests. Minimal UI wiring in the flex card only.

1. `type ReportingMode = 'schedule' | 'punch'` in settings (default `'schedule'` for new users,
   `'punch'` for existing users who have sessions, so nobody's behaviour changes silently).
2. `type DayStatus = 'missing' | 'unconfirmed' | 'ongoing' | 'reported' | 'absent' | 'partial' | 'off'`.
   `evaluateDay(date, ctx) → { status, normMin, workedMin, breakMin, absence: { flexMin, excusedMin },
   travel: { inScheduleMin, outsideMin }, flexDelta, explanation: string[] }`. `explanation` is Swedish
   lines such as "Norm 8 h (08:00–17:00, lunch 1 h)", "Arbetat 7 h 40 min", "Flex −20 min".
3. Rules:
   - Schedule mode: a scheduled past day with no entries → `unconfirmed`, counted as worked per schedule
     (flexDelta 0). A day the user confirmed "Enligt schema" → `reported`, flexDelta 0. A day with an
     adjustment (`DayAdjustment { date, start?, end?, breakMin?, note? }`) → worked per the adjustment.
   - Punch mode: scheduled past day with no session and no absence → `missing`, flexDelta 0, listed in
     `missingDays`.
   - Full-day flex absence = −norm once. Flex absence in hours = −hours.
   - Absence on a non-scheduled day is ignored.
   - Break: if sessions/adjustment carry `breakMinutes`, use them; else deduct schedule lunch only when
     the day has exactly one session longer than `settings.autoLunchThresholdMin` (default 300); never
     when the user punched out over lunch.
   - All day keys local.
4. `flex.ts` becomes a fold over `evaluateDay`: `computeFlex(range) → { minutes, missingDays,
   unconfirmedDays }`.
5. `confirm.ts`: `confirmedDays: Record<date, true>`, `lockedMonths: Record<'YYYY-MM', { at, by }>`,
   `confirmMonth(month)` (marks every unconfirmed day reported and locks; in punch mode refuses while
   missing days exist), `unlockMonth(month)` with an audit log entry `{ at, action, month }`.
6. Turn PR 1's `it.fails` tests into passing tests. Add cases: schedule mode with forgotten days, half-day
   absences, weekend work, helgdag exception, multi-day absence over a weekend, locked month.
7. Flex card: "· N dagar saknas" (punch) or "· N ej bekräftade" (schedule) next to the balance.
8. Add optional `breakMinutes?: number` to Session; `load()` tolerates old data.
9. CLAUDE.md: rewrite "Flex bank" around `evaluateDay`.

### PR 4 — Rotating schedules and schedule periods · `omtag/04-schedule-rotation` · wave 2

Own `src/lib/schedule.ts`, `src/components/schedule/*`, `WeekScheduleEditor` in `Onboarding.tsx`.

1. Types: `ScheduleRotation = { weeks: WeekSchedule[] }` (1–8), `SchedulePeriod = { validFrom;
   anchorMonday; rotation }`. State gets `schedules: SchedulePeriod[]` sorted by `validFrom`. Migrate the
   old single `schedule` into one period (`validFrom` = trackingStartDate ?? '2000-01-01').
2. `getEffectiveDayConfig(date) = exceptions[date] ?? periodFor(date).rotation.weeks[mod(weeksBetween(
   anchorMonday, mondayOf(date)), n)][dayKey]`, positive modulo for dates before the anchor.
3. Editing asks "Gäller från" (default today) and appends a period instead of overwriting, so history
   keeps its old norm.
4. UI: rotation length 1–8 veckor, tabs "Vecka 1…N", line "Den här veckan är vecka 2 av 4",
   "Kopiera vecka 1 till alla", reporting-mode choice (Enligt schema / Stämpla). Keep 5-minute pickers
   and the mobile layout invariant.
5. Tests: alternating weeks, 4-week rotation, dates before anchor, period switch mid-week.
6. CLAUDE.md: "Schedule data model".

### PR 5 — New navigation + "Enligt schema" · `omtag/05-navigation` · wave 3 (merge first)

This PR owns `PunchClock.tsx` and may restructure it. No calculation changes.

1. Split into `src/views/Today.tsx`, `Calendar.tsx`, `Report.tsx`, `More.tsx`. `PunchClock.tsx` becomes
   the shell (state, persistence, sync, bottom nav: Idag / Kalender / Rapport / Mer).
2. Today, schedule mode: three big actions — "Enligt schema ✓", "Justera dag" (opens
   `AdjustDaySheet.tsx`: start, end, rast, note, and a slot `travelSlot` where PR 8 mounts its editor),
   "Frånvaro". Shows "Du kan gå kl. HH:MM" from the schedule. Punch mode: today's punch UI.
3. `AttendCard.tsx` "Att åtgärda": missing days (punch) or unconfirmed days (schedule), receipts to
   attach, long open sessions, and from the 25th the prompt "Bekräfta oktober" calling `confirmMonth`.
   Quick actions per day: "Enligt schema", "Justera", "Frånvaro".
4. Calendar: month grid by DayStatus (missing = red ring, unconfirmed = grey ring, locked month = lock
   icon). Tap a day → sheet with entries and `explanation` lines under "Så räknades dagen".
5. Report: period, totals, absences, travel time row (empty until PR 8), expenses, export (text share,
   CSV; Excel slot for PR 6).
6. More: schema & rapportläge, frånvaroregler, restidsregler slot, synk och säkerhet, import,
   automation, om appen. Move all existing entry points here.
7. Check at 375 px width. CLAUDE.md: Components table + navigation.

### PR 6 — Excel import and export · `omtag/06-excel` · wave 3

Own `src/lib/excel/*`, `src/components/ImportModal.tsx`, `vendor/xlsx-0.20.3.tgz`.

1. Vendor SheetJS 0.20.3 from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` into `vendor/`,
   depend on it via `file:`. Never the npm `xlsx` package (stuck at 0.18.5). Load with dynamic
   `import()` only inside import/export flows. If the CDN is unreachable from your sandbox, stop this PR
   and say so — do not substitute another library silently.
2. `buildTemplate()` matching `docs/min-tid-importmall.xlsx`: sheets Instruktioner, Pass (Datum, Start,
   Slut, Rast (min), Kommentar), Frånvaro (Från datum, Till datum, Typ, Timmar, Kommentar), Utlägg
   (Datum, Typ, Belopp (kr), Km, Kvitto, Kommentar), Saldon (Per datum, Flexsaldo (timmar),
   Semesterdagar kvar, Sparade semesterdagar), hidden Listor (with Mallversion 1). Add a **Restid** sheet
   (Datum, Från, Till, Resmål, Kommentar) — PR 8 consumes it.
3. `parseWorkbook(file) → { sessions, absences, expenses, travel, balances, errors: {sheet,row,message}[],
   duplicates }`. Accept Excel dates/times and text `2026-03-04` / `08:00`. Skip rows whose Kommentar is
   "EXEMPEL – skriv över eller radera". Dedupe on date+start. Times are Europe/Stockholm local.
4. ImportModal: download template, choose file, preview counts + errors with row numbers, "Importera"
   (snapshot first), "Ångra senaste import". Move trackingStartDate to the earliest imported date if
   earlier; Saldon overrides `flexBaseMinutes` as of "Per datum". Imported history is marked confirmed.
5. Excel export of a report period in the same layout.
6. Tests with a fixture workbook (errors, duplicates, example row skipped).

### PR 7 — Vacation balance · `omtag/07-vacation` · wave 3

Own `src/lib/vacation.ts`, `src/components/VacationCard.tsx`.
Settings: `vacationDaysPerYear` (25), `vacationYearStart` ('04-01'), `allowHalfDays` (false),
opening balance + saved days (from import). A semester absence consumes one day per **scheduled**
working day it covers — weekends, helgdagar and non-scheduled rotation days consume nothing; half days
only if `allowHalfDays`. Show "Semester: 17 av 25 dagar kvar" in Report and More. Warn when a planned
semester exceeds the balance. Tests with rotations and holidays.

### PR 8 — Travel time · `omtag/08-travel-time` · wave 3

Own `src/lib/travel.ts`, `src/components/TravelTimeEditor.tsx`, and in `ExpenseModal.tsx` only the
removal of the "Resetimmar" category.

1. `TravelEntry { id, date, from: 'HH:MM', to: 'HH:MM', destination?, note?, linkedExpenseId? }`.
2. Settings (`travelRules`), all user-editable in *Mer → Restidsregler*:
   - inside scheduled hours → counts as worked time (fixed),
   - outside scheduled hours → `'payroll'` (default) | `'flex'` | `'none'`,
   - `factor` (default 1.0), `maxPerDayMin` (default none), `excludeNight` 22–06 (default false).
3. `splitTravel(entry, dayConfig, rules) → { inScheduleMin, outsideMin, payrollMin, flexMin }`; wire
   into `evaluateDay` through the `travel` field PR 3 defined (only the call site, not the rules).
4. Mount `TravelTimeEditor` in `AdjustDaySheet`'s `travelSlot`; show a "Restid" row in Report and Excel
   export with payroll hours separately.
5. Migration: existing `resetimmar` expenses become TravelEntry with from/to unknown → stored as
   duration only (`durationMin`), flagged "importerad" in the UI. Nothing is lost.
6. Consume the Restid sheet from PR 6's parser if PR 6 is merged; otherwise leave a TODO in the report.
7. Tests: trip fully inside, fully outside, straddling the shift end, night exclusion, cap, factor 0.5.

### PR 9 — Demo and 1.0 · `omtag/09-release` · wave 4

1. Demo mode at `?demo=1`: separate key `punchclock_demo`, seeded with 8 weeks for "Anna Demo": schedule
   mode, a 2-week rotation, one semester week, one VAB day, two unconfirmed days, one travel day with
   time outside schedule, some expenses, one confirmed and locked month. Banner "Demoläge – inget
   sparas" with an exit button. Sync disabled in demo.
2. Review empty states and first-run copy (Swedish).
3. Bump to `1.0.0` in `package.json` and `server/package.json`; turn `[Unreleased]` into `[1.0.0]`;
   refresh README and CLAUDE.md to match reality (remove stale "no server" statements).

---

## 5. Final step

1. Full check on `omtag/v1`. Start `npm run dev`, open `?demo=1`, and walk the demo path: Idag → Enligt
   schema → Justera dag with restid → Kalender day explanation → Rapport → Excel export → Mer → Synk och
   säkerhet. Fix anything broken (small fixes only, on a branch `omtag/fixes`, merged like any PR).
2. Push `omtag/v1`.
3. With `gh`: open — **do not merge** — a PR `omtag/v1` → `main` titled "min-tid 1.0 — omtag". Body: what
   changed per PR, migration notes, and the open questions below.
4. Write `docs/OMTAG-RAPPORT.md` on `omtag/v1`: per PR — status (merged / open / blocked), PR link, tests
   added, deviations from spec, TODOs. Commit and push.
5. End with a short summary to the human: what is merged, what is blocked, and the link to the PR to
   `main`.

## Open questions to list in the report (do not guess beyond the defaults above)

- Which collective agreement applies (bankavtalet)? Decides travel-time defaults, half-day vacation and
  any flex cap.
- Should the future admin app read employees' data? It conflicts with end-to-end encryption.
- Recovery key vs. "restore only from another device" — default implemented: recovery key.
