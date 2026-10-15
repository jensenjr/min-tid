// Contracts between the shell (PunchClock.tsx) and the four views.
import type { ReactNode } from "react";
import type { Report, ReportPeriod } from "../lib/report";
import type { AbsenceEntry, ExpenseEntry, Session } from "../lib/types";

/**
 * Everything a view can do to a day. The shell implements these: it blocks edits on
 * locked days (toast + "Lås upp månaden"), anchors the flex start on the first
 * registration, and stores the result.
 */
export type DayActions = {
  /** "Enligt schema ✓" — confirm the day as worked per schedule. */
  enligtSchema: (date: string) => void;
  /** Undo a confirmation. */
  undoSchema: (date: string) => void;
  /** Open "Justera dag" (AdjustDaySheet). */
  adjust: (date: string) => void;
  /** Open the absence sheet for the day ("Frånvaro"). */
  absence: (date: string) => void;
  /** "Lägg till tid" for the day. */
  addTime: (date: string) => void;
  editSession: (s: Session) => void;
  deleteSession: (id: string) => void;
  deleteAbsence: (a: AbsenceEntry) => void;
  /** "Ändra schema för dag" (shortened day). */
  editException: (date: string) => void;
  /** Open the "Bekräfta <månad>" confirmation (calls confirmMonth when accepted). */
  confirmMonth: (month: string) => void;
  /** Open the "Lås upp månaden" confirmation (calls unlockMonth when accepted). */
  unlockMonth: (month: string) => void;
  /** Remove the "Justera dag" adjustment of a day. */
  removeAdjustment: (date: string) => void;
};

/**
 * A slot is either ready-made content or a function of the current report period.
 * Another PR plugs in with one line in PunchClock.tsx, e.g.
 * `reportSlots.vacation = (p) => <VacationLine period={p} />`.
 */
export type Slot<T> = ReactNode | ((p: T) => ReactNode);

export type ReportSlotContext = ReportPeriod & { report: Report };

/** Slots in the Rapport view. Each renders nothing until it is filled. */
export type ReportSlots = {
  /** PR 8: the "Restid" row (travel time for the period). */
  travel?: Slot<ReportSlotContext>;
  /** PR 7: the vacation line, "Semester: 17 av 25 dagar kvar". */
  vacation?: Slot<ReportSlotContext>;
  /** PR 6: the "Exportera Excel" button. */
  excelExport?: Slot<ReportSlotContext>;
};

/**
 * Slots in the Mer view. Fill them with a `<MoreRow>` (from components/ui) plus whatever
 * sheet it opens. Each renders nothing until it is filled.
 */
export type MoreSlots = {
  /** PR 8: "Restidsregler". */
  travelRules?: ReactNode;
  /** PR 7: "Semester". */
  vacation?: ReactNode;
  /** PR 6: "Importera från Excel". */
  excelImport?: ReactNode;
};

export function renderSlot<T>(slot: Slot<T> | undefined, arg: T): ReactNode {
  if (slot === undefined || slot === null || slot === false) return null;
  return typeof slot === "function" ? (slot as (p: T) => ReactNode)(arg) : slot;
}

export type FlexFigures = {
  total: number; // flexBaseMinutes + computeFlex — the balance
  week: number;
  month: number;
  /** liveDayDelta of today — never −norm for an unworked day. */
  today: number;
  /** "N dagar saknas" / "N ej bekräftade" next to the balance, or null. */
  attention: string | null;
};
