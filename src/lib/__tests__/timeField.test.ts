import { describe, expect, it } from "vitest";
import {
  PICKER_HOURS,
  PICKER_MINUTES,
  formatHm,
  parseHm,
  snapMinute,
  withHour,
  withMinute,
} from "../timeField";

describe("timeField helpers", () => {
  it("offers 24 hours and 5-minute steps", () => {
    expect(PICKER_HOURS).toHaveLength(24);
    expect(PICKER_MINUTES).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });

  it("parses and formats HH:MM", () => {
    expect(parseHm("08:05")).toEqual({ h: 8, m: 5 });
    expect(parseHm("23:59")).toEqual({ h: 23, m: 59 });
    expect(parseHm("24:00")).toBeNull();
    expect(parseHm("8:05")).toBeNull();
    expect(parseHm("")).toBeNull();
    expect(parseHm(undefined)).toBeNull();
    expect(formatHm(7, 0)).toBe("07:00");
  });

  it("snaps minutes to 5 without spilling into the next hour", () => {
    expect(snapMinute(0)).toBe(0);
    expect(snapMinute(2)).toBe(0);
    expect(snapMinute(3)).toBe(5);
    expect(snapMinute(57)).toBe(55);
    expect(snapMinute(59)).toBe(55);
  });

  it("changes the hour and keeps a snapped minute", () => {
    expect(withHour("08:03", 9)).toBe("09:05");
    expect(withHour("08:30", 17)).toBe("17:30");
    expect(withHour("", 6)).toBe("06:00");
  });

  it("changes the minute and keeps the hour", () => {
    expect(withMinute("08:03", 45)).toBe("08:45");
    expect(withMinute("", 15)).toBe("08:15");
    expect(withMinute("", 15, 16)).toBe("16:15");
  });
});
