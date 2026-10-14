import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  getWeekMonday,
  hmLocal,
  isoWeekNumber,
  isYmd,
  mondayOf,
  monthRange,
  todayLocal,
  weekKey,
  ymdLocal,
} from "../dates";
import { at } from "./helpers";

describe("dates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ymdLocal uses the local calendar date, even right after local midnight", () => {
    expect(ymdLocal(new Date(2026, 2, 10, 0, 30))).toBe("2026-03-10");
    expect(ymdLocal(new Date(2026, 2, 10, 23, 59))).toBe("2026-03-10");
  });

  // PR 1 pinned the historic UTC key here ("2026-03-10" at 00:30 local). That was the
  // 00:00–02:00 bug: todayLocal() is now the local calendar date.
  it("todayLocal is the local calendar date, also between 00:00 and 02:00", () => {
    vi.setSystemTime(new Date(2026, 2, 11, 12, 0)); // Wed 12:00 local
    expect(todayLocal()).toBe("2026-03-11");
    vi.setSystemTime(new Date(2026, 2, 11, 0, 30)); // 23:30 UTC the day before
    expect(todayLocal()).toBe("2026-03-11");
    vi.setSystemTime(new Date(2026, 2, 10, 23, 59));
    expect(todayLocal()).toBe("2026-03-10");
  });

  it("todayLocal on the DST switch nights", () => {
    vi.setSystemTime(new Date(2026, 2, 29, 0, 30)); // spring forward night
    expect(todayLocal()).toBe("2026-03-29");
    vi.setSystemTime(new Date(2026, 9, 25, 0, 30)); // fall back night
    expect(todayLocal()).toBe("2026-10-25");
  });

  it("getWeekMonday returns local midnight of the ISO week's Monday", () => {
    const wed = getWeekMonday(new Date(2026, 2, 11, 15, 0));
    expect(ymdLocal(wed)).toBe("2026-03-09");
    expect(wed.getHours()).toBe(0);
    expect(ymdLocal(getWeekMonday(new Date(2026, 2, 15, 10, 0)))).toBe("2026-03-09"); // Sunday
    expect(ymdLocal(getWeekMonday(new Date(2026, 2, 9, 10, 0)))).toBe("2026-03-09"); // Monday
  });

  // PR 1 pinned "2026-03-08" (the UTC date of local midnight Monday) — a bug that made
  // week labels start on a Sunday. weekKey is now the local Monday.
  it("weekKey is the local date of the week's Monday", () => {
    expect(weekKey(new Date(2026, 2, 11, 15, 0))).toBe("2026-03-09");
    expect(weekKey(new Date(2026, 2, 15, 23, 30))).toBe("2026-03-09");
    expect(weekKey(new Date(2026, 2, 29, 12, 0))).toBe("2026-03-23"); // DST Sunday
    expect(weekKey(new Date(2026, 9, 25, 12, 0))).toBe("2026-10-19"); // DST Sunday
  });

  it("isoWeekNumber follows ISO-8601", () => {
    expect(isoWeekNumber(new Date(2026, 0, 1))).toBe(1);
    expect(isoWeekNumber(new Date(2026, 2, 11))).toBe(11);
    expect(isoWeekNumber(new Date(2026, 11, 31))).toBe(53);
    expect(isoWeekNumber(new Date(2027, 0, 1))).toBe(53);
    expect(isoWeekNumber(new Date(2027, 0, 4))).toBe(1);
  });
});

describe("local day-key helpers", () => {
  it("addDays steps whole calendar days, across DST, months, years and leap days", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-03-11", 0)).toBe("2026-03-11");
  });

  it("addDays never skips or repeats a day over a whole year (both DST switches)", () => {
    let d = "2026-01-01";
    const seen = new Set<string>([d]);
    for (let i = 0; i < 400; i++) {
      const next = addDays(d, 1);
      const expected = new Date(Date.UTC(2026, 0, 2 + i)).toISOString().slice(0, 10);
      expect(next).toBe(expected);
      expect(seen.has(next)).toBe(false);
      seen.add(next);
      d = next;
    }
  });

  it("mondayOf gives the local Monday of a day key", () => {
    expect(mondayOf("2026-03-11")).toBe("2026-03-09");
    expect(mondayOf("2026-03-09")).toBe("2026-03-09");
    expect(mondayOf("2026-03-15")).toBe("2026-03-09");
    expect(mondayOf("2026-03-29")).toBe("2026-03-23");
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
  });

  it("monthRange gives the first and last day of a month", () => {
    expect(monthRange("2026-02")).toEqual({ first: "2026-02-01", last: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ first: "2028-02-01", last: "2028-02-29" });
    expect(monthRange("2026-12")).toEqual({ first: "2026-12-01", last: "2026-12-31" });
    expect(monthRange("2026-10")).toEqual({ first: "2026-10-01", last: "2026-10-31" });
  });

  it("hmLocal formats a timestamp as local HH:MM", () => {
    expect(hmLocal(at("2026-03-11", "08:05"))).toBe("08:05");
    expect(hmLocal(at("2026-03-29", "03:15"))).toBe("03:15");
    expect(hmLocal(at("2026-03-10", "00:30"))).toBe("00:30");
  });

  it("isYmd only accepts YYYY-MM-DD", () => {
    expect(isYmd("2026-03-11")).toBe(true);
    expect(isYmd("2026-3-11")).toBe(false);
    expect(isYmd("2026-03")).toBe(false);
    expect(isYmd(20260311)).toBe(false);
    expect(isYmd(undefined)).toBe(false);
  });
});
