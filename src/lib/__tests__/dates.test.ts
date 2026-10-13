import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWeekMonday, isoWeekNumber, todayLocal, weekKey, ymdLocal } from "../dates";

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

  it("todayLocal keeps the historic UTC-based day key", () => {
    vi.setSystemTime(new Date(2026, 2, 11, 12, 0)); // Wed 12:00 local
    expect(todayLocal()).toBe("2026-03-11");
    vi.setSystemTime(new Date(2026, 2, 11, 0, 30)); // 23:30 UTC the day before
    expect(todayLocal()).toBe("2026-03-10");
  });

  it("getWeekMonday returns local midnight of the ISO week's Monday", () => {
    const wed = getWeekMonday(new Date(2026, 2, 11, 15, 0));
    expect(ymdLocal(wed)).toBe("2026-03-09");
    expect(wed.getHours()).toBe(0);
    expect(ymdLocal(getWeekMonday(new Date(2026, 2, 15, 10, 0)))).toBe("2026-03-09"); // Sunday
    expect(ymdLocal(getWeekMonday(new Date(2026, 2, 9, 10, 0)))).toBe("2026-03-09"); // Monday
  });

  it("weekKey is the UTC date of the Monday (local midnight shifts back a day)", () => {
    expect(weekKey(new Date(2026, 2, 11, 15, 0))).toBe("2026-03-08");
  });

  it("isoWeekNumber follows ISO-8601", () => {
    expect(isoWeekNumber(new Date(2026, 0, 1))).toBe(1);
    expect(isoWeekNumber(new Date(2026, 2, 11))).toBe(11);
    expect(isoWeekNumber(new Date(2026, 11, 31))).toBe(53);
    expect(isoWeekNumber(new Date(2027, 0, 1))).toBe(53);
    expect(isoWeekNumber(new Date(2027, 0, 4))).toBe(1);
  });
});
