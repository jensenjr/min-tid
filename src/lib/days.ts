import { type ScheduleSource, getEffectiveDayConfig } from "./schedule";
import type { AbsenceEntry, ScheduleException, Session } from "./types";

export function computeDayMinutes(
  sessions: Session[],
  dateStr: string,
  schedule: ScheduleSource,
  exceptions: Record<string, ScheduleException> = {},
) {
  const cfg = getEffectiveDayConfig(dateStr, schedule, exceptions);
  let raw = 0;
  for (const s of sessions) {
    const end = s.checkOut ?? Date.now();
    raw += (end - s.checkIn) / 60000;
  }
  return { raw, net: Math.max(0, raw - (cfg?.lunchMinutes ?? 0)), cfg };
}

export function getAbsencesForDate(absences: AbsenceEntry[], date: string): AbsenceEntry[] {
  return absences.filter((a) => a.startDate <= date && a.endDate >= date);
}
