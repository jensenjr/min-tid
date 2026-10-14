// From a parsed workbook to what the app would do with it — and then to a state patch.
//
// buildImportPlan(parsed, state) is the preview: it drops rows that cannot be imported
// (a locked month, a future session), finds duplicates of what the app already holds and
// works out the new trackingStartDate / confirmed days / balances. applyImportPlan turns
// the plan into a patch of AppState fields. Both are pure.
//
// Rules
// - Locked months: a row in a locked month is a row error (never confirm or add there).
// - Sessions must not be in the future; absences may be (planned leave).
// - Imported history is marked confirmed: every day of an imported session / absence up
//   to today goes into confirmedDays (confirmDay from confirm.ts, so locked days refuse).
// - trackingStartDate moves to the earliest imported day (sessions, absences, travel) when
//   that is earlier. With a flex balance it also reaches back to the day after "Per datum":
//   the balance is at the END of that day and flex accrues from the next one.
// - Saldon: flexBaseMinutes = hours × 60 and flexBaseDate = Per datum (computeFlex only
//   accrues after it). Vacation columns land in vacation.opening.
import { addDaysStr } from "../schedule";
import { hmLocal, todayLocal, ymdLocal } from "../dates";
import { confirmDay, isDayLocked } from "../confirm";
import type { AbsenceEntry, AppState, ExpenseEntry, Session, VacationSettings } from "../types";
import type { ParsedBalances, ParsedWorkbook, RowIssue, TravelImport } from "./parse";
import { SHEETS } from "./lists";

/** The slice of AppState an import reads. Travel is PR 8's; see ImportPlan.travel. */
export type ImportableState = Pick<
  AppState,
  | "sessions"
  | "absences"
  | "expenses"
  | "confirmedDays"
  | "lockedMonths"
  | "trackingStartDate"
  | "flexBaseMinutes"
  | "flexBaseDate"
  | "vacation"
>;

/** The fields an import changes. Every key is present (undefined = clear it). */
export type ImportPatch = {
  sessions: Session[];
  absences: AbsenceEntry[];
  expenses: ExpenseEntry[];
  confirmedDays: Record<string, true>;
  trackingStartDate: string | undefined;
  flexBaseMinutes: number;
  flexBaseDate: string | undefined;
  vacation: VacationSettings | undefined;
  // Hook for PR 8: add `travel: TravelEntry[] | undefined` here (and in the snapshot) when
  // travel state exists, and map plan.travel to TravelEntry in applyImportPlan.
};

/** Defaults for a state that has no vacation settings yet (PR 7 owns the real ones). */
export const DEFAULT_VACATION: VacationSettings = {
  daysPerYear: 25,
  yearStart: "04-01",
  allowHalfDays: false,
};

export type ImportPlan = {
  sessions: Session[];
  absences: AbsenceEntry[];
  expenses: ExpenseEntry[];
  /** Parsed Restid rows. Not stored yet: the app has no travel state until PR 8. */
  travel: TravelImport[];
  balances: ParsedBalances | null;
  errors: RowIssue[];
  duplicates: RowIssue[];
  skippedExamples: number;
  /** Earliest day among imported sessions, absences and travel. */
  earliestDate?: string;
  /** The trackingStartDate after the import (undefined = unchanged and unset). */
  trackingStartDate?: string;
  /** Days that will be marked confirmed. */
  confirmedDays: string[];
  /** Imported sessions/absences on or before "Per datum": kept, but not counted in flex. */
  beforeBalance: number;
  /** Nothing in the file would change anything. */
  empty: boolean;
};

const sessionKey = (s: Session) => `${ymdLocal(new Date(s.checkIn))}|${hmLocal(s.checkIn)}`;
const absenceKey = (a: AbsenceEntry) =>
  `${a.category}|${a.startDate}|${a.endDate}|${a.hours ?? ""}`;
const expenseKey = (e: ExpenseEntry) =>
  `${e.date}|${e.category}|${e.amount ?? ""}|${e.km ?? ""}|${e.note ?? ""}`;

function* daysOf(from: string, to: string): Generator<string> {
  for (let d = from; d <= to; d = addDaysStr(d, 1)) yield d;
}

export function buildImportPlan(
  parsed: ParsedWorkbook,
  state: ImportableState,
  today: string = todayLocal(),
): ImportPlan {
  const errors: RowIssue[] = [...parsed.errors];
  const duplicates: RowIssue[] = [...parsed.duplicates];
  const locks = { lockedMonths: state.lockedMonths };

  // Sessions
  const haveSessions = new Set(state.sessions.map(sessionKey));
  const sessions: Session[] = [];
  parsed.sessions.forEach((s, i) => {
    const row = parsed.rows.sessions[i];
    const date = ymdLocal(new Date(s.checkIn));
    if (isDayLocked(date, locks)) {
      errors.push({ sheet: SHEETS.sessions, row, message: `Månaden ${date.slice(0, 7)} är låst` });
    } else if (date > today) {
      errors.push({
        sheet: SHEETS.sessions,
        row,
        message: `${date} ligger i framtiden – bara historik kan importeras`,
      });
    } else if (haveSessions.has(sessionKey(s))) {
      duplicates.push({
        sheet: SHEETS.sessions,
        row,
        message: "Finns redan i appen (samma datum och start)",
      });
    } else {
      sessions.push(s);
    }
  });

  // Absences
  const haveAbsences = new Set(state.absences.map(absenceKey));
  const absences: AbsenceEntry[] = [];
  parsed.absences.forEach((a, i) => {
    const row = parsed.rows.absences[i];
    let lockedMonth: string | undefined;
    for (const d of daysOf(a.startDate, a.endDate)) {
      if (isDayLocked(d, locks)) {
        lockedMonth = d.slice(0, 7);
        break;
      }
    }
    if (lockedMonth) {
      errors.push({
        sheet: SHEETS.absences,
        row,
        message: `Perioden går in i den låsta månaden ${lockedMonth}`,
      });
    } else if (haveAbsences.has(absenceKey(a))) {
      duplicates.push({ sheet: SHEETS.absences, row, message: "Finns redan i appen" });
    } else {
      absences.push(a);
    }
  });

  // Expenses
  const haveExpenses = new Set(state.expenses.map(expenseKey));
  const expenses: ExpenseEntry[] = [];
  parsed.expenses.forEach((e, i) => {
    const row = parsed.rows.expenses[i];
    if (isDayLocked(e.date, locks)) {
      errors.push({
        sheet: SHEETS.expenses,
        row,
        message: `Månaden ${e.date.slice(0, 7)} är låst`,
      });
    } else if (haveExpenses.has(expenseKey(e))) {
      duplicates.push({ sheet: SHEETS.expenses, row, message: "Finns redan i appen" });
    } else {
      expenses.push(e);
    }
  });

  // Travel (preview only)
  const travel: TravelImport[] = [];
  parsed.travel.forEach((t, i) => {
    const row = parsed.rows.travel[i];
    if (isDayLocked(t.date, locks)) {
      errors.push({
        sheet: SHEETS.travel,
        row,
        message: `Månaden ${t.date.slice(0, 7)} är låst`,
      });
    } else {
      travel.push(t);
    }
  });

  errors.sort(
    (a, b) =>
      (a.row === 0 ? -1 : 0) - (b.row === 0 ? -1 : 0) ||
      a.sheet.localeCompare(b.sheet, "sv") ||
      a.row - b.row,
  );

  // Earliest imported day → trackingStartDate
  const dates: string[] = [
    ...sessions.map((s) => ymdLocal(new Date(s.checkIn))),
    ...absences.map((a) => a.startDate),
    ...travel.map((t) => t.date),
  ];
  const earliestDate = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : undefined;
  const balances = parsed.balances;
  let tracking = state.trackingStartDate;
  const candidates = [earliestDate];
  if (balances?.flexMinutes !== undefined) candidates.push(addDaysStr(balances.asOf, 1));
  for (const c of candidates) if (c && (!tracking || c < tracking)) tracking = c;

  // Imported history is confirmed (up to today; never a locked day).
  const confirmed = new Set<string>();
  const markConfirmed = (d: string) => {
    if (d > today) return;
    const r = confirmDay(d, { confirmedDays: {}, lockedMonths: state.lockedMonths });
    if (r.ok) confirmed.add(d);
  };
  for (const s of sessions) markConfirmed(ymdLocal(new Date(s.checkIn)));
  for (const a of absences) {
    for (const d of daysOf(a.startDate, a.endDate)) markConfirmed(d);
  }

  const asOf = balances?.asOf;
  const beforeBalance =
    balances?.flexMinutes !== undefined && asOf
      ? sessions.filter((s) => ymdLocal(new Date(s.checkIn)) <= asOf).length +
        absences.filter((a) => a.startDate <= asOf).length
      : 0;

  const empty =
    sessions.length + absences.length + expenses.length + travel.length === 0 && !balances;

  return {
    sessions,
    absences,
    expenses,
    travel,
    balances,
    errors,
    duplicates,
    skippedExamples: parsed.skippedExamples,
    earliestDate,
    trackingStartDate: tracking,
    confirmedDays: [...confirmed].sort(),
    beforeBalance,
    empty,
  };
}

/** The patch to apply (and, built from the old state, the snapshot to undo it with). */
export function snapshotOf(state: ImportableState): ImportPatch {
  return {
    sessions: state.sessions,
    absences: state.absences,
    expenses: state.expenses,
    confirmedDays: state.confirmedDays ?? {},
    trackingStartDate: state.trackingStartDate,
    flexBaseMinutes: state.flexBaseMinutes,
    flexBaseDate: state.flexBaseDate,
    vacation: state.vacation,
  };
}

export function applyImportPlan(plan: ImportPlan, state: ImportableState): ImportPatch {
  const confirmedDays: Record<string, true> = { ...(state.confirmedDays ?? {}) };
  for (const d of plan.confirmedDays) confirmedDays[d] = true;

  const patch = snapshotOf(state);
  patch.sessions = [...state.sessions, ...plan.sessions].sort((a, b) => a.checkIn - b.checkIn);
  patch.absences = [...state.absences, ...plan.absences];
  patch.expenses = [...state.expenses, ...plan.expenses];
  patch.confirmedDays = confirmedDays;
  patch.trackingStartDate = plan.trackingStartDate ?? state.trackingStartDate;

  const b = plan.balances;
  if (b) {
    if (b.flexMinutes !== undefined) {
      patch.flexBaseMinutes = b.flexMinutes;
      patch.flexBaseDate = b.asOf;
    }
    if (b.vacationDaysLeft !== undefined || b.savedVacationDays !== undefined) {
      const prev = state.vacation?.opening;
      patch.vacation = {
        ...(state.vacation ?? DEFAULT_VACATION),
        opening: {
          asOf: b.asOf,
          daysLeft: b.vacationDaysLeft ?? prev?.daysLeft ?? 0,
          savedDays: b.savedVacationDays ?? prev?.savedDays ?? 0,
        },
      };
    }
  }
  return patch;
}
