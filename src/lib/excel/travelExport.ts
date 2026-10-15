// The "Restid" part of the Excel export: a sheet with one row per trip plus summary lines,
// handed to buildReportWorkbook through its `extraSheets` / `extraSummary` / `travelFor`
// hooks. The first columns (Datum, Från, Till, Resmål, Kommentar by name) are the Restid
// sheet of the import template, so a trip written here is read back by parseWorkbook.
//
// Notes
// - Per-row figures ignore the per-day cap (a trip is shown on its own); the summary uses
//   the day totals with the cap applied. A day that was capped says so in Kommentar.
// - A trip across midnight (Till before Från) and a duration-only (imported) trip are
//   exported as they are, but the importer rejects such rows (it needs Från < Till).
import type { DayConfig } from "../schedule";
import type { DayContext } from "../days";
import {
  isDurationOnly,
  makeTravelFor,
  splitTravel,
  splitTravelDay,
  travelDurationMin,
  type TravelEntry,
  type TravelRules,
} from "../travel";
import { hmToFraction, ymdToSerial } from "./cells";
import type { ExportCell, ExportSheet } from "./export";

export const TRAVEL_EXPORT_HEADERS = [
  "Datum",
  "Från",
  "Till",
  "Resmål",
  "Inom schema (h)",
  "Utanför schema (h)",
  "Till lön (h)",
  "Till flex (h)",
  "Kommentar",
] as const;

const hours = (min: number): number => Math.round((min / 60) * 100) / 100;

export type TravelExport = {
  extraSheets: ExportSheet[];
  extraSummary: [string, ExportCell][];
  travelFor: NonNullable<DayContext["travelFor"]>;
};

export function buildTravelExport(
  travel: TravelEntry[] | undefined,
  rules: TravelRules,
  cfgFor: (date: string) => DayConfig,
  start: string,
  end: string,
): TravelExport {
  const travelFor = makeTravelFor(travel, rules);
  const inPeriod = (travel ?? [])
    .filter((t) => t.date >= start && t.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.from ?? "").localeCompare(b.from ?? ""));
  if (inPeriod.length === 0) return { extraSheets: [], extraSummary: [], travelFor };

  const uncapped: TravelRules = { ...rules, maxPerDayMin: undefined };
  const byDate = new Map<string, TravelEntry[]>();
  for (const t of inPeriod) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);

  const rows: ExportCell[][] = [[...TRAVEL_EXPORT_HEADERS]];
  const sum = { inside: 0, outside: 0, payroll: 0, flex: 0, total: 0 };
  for (const [date, entries] of byDate) {
    const cfg = cfgFor(date);
    const day = splitTravelDay(entries, cfg, rules);
    sum.inside += day.inScheduleMin;
    sum.outside += day.outsideMin;
    sum.payroll += day.payrollMin;
    sum.flex += day.flexMin;
    const rowPayroll = entries.reduce((s, e) => s + splitTravel(e, cfg, uncapped).payrollMin, 0);
    const rowFlex = entries.reduce((s, e) => s + splitTravel(e, cfg, uncapped).flexMin, 0);
    const capped = day.payrollMin + day.flexMin < rowPayroll + rowFlex;
    entries.forEach((e, i) => {
      sum.total += travelDurationMin(e);
      const s = splitTravel(e, cfg, uncapped);
      const notes = [e.note, e.imported ? "Importerad (saknar klockslag)" : undefined];
      if (capped && i === 0) {
        notes.push(
          `Maxgräns per dag tillämpad (dagens totalt ${hours(day.payrollMin + day.flexMin)} h)`,
        );
      }
      rows.push([
        { v: ymdToSerial(date), z: "yyyy-mm-dd" },
        isDurationOnly(e) ? null : { v: hmToFraction(e.from as string), z: "hh:mm" },
        isDurationOnly(e) ? null : { v: hmToFraction(e.to as string), z: "hh:mm" },
        e.destination ?? null,
        hours(s.inScheduleMin),
        hours(s.outsideMin),
        hours(s.payrollMin),
        hours(s.flexMin),
        notes.filter(Boolean).join(" · ") || null,
      ]);
    });
  }

  return {
    extraSheets: [{ name: "Restid", rows, widths: [14, 9, 9, 22, 16, 18, 13, 13, 50] }],
    extraSummary: [
      ["Restid totalt (h)", hours(sum.total)],
      ["Restid inom schema (h)", hours(sum.inside)],
      ["Restid utanför schema (h)", hours(sum.outside)],
      ["Restid till lön (h)", hours(sum.payroll)],
      ["Restid till flex (h)", hours(sum.flex)],
    ],
    travelFor,
  };
}
