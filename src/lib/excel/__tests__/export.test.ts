import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildReportSheets, buildReportWorkbook, exportFilename } from "../export";
import { parseWorkbook } from "../parse";
import { evaluateDay } from "../../days";
import { migrateSchedules } from "../../schedule";
import type { AbsenceEntry, ExpenseEntry, Session } from "../../types";
import type { ExportState } from "../export";

const at = (d: string, hm: string) => new Date(`${d}T${hm}:00`).getTime();
const sess = (id: string, d: string, from: string, to: string, extra: Partial<Session> = {}) =>
  ({ id, checkIn: at(d, from), checkOut: at(d, to), manual: true, ...extra }) as Session;

const absences: AbsenceEntry[] = [
  { id: "a1", category: "vab", startDate: "2026-03-09", endDate: "2026-03-09", manual: true },
];
const expenses: ExpenseEntry[] = [
  {
    id: "e1",
    category: "parkering",
    date: "2026-03-05",
    amount: 85.5,
    hasReceipt: true,
    manual: true,
  },
  {
    id: "e2",
    category: "milersattning",
    date: "2026-03-06",
    km: 42,
    hasReceipt: false,
    manual: true,
  },
  { id: "e3", category: "kost", date: "2026-02-20", amount: 99, hasReceipt: true, manual: true },
];

const state: ExportState = {
  name: "Anna Demo",
  department: "Support",
  schedules: migrateSchedules({}),
  scheduleExceptions: {},
  reportingMode: "schedule",
  trackingStartDate: "2026-03-02",
  flexBaseMinutes: 600, // 10 h at the end of 03-01
  flexBaseDate: "2026-03-01",
  sessions: [
    sess("s1", "2026-03-02", "08:00", "12:00"),
    sess("s2", "2026-03-02", "13:00", "17:00"),
    sess("s3", "2026-03-03", "07:30", "17:30", { note: "tidig start" }), // 10 h − auto lunch 1 h
  ],
  absences,
  expenses,
  dayAdjustments: {
    "2026-03-04": {
      date: "2026-03-04",
      start: "09:00",
      end: "15:00",
      breakMin: 30,
      note: "tandläkare",
    },
  },
  confirmedDays: { "2026-03-05": true },
};
const opts = { today: "2026-03-13", now: at("2026-03-13", "12:00") };
const START = "2026-03-02";
const END = "2026-03-13";

const sheet = (name: string) =>
  buildReportSheets(state, START, END, opts).find((s) => s.name === name)!;
const cellValue = (c: unknown) => (c && typeof c === "object" ? (c as { v: number }).v : c);

describe("buildReportSheets", () => {
  it("has the template sheets plus a summary first, Listor hidden last", () => {
    const sheets = buildReportSheets(state, START, END, opts);
    expect(sheets.map((s) => s.name)).toEqual([
      "Sammanfattning",
      "Pass",
      "Frånvaro",
      "Utlägg",
      "Saldon",
      "Listor",
    ]);
    expect(sheets.find((s) => s.name === "Listor")?.hidden).toBe(true);
    expect(sheet("Pass").rows[0]).toEqual(["Datum", "Start", "Slut", "Rast (min)", "Kommentar"]);
    expect(sheet("Frånvaro").rows[0]).toEqual([
      "Från datum",
      "Till datum",
      "Typ",
      "Timmar",
      "Kommentar",
    ]);
    expect(sheet("Utlägg").rows[0]).toEqual([
      "Datum",
      "Typ",
      "Belopp (kr)",
      "Km",
      "Kvitto",
      "Kommentar",
    ]);
  });

  it("Pass: sessions, the adjustment and the confirmed day — not the unconfirmed ones", () => {
    const rows = sheet("Pass").rows.slice(1);
    const fmt = (r: unknown[]) =>
      [r[1], r[2], r[3], r[4]].map((c) =>
        typeof c === "object" && c ? Math.round((c as { v: number }).v * 1440) : c,
      );
    expect(rows).toHaveLength(5);
    // 03-02: two sessions, nothing deducted (punched out for lunch)
    expect(fmt(rows[0])).toEqual([480, 720, null, null]);
    expect(fmt(rows[1])).toEqual([780, 1020, null, null]);
    // 03-03: one long session → the schedule lunch is written down as the break
    expect(fmt(rows[2])).toEqual([450, 1050, 60, "tidig start"]);
    // 03-04: the adjustment replaces sessions
    expect(fmt(rows[3])).toEqual([540, 900, 30, "Justerad dag – tandläkare"]);
    // 03-05: confirmed "Enligt schema" → the scheduled hours
    expect(fmt(rows[4])).toEqual([480, 1020, 60, "Enligt schema"]);
  });

  it("Frånvaro is clipped to the period, Utlägg is filtered to it", () => {
    const withLeave: ExportState = {
      ...state,
      absences: [
        ...absences,
        {
          id: "a2",
          category: "semester",
          startDate: "2026-02-26",
          endDate: "2026-03-20",
          hours: 8,
          note: "går över periodens gränser",
          manual: true,
        },
      ],
    };
    const abs = buildReportSheets(withLeave, "2026-03-03", "2026-03-13", opts)
      .find((s) => s.name === "Frånvaro")!
      .rows.slice(1);
    expect(abs).toHaveLength(2);
    const semester = abs.find((r) => r[2] === "Semester")!;
    expect(cellValue(semester[0])).toBe(46084); // 2026-03-03, not 02-26
    expect(cellValue(semester[1])).toBe(46094); // 2026-03-13, not 03-20
    expect(semester[3]).toBe(8);
    const exp = sheet("Utlägg").rows.slice(1);
    expect(exp.map((r) => [r[1], cellValue(r[2]) ?? null, r[3] ?? null, r[4]])).toEqual([
      ["Parkering", 85.5, null, "Ja"],
      ["Milersättning", null, 42, "Nej"],
    ]); // the February expense is out
  });

  it("the summary matches what evaluateDay says", () => {
    const rows = sheet("Sammanfattning").rows;
    const val = (label: string) => cellValue(rows.find((r) => r[0] === label)?.[1]);
    // worked: 8 + 9 + 5.5 + 8 h = 30.5 h; the unconfirmed days are not counted as reported
    expect(val("Arbetad tid (h)")).toBe(30.5);
    // flex: 0 + 60 − 150 = −90 min
    expect(val("Flex under perioden (h)")).toBe(-1.5);
    expect(val("Flexsaldo vid periodens slut (h)")).toBe(8.5); // 10 h − 1.5 h
    expect(val("Utlägg totalt (kr)")).toBe(85.5);
    expect(val("Km totalt")).toBe(42);
    expect(val("Utlägg utan kvitto")).toBe(1);
    // 03-06 and 03-10..03-12 are schedule-mode days nobody confirmed; today is still ongoing
    expect(val("Dagar som inte är bekräftade")).toBe(4);
    expect(val("Dagar som saknas")).toBe(0);
    expect(rows.some((r) => r[0] === "Namn" && r[1] === "Anna Demo")).toBe(true);
    // the per-day table is evaluateDay's explanation
    const adjusted = rows.find(
      (r) => typeof r[5] === "string" && (r[5] as string).includes("Justerad dag 09:00–15:00"),
    );
    expect(adjusted?.[1]).toBe("Rapporterad");
    expect(adjusted?.[3]).toBe(5.5);
    expect(adjusted?.[4]).toBe(-2.5);
  });

  it("days up to the balance date show flex 0", () => {
    const rows = buildReportSheets({ ...state, flexBaseDate: "2026-03-02" }, START, END, opts).find(
      (s) => s.name === "Sammanfattning",
    )!.rows;
    const mon = rows.find(
      (r) =>
        r[1] === "Rapporterad" &&
        String(r[5]).includes("Ingår i importerat flexsaldo per 2026-03-02"),
    );
    expect(mon).toBeDefined();
    expect(mon![4]).toBe(0);
  });

  it("leaves hooks for PR 8", () => {
    const sheets = buildReportSheets(state, START, END, {
      ...opts,
      extraSheets: [{ name: "Restid", rows: [["Datum", "Från", "Till", "Resmål", "Kommentar"]] }],
      extraSummary: [["Restid utanför schema (h)", 1.5]],
    });
    expect(sheets.map((s) => s.name)).toContain("Restid");
    expect(sheets[0].rows.some((r) => r[0] === "Restid utanför schema (h)")).toBe(true);
    expect(sheets.map((s) => s.name).indexOf("Restid")).toBeLessThan(
      sheets.map((s) => s.name).indexOf("Listor"),
    );
  });
});

describe("buildReportWorkbook", () => {
  it("writes an .xlsx that reads back with real dates, times and a hidden Listor", async () => {
    const bytes = await buildReportWorkbook(state, START, END, opts);
    const wb = XLSX.read(bytes, { type: "array", cellNF: true });
    expect(wb.SheetNames).toEqual([
      "Sammanfattning",
      "Pass",
      "Frånvaro",
      "Utlägg",
      "Saldon",
      "Listor",
    ]);
    expect(wb.Workbook?.Sheets?.[5]).toMatchObject({ name: "Listor", Hidden: 1 });
    expect(wb.Sheets.Pass.A2).toMatchObject({ t: "n", v: 46083, z: "yyyy-mm-dd" }); // 2026-03-02
    expect(wb.Sheets.Pass.B2.z).toBe("hh:mm");
    expect(wb.Sheets.Listor.D2.v).toBe(1);
    expect(exportFilename(START, END)).toBe("tidrapport-2026-03-02_2026-03-13.xlsx");
  });

  it("round-trips through the importer: same worked time per day, same balance", async () => {
    const parsed = await parseWorkbook(await buildReportWorkbook(state, START, END, opts));
    expect(parsed.errors).toEqual([]);
    expect(parsed.sessions).toHaveLength(5);
    expect(parsed.absences.map((a) => [a.category, a.startDate, a.endDate])).toEqual([
      ["vab", "2026-03-09", "2026-03-09"],
    ]);
    expect(parsed.expenses).toHaveLength(2);
    // Saldon: 8.5 h at the end of the period
    expect(parsed.balances).toEqual({ asOf: END, flexMinutes: 510 });

    // Same worked time per day as the original state's evaluateDay.
    const base = {
      absences: [],
      schedule: state.schedules,
      exceptions: {},
      reportingMode: "punch" as const,
      trackingStartDate: START,
      today: END,
      now: opts.now,
    };
    const again = (d: string) =>
      evaluateDay(d, { ...base, sessions: parsed.sessions }, { explain: false });
    const orig = (d: string) =>
      evaluateDay(
        d,
        {
          ...base,
          sessions: state.sessions,
          dayAdjustments: state.dayAdjustments,
          confirmedDays: state.confirmedDays,
          reportingMode: "schedule",
        },
        { explain: false },
      );
    for (const d of ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]) {
      expect([d, again(d).workedMin, again(d).flexDelta]).toEqual([
        d,
        orig(d).workedMin,
        orig(d).flexDelta,
      ]);
    }
  });
});
