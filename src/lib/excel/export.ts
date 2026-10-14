// Excel export of a report period, in the import template's layout so the file can be read
// back in: Pass, Frånvaro, Utlägg, Saldon and the hidden Listor — plus a "Sammanfattning"
// sheet first.
//
// Worked time comes from evaluateDay (the same function the flex card folds over), so the
// totals match the app: sessions as registered, "Justera dag" adjustments, and days
// confirmed "Enligt schema" (or in a locked month) as a row for the scheduled hours.
// Unconfirmed days are not rows (nothing was reported); they are counted in the summary.
//
// Saldon is written "Per datum" = the last day of the period with the flex balance at the
// end of it (opening balance + computeFlex), so importing the file into an empty app
// reproduces the balance; the sessions are on or before that date and are not counted twice.
//
// PR 8 (travel time): pass `extraSheets` — e.g. a "Restid" sheet with Datum, Från, Till,
// Resmål, Kommentar plus payroll hours — and extra summary lines via `extraSummary`.
import { addDaysStr, getEffectiveDayConfig } from "../schedule";
import { todayLocal } from "../dates";
import {
  type DayContext,
  type DayStatus,
  evaluateDay,
  resolveReportingMode,
  sessionsOn,
} from "../days";
import { ABSENCE_LABEL } from "../absence";
import { computeFlex } from "../flex";
import type { AppState } from "../types";
import { loadXlsx } from "./parse";
import { hmToFraction, ymdToSerial } from "./cells";
import {
  ABSENCE_HEADERS,
  ABSENCE_TYPE_LABELS,
  BALANCE_HEADERS,
  BALANCE_LABELS,
  EXPENSE_HEADERS,
  EXPENSE_TYPE_LABELS,
  RECEIPT_LABELS,
  SESSION_HEADERS,
  SHEETS,
  TEMPLATE_VERSION,
} from "./lists";

/** A cell: plain text/number, or a number with an Excel number format (dates, times). */
export { downloadBytes } from "./download";
export { XLSX_MIME } from "./lists";

export type ExportCell = string | number | null | { v: number; z: string };
export type ExportSheet = {
  name: string;
  rows: ExportCell[][];
  /** Column widths in characters. */
  widths?: number[];
  hidden?: boolean;
};

export type ExportState = Pick<
  AppState,
  "sessions" | "absences" | "expenses" | "schedules" | "scheduleExceptions"
> &
  Partial<
    Pick<
      AppState,
      | "name"
      | "department"
      | "reportingMode"
      | "trackingStartDate"
      | "autoLunchThresholdMin"
      | "confirmedDays"
      | "lockedMonths"
      | "dayAdjustments"
      | "flexBaseMinutes"
      | "flexBaseDate"
    >
  >;

export type ReportOptions = {
  /** Local day key of "today" (tests). Defaults to todayLocal(). */
  today?: string;
  now?: number;
  /** Hook for PR 8: more sheets (e.g. Restid) appended after the template sheets. */
  extraSheets?: ExportSheet[];
  /** Hook for PR 8: extra "label, value" lines appended to the summary block. */
  extraSummary?: [string, ExportCell][];
  /** Passed through to evaluateDay (PR 8's travel minutes). */
  travelFor?: DayContext["travelFor"];
};

const DATE_FMT = "yyyy-mm-dd";
const TIME_FMT = "hh:mm";
const MAX_DAYS = 3660;

const date = (ymd: string): ExportCell => ({ v: ymdToSerial(ymd), z: DATE_FMT });
const time = (hm: string): ExportCell => ({ v: hmToFraction(hm), z: TIME_FMT });
const hours = (min: number): number => Math.round((min / 60) * 100) / 100;
const hhmm = (totalMin: number) =>
  `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const pad = (n: number) => String(n).padStart(2, "0");
const hmOf = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const STATUS_LABEL: Record<DayStatus, string> = {
  missing: "Saknas",
  unconfirmed: "Ej bekräftad",
  ongoing: "Pågår",
  reported: "Rapporterad",
  absent: "Frånvaro",
  partial: "Delvis frånvaro",
  off: "Ledig",
};

export function exportFilename(start: string, end: string): string {
  return `tidrapport-${start}_${end}.xlsx`;
}

/** The sheets of a period report as plain data (no SheetJS) — what the workbook is made of. */
export function buildReportSheets(
  state: ExportState,
  start: string,
  end: string,
  opts: ReportOptions = {},
): ExportSheet[] {
  const today = opts.today ?? todayLocal();
  const now = opts.now ?? Date.now();
  const ctx: DayContext & { flexBaseDate?: string } = {
    sessions: state.sessions,
    absences: state.absences,
    schedule: state.schedules,
    exceptions: state.scheduleExceptions,
    reportingMode: state.reportingMode ?? resolveReportingMode({ sessions: state.sessions }),
    trackingStartDate: state.trackingStartDate,
    today,
    now,
    autoLunchThresholdMin: state.autoLunchThresholdMin,
    confirmedDays: state.confirmedDays,
    lockedMonths: state.lockedMonths,
    dayAdjustments: state.dayAdjustments,
    travelFor: opts.travelFor,
    flexBaseDate: state.flexBaseDate,
  };

  // ── Pass + per-day figures ──
  const passRows: ExportCell[][] = [[...SESSION_HEADERS]];
  const dayRows: ExportCell[][] = [
    ["Datum", "Status", "Norm (h)", "Arbetat (h)", "Flex (h)", "Så räknades dagen"],
  ];
  let workedMin = 0;
  let normMin = 0;
  let excusedMin = 0;
  let flexAbsMin = 0;
  let missing = 0;
  let unconfirmed = 0;
  let days = 0;
  for (let d = start; d <= end && days < MAX_DAYS; d = addDaysStr(d, 1), days++) {
    const ev = evaluateDay(d, ctx);
    const cfg = getEffectiveDayConfig(d, state.schedules, state.scheduleExceptions);
    const beforeBase = !!state.flexBaseDate && d <= state.flexBaseDate;
    const flexDelta = beforeBase ? 0 : ev.flexDelta;
    if (ev.status === "reported" || ev.status === "partial") {
      workedMin += ev.workedMin;
    }
    normMin += ev.normMin;
    excusedMin += ev.absence.excusedMin;
    flexAbsMin += ev.absence.flexMin;
    if (!beforeBase) {
      if (ev.status === "missing") missing++;
      if (ev.status === "unconfirmed") unconfirmed++;
    }
    if (ev.status !== "off" || ev.workedMin > 0) {
      dayRows.push([
        date(d),
        STATUS_LABEL[ev.status],
        hours(ev.normMin),
        hours(ev.workedMin),
        hours(flexDelta),
        (beforeBase
          ? ["Före saldodatum – räknas inte i flexsaldot", ...ev.explanation]
          : ev.explanation
        ).join(" · "),
      ]);
    }

    // Pass rows (only days with reported time)
    if (ev.status === "ongoing") continue;
    const adj = state.dayAdjustments?.[d];
    const done = sessionsOn(state.sessions, d)
      .filter((s) => typeof s.checkOut === "number")
      .sort((a, b) => a.checkIn - b.checkIn);
    if (adj) {
      // An adjustment replaces the day's sessions in evaluateDay, so it is the row.
      const s = adj.start ?? (cfg.active ? cfg.startTime : undefined);
      const e = adj.end ?? (cfg.active ? cfg.endTime : undefined);
      if (s && e) {
        passRows.push([
          date(d),
          time(s),
          time(e),
          ev.breakMin > 0 ? ev.breakMin : null,
          adj.note ? `Justerad dag – ${adj.note}` : "Justerad dag",
        ]);
        continue;
      }
    }
    if (done.length > 0) {
      for (const s of done) {
        const brk = done.length === 1 ? ev.breakMin : (s.breakMinutes ?? 0);
        passRows.push([
          date(d),
          time(hmOf(s.checkIn)),
          time(hmOf(s.checkOut as number)),
          brk > 0 ? brk : null,
          s.note ?? null,
        ]);
      }
      continue;
    }
    if ((ev.status === "reported" || ev.status === "partial") && cfg.active && ev.workedMin > 0) {
      // Confirmed "Enligt schema" / locked month: the scheduled hours, sized to the worked time.
      const s = toMin(cfg.startTime);
      const e = Math.min(23 * 60 + 59, s + ev.workedMin + ev.breakMin);
      passRows.push([
        date(d),
        time(cfg.startTime),
        time(hhmm(e)),
        ev.breakMin > 0 ? ev.breakMin : null,
        "Enligt schema",
      ]);
    }
  }

  // ── Frånvaro (clipped to the period) ──
  const absenceLabel = new Map<string, string>(ABSENCE_TYPE_LABELS.map(([l, c]) => [c, l]));
  const absRows: ExportCell[][] = [[...ABSENCE_HEADERS]];
  for (const a of [...state.absences].sort((x, y) => x.startDate.localeCompare(y.startDate))) {
    if (a.endDate < start || a.startDate > end) continue;
    absRows.push([
      date(a.startDate < start ? start : a.startDate),
      date(a.endDate > end ? end : a.endDate),
      absenceLabel.get(a.category) ?? ABSENCE_LABEL[a.category] ?? a.category,
      a.hours ?? null,
      a.note ?? null,
    ]);
  }

  // ── Utlägg ──
  const expLabel = new Map<string, string>(EXPENSE_TYPE_LABELS.map(([l, c]) => [c, l]));
  const expRows: ExportCell[][] = [[...EXPENSE_HEADERS]];
  let expenseTotal = 0;
  let kmTotal = 0;
  let noReceipt = 0;
  for (const e of [...state.expenses].sort((x, y) => x.date.localeCompare(y.date))) {
    if (e.date < start || e.date > end) continue;
    expenseTotal += e.amount ?? 0;
    kmTotal += e.km ?? 0;
    if (!e.hasReceipt) noReceipt++;
    expRows.push([
      date(e.date),
      expLabel.get(e.category) ?? e.category,
      e.amount !== undefined ? { v: e.amount, z: "#,##0.00" } : null,
      e.km ?? null,
      e.hasReceipt ? RECEIPT_LABELS[0] : RECEIPT_LABELS[1],
      e.note ?? null,
    ]);
  }

  // ── Flex ──
  const flexPeriod = computeFlex(ctx, { from: start, to: end }).minutes;
  const flexAtEnd = (state.flexBaseMinutes ?? 0) + computeFlex(ctx, { to: end }).minutes;

  // ── Sammanfattning ──
  const summary: ExportCell[][] = [
    ["Tidrapport"],
    ["Namn", state.name || null],
    ["Avdelning", state.department || null],
    ["Period", `${start} – ${end}`],
    ["Rapportläge", ctx.reportingMode === "schedule" ? "Enligt schema" : "Stämpla"],
    [],
    ["Summering"],
    ["Arbetad tid (h)", hours(workedMin)],
    ["Norm (h)", hours(normMin)],
    ["Flex under perioden (h)", hours(flexPeriod)],
    ["Flexsaldo vid periodens slut (h)", hours(flexAtEnd)],
    ["Frånvaro, minskar normen (h)", hours(excusedMin)],
    ["Flexuttag (h)", hours(flexAbsMin)],
    [],
    ["Dagar som saknas", missing],
    ["Dagar som inte är bekräftade", unconfirmed],
    [],
    ["Utlägg totalt (kr)", { v: Math.round(expenseTotal * 100) / 100, z: "#,##0.00" }],
    ["Km totalt", Math.round(kmTotal * 100) / 100],
    ["Utlägg utan kvitto", noReceipt],
    ...(opts.extraSummary ? [[] as ExportCell[], ...opts.extraSummary] : []),
    [],
    ["Dag för dag"],
    ...dayRows,
  ];

  // ── Saldon ──
  const balances: ExportCell[][] = [
    [...BALANCE_HEADERS],
    [
      BALANCE_LABELS.asOf,
      date(end),
      "Datumet saldona nedan gäller. Appen räknar vidare från dagen efter.",
    ],
    [
      BALANCE_LABELS.flexHours,
      hours(flexAtEnd),
      "Plus eller minus i timmar, till exempel 12,5 eller -3,25.",
    ],
    [BALANCE_LABELS.vacationLeft, null, "Hela dagar kvar innevarande semesterår."],
    [BALANCE_LABELS.vacationSaved, null, "Sparade dagar från tidigare år."],
  ];

  const lists: ExportCell[][] = [["Frånvarotyp", "Utläggstyp", "Kvitto", "Mallversion"]];
  const n = Math.max(ABSENCE_TYPE_LABELS.length, EXPENSE_TYPE_LABELS.length);
  for (let i = 0; i < n; i++) {
    lists.push([
      ABSENCE_TYPE_LABELS[i]?.[0] ?? null,
      EXPENSE_TYPE_LABELS[i]?.[0] ?? null,
      RECEIPT_LABELS[i] ?? null,
      i === 0 ? TEMPLATE_VERSION : null,
    ]);
  }

  return [
    { name: "Sammanfattning", rows: summary, widths: [34, 18, 12, 14, 12, 90] },
    { name: SHEETS.sessions, rows: passRows, widths: [14, 10, 10, 12, 40] },
    { name: SHEETS.absences, rows: absRows, widths: [14, 14, 20, 10, 40] },
    { name: SHEETS.expenses, rows: expRows, widths: [14, 18, 13, 8, 9, 40] },
    ...(opts.extraSheets ?? []),
    { name: SHEETS.balances, rows: balances, widths: [28, 16, 60] },
    { name: SHEETS.lists, rows: lists, hidden: true },
  ];
}

/** The report as an .xlsx file (bytes). SheetJS is loaded on demand. */
export async function buildReportWorkbook(
  state: ExportState,
  start: string,
  end: string,
  opts: ReportOptions = {},
): Promise<Uint8Array> {
  const XLSX = await loadXlsx();
  const sheets = buildReportSheets(state, start, end, opts);
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws: import("xlsx").WorkSheet = {};
    let maxC = 0;
    sheet.rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell === null || cell === undefined || cell === "") return;
        const addr = XLSX.utils.encode_cell({ r, c });
        if (typeof cell === "number") ws[addr] = { t: "n", v: cell };
        else if (typeof cell === "string") ws[addr] = { t: "s", v: cell };
        else ws[addr] = { t: "n", v: cell.v, z: cell.z };
        if (c > maxC) maxC = c;
      });
    });
    ws["!ref"] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(0, sheet.rows.length - 1), c: Math.max(0, maxC) },
    });
    if (sheet.widths) ws["!cols"] = sheet.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  wb.Workbook = {
    Sheets: sheets.map((s) => ({ name: s.name, Hidden: s.hidden ? 1 : 0 })),
  };
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true });
  return new Uint8Array(out as ArrayBuffer);
}
