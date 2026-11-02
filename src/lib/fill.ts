// "Flera dagar": fill a date range with a share of each scheduled day. Pure, so the
// numbers can be tested against evaluateDay.
//
// A full day is saved as the whole shift with the schedule lunch as an explicit break. A
// part day (25/50/75 %) is saved as exactly the net time with a 0 min break — without an
// explicit break the single-session lunch rule (days.ts) would not deduct the lunch from
// a short session and the day would gain up to an hour.
import { type DayConfig, type ScheduleSource, getEffectiveDayConfig, netDayMin } from "./schedule";
import { ymdLocal } from "./dates";
import type { Session } from "./types";

export const MULTI_DAY_MAX_SPAN = 120; // days — guardrail against fat-finger ranges

export type DayBlock = "locked" | "adjusted" | null;

export type FillDay = {
  dateStr: string;
  netMin: number;
  rawMin: number; // netMin + breakMin: the length of the saved session
  breakMin: number;
  cfg: DayConfig;
};

export type FillPlan = {
  days: FillDay[];
  skippedInactive: number;
  skippedExisting: number;
  skippedBlocked: number;
  totalNet: number;
  tooLong: boolean;
};

export function planFill(input: {
  from: string;
  to: string;
  pct: number;
  schedule: ScheduleSource;
  existingSessions?: Session[];
  dayBlock?: (date: string) => DayBlock;
}): FillPlan {
  const { from, to, pct, schedule, existingSessions, dayBlock } = input;
  const plan: FillPlan = {
    days: [],
    skippedInactive: 0,
    skippedExisting: 0,
    skippedBlocked: 0,
    totalNet: 0,
    tooLong: false,
  };
  const start = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return plan;
  const span = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (span > MULTI_DAY_MAX_SPAN) return { ...plan, tooLong: true };

  const existDates = new Set((existingSessions ?? []).map((s) => ymdLocal(new Date(s.checkIn))));
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = ymdLocal(d);
    const cfg = getEffectiveDayConfig(dateStr, schedule);
    const netSched = netDayMin(cfg);
    if (!cfg.active || netSched <= 0) {
      plan.skippedInactive++;
      continue;
    }
    if (existDates.has(dateStr)) {
      plan.skippedExisting++;
      continue;
    }
    if (dayBlock?.(dateStr)) {
      plan.skippedBlocked++;
      continue;
    }
    const netMin = Math.round((netSched * pct) / 100);
    const breakMin = pct === 100 ? cfg.lunchMinutes : 0;
    plan.days.push({ dateStr, netMin, rawMin: netMin + breakMin, breakMin, cfg });
  }
  plan.totalNet = plan.days.reduce((sum, x) => sum + x.netMin, 0);
  return plan;
}

export function fillSessions(
  plan: FillPlan,
  note: string | undefined,
  newId: () => string = () => crypto.randomUUID(),
): Session[] {
  return plan.days.map(({ dateStr, rawMin, breakMin, cfg }) => {
    const checkIn = new Date(`${dateStr}T${cfg.startTime}`).getTime();
    return {
      id: newId(),
      checkIn,
      checkOut: checkIn + rawMin * 60000,
      manual: true,
      breakMinutes: breakMin,
      note: note?.trim() || undefined,
    };
  });
}
