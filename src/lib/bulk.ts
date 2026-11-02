// "Välj dagar" in the calendar: set one status on many days at once. Pure: returns the
// new absences and confirmed days; the caller (PunchClock) stores them.
//
// Setting a status replaces what the day had: its absences are cut out (a longer
// period is split around it) and its "Enligt schema" confirmation is removed, then the
// new status is written. Sessions and "Justera dag" adjustments are never touched.
//
// - "ok"      → "Enligt schema" on scheduled days up to today.
// - absence   → one full-day entry per run of selected days. Days off between two
//               selected days do not break the run, so Mon–Fri + Mon–Fri is one
//               period. Future days are allowed (planned semester).
// - "clear"   → only removes absences and confirmations.
//
// Locked days are never changed (they are listed in `skipped.locked`).
import { isDayLocked } from "./confirm";
import { isYmd } from "./dates";
import { addDaysStr, getEffectiveDayConfig, netDayMin, type ScheduleSource } from "./schedule";
import type { AbsenceCategory, AbsenceEntry, LockedMonth, ScheduleException } from "./types";

export type BulkStatus =
  | { kind: "ok" }
  | { kind: "absence"; category: AbsenceCategory }
  | { kind: "clear" };

export type BulkState = {
  absences: AbsenceEntry[];
  confirmedDays: Record<string, true>;
  lockedMonths?: Record<string, LockedMonth>;
  schedule: ScheduleSource;
  exceptions?: Record<string, ScheduleException>;
  today: string;
};

export type BulkResult = {
  absences: AbsenceEntry[];
  confirmedDays: Record<string, true>;
  /** Days that now have the status (or were cleared), sorted. */
  changed: string[];
  skipped: {
    locked: string[];
    /** "ok" only: days after today. */
    future: string[];
    /** Not a scheduled day: nothing to confirm, an absence would not count there. */
    off: string[];
  };
};

/** Safety cap when walking an absence period day by day (~10 years). */
const MAX_SPAN_DAYS = 3700;

function isScheduled(date: string, s: Pick<BulkState, "schedule" | "exceptions">): boolean {
  const cfg = getEffectiveDayConfig(date, s.schedule, s.exceptions ?? {});
  return cfg.active && netDayMin(cfg) > 0;
}

/**
 * Cut `days` out of every absence. A period that loses days in the middle is split; the
 * first remaining piece keeps the entry's id, later pieces get `newId()`. Pieces left
 * with no scheduled day (a lone weekend) are dropped, they would count nothing.
 */
export function removeDaysFromAbsences(
  absences: AbsenceEntry[],
  days: ReadonlySet<string>,
  s: Pick<BulkState, "schedule" | "exceptions">,
  newId: () => string,
): AbsenceEntry[] {
  const out: AbsenceEntry[] = [];
  for (const a of absences) {
    let hit = false;
    for (const d of days) {
      if (d >= a.startDate && d <= a.endDate) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      out.push(a);
      continue;
    }
    const pieces: { start: string; end: string; scheduled: boolean }[] = [];
    let cur: { start: string; end: string; scheduled: boolean } | null = null;
    for (
      let d = a.startDate, n = 0;
      d <= a.endDate && n < MAX_SPAN_DAYS;
      d = addDaysStr(d, 1), n++
    ) {
      if (days.has(d)) {
        cur = null;
        continue;
      }
      if (!cur) {
        cur = { start: d, end: d, scheduled: false };
        pieces.push(cur);
      }
      cur.end = d;
      if (!cur.scheduled && isScheduled(d, s)) cur.scheduled = true;
    }
    let first = true;
    for (const p of pieces) {
      if (!p.scheduled) continue;
      out.push({ ...a, id: first ? a.id : newId(), startDate: p.start, endDate: p.end });
      first = false;
    }
  }
  return out;
}

/**
 * Group sorted scheduled days into periods. Two days belong to the same period when
 * every day between them is unscheduled and not locked (a weekend, a rotation day off).
 */
export function groupIntoPeriods(
  days: string[],
  s: Pick<BulkState, "schedule" | "exceptions" | "lockedMonths">,
): { start: string; end: string }[] {
  const sorted = [...days].sort();
  const periods: { start: string; end: string }[] = [];
  for (const d of sorted) {
    const last = periods[periods.length - 1];
    if (last && bridgeable(last.end, d, s)) last.end = d;
    else periods.push({ start: d, end: d });
  }
  return periods;
}

function bridgeable(
  from: string,
  to: string,
  s: Pick<BulkState, "schedule" | "exceptions" | "lockedMonths">,
): boolean {
  for (let d = addDaysStr(from, 1), n = 0; d < to; d = addDaysStr(d, 1), n++) {
    if (n > 31 || isScheduled(d, s) || isDayLocked(d, s)) return false;
  }
  return true;
}

export function applyBulkStatus(
  days: string[],
  status: BulkStatus,
  state: BulkState,
  newId: () => string = () => crypto.randomUUID(),
): BulkResult {
  const unique = [...new Set(days.filter(isYmd))].sort();
  const skipped: BulkResult["skipped"] = { locked: [], future: [], off: [] };
  const targets: string[] = [];
  for (const d of unique) {
    if (isDayLocked(d, state)) skipped.locked.push(d);
    else if (status.kind === "clear") targets.push(d);
    else if (status.kind === "ok" && d > state.today) skipped.future.push(d);
    else if (!isScheduled(d, state)) skipped.off.push(d);
    else targets.push(d);
  }

  const set = new Set(targets);
  let absences = removeDaysFromAbsences(state.absences, set, state, newId);
  const confirmedDays = { ...state.confirmedDays };
  for (const d of targets) delete confirmedDays[d];

  if (status.kind === "ok") {
    for (const d of targets) confirmedDays[d] = true;
  } else if (status.kind === "absence") {
    absences = [
      ...absences,
      ...groupIntoPeriods(targets, state).map(
        (p): AbsenceEntry => ({
          id: newId(),
          category: status.category,
          startDate: p.start,
          endDate: p.end,
          manual: true,
        }),
      ),
    ];
  }

  return { absences, confirmedDays, changed: targets, skipped };
}
