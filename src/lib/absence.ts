// Absence rules for one day. Pure — no React, no dates other than day keys.
//
// - An absence only counts on a scheduled day (active with a positive norm). On a day
//   off it is ignored, so a semester or flex range over a weekend costs nothing there.
// - `hours` is per day; undefined = the whole day (the day's effective norm).
// - Non-flex categories (VAB, sjuk, semester, helgdag, …) are "excused": they lower the
//   day's norm. Flex is paid from the flex bank.
// - Together they never exceed the norm: excused first, then flex.
import { type DayConfig, netDayMin } from "./schedule";
import type { AbsenceCategory, AbsenceEntry } from "./types";

// Same labels as ABSENCE_META in AbsenceModal.tsx (a test keeps them in step); copied
// so the pure lib does not import a component at runtime.
export const ABSENCE_LABEL: Record<AbsenceCategory, string> = {
  sjuk: "Sjuk",
  vab: "VAB",
  semester: "Semester",
  foraldraledighet: "Föräldraledighet",
  friskard: "Friskvård",
  tjansteledighet: "Tjänsteledighet",
  obetald: "Obetald ledighet",
  overtid_betald: "Övertid (betald)",
  flex: "Flex",
  helgdag: "Helgdag (röd dag)",
};

export function getAbsencesForDate(absences: AbsenceEntry[], date: string): AbsenceEntry[] {
  return absences.filter((a) => a.startDate <= date && a.endDate >= date);
}

export function isFlexAbsence(a: AbsenceEntry): boolean {
  return a.category === "flex";
}

export type DayAbsence = {
  flexMin: number; // drawn from the flex bank
  excusedMin: number; // lowers the day's norm
  ignored: boolean; // there were absences, but the day is not scheduled
  capped: boolean; // the entries asked for more than the norm
  items: { entry: AbsenceEntry; minutes: number; flex: boolean }[]; // as requested, before capping
  fullDay: boolean; // flex + excused cover the whole norm
};

function requestedMinutes(a: AbsenceEntry, norm: number): number {
  if (typeof a.hours === "number" && Number.isFinite(a.hours)) {
    return Math.max(0, Math.round(a.hours * 60));
  }
  return norm;
}

export function absenceForDay(absences: AbsenceEntry[], date: string, cfg: DayConfig): DayAbsence {
  const entries = getAbsencesForDate(absences, date);
  const norm = cfg.active ? netDayMin(cfg) : 0;
  if (norm <= 0) {
    return {
      flexMin: 0,
      excusedMin: 0,
      ignored: entries.length > 0,
      capped: false,
      items: [],
      fullDay: false,
    };
  }
  let flexReq = 0;
  let excusedReq = 0;
  const items = entries.map((entry) => {
    const minutes = requestedMinutes(entry, norm);
    const flex = isFlexAbsence(entry);
    if (flex) flexReq += minutes;
    else excusedReq += minutes;
    return { entry, minutes, flex };
  });
  const excusedMin = Math.min(norm, excusedReq);
  const flexMin = Math.min(norm - excusedMin, flexReq);
  return {
    flexMin,
    excusedMin,
    ignored: false,
    capped: flexReq + excusedReq > norm,
    items,
    fullDay: excusedMin + flexMin >= norm,
  };
}
