// Small pure helpers for the Today view and the "Enligt schema" actions.
import { type DayConfig, netDayMin } from "./schedule";
import { isHm } from "./days";
import type { DayAdjustment } from "./types";

/**
 * "Du kan gå kl. HH:MM" for a schedule-mode user: the adjusted end if the day was
 * adjusted, else the scheduled end. null on a day off (without an adjusted end).
 */
export function scheduledLeaveTime(cfg: DayConfig, adj?: DayAdjustment): string | null {
  if (adj && isHm(adj.end)) return adj.end;
  return cfg.active && netDayMin(cfg) > 0 ? cfg.endTime : null;
}

/**
 * The flex anchor for a user who never punches: the first "Enligt schema" / adjustment /
 * confirmation sets it, an existing one is never moved. A day in the future anchors today.
 */
export function nextTrackingStart(
  existing: string | undefined,
  date: string,
  today: string,
): string {
  if (existing) return existing;
  return date <= today ? date : today;
}

export type LeaveEstimate = {
  leaveAtMs: number;
  reached: boolean; // the day's target is already met
  overMin: number; // whole minutes past the target (0 until reached)
  lunchIncluded: boolean;
};

/**
 * Punch mode: when can I leave today? The schedule lunch is only added to the target while
 * this is the day's single session (the break rule deducts it only then); a user who
 * already punched out over lunch needs no extra minutes.
 */
export function punchLeaveEstimate(input: {
  cfg: DayConfig;
  workedRawMin: number; // punched-in minutes today, open session included
  sessionCount: number; // sessions today, open one included
  nowMs: number;
}): LeaveEstimate {
  const { cfg, workedRawMin, sessionCount, nowMs } = input;
  const lunchIncluded = sessionCount <= 1 && cfg.lunchMinutes > 0;
  const target = netDayMin(cfg) + (lunchIncluded ? cfg.lunchMinutes : 0);
  const remaining = Math.max(0, target - workedRawMin);
  const reached = workedRawMin >= target;
  return {
    leaveAtMs: nowMs + remaining * 60000,
    reached,
    overMin: reached ? Math.round(workedRawMin - target) : 0,
    lunchIncluded,
  };
}
