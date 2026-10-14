// Travel time ("Restid"): pure rules, no UI.
//
// A trip is a TravelEntry (from/to wall-clock times, or a bare duration for entries
// migrated from the old "Resetimmar" expense). Against the day's effective schedule a
// trip splits into
//   - inScheduleMin: minutes inside the scheduled hours — worked time, fixed, no factor
//   - outsideMin:    minutes outside the scheduled hours that count as travel
//                    (after the optional night exclusion, before factor and cap)
//   - payrollMin / flexMin: what the outside minutes are worth under `rules`
//                    (after factor and cap, routed by `rules.outside`)
//
// Decisions (all covered by tests):
// - Times are WALL-CLOCK minutes. A DST day is not corrected: 01:30–03:30 on the spring
//   switch day counts as 120 min although 60 min elapsed. Travel is reported the way
//   it is written on the timesheet.
// - to < from means the trip crosses midnight (to is the next day); to == from is an
//   empty trip. The part after midnight is always "outside": the next day's
//   schedule is not known here (and the trip belongs to the day it started).
// - The scheduled window is [startTime, endTime) of the effective day config, lunch
//   included. A non-scheduled day (cfg.active false) has no window: all outside.
// - excludeNight removes outside minutes between 22:00 and 06:00 (they are neither
//   payroll nor flex). Inside-schedule minutes are never removed (night shifts keep
//   their travel as worked time).
// - factor multiplies the outside minutes only (inside is worked time, 1:1).
// - maxPerDayMin caps the CREDITED outside minutes of a whole day, i.e. AFTER factor:
//   "at most N minutes per day end up in payroll/flex". It is a per-day cap, so several
//   trips on one day share it (use splitTravelDay).
// - A duration-only entry has no times, so it cannot be placed against the schedule:
//   it counts entirely as outside (night exclusion cannot apply either).
// - 'none' keeps outsideMin for information but pays nothing and adds no flex.
// - Overlap with punched sessions is NOT removed here: if the clock kept running during
//   the trip, the inside minutes are also in the session. Consumers (evaluateDay) must
//   decide how to avoid counting that twice.
import type { DayConfig } from "./schedule";
import { isYmd } from "./dates";
import type { TravelMinutes } from "./days";
import type { ExpenseEntry, TravelEntry, TravelRules } from "./types";

export type { TravelEntry, TravelRules };

export type TravelSplit = {
  inScheduleMin: number;
  outsideMin: number;
  payrollMin: number;
  flexMin: number;
};

export const DEFAULT_TRAVEL_RULES: TravelRules = {
  outside: "payroll",
  factor: 1,
  excludeNight: false,
};

export const NIGHT_START_MIN = 22 * 60;
export const NIGHT_END_MIN = 6 * 60;
const DAY_MIN = 24 * 60;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const hmToMin = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

export function isTravelTime(v: unknown): v is string {
  return typeof v === "string" && HM_RE.test(v);
}

// ─── Rules ────────────────────────────────────────────────────
/** A stored/synced value as valid rules; anything missing or odd falls back to defaults. */
export function parseTravelRules(raw: unknown): TravelRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const outside =
    r.outside === "payroll" || r.outside === "flex" || r.outside === "none"
      ? r.outside
      : DEFAULT_TRAVEL_RULES.outside;
  const factor =
    typeof r.factor === "number" && Number.isFinite(r.factor) && r.factor >= 0
      ? Math.min(r.factor, 10)
      : DEFAULT_TRAVEL_RULES.factor;
  const out: TravelRules = { outside, factor, excludeNight: r.excludeNight === true };
  if (typeof r.maxPerDayMin === "number" && Number.isFinite(r.maxPerDayMin) && r.maxPerDayMin > 0) {
    out.maxPerDayMin = Math.round(r.maxPerDayMin);
  }
  return out;
}

// ─── Entries ──────────────────────────────────────────────────
function parseEntry(raw: unknown): TravelEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "string" || !e.id || !isYmd(e.date)) return null;
  const out: TravelEntry = { id: e.id, date: e.date };
  if (isTravelTime(e.from) && isTravelTime(e.to)) {
    out.from = e.from;
    out.to = e.to;
  }
  if (typeof e.durationMin === "number" && Number.isFinite(e.durationMin) && e.durationMin > 0) {
    out.durationMin = Math.round(e.durationMin);
  }
  // An entry that says nothing about its length is kept (the user can fix it in the UI).
  if (typeof e.destination === "string" && e.destination) out.destination = e.destination;
  if (typeof e.note === "string" && e.note) out.note = e.note;
  if (typeof e.linkedExpenseId === "string" && e.linkedExpenseId) {
    out.linkedExpenseId = e.linkedExpenseId;
  }
  if (e.imported === true) out.imported = true;
  return out;
}

export function parseTravel(raw: unknown): TravelEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: TravelEntry[] = [];
  for (const r of raw) {
    const e = parseEntry(r);
    if (e) out.push(e);
  }
  return out;
}

/** Wall-clock length of a trip in minutes (to < from = across midnight; to == from = 0). */
export function travelDurationMin(entry: TravelEntry): number {
  if (isTravelTime(entry.from) && isTravelTime(entry.to)) {
    return (hmToMin(entry.to) - hmToMin(entry.from) + DAY_MIN) % DAY_MIN;
  }
  const d = entry.durationMin;
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? Math.round(d) : 0;
}

/** True when the entry has no times (migrated "Resetimmar"): it cannot be placed in the schedule. */
export function isDurationOnly(entry: TravelEntry): boolean {
  return !(isTravelTime(entry.from) && isTravelTime(entry.to));
}

export function travelOn(travel: TravelEntry[], date: string): TravelEntry[] {
  return travel.filter((t) => t.date === date);
}

const isNightMin = (dayMin: number) => dayMin >= NIGHT_START_MIN || dayMin < NIGHT_END_MIN;

/** Raw split of one trip: minutes inside the schedule, outside it, and outside-at-night. */
function rawSplit(entry: TravelEntry, cfg: DayConfig, rules: TravelRules) {
  const total = travelDurationMin(entry);
  if (isDurationOnly(entry)) return { inside: 0, outside: total };
  const from = hmToMin(entry.from as string);
  const winStart = cfg.active ? hmToMin(cfg.startTime) : 0;
  const winEnd = cfg.active ? hmToMin(cfg.endTime) : 0;
  let inside = 0;
  let outside = 0;
  for (let m = from; m < from + total; m++) {
    // Only the first calendar day (m < 24 h) has a known schedule.
    if (m < DAY_MIN && m >= winStart && m < winEnd) inside++;
    else if (rules.excludeNight && isNightMin(m % DAY_MIN)) continue;
    else outside++;
  }
  return { inside, outside };
}

/**
 * Everything one local day's trips are worth. The per-day cap is applied to the
 * day's total, so several trips on one day share it.
 */
export function splitTravelDay(
  entries: TravelEntry[],
  dayConfig: DayConfig,
  rules: TravelRules,
): TravelSplit {
  let inside = 0;
  let outside = 0;
  for (const e of entries) {
    const r = rawSplit(e, dayConfig, rules);
    inside += r.inside;
    outside += r.outside;
  }
  let credited = 0;
  if (rules.outside !== "none") {
    credited = Math.round(outside * (Number.isFinite(rules.factor) ? rules.factor : 1));
    if (rules.maxPerDayMin !== undefined && rules.maxPerDayMin > 0) {
      credited = Math.min(credited, rules.maxPerDayMin);
    }
  }
  return {
    inScheduleMin: inside,
    outsideMin: outside,
    payrollMin: rules.outside === "payroll" ? credited : 0,
    flexMin: rules.outside === "flex" ? credited : 0,
  };
}

/** One trip against the day's effective config (`dayConfig` must be the config of `entry.date`). */
export function splitTravel(
  entry: TravelEntry,
  dayConfig: DayConfig,
  rules: TravelRules,
): TravelSplit {
  return splitTravelDay([entry], dayConfig, rules);
}

export type TravelDayMinutes = TravelMinutes & { payrollMin: number; flexMin: number };

/**
 * Builds the `travelFor` hook of evaluateDay's context. The result carries the two
 * numbers evaluateDay copies into `travel` plus payrollMin/flexMin for the consumers
 * that need them (the report, and the flex rule once days.ts reads them).
 */
export function makeTravelFor(
  travel: TravelEntry[] | undefined,
  rules: TravelRules | undefined,
): (date: string, cfg: DayConfig) => TravelDayMinutes | undefined {
  const byDate = new Map<string, TravelEntry[]>();
  for (const t of travel ?? []) {
    const list = byDate.get(t.date);
    if (list) list.push(t);
    else byDate.set(t.date, [t]);
  }
  const r = rules ?? DEFAULT_TRAVEL_RULES;
  return (date, cfg) => {
    const entries = byDate.get(date);
    if (!entries) return undefined;
    const s = splitTravelDay(entries, cfg, r);
    return {
      inScheduleMin: s.inScheduleMin,
      outsideMin: s.outsideMin,
      payrollMin: s.payrollMin,
      flexMin: s.flexMin,
    };
  };
}

/** Totals over a date range (inclusive), for the Report/Excel "Restid" row. */
export function travelTotals(
  travel: TravelEntry[],
  rules: TravelRules,
  cfgFor: (date: string) => DayConfig,
  range: { from: string; to: string },
): TravelSplit & { totalMin: number; days: number } {
  const byDate = new Map<string, TravelEntry[]>();
  for (const t of travel) {
    if (t.date < range.from || t.date > range.to) continue;
    const list = byDate.get(t.date);
    if (list) list.push(t);
    else byDate.set(t.date, [t]);
  }
  const sum = { inScheduleMin: 0, outsideMin: 0, payrollMin: 0, flexMin: 0, totalMin: 0, days: 0 };
  for (const [date, entries] of byDate) {
    const s = splitTravelDay(entries, cfgFor(date), rules);
    sum.inScheduleMin += s.inScheduleMin;
    sum.outsideMin += s.outsideMin;
    sum.payrollMin += s.payrollMin;
    sum.flexMin += s.flexMin;
    sum.totalMin += entries.reduce((a, e) => a + travelDurationMin(e), 0);
    sum.days += 1;
  }
  return sum;
}

// ─── Migration ────────────────────────────────────────────────
const MAX_PLAUSIBLE_HOURS = 24;

export type TravelState = {
  expenses: ExpenseEntry[];
  travel: TravelEntry[];
  travelRules: TravelRules;
  /** How many "resetimmar" expenses became travel entries in this call. */
  migrated: number;
  /** "resetimmar" expenses that could not be mapped and were left untouched. */
  kept: number;
};

/**
 * Loads `travel`/`travelRules` and moves old "Resetimmar" expenses into travel.
 * The old expense form had only a "Belopp (kr)" field, no hours, so the stored amount is
 * read as hours (that is what a user logging "resetimmar" typed). The new entry is
 * duration-only, flagged `imported`, keeps the note, and records the original amount in
 * its note so the user can check it. An expense whose amount is not a plausible
 * number of hours (missing, <= 0 or > 24) stays an expense — nothing is lost or guessed.
 *
 * Idempotent: the entry id derives from the expense id (`imp-<expenseId>`), so running it
 * again, or on two synced devices, never duplicates.
 */
export function migrateTravelState(raw: {
  expenses?: unknown;
  travel?: unknown;
  travelRules?: unknown;
}): TravelState {
  const travel = parseTravel(raw.travel);
  const have = new Set(travel.map((t) => t.id));
  const expenses: ExpenseEntry[] = [];
  let migrated = 0;
  let kept = 0;
  for (const x of Array.isArray(raw.expenses) ? (raw.expenses as ExpenseEntry[]) : []) {
    if (!x || x.category !== "resetimmar") {
      expenses.push(x);
      continue;
    }
    const hours = x.amount;
    const ok =
      typeof hours === "number" &&
      Number.isFinite(hours) &&
      hours > 0 &&
      hours <= MAX_PLAUSIBLE_HOURS &&
      isYmd(x.date) &&
      typeof x.id === "string";
    if (!ok) {
      expenses.push(x);
      kept++;
      continue;
    }
    const id = `imp-${x.id}`;
    if (!have.has(id)) {
      have.add(id);
      const parts = [
        x.note?.trim(),
        `Importerad Resetimmar (${hours} i beloppsfältet${x.hasReceipt ? ", kvitto fanns" : ""})`,
      ].filter(Boolean);
      travel.push({
        id,
        date: x.date,
        durationMin: Math.round(hours * 60),
        note: parts.join(" · "),
        imported: true,
      });
    }
    migrated++;
  }
  return { expenses, travel, travelRules: parseTravelRules(raw.travelRules), migrated, kept };
}

/** Dirty-device sync merge: travel is a union by id (local wins), rules are a local scalar. */
export function mergeTravelState(
  server: { travel?: unknown; travelRules?: unknown },
  local: { travel?: unknown; travelRules?: unknown },
): { travel: TravelEntry[]; travelRules: TravelRules } {
  const byId = new Map<string, TravelEntry>();
  for (const e of parseTravel(server.travel)) byId.set(e.id, e);
  for (const e of parseTravel(local.travel)) byId.set(e.id, e);
  return {
    travel: [...byId.values()],
    travelRules: parseTravelRules(local.travelRules ?? server.travelRules),
  };
}
