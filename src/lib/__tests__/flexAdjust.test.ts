import { describe, expect, it } from "vitest";
import type { DayContext } from "../days";
import { computeFlex, computeWeeklyFlex } from "../flex";
import { mergeFlexAdjustments, parseFlexAdjustments, sumFlexAdjustments } from "../flexAdjust";
import { buildReport, buildShareText } from "../report";
import { DEFAULT_SCHEDULE } from "../schedule";
import type { FlexAdjustment } from "../types";
import { at, session } from "./helpers";

const TODAY = "2026-03-18";

const adj = (id: string, date: string, minutes: number, note?: string): FlexAdjustment => ({
  id,
  date,
  minutes,
  note,
  at: 1,
});

function ctx(over: Partial<DayContext> = {}): DayContext {
  return {
    sessions: [session("2026-03-02", "08:00", "19:00")], // +2 h
    absences: [],
    schedule: DEFAULT_SCHEDULE,
    reportingMode: "punch",
    trackingStartDate: "2026-03-02",
    confirmedDays: {},
    today: TODAY,
    now: at(TODAY, "20:00"),
    ...over,
  };
}

describe("parseFlexAdjustments", () => {
  it("keeps valid entries sorted by date and drops junk", () => {
    expect(
      parseFlexAdjustments([
        adj("b", "2026-03-10", -600, "  Utbetald övertid "),
        { id: "x", date: "2026-3-1", minutes: 5 },
        { id: "y", date: "2026-03-01", minutes: 0 },
        { id: "", date: "2026-03-01", minutes: 5 },
        adj("a", "2026-03-05", 90.4),
        null,
      ]),
    ).toEqual([adj("a", "2026-03-05", 90), adj("b", "2026-03-10", -600, "Utbetald övertid")]);
    expect(parseFlexAdjustments(undefined)).toEqual([]);
  });

  it("mergeFlexAdjustments is a union by id, local wins", () => {
    const merged = mergeFlexAdjustments(
      [adj("a", "2026-03-05", 60), adj("b", "2026-03-06", 30)],
      [adj("a", "2026-03-05", -60), adj("c", "2026-03-04", 15)],
    );
    expect(merged.map((a) => [a.id, a.minutes])).toEqual([
      ["c", 15],
      ["a", -60],
      ["b", 30],
    ]);
  });

  it("sumFlexAdjustments over a range", () => {
    const list = [adj("a", "2026-03-05", 60), adj("b", "2026-03-20", -30)];
    expect(sumFlexAdjustments(list)).toBe(30);
    expect(sumFlexAdjustments(list, "2026-03-06")).toBe(-30);
    expect(sumFlexAdjustments(list, undefined, "2026-03-19")).toBe(60);
  });
});

describe("flex with manual adjustments", () => {
  const list = [
    adj("a", "2026-03-10", -600, "Utbetald övertid"),
    adj("b", "2026-03-25", 120), // future: not counted yet
  ];

  it("computeFlex adds the adjustments dated in its range, never future ones", () => {
    const base = computeFlex(ctx()).minutes;
    expect(base).toBe(120);
    expect(computeFlex(ctx({ flexAdjustments: list })).minutes).toBe(120 - 600);
    expect(
      computeFlex(ctx({ flexAdjustments: list }), { from: "2026-03-09", to: "2026-03-15" }).minutes,
    ).toBe(-600);
    expect(
      computeFlex(ctx({ flexAdjustments: list }), { from: "2026-03-02", to: "2026-03-08" }).minutes,
    ).toBe(120);
  });

  it("counts even without a flex start", () => {
    expect(computeFlex(ctx({ trackingStartDate: undefined, flexAdjustments: list })).minutes).toBe(
      -600,
    );
  });

  it("shows up in the week it is dated in", () => {
    const weeks = computeWeeklyFlex(ctx({ flexAdjustments: list }), 3);
    expect(weeks.map((w) => [w.mondayStr, w.minutes])).toEqual([
      ["2026-03-16", 0],
      ["2026-03-09", -600],
      ["2026-03-02", 120],
    ]);
  });

  it("the report includes them in the flex total and lists them in the share text", () => {
    const r = buildReport(ctx({ flexAdjustments: list }), "2026-03-01", "2026-03-31");
    expect(r.flexAdjustments.map((a) => a.id)).toEqual(["a"]);
    expect(r.totals.flexMin).toBe(120 - 600);
    const text = buildShareText(r, {
      name: "Anna",
      periodLabel: "Mars 2026",
      expenses: [],
      mode: "punch",
    });
    expect(text).toContain("Manuella flexjusteringar");
    expect(text).toContain("2026-03-10: −10 h (Utbetald övertid)");
  });
});
