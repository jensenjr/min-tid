// Report builder: one row per day from evaluateDay, so the report, the CSV and the share
// text always agree with the flex card and the calendar. Pure — no React, no DOM.
import { addDaysStr, getEffectiveDayConfig } from "./schedule";
import { hmLocal, weekKey } from "./dates";
import { ABSENCE_LABEL, absenceForDay } from "./absence";
import {
  type DayContext,
  type DayStatus,
  evaluateDay,
  fmtDuration,
  fmtSignedDuration,
  isHm,
  sessionsOn,
} from "./days";
import { weekRangeLabel } from "./format";
import type { AbsenceCategory, ExpenseCategory, ExpenseEntry } from "./types";

// Same labels as EXPENSE_META in ExpenseModal.tsx (a test keeps them in step).
export const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  milersattning: "Milersättning",
  traktamente: "Traktamente",
  resetimmar: "Resetimmar",
  parkering: "Parkering",
  kost: "Kost",
  representation: "Representation",
  ovrigt: "Övrigt",
};

export const STATUS_LABEL: Record<DayStatus, string> = {
  reported: "Registrerad",
  partial: "Delvis frånvaro",
  absent: "Frånvaro",
  unconfirmed: "Ej bekräftad (enligt schema)",
  missing: "Saknas",
  ongoing: "Pågår",
  off: "Ledig",
};

export type TimeSource = "sessions" | "adjustment" | "schedule" | "ongoing" | "none";

export const SOURCE_LABEL: Record<TimeSource, string> = {
  sessions: "Stämplat",
  adjustment: "Justerat",
  schedule: "Enligt schema",
  ongoing: "Pågår",
  none: "",
};

export type AbsenceLine = {
  category: AbsenceCategory;
  label: string;
  minutes: number; // as requested for this day (before the cap at the norm)
  flex: boolean;
  fullDay: boolean;
};

export type ReportRow = {
  date: string;
  status: DayStatus;
  normMin: number;
  expectedMin: number; // norm minus excused absence
  workedMin: number;
  breakMin: number;
  flexDelta: number;
  start?: string; // "HH:MM"
  end?: string;
  timeSource: TimeSource;
  absences: AbsenceLine[];
  note?: string;
  explanation: string[];
};

export type ReportTotals = {
  workedMin: number; // counted work (sessions, adjustments, per schedule for unconfirmed/confirmed)
  expectedMin: number; // what the counted days asked for (norm − excused absence)
  flexMin: number; // Σ flexDelta — the same figure the flex card folds
  workedDays: number;
  missingDays: string[]; // punch mode: nothing registered
  unconfirmedDays: string[]; // schedule mode: counted per schedule, not yet confirmed
};

export type AbsenceTotal = {
  category: AbsenceCategory;
  label: string;
  minutes: number;
  days: number;
};

export type Report = {
  start: string;
  end: string;
  rows: ReportRow[];
  totals: ReportTotals;
  absences: AbsenceTotal[];
};

const isOpen = (s: { checkOut: number | null }) => s.checkOut === null || s.checkOut === undefined;

/** Build the per-day rows and totals for [start, end] (inclusive local day keys). */
export function buildReport(ctx: DayContext, start: string, end: string): Report {
  const rows: ReportRow[] = [];
  const totals: ReportTotals = {
    workedMin: 0,
    expectedMin: 0,
    flexMin: 0,
    workedDays: 0,
    missingDays: [],
    unconfirmedDays: [],
  };
  const absByCat = new Map<AbsenceCategory, AbsenceTotal>();
  // Freeze the clock so every day sees the same "now".
  const c: DayContext = { ...ctx, today: ctx.today, now: ctx.now ?? Date.now() };

  for (let date = start; date <= end; date = addDaysStr(date, 1)) {
    const cfg = getEffectiveDayConfig(date, c.schedule, c.exceptions ?? {});
    const ev = evaluateDay(date, c);
    const abs = absenceForDay(c.absences, date, cfg);
    const absences: AbsenceLine[] = abs.items.map((i) => ({
      category: i.entry.category,
      label: ABSENCE_LABEL[i.entry.category] ?? i.entry.category,
      minutes: i.minutes,
      flex: i.flex,
      fullDay: i.entry.hours === undefined,
    }));

    const daySessions = sessionsOn(c.sessions, date);
    const done = daySessions.filter((s) => !isOpen(s)).sort((a, b) => a.checkIn - b.checkIn);
    const open = daySessions.filter(isOpen);
    const adj = c.dayAdjustments?.[date];
    let startHm: string | undefined;
    let endHm: string | undefined;
    let timeSource: TimeSource = "none";
    const scheduled = ev.normMin > 0;
    const adjStart = adj && (isHm(adj.start) ? adj.start : scheduled ? cfg.startTime : undefined);
    const adjEnd = adj && (isHm(adj.end) ? adj.end : scheduled ? cfg.endTime : undefined);
    if (open.length > 0) {
      startHm = hmLocal(open[0].checkIn);
      timeSource = "ongoing";
    } else if (adjStart && adjEnd) {
      startHm = adjStart;
      endHm = adjEnd;
      timeSource = "adjustment";
    } else if (done.length > 0) {
      startHm = hmLocal(done[0].checkIn);
      endHm = hmLocal(Math.max(...done.map((s) => s.checkOut as number)));
      timeSource = "sessions";
    } else if (ev.workedMin > 0 && scheduled) {
      startHm = cfg.startTime;
      endHm = cfg.endTime;
      timeSource = "schedule";
    }

    const notes: string[] = [];
    if (adj?.note) notes.push(adj.note);
    for (const s of done) if (s.note) notes.push(s.note);

    for (const a of absences) {
      const t = absByCat.get(a.category) ?? {
        category: a.category,
        label: a.label,
        minutes: 0,
        days: 0,
      };
      t.minutes += a.minutes;
      t.days += 1;
      absByCat.set(a.category, t);
    }

    const include = ev.status !== "off" || ev.workedMin > 0 || absences.length > 0 || !!adj;
    if (!include) continue;

    const expectedMin = Math.max(0, ev.normMin - ev.absence.excusedMin);
    rows.push({
      date,
      status: ev.status,
      normMin: ev.normMin,
      expectedMin,
      workedMin: ev.workedMin,
      breakMin: ev.breakMin,
      flexDelta: ev.flexDelta,
      start: startHm,
      end: endHm,
      timeSource,
      absences,
      note: notes.length ? notes.join(" · ") : undefined,
      explanation: ev.explanation,
    });

    if (ev.status !== "off" || ev.workedMin > 0) {
      totals.workedMin += ev.workedMin;
      if (ev.status !== "ongoing") totals.expectedMin += expectedMin;
      totals.flexMin += ev.flexDelta;
      if (ev.workedMin > 0) totals.workedDays += 1;
    }
    if (ev.status === "missing") totals.missingDays.push(date);
    if (ev.status === "unconfirmed") totals.unconfirmedDays.push(date);
  }

  return {
    start,
    end,
    rows,
    totals,
    absences: [...absByCat.values()].sort((a, b) => b.minutes - a.minutes),
  };
}

// ─── Periods ──────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");

/** First/last day key and label of a month (month is 0-based like Date). */
export function monthPeriod(year: number, month: number) {
  const start = `${year}-${pad(month + 1)}-01`;
  const end = `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`;
  const raw = new Date(year, month).toLocaleDateString("sv-SE", { month: "long", year: "numeric" });
  return {
    start,
    end,
    label: raw.charAt(0).toUpperCase() + raw.slice(1),
    fileLabel: `${year}-${pad(month + 1)}`,
  };
}

export type ReportPeriod = { start: string; end: string; label: string; fileLabel: string };

export function rangePeriod(from: string, to: string): ReportPeriod {
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  return { start, end, label: `${start} – ${end}`, fileLabel: `${start}_${end}` };
}

// ─── CSV ──────────────────────────────────────────────────────
const WEEKDAY = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("sv-SE", { weekday: "long" });

const hours = (min: number) => (min / 60).toFixed(2).replace(".", ",");

/** One row per day (not per session). BOM-prefixed so Excel reads UTF-8. */
export function buildCsv(report: Report): string {
  const header = [
    "Datum",
    "Veckodag",
    "Status",
    "Källa",
    "Start",
    "Slut",
    "Rast (min)",
    "Arbetad (min)",
    "Arbetad (h)",
    "Norm (min)",
    "Flex (min)",
    "Frånvaro",
    "Anteckning",
  ];
  const rows = report.rows.map((r) => [
    r.date,
    WEEKDAY(r.date),
    STATUS_LABEL[r.status],
    SOURCE_LABEL[r.timeSource],
    r.start ?? "",
    r.end ?? "",
    String(r.breakMin),
    String(r.workedMin),
    hours(r.workedMin),
    String(r.expectedMin),
    String(r.flexDelta),
    r.absences.map((a) => `${a.label}${a.fullDay ? "" : ` ${fmtDuration(a.minutes)}`}`).join(", "),
    r.note ?? "",
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  return "﻿" + csv;
}

// ─── Share text ───────────────────────────────────────────────
export function buildShareText(
  report: Report,
  opts: {
    name: string;
    periodLabel: string;
    expenses: ExpenseEntry[];
    mode: "schedule" | "punch";
    generatedAt?: Date;
  },
): string {
  const { rows, totals } = report;
  const lines: string[] = [
    `⏱ Tidrapport${opts.name ? " – " + opts.name : ""}`,
    `📅 ${opts.periodLabel}\n`,
  ];

  if (totals.unconfirmedDays.length > 0) {
    const n = totals.unconfirmedDays.length;
    lines.push(
      `⚠ ${n} ${n === 1 ? "dag är" : "dagar är"} inte bekräftade och räknas enligt schema.\n`,
    );
  }
  if (totals.missingDays.length > 0) {
    const n = totals.missingDays.length;
    lines.push(`⚠ ${n} ${n === 1 ? "dag saknas" : "dagar saknas"} (ingen registrering).\n`);
  }
  if (rows.length === 0) lines.push("Inga registreringar i perioden.");

  const weekMap = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const wk = weekKey(new Date(r.date + "T12:00:00"));
    const list = weekMap.get(wk);
    if (list) list.push(r);
    else weekMap.set(wk, [r]);
  }
  for (const wk of [...weekMap.keys()].sort((a, b) => b.localeCompare(a))) {
    const wRows = (weekMap.get(wk) as ReportRow[]).sort((a, b) => a.date.localeCompare(b.date));
    const wWorked = wRows.reduce((s, r) => s + r.workedMin, 0);
    const wFlex = wRows.reduce((s, r) => s + r.flexDelta, 0);
    lines.push(`── ${weekRangeLabel(wk)} ──`);
    lines.push(`Totalt: ${fmtDuration(wWorked)}  (flex ${fmtSignedDuration(wFlex)})\n`);
    for (const r of wRows) {
      const label = new Date(r.date + "T12:00:00").toLocaleDateString("sv-SE", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      const span = r.start ? ` (${r.start}${r.end ? `–${r.end}` : " →"})` : "";
      const src = r.timeSource === "schedule" ? " · enligt schema" : "";
      if (r.workedMin > 0 || r.status === "ongoing") {
        lines.push(`  ${label}: ${fmtDuration(r.workedMin)}${span}${src}`);
      } else if (r.status === "missing") {
        lines.push(`  ${label}: saknas`);
      } else {
        lines.push(`  ${label}`);
      }
      for (const a of r.absences) {
        lines.push(`    ${a.label}${a.fullDay ? " (hel dag)" : ` ${fmtDuration(a.minutes)}`}`);
      }
      if (r.note) lines.push(`    ${r.note}`);
    }
    lines.push("");
  }

  if (rows.length > 0) {
    lines.push(
      `Total: ${fmtDuration(totals.workedMin)} · flex ${fmtSignedDuration(totals.flexMin)}`,
    );
  }

  const periodExpenses = opts.expenses
    .filter((e) => e.date >= report.start && e.date <= report.end)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (periodExpenses.length > 0) {
    lines.push(`\n── Utlägg ──`);
    let total = 0;
    for (const e of periodExpenses) {
      const parts: string[] = [];
      if (e.km != null) parts.push(`${e.km} km`);
      if (e.amount != null) parts.push(`${e.amount} kr`);
      const detail = parts.length ? ` — ${parts.join(" · ")}` : "";
      lines.push(
        `  ${e.date}: ${EXPENSE_LABEL[e.category] ?? e.category}${detail}${e.hasReceipt ? " (kvitto)" : ""}${e.note ? ` (${e.note})` : ""}`,
      );
      total += e.amount ?? 0;
    }
    lines.push(`Total utlägg: ${total} kr`);
  }

  lines.push(`\nGenererat ${(opts.generatedAt ?? new Date()).toLocaleString("sv-SE")}`);
  return lines.join("\n");
}
