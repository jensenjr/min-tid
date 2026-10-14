// ─── Flex bank ────────────────────────────────────────────────
// The bank is a fold over evaluateDay (days.ts): the sum of each day's flexDelta from
// trackingStartDate up to and including today. Today only counts once evaluateDay calls
// it settled; future days never count. Missing (punch mode) and unconfirmed (schedule
// mode) days are listed so the UI can ask the user to fill them in.
import {
  type DayConfig,
  type ScheduleSource,
  addDaysStr,
  mondayOfStr,
  netDayMin,
} from "./schedule";
import { isYmd, todayLocal } from "./dates";
import {
  DEFAULT_AUTO_LUNCH_THRESHOLD_MIN,
  type DayContext,
  evaluateDay,
  validThreshold,
  workedFromSessions,
} from "./days";
import type { AbsenceEntry, ScheduleException, Session } from "./types";

/**
 * DayContext plus the day an opening balance was set on. A balance (AppState.flexBaseMinutes,
 * e.g. from the Excel import "Saldon") is the balance at the END of flexBaseDate, so the
 * bank accrues only from the day after it. Without a date it accrues from trackingStartDate.
 */
export type FlexContext = DayContext & { flexBaseDate?: string };

export type FlexRange = { from?: string; to?: string }; // inclusive local day keys
export type FlexResult = { minutes: number; missingDays: string[]; unconfirmedDays: string[] };

/** Flex over a range (default: everything since trackingStartDate), clamped to today. */
export function computeFlex(ctx: FlexContext, range: FlexRange = {}): FlexResult {
  const out: FlexResult = { minutes: 0, missingDays: [], unconfirmedDays: [] };
  const tracking = ctx.trackingStartDate;
  if (!isYmd(tracking)) return out;
  // The opening balance already covers everything up to and including flexBaseDate.
  const afterBase = isYmd(ctx.flexBaseDate) ? addDaysStr(ctx.flexBaseDate, 1) : undefined;
  const start = afterBase && afterBase > tracking ? afterBase : tracking;
  const today = ctx.today ?? todayLocal();
  // Freeze "today" and "now" so every day of the fold sees the same clock.
  const c: FlexContext = { ...ctx, today, now: ctx.now ?? Date.now() };
  const from = isYmd(range.from) && range.from > start ? range.from : start;
  const to = isYmd(range.to) && range.to < today ? range.to : today;
  for (let d = from; d <= to; d = addDaysStr(d, 1)) {
    const ev = evaluateDay(d, c, { explain: false });
    out.minutes += ev.flexDelta;
    if (ev.status === "missing") out.missingDays.push(d);
    else if (ev.status === "unconfirmed") out.unconfirmedDays.push(d);
  }
  return out;
}

export type WeekFlex = FlexResult & { mondayStr: string };

/** The last `weeks` weeks (newest first, local Mondays), stopping before trackingStartDate. */
export function computeWeeklyFlex(ctx: FlexContext, weeks: number): WeekFlex[] {
  const start = ctx.trackingStartDate;
  if (!isYmd(start)) return [];
  const today = ctx.today ?? todayLocal();
  const c: FlexContext = { ...ctx, today, now: ctx.now ?? Date.now() };
  const thisMonday = mondayOfStr(today);
  const rows: WeekFlex[] = [];
  for (let i = 0; i < weeks; i++) {
    const mon = addDaysStr(thisMonday, -7 * i);
    const sun = addDaysStr(mon, 6);
    if (sun < start) break;
    rows.push({ mondayStr: mon, ...computeFlex(c, { from: mon, to: sun }) });
  }
  return rows;
}

// ─── Old API — thin wrappers kept for existing callers ────────
// They evaluate in punch mode with no confirmations/adjustments. Reporting mode never
// changes flex minutes (missing and unconfirmed days both leave flex untouched), only
// which list a day lands in.
function legacyCtx(
  sessions: Session[],
  absences: AbsenceEntry[],
  schedule: ScheduleSource,
  trackingStartDate: string | undefined,
  exceptions: Record<string, ScheduleException>,
  today = todayLocal(),
): DayContext {
  return {
    sessions,
    absences,
    schedule,
    exceptions,
    reportingMode: "punch",
    trackingStartDate,
    today,
    now: Date.now(),
  };
}

/** Flex for completed past days only (date < today) in [rangeStart, rangeEnd]. */
export function computeFlexMinutes(
  sessions: Session[],
  absences: AbsenceEntry[],
  schedule: ScheduleSource,
  trackingStartDate: string | undefined,
  rangeStart?: string,
  rangeEnd?: string,
  exceptions: Record<string, ScheduleException> = {},
): number {
  if (!trackingStartDate) return 0;
  const ctx = legacyCtx(sessions, absences, schedule, trackingStartDate, exceptions);
  const yesterday = addDaysStr(ctx.today as string, -1);
  const to = rangeEnd && rangeEnd < yesterday ? rangeEnd : yesterday;
  return computeFlex(ctx, { from: rangeStart, to }).minutes;
}

/** Today's flexDelta once evaluateDay calls today settled, else 0. */
export function computeTodayContribution(
  sessions: Session[],
  absences: AbsenceEntry[],
  schedule: ScheduleSource,
  today: string,
  trackingStartDate: string | undefined,
  exceptions: Record<string, ScheduleException> = {},
): number {
  if (!trackingStartDate || today < trackingStartDate) return 0;
  const ctx = legacyCtx(sessions, absences, schedule, trackingStartDate, exceptions, today);
  return evaluateDay(today, ctx, { explain: false }).flexDelta;
}

/** Live worked − norm for today's sessions (display only), with the same break rule. */
export function computeTodayDelta(
  todaySessions: Session[],
  todayCfg: DayConfig,
  autoLunchThresholdMin = DEFAULT_AUTO_LUNCH_THRESHOLD_MIN,
): number {
  const threshold = validThreshold(autoLunchThresholdMin) ?? DEFAULT_AUTO_LUNCH_THRESHOLD_MIN;
  const { workedMin } = workedFromSessions(todaySessions, todayCfg, threshold, Date.now());
  return workedMin - (todayCfg.active ? netDayMin(todayCfg) : 0);
}

/** Past-day flex per week (newest first); the current week adds `todayContribution`. */
export function computeWeeklyFlexBreakdown(
  sessions: Session[],
  absences: AbsenceEntry[],
  schedule: ScheduleSource,
  trackingStartDate: string | undefined,
  weeks: number,
  todayContribution: number,
  exceptions: Record<string, ScheduleException> = {},
): { mondayStr: string; minutes: number }[] {
  if (!trackingStartDate) return [];
  const out: { mondayStr: string; minutes: number }[] = [];
  const thisMonday = mondayOfStr(todayLocal());
  for (let i = 0; i < weeks; i++) {
    const mon = addDaysStr(thisMonday, -7 * i);
    const sun = addDaysStr(mon, 6);
    if (sun < trackingStartDate) break;
    let minutes = computeFlexMinutes(
      sessions,
      absences,
      schedule,
      trackingStartDate,
      mon,
      sun,
      exceptions,
    );
    if (i === 0) minutes += todayContribution; // current week picks up today's committed flex
    out.push({ mondayStr: mon, minutes });
  }
  return out;
}
