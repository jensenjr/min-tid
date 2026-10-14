import type { AbsenceEntry, AbsenceCategory, Session } from "../types";

// Local-time timestamp for "YYYY-MM-DD" + "HH:MM" (tests run in Europe/Stockholm).
export function at(date: string, time: string): number {
  return new Date(`${date}T${time}:00`).getTime();
}

let seq = 0;

export function session(
  date: string,
  from: string,
  to: string | null,
  endDate = date,
  extra: Partial<Session> = {},
): Session {
  seq += 1;
  return {
    id: `s${seq}`,
    checkIn: at(date, from),
    checkOut: to === null ? null : at(endDate, to),
    manual: true,
    ...extra,
  };
}

export function absence(
  category: AbsenceCategory,
  startDate: string,
  endDate = startDate,
  hours?: number,
): AbsenceEntry {
  seq += 1;
  return { id: `a${seq}`, category, startDate, endDate, hours, manual: true };
}
