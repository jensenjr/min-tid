import { type ScheduleSource, type DayConfig, netDayMin, getEffectiveDayConfig } from "./schedule";
import { getWeekMonday, todayLocal } from "./dates";
import { computeDayMinutes, getAbsencesForDate } from "./days";
import type { AbsenceEntry, ScheduleException, Session } from "./types";

// ─── Flex bank ────────────────────────────────────────────────
// Day-by-day accrual over completed (past) days only. For every day strictly
// before today between `trackingStartDate` and the range end, flex += (actual − norm).
// Non-flex absences (VAB, semester, etc.) excuse the day — they reduce the norm but
// don't drain flex. Flex absences deduct their minutes from the bank as intended.
// **Today never contributes to flex.** A day's contribution rolls in the morning after
// it ends — that way an unworked or partly-worked today doesn't show as red flex.
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
  const today = todayLocal();
  const start = rangeStart && rangeStart > trackingStartDate ? rangeStart : trackingStartDate;
  const end = rangeEnd && rangeEnd < today ? rangeEnd : today;
  if (start > end) return 0;

  // Group completed sessions by date for the iteration window
  const byDate: Record<string, Session[]> = {};
  for (const s of sessions) {
    if (s.checkOut === null) continue;
    const d = new Date(s.checkIn).toISOString().slice(0, 10);
    if (d < start || d >= today) continue;
    (byDate[d] ??= []).push(s);
  }

  let flex = 0;
  const cur = new Date(start + "T12:00:00");
  const endDate = new Date(end + "T12:00:00");

  while (cur <= endDate) {
    const dateStr = cur.toISOString().slice(0, 10);
    // Skip today and any future date — only past, completed days contribute.
    if (dateStr >= today) break;

    const dayCfg = getEffectiveDayConfig(dateStr, schedule, exceptions);
    const dayAbsences = getAbsencesForDate(absences, dateStr);
    const daySessions = byDate[dateStr] ?? [];

    let flexAbsMin = 0;
    let nonFlexAbsMin = 0;
    for (const a of dayAbsences) {
      const min = a.hours !== undefined ? Math.round(a.hours * 60) : netDayMin(dayCfg);
      if (a.category === "flex") flexAbsMin += min;
      else nonFlexAbsMin += min;
    }

    const scheduledNorm = dayCfg.active ? netDayMin(dayCfg) : 0;
    const norm = Math.max(0, scheduledNorm - nonFlexAbsMin);
    const actual =
      daySessions.length > 0
        ? computeDayMinutes(daySessions, dateStr, schedule, exceptions).net
        : 0;

    flex += actual - norm;
    flex -= flexAbsMin;

    cur.setDate(cur.getDate() + 1);
  }

  return flex;
}

// Today's contribution to the flex bank — added once today's shift looks settled.
// "Settled" = no active session AND at least one completed session today (or a flex
// absence on today). During an active session, today contributes 0 — the live
// running timer and the "Idag" sub-stat are the in-progress signals.
export function computeTodayContribution(
  sessions: Session[],
  absences: AbsenceEntry[],
  schedule: ScheduleSource,
  today: string,
  trackingStartDate: string | undefined,
  exceptions: Record<string, ScheduleException> = {},
): number {
  if (!trackingStartDate || today < trackingStartDate) return 0;

  const todaySessions = sessions.filter(
    (s) => new Date(s.checkIn).toISOString().slice(0, 10) === today,
  );
  const hasActive = todaySessions.some((s) => s.checkOut === null);
  if (hasActive) return 0;
  const completedToday = todaySessions.filter((s) => s.checkOut !== null);

  const dayCfg = getEffectiveDayConfig(today, schedule, exceptions);
  const dayAbsences = getAbsencesForDate(absences, today);

  let flexAbsMin = 0;
  let nonFlexAbsMin = 0;
  for (const a of dayAbsences) {
    const min = a.hours !== undefined ? Math.round(a.hours * 60) : netDayMin(dayCfg);
    if (a.category === "flex") flexAbsMin += min;
    else nonFlexAbsMin += min;
  }

  // Don't commit anything until the user has actually interacted with today
  // (punched in/out at least once or has a flex absence).
  if (completedToday.length === 0 && flexAbsMin === 0) return 0;

  const scheduledNorm = dayCfg.active ? netDayMin(dayCfg) : 0;
  const norm = Math.max(0, scheduledNorm - nonFlexAbsMin);
  const actual =
    completedToday.length > 0
      ? computeDayMinutes(completedToday, today, schedule, exceptions).net
      : 0;

  return actual - norm - flexAbsMin;
}

// Live per-day flex shown on the dashboard. Unlike `computeTodayContribution`,
// this updates continuously while you're punched in so you can see "how today is
// going" in real time — even mid-shift.
export function computeTodayDelta(todaySessions: Session[], todayCfg: DayConfig): number {
  let raw = 0;
  for (const s of todaySessions) {
    const end = s.checkOut ?? Date.now();
    raw += (end - s.checkIn) / 60000;
  }
  const lunch = todayCfg.active ? todayCfg.lunchMinutes : 0;
  const liveNet = Math.max(0, raw - lunch);
  const target = todayCfg.active ? netDayMin(todayCfg) : 0;
  return liveNet - target;
}

// Week-by-week flex breakdown for the last N weeks (newest first).
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
  const thisMonday = getWeekMonday(new Date());
  for (let i = 0; i < weeks; i++) {
    const mon = new Date(thisMonday);
    mon.setDate(mon.getDate() - i * 7);
    const sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    const monStr = mon.toISOString().slice(0, 10);
    const sunStr = sun.toISOString().slice(0, 10);
    if (sunStr < trackingStartDate) break;
    let minutes = computeFlexMinutes(
      sessions,
      absences,
      schedule,
      trackingStartDate,
      monStr,
      sunStr,
      exceptions,
    );
    if (i === 0) minutes += todayContribution; // current week picks up today's committed flex
    out.push({ mondayStr: monStr, minutes });
  }
  return out;
}
