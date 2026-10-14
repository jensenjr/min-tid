import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE } from "../schedule";
import { evaluateDay, type DayContext } from "../days";
import { computeFlex } from "../flex";
import {
  EXPENSE_LABEL,
  buildCsv,
  buildReport,
  buildShareText,
  monthPeriod,
  rangePeriod,
} from "../report";
import { EXPENSE_META } from "../../components/ExpenseModal";
import type { ExpenseEntry } from "../types";
import { absence, at, session } from "./helpers";

// Wednesday 2026-10-14, 18:00 local. Default schedule: Mon–Fri 08:00–17:00, 60 min lunch.
const TODAY = "2026-10-14";

function ctx(over: Partial<DayContext> = {}): DayContext {
  return {
    sessions: [],
    absences: [],
    schedule: DEFAULT_SCHEDULE,
    exceptions: {},
    reportingMode: "punch",
    trackingStartDate: "2026-10-01",
    today: TODAY,
    now: at(TODAY, "18:00"),
    ...over,
  };
}

describe("buildReport", () => {
  it("agrees with the flex card: totals.flexMin == computeFlex over the same range", () => {
    const c = ctx({
      sessions: [
        session("2026-10-01", "08:00", "17:00"),
        session("2026-10-02", "08:00", "16:00"),
        session("2026-10-05", "08:00", "12:00"),
        session("2026-10-05", "13:00", "17:30"),
      ],
      absences: [absence("flex", "2026-10-06")],
    });
    const r = buildReport(c, "2026-10-01", "2026-10-31");
    expect(r.totals.flexMin).toBe(computeFlex(c, { from: "2026-10-01", to: "2026-10-31" }).minutes);
  });

  it("builds one row per day, not per session", () => {
    const c = ctx({
      sessions: [session("2026-10-05", "08:00", "12:00"), session("2026-10-05", "13:00", "17:00")],
    });
    const r = buildReport(c, "2026-10-05", "2026-10-05");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      workedMin: 480,
      breakMin: 0,
      start: "08:00",
      end: "17:00",
      timeSource: "sessions",
    });
  });

  it("applies the single-session lunch rule exactly like evaluateDay", () => {
    const c = ctx({ sessions: [session("2026-10-05", "08:00", "17:00")] });
    const r = buildReport(c, "2026-10-05", "2026-10-05");
    expect(r.rows[0].workedMin).toBe(evaluateDay("2026-10-05", c).workedMin);
    expect(r.rows[0].workedMin).toBe(480);
    expect(r.rows[0].breakMin).toBe(60);
  });

  it("schedule mode: unconfirmed days count per schedule and are listed", () => {
    const c = ctx({ reportingMode: "schedule", trackingStartDate: "2026-10-12" });
    const r = buildReport(c, "2026-10-12", "2026-10-14");
    expect(r.totals.unconfirmedDays).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(r.totals.workedMin).toBe(3 * 480);
    expect(r.totals.flexMin).toBe(0);
    expect(r.rows.every((x) => x.timeSource === "schedule")).toBe(true);
  });

  it("an adjustment shows its own times and note", () => {
    const c = ctx({
      reportingMode: "schedule",
      dayAdjustments: {
        "2026-10-13": {
          date: "2026-10-13",
          start: "09:00",
          end: "16:00",
          breakMin: 30,
          note: "Tandläkare",
        },
      },
    });
    const r = buildReport(c, "2026-10-13", "2026-10-13");
    expect(r.rows[0]).toMatchObject({
      start: "09:00",
      end: "16:00",
      workedMin: 390,
      breakMin: 30,
      timeSource: "adjustment",
      note: "Tandläkare",
      flexDelta: -90,
    });
  });

  it("missing punch-mode days are listed and do not count", () => {
    const c = ctx({ sessions: [session("2026-10-01", "08:00", "17:00")] });
    const r = buildReport(c, "2026-10-01", "2026-10-14");
    expect(r.totals.missingDays).toContain("2026-10-12");
    expect(r.totals.missingDays).not.toContain("2026-10-10"); // Saturday
  });

  it("totals absences by category, ignoring days off", () => {
    const c = ctx({
      absences: [
        absence("semester", "2026-10-08", "2026-10-12"),
        absence("vab", "2026-10-14", "2026-10-14", 4),
      ],
    });
    const r = buildReport(c, "2026-10-01", "2026-10-31");
    const sem = r.absences.find((a) => a.category === "semester");
    expect(sem).toMatchObject({ days: 3, minutes: 3 * 480 }); // Thu, Fri, Mon — the weekend costs nothing
    expect(r.absences.find((a) => a.category === "vab")).toMatchObject({ days: 1, minutes: 240 });
  });

  it("does not list empty days off", () => {
    const r = buildReport(ctx(), "2026-10-17", "2026-10-18");
    expect(r.rows).toEqual([]);
  });

  it("a locked month reads per schedule", () => {
    const c = ctx({
      reportingMode: "schedule",
      lockedMonths: { "2026-10": { at: 1, by: "Anna" } },
    });
    const r = buildReport(c, "2026-10-05", "2026-10-05");
    expect(r.rows[0].status).toBe("reported");
    expect(r.rows[0].workedMin).toBe(480);
  });
});

describe("periods", () => {
  it("builds a month period with local keys", () => {
    expect(monthPeriod(2026, 9)).toMatchObject({
      start: "2026-10-01",
      end: "2026-10-31",
      label: "Oktober 2026",
      fileLabel: "2026-10",
    });
    expect(monthPeriod(2026, 1).end).toBe("2026-02-28");
  });
  it("orders a reversed range", () => {
    expect(rangePeriod("2026-10-20", "2026-10-10")).toMatchObject({
      start: "2026-10-10",
      end: "2026-10-20",
    });
  });
});

describe("buildCsv", () => {
  it("has one row per day with a BOM, quoted cells and a flex column", () => {
    const c = ctx({
      sessions: [session("2026-10-05", "08:00", "16:00")],
      absences: [absence("vab", "2026-10-06", "2026-10-06", 4)],
    });
    const csv = buildCsv(buildReport(c, "2026-10-05", "2026-10-06"));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"Flex (min)"');
    expect(lines[1]).toContain('"2026-10-05"');
    expect(lines[1]).toContain('"420"'); // 8 h − 1 h lunch
    expect(lines[2]).toContain("VAB");
  });

  it("escapes quotes in notes", () => {
    const c = ctx({
      reportingMode: "schedule",
      dayAdjustments: { "2026-10-05": { date: "2026-10-05", note: 'Sa "hej"' } },
    });
    expect(buildCsv(buildReport(c, "2026-10-05", "2026-10-05"))).toContain('"Sa ""hej"""');
  });
});

describe("buildShareText", () => {
  const expenses: ExpenseEntry[] = [
    {
      id: "x1",
      category: "parkering",
      date: "2026-10-05",
      amount: 60,
      hasReceipt: true,
      manual: true,
    },
    { id: "x2", category: "kost", date: "2026-11-05", amount: 99, hasReceipt: false, manual: true },
  ];

  it("lists weeks, days, absences, period expenses and warns about unconfirmed days", () => {
    const c = ctx({
      reportingMode: "schedule",
      absences: [absence("vab", "2026-10-06")],
    });
    const text = buildShareText(buildReport(c, "2026-10-05", "2026-10-14"), {
      name: "Anna",
      periodLabel: "Oktober 2026",
      expenses,
      mode: "schedule",
      generatedAt: new Date("2026-10-14T18:00:00"),
    });
    expect(text).toContain("Tidrapport – Anna");
    expect(text).toContain("inte bekräftade");
    expect(text).toContain("Vecka 41");
    expect(text).toContain("VAB (hel dag)");
    expect(text).toContain("Parkering");
    expect(text).not.toContain("Kost");
    expect(text).toContain("Total utlägg: 60 kr");
  });

  it("says so when the period is empty", () => {
    const text = buildShareText(buildReport(ctx(), "2026-10-17", "2026-10-18"), {
      name: "",
      periodLabel: "x",
      expenses: [],
      mode: "punch",
    });
    expect(text).toContain("Inga registreringar i perioden.");
  });
});

describe("labels", () => {
  it("EXPENSE_LABEL matches ExpenseModal's META", () => {
    for (const [k, v] of Object.entries(EXPENSE_META)) {
      expect(EXPENSE_LABEL[k as keyof typeof EXPENSE_LABEL]).toBe(v.label);
    }
  });
});

describe("buildReport and flexBaseDate", () => {
  it("the report's flex total equals computeFlex for a period spanning flexBaseDate", () => {
    const c = ctx({
      sessions: [
        session("2026-10-05", "08:00", "18:00"), // +60, inside the opening balance
        session("2026-10-06", "08:00", "18:00"), // +60, the balance date itself: inside
        session("2026-10-07", "08:00", "17:30"), // +30, counts
        session("2026-10-08", "08:00", "16:00"), // −60, counts
      ],
      flexBaseDate: "2026-10-06",
    });
    const report = buildReport(c, "2026-10-01", "2026-10-14");
    const fold = computeFlex(c, { from: "2026-10-01", to: "2026-10-14" }).minutes;
    expect(report.totals.flexMin).toBe(fold);
    expect(fold).toBe(-30);
    // without the date the same period would count the first two days as well
    const plain = buildReport({ ...c, flexBaseDate: undefined }, "2026-10-01", "2026-10-14");
    expect(plain.totals.flexMin).toBe(90);
  });
});
