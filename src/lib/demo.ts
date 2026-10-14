// Demo mode (`?demo=1`): a throwaway copy of the app filled with made-up data for "Anna Demo".
//
// Safety rules (the shell enforces them, this module only holds the pure pieces):
// - Demo state lives under its own key (DEMO_STORAGE_KEY) and is rebuilt on every entry;
//   the user's real data (APP_STORAGE_KEY) is never read or written in demo.
// - Sync is off in demo: no token, no push, no pull, no key store (shouldSync).
// - Exit clears the demo key and drops `?demo=1` from the address (exitDemoUrl).
//
// buildDemoState is pure and deterministic: the same `today` always gives the same state,
// and every date is relative to it, so the demo never goes stale.
import {
  DEFAULT_SCHEDULE,
  type SchedulePeriod,
  type WeekSchedule,
  addDaysStr,
  getEffectiveDayConfig,
  legacyScheduleOf,
  mondayOfStr,
  netDayMin,
} from "./schedule";
import { monthRange } from "./dates";
import { DEFAULT_TRAVEL_RULES } from "./travel";
import type {
  AbsenceEntry,
  AppState,
  AuditEntry,
  DayAdjustment,
  ExpenseEntry,
  LockedMonth,
  Session,
  TravelEntry,
  VacationSettings,
} from "./types";

export const APP_STORAGE_KEY = "punchclock_v2";
export const DEMO_STORAGE_KEY = "punchclock_demo";
export const DEMO_NAME = "Anna Demo";

/** True for `?demo=1` (and only that). */
export function isDemoSearch(search: string): boolean {
  return new URLSearchParams(search).get("demo") === "1";
}

/** The localStorage key the app state is read from and written to. */
export function storageKeyFor(demo: boolean): string {
  return demo ? DEMO_STORAGE_KEY : APP_STORAGE_KEY;
}

/** Sync talks to the server only outside demo and only with a token. */
export function shouldSync(demo: boolean, token: string | null | undefined): boolean {
  return !demo && !!token;
}

/** The address to go back to: same page, `demo` removed, everything else kept. */
export function exitDemoUrl(loc: { pathname: string; search: string; hash: string }): string {
  const params = new URLSearchParams(loc.search);
  params.delete("demo");
  const rest = params.toString();
  return loc.pathname + (rest ? `?${rest}` : "") + loc.hash;
}

// ─── Seed ─────────────────────────────────────────────────────

const WEEK_ONE: WeekSchedule = DEFAULT_SCHEDULE;
// Week 2 of the rotation: Friday off (4 × 8 h).
const WEEK_TWO: WeekSchedule = {
  ...DEFAULT_SCHEDULE,
  fri: { ...DEFAULT_SCHEDULE.fri, active: false },
};

const MON = 0;
const TUE = 1;
const WED = 2;
const THU = 3;

function nextMonth(month: string): string {
  return addDaysStr(monthRange(month).last, 1).slice(0, 7);
}

function at(date: string, time: string): number {
  return new Date(`${date}T${time}:00`).getTime();
}

/**
 * Eight weeks of Anna's time ending today: "Enligt schema", a two-week rotation, a semester
 * week, a VAB day, two days still to confirm, a trip outside the schedule, a few
 * expenses and the oldest full month confirmed and locked.
 *
 * `today` is a local day key. The window starts on a Monday at least eight weeks back and
 * is stretched backwards until it holds one full past month (the locked one) followed by
 * at least two scheduled days (the unconfirmed ones).
 */
export function buildDemoState(today: string): AppState {
  const curMonday = mondayOfStr(today);
  // Week 1 of the rotation is the current week, so Fridays alternate off/on backwards.
  const anchorMonday = addDaysStr(curMonday, -7 * 2 * 12);
  const weekDate = (weeksBack: number, dow: number) => addDaysStr(curMonday, -7 * weeksBack + dow);

  const buildPeriod = (validFrom: string): SchedulePeriod => ({
    validFrom,
    anchorMonday,
    rotation: { weeks: [WEEK_ONE, WEEK_TWO] },
  });
  const scheduled = (date: string, schedules: SchedulePeriod[]) => {
    const cfg = getEffectiveDayConfig(date, schedules);
    return cfg.active && netDayMin(cfg) > 0;
  };

  // ── Window: 8+ weeks, one full month to lock, two scheduled days after it ──
  let start = addDaysStr(curMonday, -7 * 8);
  let lockedMonth = "";
  let tail: string[] = []; // scheduled days after the locked month, before today
  for (let weeks = 8; weeks <= 24; weeks++) {
    start = addDaysStr(curMonday, -7 * weeks);
    const schedules = [buildPeriod(start)];
    let month = start.endsWith("-01") ? start.slice(0, 7) : nextMonth(start.slice(0, 7));
    // Skip months that have not fully passed (cannot happen for the oldest, kept for safety).
    if (monthRange(month).last >= today) continue;
    const days: string[] = [];
    for (let d = addDaysStr(monthRange(month).last, 1); d < today; d = addDaysStr(d, 1)) {
      if (scheduled(d, schedules)) days.push(d);
    }
    if (days.length >= 2) {
      lockedMonth = month;
      tail = days;
      break;
    }
  }
  const schedules = [buildPeriod(start)];

  // The two latest scheduled days before today stay unconfirmed.
  const unconfirmed = new Set(tail.slice(-2));
  const [receiptDay] = tail.slice(-2);

  // ── Registered time ─────────────────────────────────────────
  const absences: AbsenceEntry[] = [];
  const sessions: Session[] = [];
  const dayAdjustments: Record<string, DayAdjustment> = {};
  const travel: TravelEntry[] = [];
  const expenses: ExpenseEntry[] = [];
  const touched = new Set<string>();

  const semesterMonday = weekDate(5, MON);
  absences.push({
    id: "demo-semester-1",
    category: "semester",
    startDate: semesterMonday,
    endDate: addDaysStr(semesterMonday, 4),
    note: "Veckan före midsommar",
    manual: true,
  });
  for (let i = 0; i < 5; i++) touched.add(addDaysStr(semesterMonday, i));

  const vabDay = weekDate(2, WED);
  absences.push({
    id: "demo-vab-1",
    category: "vab",
    startDate: vabDay,
    endDate: vabDay,
    note: "Sjukt barn",
    manual: true,
  });
  touched.add(vabDay);

  const adjust = (date: string, adj: Omit<DayAdjustment, "date">) => {
    dayAdjustments[date] = { date, ...adj };
    touched.add(date);
  };
  adjust(weekDate(2, TUE), { start: "08:00", end: "15:30", note: "Tandläkare" });
  adjust(weekDate(3, TUE), { start: "08:00", end: "18:00", note: "Kvartalsavslut" });
  adjust(weekDate(7, TUE), { start: "08:00", end: "19:00", note: "Release" });

  const longDay = weekDate(6, THU);
  sessions.push({
    id: "demo-session-1",
    checkIn: at(longDay, "07:30"),
    checkOut: at(longDay, "17:30"),
    manual: true,
    breakMinutes: 60,
    note: "Tidig start, inventering",
  });
  touched.add(longDay);

  // A trip that starts before the shift: 30 min inside the schedule, 150 min outside it.
  const tripDay = weekDate(3, THU);
  travel.push({
    id: "demo-travel-1",
    date: tripDay,
    from: "05:30",
    to: "08:30",
    destination: "Göteborg",
    note: "Kundmöte",
  });
  expenses.push(
    {
      id: "demo-exp-1",
      category: "milersattning",
      date: tripDay,
      km: 184,
      hasReceipt: false,
      note: "Göteborg t/r",
      manual: true,
    },
    {
      id: "demo-exp-2",
      category: "kost",
      date: tripDay,
      amount: 148,
      hasReceipt: false,
      note: "Lunch med kund",
      manual: true,
    },
    {
      id: "demo-exp-3",
      category: "parkering",
      date: weekDate(6, THU),
      amount: 65,
      hasReceipt: false,
      manual: true,
    },
    // In an unlocked month with a receipt on paper: "Att åtgärda" asks for it.
    {
      id: "demo-exp-4",
      category: "parkering",
      date: receiptDay,
      amount: 90,
      hasReceipt: true,
      note: "Kvitto att bifoga",
      manual: true,
    },
  );

  // ── Everything else that was scheduled is "Enligt schema ✓" ──
  const confirmedDays: Record<string, true> = {};
  for (let d = start; d < today; d = addDaysStr(d, 1)) {
    if (!scheduled(d, schedules) || touched.has(d) || unconfirmed.has(d)) continue;
    confirmedDays[d] = true;
  }

  const confirmedAt = at(addDaysStr(monthRange(lockedMonth).last, 1), "00:05");
  const lockedMonths: Record<string, LockedMonth> = {
    [lockedMonth]: { at: confirmedAt, by: DEMO_NAME },
  };
  const auditLog: AuditEntry[] = [{ at: confirmedAt, action: "confirm", month: lockedMonth }];

  const vacation: VacationSettings = {
    daysPerYear: 25,
    // The vacation year starts on the 1st of the semester week's month, so the demo week
    // and today always fall in the same year.
    yearStart: `${semesterMonday.slice(5, 7)}-01`,
    allowHalfDays: false,
  };

  return {
    name: DEMO_NAME,
    department: "Ekonomi",
    schedule: legacyScheduleOf(schedules, today),
    schedules,
    reportingMode: "schedule",
    onboardingDone: true,
    sessions,
    absences,
    expenses,
    travel,
    travelRules: DEFAULT_TRAVEL_RULES,
    flexBaseMinutes: 0,
    trackingStartDate: start,
    scheduleExceptions: {},
    confirmedDays,
    lockedMonths,
    dayAdjustments,
    auditLog,
    vacation,
  };
}
