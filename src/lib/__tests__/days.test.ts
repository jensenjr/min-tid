import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeDayMinutes, getAbsencesForDate } from "../days";
import { DEFAULT_SCHEDULE, getEffectiveDayConfig, type WeekSchedule } from "../schedule";
import { absence, session } from "./helpers";

const WED = "2026-03-11";
const FRI = "2026-03-13";
const SAT = "2026-03-14";

describe("getEffectiveDayConfig", () => {
  it("falls back to the weekly schedule", () => {
    expect(getEffectiveDayConfig(WED, DEFAULT_SCHEDULE)).toEqual(DEFAULT_SCHEDULE.wed);
    expect(getEffectiveDayConfig(SAT, DEFAULT_SCHEDULE).active).toBe(false);
  });

  it("applies an exception's end time and lunch", () => {
    const cfg = getEffectiveDayConfig(FRI, DEFAULT_SCHEDULE, {
      [FRI]: { type: "override", endTime: "13:00", lunchMinutes: 0 },
    });
    expect(cfg).toEqual({ ...DEFAULT_SCHEDULE.fri, endTime: "13:00", lunchMinutes: 0 });
  });

  it("keeps the base lunch when the exception has none", () => {
    const cfg = getEffectiveDayConfig(FRI, DEFAULT_SCHEDULE, {
      [FRI]: { type: "override", endTime: "15:00" },
    });
    expect(cfg.endTime).toBe("15:00");
    expect(cfg.lunchMinutes).toBe(DEFAULT_SCHEDULE.fri.lunchMinutes);
  });
});

describe("computeDayMinutes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 11, 10, 0)); // Wed 10:00 local
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deducts the scheduled lunch from the raw time", () => {
    const r = computeDayMinutes([session(WED, "08:00", "17:00")], WED, DEFAULT_SCHEDULE);
    expect(r.raw).toBe(540);
    expect(r.net).toBe(480);
  });

  it("sums several sessions", () => {
    const r = computeDayMinutes(
      [session(WED, "08:00", "12:00"), session(WED, "13:00", "17:00")],
      WED,
      DEFAULT_SCHEDULE,
    );
    expect(r.raw).toBe(480);
  });

  it("uses now() for an open session", () => {
    const r = computeDayMinutes([session(WED, "08:00", null)], WED, DEFAULT_SCHEDULE);
    expect(r.raw).toBe(120);
    expect(r.net).toBe(60);
  });

  it("never goes negative", () => {
    const r = computeDayMinutes([session(WED, "08:00", "08:30")], WED, DEFAULT_SCHEDULE);
    expect(r.net).toBe(0);
  });

  it("respects schedule exceptions", () => {
    const r = computeDayMinutes([session(FRI, "08:00", "13:00")], FRI, DEFAULT_SCHEDULE, {
      [FRI]: { type: "override", endTime: "13:00", lunchMinutes: 0 },
    });
    expect(r.net).toBe(300);
  });

  it("uses the lunch of an inactive day too (weekend work)", () => {
    const schedule: WeekSchedule = {
      ...DEFAULT_SCHEDULE,
      sat: { ...DEFAULT_SCHEDULE.sat, lunchMinutes: 30 },
    };
    const r = computeDayMinutes([session(SAT, "10:00", "12:00")], SAT, schedule);
    expect(r.net).toBe(90);
  });
});

describe("getAbsencesForDate", () => {
  const list = [
    absence("sjuk", "2026-03-09", "2026-03-11"),
    absence("vab", "2026-03-11"),
    absence("semester", "2026-03-20", "2026-03-22"),
  ];

  it("includes both ends of a range", () => {
    expect(getAbsencesForDate(list, "2026-03-09")).toHaveLength(1);
    expect(getAbsencesForDate(list, "2026-03-11")).toHaveLength(2);
    expect(getAbsencesForDate(list, "2026-03-12")).toHaveLength(0);
  });
});
