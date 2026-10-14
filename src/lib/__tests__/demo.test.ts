import { describe, expect, it, vi } from "vitest";
import {
  APP_STORAGE_KEY,
  DEMO_STORAGE_KEY,
  buildDemoState,
  exitDemoUrl,
  isDemoSearch,
  shouldSync,
  storageKeyFor,
} from "../demo";
import { buildAttend } from "../attend";
import { computeFlex } from "../flex";
import { evaluateDay, type DayContext } from "../days";
import { getEffectiveDayConfig, netDayMin, addDaysStr } from "../schedule";
import { makeTravelFor } from "../travel";
import { vacationBalance } from "../vacation";
import { monthRange, ymdLocal } from "../dates";
import { at } from "./helpers";
import type { AppState } from "../types";

const TODAY = "2026-10-14"; // a Wednesday

function ctxOf(s: AppState, today: string): DayContext {
  return {
    sessions: s.sessions,
    absences: s.absences,
    schedule: s.schedules,
    exceptions: s.scheduleExceptions,
    reportingMode: s.reportingMode ?? "schedule",
    trackingStartDate: s.trackingStartDate,
    today,
    now: at(today, "10:00"), // mid-shift: today is still ongoing
    autoLunchThresholdMin: s.autoLunchThresholdMin,
    confirmedDays: s.confirmedDays,
    lockedMonths: s.lockedMonths,
    dayAdjustments: s.dayAdjustments,
    flexBaseDate: s.flexBaseDate,
    travelFor: makeTravelFor(s.travel, s.travelRules),
  };
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysStr(d, 1)) out.push(d);
  return out;
}

describe("demo storage and sync gating", () => {
  it("picks the demo key only for ?demo=1", () => {
    expect(storageKeyFor(true)).toBe(DEMO_STORAGE_KEY);
    expect(storageKeyFor(false)).toBe(APP_STORAGE_KEY);
    expect(DEMO_STORAGE_KEY).toBe("punchclock_demo");
    expect(APP_STORAGE_KEY).toBe("punchclock_v2");
    expect(isDemoSearch("?demo=1")).toBe(true);
    expect(isDemoSearch("?a=b&demo=1")).toBe(true);
    expect(isDemoSearch("")).toBe(false);
    expect(isDemoSearch("?demo=0")).toBe(false);
    expect(isDemoSearch("?demo")).toBe(false);
  });

  it("never lets the sync layer run in demo, even with a token", () => {
    const syncPush = vi.fn();
    const syncPull = vi.fn();
    // The shell guards every push/pull with shouldSync(demo, token).
    const run = (demo: boolean, token: string | null) => {
      if (!shouldSync(demo, token)) return;
      syncPull();
      syncPush();
    };
    run(true, "a-token");
    run(true, null);
    run(false, null);
    expect(syncPull).not.toHaveBeenCalled();
    expect(syncPush).not.toHaveBeenCalled();
    run(false, "a-token");
    expect(syncPull).toHaveBeenCalledTimes(1);
    expect(shouldSync(true, "x")).toBe(false);
    expect(shouldSync(false, "x")).toBe(true);
  });

  it("exitDemoUrl drops only the demo parameter", () => {
    expect(exitDemoUrl({ pathname: "/", search: "?demo=1", hash: "" })).toBe("/");
    expect(exitDemoUrl({ pathname: "/", search: "?demo=1&x=2", hash: "#a" })).toBe("/?x=2#a");
    expect(exitDemoUrl({ pathname: "/app", search: "", hash: "" })).toBe("/app");
  });
});

describe("buildDemoState", () => {
  const s = buildDemoState(TODAY);
  const ctx = ctxOf(s, TODAY);

  it("is deterministic and JSON-safe", () => {
    expect(buildDemoState(TODAY)).toEqual(s);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("is Anna Demo in Enligt schema mode and skips onboarding", () => {
    expect(s.name).toBe("Anna Demo");
    expect(s.reportingMode).toBe("schedule");
    expect(s.onboardingDone).toBe(true);
    expect(s.sessions.length).toBeGreaterThan(0);
  });

  it("covers at least eight weeks ending today, tracked from a Monday", () => {
    const start = s.trackingStartDate as string;
    expect(new Date(`${start}T12:00:00`).getDay()).toBe(1);
    expect(start <= addDaysStr(TODAY, -8 * 7 + 6)).toBe(true);
  });

  it("has a two-week rotation where week 2 has Friday off", () => {
    expect(s.schedules).toHaveLength(1);
    const weeks = s.schedules[0].rotation.weeks;
    expect(weeks).toHaveLength(2);
    expect(weeks[0].fri.active).toBe(true);
    expect(weeks[1].fri.active).toBe(false);
    // The current week is week 1, the one before it week 2.
    const fridayNow = addDaysStr(TODAY, 2);
    const fridayBefore = addDaysStr(TODAY, -5);
    expect(getEffectiveDayConfig(fridayNow, s.schedules).active).toBe(true);
    expect(getEffectiveDayConfig(fridayBefore, s.schedules).active).toBe(false);
  });

  it("has exactly two unconfirmed past days, the latest scheduled ones, outside the locked month", () => {
    const flex = computeFlex(ctx);
    expect(flex.unconfirmedDays).toHaveLength(2);
    expect(flex.missingDays).toHaveLength(0);
    expect(flex.unconfirmedDays).toEqual(["2026-10-12", "2026-10-13"]);
    const locked = Object.keys(s.lockedMonths ?? {});
    for (const d of flex.unconfirmedDays) {
      expect(d < TODAY).toBe(true);
      expect(locked).not.toContain(d.slice(0, 7));
    }
  });

  it("has one semester week consuming at most five days, and a VAB day", () => {
    const sem = s.absences.filter((a) => a.category === "semester");
    expect(sem).toHaveLength(1);
    const b = vacationBalance(
      {
        absences: s.absences,
        schedules: s.schedules,
        scheduleExceptions: s.scheduleExceptions,
        vacation: s.vacation,
      },
      TODAY,
    );
    expect(b.used).toBeGreaterThan(0);
    expect(b.used).toBeLessThanOrEqual(5);
    expect(b.left).toBe(b.total - b.used);
    expect(b.planned).toBe(0);

    const vab = s.absences.filter((a) => a.category === "vab");
    expect(vab).toHaveLength(1);
    expect(vab[0].startDate).toBe(vab[0].endDate);
    const ev = evaluateDay(vab[0].startDate, ctx);
    expect(ev.status).toBe("absent");
    expect(ev.absence.excusedMin).toBe(8 * 60);
  });

  it("has a trip with time outside the schedule that yields payroll minutes", () => {
    expect(s.travel).toHaveLength(1);
    const day = (s.travel ?? [])[0].date;
    const ev = evaluateDay(day, ctx);
    expect(ev.travel.outsideMin).toBeGreaterThan(0);
    expect(ev.travel.payrollMin).toBe(ev.travel.outsideMin);
    expect(ev.travel.inScheduleMin).toBeGreaterThan(0);
    expect(ev.explanation.join("\n")).toMatch(/Restid/);
  });

  it("has expenses incl. kilometers and a meal, and one that shows up in Att åtgärda", () => {
    const cats = s.expenses.map((e) => e.category);
    expect(cats).toContain("milersattning");
    expect(cats).toContain("kost");
    const attend = buildAttend({
      ctx,
      expenses: s.expenses,
      cfgFor: (d) => getEffectiveDayConfig(d, s.schedules, s.scheduleExceptions),
      today: TODAY,
      now: ctx.now as number,
    });
    expect(attend.receipts.length).toBeGreaterThanOrEqual(1);
    expect(attend.days).toHaveLength(2);
  });

  it("has the oldest full month confirmed and locked with an audit entry", () => {
    const months = Object.keys(s.lockedMonths ?? {});
    expect(months).toHaveLength(1);
    const [m] = months;
    const { first, last } = monthRange(m);
    expect(first >= (s.trackingStartDate as string)).toBe(true);
    expect(last < TODAY).toBe(true);
    // No full month before it inside the window.
    const before = addDaysStr(first, -1);
    expect(monthRange(before.slice(0, 7)).first >= (s.trackingStartDate as string)).toBe(false);
    expect(s.auditLog).toEqual([expect.objectContaining({ action: "confirm", month: m })]);
    for (const d of eachDay(first, last)) {
      const ev = evaluateDay(d, ctx);
      expect(["reported", "absent", "partial", "off"]).toContain(ev.status);
    }
  });

  it("has a few adjustments and plenty of confirmed days", () => {
    expect(Object.keys(s.dayAdjustments ?? {}).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(s.confirmedDays ?? {}).length).toBeGreaterThan(20);
  });

  it("ends on a believable small positive flex balance", () => {
    const flex = computeFlex(ctx).minutes;
    expect(flex).toBeGreaterThan(30);
    expect(flex).toBeLessThan(6 * 60);
    expect(s.flexBaseMinutes).toBe(0);
  });

  it("has no day in the window that is neither registered nor deliberately open", () => {
    const start = s.trackingStartDate as string;
    for (const d of eachDay(start, addDaysStr(TODAY, -1))) {
      const cfg = getEffectiveDayConfig(d, s.schedules);
      const ev = evaluateDay(d, ctx);
      if (!cfg.active || netDayMin(cfg) === 0) continue;
      expect(["reported", "absent", "partial", "unconfirmed"]).toContain(ev.status);
    }
  });

  it("keeps its promises for every day of two years, whatever `today` is", () => {
    for (const today of eachDay("2026-01-01", "2027-12-31")) {
      const st = buildDemoState(today);
      const c = ctxOf(st, today);
      const flex = computeFlex(c);
      expect(flex.unconfirmedDays).toHaveLength(2);
      expect(flex.missingDays).toHaveLength(0);
      const locked = Object.keys(st.lockedMonths ?? {});
      expect(locked).toHaveLength(1);
      expect(monthRange(locked[0]).last < today).toBe(true);
      expect(locked[0] <= (flex.unconfirmedDays[0] as string).slice(0, 7)).toBe(true);
      expect(locked).not.toContain(flex.unconfirmedDays[0].slice(0, 7));
      expect(locked).not.toContain(flex.unconfirmedDays[1].slice(0, 7));
      expect(
        Math.round(
          (new Date(`${today}T12:00`).getTime() -
            new Date(`${st.trackingStartDate}T12:00`).getTime()) /
            86_400_000,
        ),
      ).toBeGreaterThanOrEqual(8 * 7);
      expect(flex.minutes).toBeGreaterThan(0);
      expect(flex.minutes).toBeLessThan(8 * 60);
      const b = vacationBalance(
        { absences: st.absences, schedules: st.schedules, vacation: st.vacation },
        today,
      );
      expect(b.used).toBeGreaterThan(0);
      expect(b.used).toBeLessThanOrEqual(5);
      expect(ymdLocal(new Date(`${today}T12:00:00`))).toBe(today);
    }
  });
});
