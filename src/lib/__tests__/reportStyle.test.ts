import { describe, expect, it } from "vitest";
import {
  reportStyle,
  reportStyleSummary,
  todayLayout,
  type TodayLayoutInput,
} from "../reportStyle";

const base: TodayLayoutInput = {
  mode: "punch",
  checkedIn: false,
  scheduled: true,
  registered: false,
  confirmed: false,
};

describe("todayLayout", () => {
  it("Stämplare: big clock, small 'enligt schema' on an untouched scheduled day", () => {
    expect(todayLayout(base)).toEqual({
      primary: "clock",
      secondaryPunch: false,
      secondaryOk: true,
      okDone: false,
    });
  });

  it("Stämplare: no 'enligt schema' once something is registered, on a day off or while checked in", () => {
    expect(todayLayout({ ...base, registered: true }).secondaryOk).toBe(false);
    expect(todayLayout({ ...base, scheduled: false }).secondaryOk).toBe(false);
    expect(todayLayout({ ...base, checkedIn: true }).secondaryOk).toBe(false);
  });

  it("Stämplare: a confirmed day shows the done line instead of the button", () => {
    const l = todayLayout({ ...base, confirmed: true });
    expect(l.secondaryOk).toBe(false);
    expect(l.okDone).toBe(true);
  });

  it("Justerare: big 'Enligt schema', small 'Checka in' beside it", () => {
    expect(todayLayout({ ...base, mode: "schedule" })).toEqual({
      primary: "schedule",
      secondaryPunch: true,
      secondaryOk: false,
      okDone: false,
    });
  });

  it("a running session puts the clock first for a Justerare too", () => {
    const l = todayLayout({ ...base, mode: "schedule", checkedIn: true });
    expect(l.primary).toBe("clock");
    expect(l.secondaryPunch).toBe(false);
  });
});

describe("labels", () => {
  it("names both roles", () => {
    expect(reportStyle("punch").role).toBe("Stämplare");
    expect(reportStyle("schedule").role).toBe("Justerare");
    expect(reportStyleSummary("punch")).toMatch(/^Stämplare/);
    expect(reportStyleSummary("schedule")).toMatch(/^Justerare/);
  });
});
