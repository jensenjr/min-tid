// Shared data types for the time/flex logic. Pure type module — no runtime code.
import type { WeekSchedule } from "./schedule";
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

// Shape persisted in localStorage under `punchclock_v2`.
export type AppState = {
  name: string;
  schedule: WeekSchedule;
  department?: string;
  onboardingDone: boolean;
  sessions: Session[];
  absences: AbsenceEntry[];
  expenses: ExpenseEntry[];
  flexBaseMinutes: number;
  trackingStartDate?: string; // YYYY-MM-DD — flex accrues from this day forward
  scheduleExceptions: Record<string, ScheduleException>; // YYYY-MM-DD → override
};
