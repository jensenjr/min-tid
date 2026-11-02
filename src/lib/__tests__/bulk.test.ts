import { describe, expect, it } from "vitest";
import { applyBulkStatus, groupIntoPeriods, removeDaysFromAbsences } from "../bulk";
import { evaluateDay, type DayContext } from "../days";
import { DEFAULT_SCHEDULE } from "../schedule";
import type { AbsenceEntry } from "../types";
import { absence, at } from "./helpers";

// March 2026: the 2nd is a Monday; 7–8, 14–15 and 21–22 are weekends.
const TODAY = "2026-03-18";

function state(over: Partial<Parameters<typeof applyBulkStatus>[2]> = {}) {
  return {
    absences: [] as AbsenceEntry[],
    confirmedDays: {} as Record<string, true>,
    schedule: DEFAULT_SCHEDULE,
    exceptions: {},
    today: TODAY,
    ...over,
  };
}

function ids() {
  let n = 0;
  return () => `new${++n}`;
}

const strip = (list: AbsenceEntry[]) =>
  list.map(({ category, startDate, endDate }) => ({ category, startDate, endDate }));

describe("applyBulkStatus — OK", () => {
  it("confirms scheduled past days and skips days off, future and locked days", () => {
    const r = applyBulkStatus(
      ["2026-03-03", "2026-03-02", "2026-03-07", "2026-03-20", "2026-02-27", "2026-03-03"],
      { kind: "ok" },
      state({ lockedMonths: { "2026-02": { at: 1, by: "A" } } }),
    );
    expect(r.changed).toEqual(["2026-03-02", "2026-03-03"]);
    expect(r.confirmedDays).toEqual({ "2026-03-02": true, "2026-03-03": true });
    expect(r.skipped).toEqual({
      locked: ["2026-02-27"],
      future: ["2026-03-20"],
      off: ["2026-03-07"],
    });
  });

  it("replaces an absence on the day, splitting a longer period", () => {
    const sem = absence("semester", "2026-03-02", "2026-03-06");
    const r = applyBulkStatus(["2026-03-04"], { kind: "ok" }, state({ absences: [sem] }), ids());
    expect(r.absences).toEqual([
      { ...sem, startDate: "2026-03-02", endDate: "2026-03-03" },
      { ...sem, id: "new1", startDate: "2026-03-05", endDate: "2026-03-06" },
    ]);
    expect(r.confirmedDays).toEqual({ "2026-03-04": true });
  });
});

describe("applyBulkStatus — absence", () => {
  it("makes one period of two working weeks, across the weekend, also in the future", () => {
    const days = [
      "2026-03-23",
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
      "2026-03-30",
      "2026-03-31",
    ];
    const r = applyBulkStatus(days, { kind: "absence", category: "semester" }, state(), ids());
    expect(strip(r.absences)).toEqual([
      { category: "semester", startDate: "2026-03-23", endDate: "2026-03-31" },
    ]);
    expect(r.absences[0]).toMatchObject({ id: "new1", manual: true });
    expect(r.changed).toEqual(days);
  });

  it("splits into separate periods when a working day in between is not selected", () => {
    const r = applyBulkStatus(
      ["2026-03-02", "2026-03-03", "2026-03-05"],
      { kind: "absence", category: "sjuk" },
      state(),
      ids(),
    );
    expect(strip(r.absences)).toEqual([
      { category: "sjuk", startDate: "2026-03-02", endDate: "2026-03-03" },
      { category: "sjuk", startDate: "2026-03-05", endDate: "2026-03-05" },
    ]);
  });

  it("replaces the day's status: removes the confirmation and the old absence", () => {
    const vab = absence("vab", "2026-03-09");
    const r = applyBulkStatus(
      ["2026-03-09", "2026-03-10"],
      { kind: "absence", category: "flex" },
      state({ absences: [vab], confirmedDays: { "2026-03-10": true, "2026-03-11": true } }),
      ids(),
    );
    expect(strip(r.absences)).toEqual([
      { category: "flex", startDate: "2026-03-09", endDate: "2026-03-10" },
    ]);
    expect(r.confirmedDays).toEqual({ "2026-03-11": true });

    const ctx: DayContext = {
      sessions: [],
      absences: r.absences,
      schedule: DEFAULT_SCHEDULE,
      reportingMode: "schedule",
      trackingStartDate: "2026-03-02",
      confirmedDays: r.confirmedDays,
      today: TODAY,
      now: at(TODAY, "12:00"),
    };
    expect(evaluateDay("2026-03-10", ctx)).toMatchObject({ status: "absent", flexDelta: -480 });
  });
});

describe("applyBulkStatus — clear", () => {
  it("removes absences and confirmations, keeps the rest", () => {
    const sem = absence("semester", "2026-03-02", "2026-03-13");
    const r = applyBulkStatus(
      ["2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13", "2026-03-16"],
      { kind: "clear" },
      state({ absences: [sem], confirmedDays: { "2026-03-16": true, "2026-03-17": true } }),
      ids(),
    );
    // 2–8 is left; the weekend 7–8 stays inside it, nothing after the 13th is left.
    expect(strip(r.absences)).toEqual([
      { category: "semester", startDate: "2026-03-02", endDate: "2026-03-08" },
    ]);
    expect(r.confirmedDays).toEqual({ "2026-03-17": true });
  });
});

describe("helpers", () => {
  it("removeDaysFromAbsences drops a leftover piece without a working day", () => {
    const sem = absence("semester", "2026-03-02", "2026-03-08");
    const days = new Set(["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"]);
    expect(removeDaysFromAbsences([sem], days, { schedule: DEFAULT_SCHEDULE }, ids())).toEqual([]);
  });

  it("groupIntoPeriods does not bridge into a locked month", () => {
    // Fri 27 Feb and Mon 2 Mar with the weekend 28 Feb / 1 Mar between; February locked.
    const s = { schedule: DEFAULT_SCHEDULE, lockedMonths: { "2026-02": { at: 1, by: "A" } } };
    expect(groupIntoPeriods(["2026-03-02", "2026-03-03"], s)).toEqual([
      { start: "2026-03-02", end: "2026-03-03" },
    ]);
    expect(groupIntoPeriods(["2026-02-27", "2026-03-02"], s)).toEqual([
      { start: "2026-02-27", end: "2026-02-27" },
      { start: "2026-03-02", end: "2026-03-02" },
    ]);
  });
});
