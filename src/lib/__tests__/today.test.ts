import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE, getEffectiveDayConfig } from "../schedule";
import { nextTrackingStart, punchLeaveEstimate, scheduledLeaveTime } from "../today";
import { fmtDateLabel, fmtDur, monthName, monthTitle, weekRangeLabel } from "../format";

const MON = getEffectiveDayConfig("2026-10-12", DEFAULT_SCHEDULE, {});
const SUN = getEffectiveDayConfig("2026-10-11", DEFAULT_SCHEDULE, {});

describe("scheduledLeaveTime", () => {
  it("is the scheduled end on a working day", () => {
    expect(scheduledLeaveTime(MON)).toBe("17:00");
  });
  it("prefers an adjusted end", () => {
    expect(scheduledLeaveTime(MON, { date: "2026-10-12", end: "15:30" })).toBe("15:30");
  });
  it("is null on a day off, unless adjusted", () => {
    expect(scheduledLeaveTime(SUN)).toBeNull();
    expect(scheduledLeaveTime(SUN, { date: "2026-10-11", start: "09:00", end: "12:00" })).toBe(
      "12:00",
    );
  });
  it("honours a shortened day (exception)", () => {
    const cfg = getEffectiveDayConfig("2026-10-12", DEFAULT_SCHEDULE, {
      "2026-10-12": { type: "override", endTime: "13:00", lunchMinutes: 0 },
    });
    expect(scheduledLeaveTime(cfg)).toBe("13:00");
  });
});

describe("nextTrackingStart", () => {
  it("sets the first date and never moves an existing one", () => {
    expect(nextTrackingStart(undefined, "2026-10-12", "2026-10-12")).toBe("2026-10-12");
    expect(nextTrackingStart("2026-09-01", "2026-10-12", "2026-10-12")).toBe("2026-09-01");
    expect(nextTrackingStart("2026-10-20", "2026-10-12", "2026-10-12")).toBe("2026-10-20");
  });
  it("never anchors in the future", () => {
    expect(nextTrackingStart(undefined, "2026-10-20", "2026-10-12")).toBe("2026-10-12");
  });
});

describe("punchLeaveEstimate", () => {
  const nowMs = new Date("2026-10-12T10:00:00").getTime();
  it("adds the lunch for the day's single session", () => {
    const r = punchLeaveEstimate({ cfg: MON, workedRawMin: 120, sessionCount: 1, nowMs });
    expect(r.lunchIncluded).toBe(true);
    expect(r.reached).toBe(false);
    // target 8 h + 1 h lunch = 540; 420 left → 17:00
    expect(new Date(r.leaveAtMs).getHours()).toBe(17);
  });
  it("adds no lunch after punching out over lunch", () => {
    const r = punchLeaveEstimate({ cfg: MON, workedRawMin: 240, sessionCount: 2, nowMs });
    expect(r.lunchIncluded).toBe(false);
    expect(Math.round((r.leaveAtMs - nowMs) / 60000)).toBe(240);
  });
  it("reports minutes past the target", () => {
    const r = punchLeaveEstimate({ cfg: MON, workedRawMin: 560, sessionCount: 1, nowMs });
    expect(r.reached).toBe(true);
    expect(r.overMin).toBe(20);
  });
});

describe("format helpers", () => {
  it("formats durations and labels", () => {
    expect(fmtDur(0)).toBe("0h 0min");
    expect(fmtDur(45)).toBe("45min");
    expect(fmtDur(460)).toBe("7h 40min");
    expect(fmtDateLabel("2026-10-14")).toBe("onsdag 14 oktober");
    expect(monthName("2026-10")).toBe("oktober");
    expect(monthTitle("2026-10")).toBe("Oktober 2026");
    expect(weekRangeLabel("2026-10-12")).toMatch(/^Vecka 42/);
  });
});
