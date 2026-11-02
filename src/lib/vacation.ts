// Vacation ("semester") balance. Pure — no React, no clock (callers pass dates).
//
// Consumption: a semester absence consumes one day per SCHEDULED working day it covers.
// A day is scheduled when getEffectiveDayConfig (rotation- and exception-aware) is
// active with a net norm > 0. Weekends, rotation days off and days with a "helgdag"
// absence consume nothing.
//
// Half days: a semester absence with `hours` below the day's norm is a partial day.
//   - allowHalfDays off: it still consumes a whole day (the UI says so).
//   - allowHalfDays on: the share taken is rounded to the nearest half day, at least
//     0.5 (4 h of 8 -> 0.5, 6 h of 8 -> 1, 1 h of 8 -> 0.5). hours <= 0 consumes 0.
//   Several semester entries on one day add up (capped at the norm) before rounding.
//
// Balance model: the vacation year runs from `yearStart` (MM-DD) to the day before the
// next one, e.g. 2026-04-01 .. 2027-03-31.
//   - Without `opening`: available = daysPerYear minus everything consumed in the year.
//   - With `opening` whose asOf lies in the year: available = opening.daysLeft minus what
//     is consumed AFTER asOf (the opening balance already includes everything up to and
//     including asOf). savedDays are shown separately and never mixed into `left`.
//   - An opening from an earlier year is ignored: the new year grants daysPerYear.
//   Planned (future-dated) semester counts as consumed; "planned" is the part after today.
import { addDaysStr, getEffectiveDayConfig, netDayMin, type ScheduleSource } from "./schedule";
import type { AbsenceEntry, ScheduleException, VacationSettings } from "./types";

export const DEFAULT_VACATION: VacationSettings = {
  daysPerYear: 25,
  yearStart: "04-01",
  allowHalfDays: false,
};

/** The slice of AppState the balance needs. */
export type VacationState = {
  absences: AbsenceEntry[];
  schedules: ScheduleSource;
  scheduleExceptions?: Record<string, ScheduleException>;
  vacation?: VacationSettings;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function validMonthDay(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{2}-\d{2}$/.test(s)) return false;
  const m = Number(s.slice(0, 2));
  const d = Number(s.slice(3));
  return m >= 1 && m <= 12 && d >= 1 && d <= DAYS_IN_MONTH[m - 1];
}

/** Sanitise stored/synced vacation settings; undefined when absent or not an object. */
export function parseVacation(raw: unknown): VacationSettings | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const daysPerYear =
    typeof r.daysPerYear === "number" && Number.isFinite(r.daysPerYear) && r.daysPerYear >= 0
      ? r.daysPerYear
      : DEFAULT_VACATION.daysPerYear;
  const out: VacationSettings = {
    daysPerYear,
    yearStart: validMonthDay(r.yearStart) ? r.yearStart : DEFAULT_VACATION.yearStart,
    allowHalfDays: r.allowHalfDays === true,
  };
  const o = r.opening as Record<string, unknown> | undefined;
  if (
    o &&
    typeof o === "object" &&
    typeof o.asOf === "string" &&
    DATE_RE.test(o.asOf) &&
    typeof o.daysLeft === "number" &&
    Number.isFinite(o.daysLeft)
  ) {
    out.opening = {
      asOf: o.asOf,
      daysLeft: o.daysLeft,
      savedDays: typeof o.savedDays === "number" && Number.isFinite(o.savedDays) ? o.savedDays : 0,
    };
  }
  return out;
}

export function resolveVacation(v?: VacationSettings): VacationSettings {
  return parseVacation(v) ?? DEFAULT_VACATION;
}

/** Vacation year containing `date`: inclusive start and end, YYYY-MM-DD. */
export function vacationYearOf(date: string, yearStart: string): { start: string; end: string } {
  const ys = validMonthDay(yearStart) ? yearStart : DEFAULT_VACATION.yearStart;
  const y = Number(date.slice(0, 4));
  const startYear = date >= `${y}-${ys}` ? y : y - 1;
  return {
    start: `${startYear}-${ys}`,
    end: addDaysStr(`${startYear + 1}-${ys}`, -1),
  };
}

function semesterMinutesOn(absences: AbsenceEntry[], date: string, norm: number): number {
  let min = 0;
  for (const a of absences) {
    if (a.category !== "semester" || a.startDate > date || a.endDate < date) continue;
    min +=
      typeof a.hours === "number" && Number.isFinite(a.hours)
        ? Math.max(0, Math.round(a.hours * 60))
        : norm;
  }
  return Math.min(min, norm);
}

/** Days of semester consumed on one date: 0, 0.5 or 1. */
export function vacationDaysOn(date: string, state: VacationState): number {
  const cfg = getEffectiveDayConfig(date, state.schedules, state.scheduleExceptions ?? {});
  const norm = cfg.active ? netDayMin(cfg) : 0;
  if (norm <= 0) return 0;
  const isHoliday = state.absences.some(
    (a) => a.category === "helgdag" && a.startDate <= date && a.endDate >= date,
  );
  if (isHoliday) return 0;
  const min = semesterMinutesOn(state.absences, date, norm);
  if (min <= 0) return 0;
  if (min >= norm) return 1;
  if (!resolveVacation(state.vacation).allowHalfDays) return 1;
  return Math.max(0.5, Math.round((min / norm) * 2) / 2);
}

/** Semester days consumed in [from, to] (inclusive). */
export function vacationDaysBetween(from: string, to: string, state: VacationState): number {
  if (from > to) return 0;
  const dates = new Set<string>();
  for (const a of state.absences) {
    if (a.category !== "semester" || a.endDate < from || a.startDate > to) continue;
    let d = a.startDate < from ? from : a.startDate;
    const last = a.endDate > to ? to : a.endDate;
    while (d <= last) {
      dates.add(d);
      d = addDaysStr(d, 1);
    }
  }
  let sum = 0;
  for (const d of dates) sum += vacationDaysOn(d, state);
  return sum;
}

export type VacationBalance = {
  yearStart: string;
  yearEnd: string;
  total: number; // daysPerYear
  consumed: number; // counted against the balance (used + planned)
  used: number; // dated today or earlier
  planned: number; // dated after today
  left: number; // available - consumed; negative = over-booked
  saved: number; // sparade dagar (only known from an opening balance)
  fromOpening: boolean;
};

/** Balance for the vacation year containing `today`. */
export function vacationBalance(state: VacationState, today: string): VacationBalance {
  const v = resolveVacation(state.vacation);
  const { start, end } = vacationYearOf(today, v.yearStart);
  const opening = v.opening && v.opening.asOf >= start && v.opening.asOf <= end ? v.opening : null;
  const countFrom = opening ? addDaysStr(opening.asOf, 1) : start;
  const available = opening ? opening.daysLeft : v.daysPerYear;
  const tomorrow = addDaysStr(today, 1);
  const used = vacationDaysBetween(countFrom, today < end ? today : end, state);
  const planned = vacationDaysBetween(tomorrow > countFrom ? tomorrow : countFrom, end, state);
  return {
    yearStart: start,
    yearEnd: end,
    total: v.daysPerYear,
    consumed: used + planned,
    used,
    planned,
    left: available - used - planned,
    saved: opening ? opening.savedDays : 0,
    fromOpening: !!opening,
  };
}

/** 17 -> "17", 16.5 -> "16,5". */
export function fmtDays(n: number): string {
  const r = Math.round(n * 2) / 2;
  return Number.isInteger(r) ? String(r) : String(r).replace(".", ",");
}

function daysWord(n: number): string {
  return n === 1 ? "dag" : "dagar";
}

/** "Semester: 17 av 25 dagar kvar" (+ " + 3 sparade"). */
export function vacationLine(b: VacationBalance): string {
  let s = `Semester: ${fmtDays(b.left)} av ${fmtDays(b.total)} ${daysWord(b.total)} kvar`;
  if (b.saved > 0) s += ` + ${fmtDays(b.saved)} sparade`;
  return s;
}

/** Warning for the balance already on the books (planned semester over budget). */
export function balanceWarning(b: VacationBalance): string | null {
  if (b.left >= 0) return null;
  const over = -b.left;
  return `Planerad semester överskrider saldot med ${fmtDays(over)} ${daysWord(over)}.`;
}

/**
 * Warning for saving `newAbsence` (null when fine). Checks every vacation year the
 * absence touches and only warns when the new entry itself pushes the balance below zero.
 * An existing entry with the same id is replaced (editing).
 */
export function vacationWarning(state: VacationState, newAbsence: AbsenceEntry): string | null {
  if (newAbsence.category !== "semester") return null;
  const v = resolveVacation(state.vacation);
  const others = state.absences.filter((a) => a.id !== newAbsence.id);
  const without: VacationState = { ...state, absences: others };
  const withNew: VacationState = { ...state, absences: [...others, newAbsence] };
  let date = newAbsence.startDate;
  while (date <= newAbsence.endDate) {
    const a = vacationBalance(withNew, date);
    const b = vacationBalance(without, date);
    const added = a.consumed - b.consumed;
    if (a.left < 0 && added > 0) {
      const over = Math.min(-a.left, added);
      return `Semestern (${fmtDays(added)} ${daysWord(added)}) överskrider saldot med ${fmtDays(over)} ${daysWord(over)}.`;
    }
    date = addDaysStr(vacationYearOf(date, v.yearStart).end, 1);
  }
  return null;
}
