// Shared data types for the time/flex logic. Pure type module — no runtime code.
import type { WeekSchedule, SchedulePeriod } from "./schedule";
import type { ActionSource } from "./actions";
import type { AbsenceEntry } from "../components/AbsenceModal";
import type { ExpenseEntry } from "../components/ExpenseModal";

// Absence/expense types are still declared next to their modals; re-exported here so
// the pure lib modules import everything from one place (type-only, erased at build).
export type { AbsenceCategory, AbsenceEntry } from "../components/AbsenceModal";
export type {
  ExpenseCategory,
  ExpenseEntry,
  ExpenseEntry as Expense,
} from "../components/ExpenseModal";

export type Session = {
  id: string;
  checkIn: number;
  checkOut: number | null;
  manual: boolean;
  note?: string;
  source?: ActionSource; // set when the punch came from a QR/NFC/WiFi/shortcut trigger
  breakMinutes?: number; // registered break; when set (on any session of a day) it replaces the auto lunch
};

// An override for a single calendar date — used when the effective work schedule
// differs from the recurring WeekSchedule (company-wide shortened days, etc.).
// Keyed by YYYY-MM-DD. For public holidays (user didn't work), use the "helgdag"
// absence category instead — that excuses the day via the norm calculation.
export type ScheduleException = {
  type: "override";
  endTime: string; // shortened/changed end time, e.g. "13:00"
  lunchMinutes?: number; // optional: 0 if no lunch on a short day
  note?: string;
};

// How a day gets its hours: "schedule" = the schedule is the report (Enligt schema),
// "punch" = the user clocks in/out (Stämpla). Undefined = not chosen yet.
export type ReportingMode = "schedule" | "punch";

// "Justera dag": what the user says the day was. Missing start/end fall back to the
// schedule; a missing breakMin follows the auto-lunch rule (see evaluateDay).
export type DayAdjustment = {
  date: string; // YYYY-MM-DD (local)
  start?: string; // "HH:MM"
  end?: string; // "HH:MM"
  breakMin?: number;
  note?: string;
};

// A confirmed ("attesterad") month. Locked days cannot be edited (isDayLocked) and an
// unregistered day in a locked month reads as reported per schedule.
export type LockedMonth = { at: number; by: string };

export type AuditAction = "confirm" | "unlock";
export type AuditEntry = { at: number; action: AuditAction; month: string }; // month: YYYY-MM

export type TravelEntry = {
  id: string;
  date: string;
  from?: string;
  to?: string;
  durationMin?: number;
  destination?: string;
  note?: string;
  linkedExpenseId?: string;
  imported?: boolean;
};
export type TravelRules = {
  outside: "payroll" | "flex" | "none";
  factor: number;
  maxPerDayMin?: number;
  excludeNight: boolean;
};
export type VacationSettings = {
  daysPerYear: number;
  yearStart: string;
  allowHalfDays: boolean;
  opening?: { asOf: string; daysLeft: number; savedDays: number };
};

// Shape persisted in localStorage under `punchclock_v2`.
export type AppState = {
  name: string;
  schedule: WeekSchedule; // legacy: week 1 of the period valid today (kept for rollback to older builds)
  schedules: SchedulePeriod[]; // schedule periods sorted by validFrom — the source of truth
  reportingMode?: ReportingMode;
  department?: string;
  onboardingDone: boolean;
  sessions: Session[];
  absences: AbsenceEntry[];
  expenses: ExpenseEntry[];
  flexBaseMinutes: number;
  trackingStartDate?: string; // YYYY-MM-DD — flex accrues from this day forward
  scheduleExceptions: Record<string, ScheduleException>; // YYYY-MM-DD → override
  // Day status (PR 3). All optional so old data loads; load() fills the defaults.
  autoLunchThresholdMin?: number; // default 300: one session longer than this gets the schedule lunch
  confirmedDays?: Record<string, true>; // YYYY-MM-DD → "Enligt schema" confirmed
  lockedMonths?: Record<string, LockedMonth>; // YYYY-MM → lock
  dayAdjustments?: Record<string, DayAdjustment>; // YYYY-MM-DD → adjustment
  auditLog?: AuditEntry[]; // confirm/unlock history, sorted by at
  travel?: TravelEntry[];
  travelRules?: TravelRules;
  vacation?: VacationSettings;
  flexBaseDate?: string;
};
