import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE } from "../schedule";
import { evaluateDay, type DayContext } from "../days";
import { fillSessions, planFill } from "../fill";
import { session } from "./helpers";

// Mon 2026-10-12 .. Sun 2026-10-18. Default schedule: Mon–Fri 08:00–17:00, 60 min lunch.
const FROM = "2026-10-12";
const TO = "2026-10-18";

function ctxWith(sessions: ReturnType<typeof fillSessions>): DayContext {
  return {
    sessions,
    absences: [],
    schedule: DEFAULT_SCHEDULE,
    exceptions: {},
    reportingMode: "punch",
    trackingStartDate: FROM,
    today: "2026-10-20",
    now: new Date("2026-10-20T12:00:00").getTime(),
  };
}

describe("planFill / fillSessions", () => {
  it.each([100, 75, 50, 25])("a %i %% day is worth exactly that share of the norm", (pct) => {
    const plan = planFill({ from: FROM, to: TO, pct, schedule: DEFAULT_SCHEDULE });
    expect(plan.days).toHaveLength(5);
    const sessions = fillSessions(plan, undefined);
    const ctx = ctxWith(sessions);
    for (const d of plan.days) {
      const ev = evaluateDay(d.dateStr, ctx);
      expect(ev.workedMin).toBe(Math.round((480 * pct) / 100));
      // the share of the norm, so flex moves by exactly −(100 − pct) % of the day
      expect(ev.flexDelta).toBe(ev.workedMin - 480);
    }
  });

  it("a part day never gains the lunch back (the regression this guards against)", () => {
    const plan = planFill({ from: FROM, to: FROM, pct: 50, schedule: DEFAULT_SCHEDULE });
    const [s] = fillSessions(plan, "VAB");
    expect(s.breakMinutes).toBe(0);
    expect(s.note).toBe("VAB");
    // 4 h session, no lunch: worked = 240, not 240 + 60
    expect(evaluateDay(FROM, ctxWith([s])).workedMin).toBe(240);
  });

  it("a full day keeps the schedule lunch as an explicit break", () => {
    const plan = planFill({ from: FROM, to: FROM, pct: 100, schedule: DEFAULT_SCHEDULE });
    const [s] = fillSessions(plan, undefined);
    expect(s.breakMinutes).toBe(60);
    expect(s.checkOut! - s.checkIn).toBe(9 * 3600_000);
    expect(evaluateDay(FROM, ctxWith([s])).workedMin).toBe(480);
  });

  it("skips days off, days with sessions, and blocked days — and counts them", () => {
    const plan = planFill({
      from: FROM,
      to: TO,
      pct: 100,
      schedule: DEFAULT_SCHEDULE,
      existingSessions: [session("2026-10-13", "08:00", "17:00")],
      dayBlock: (d) => (d === "2026-10-14" ? "locked" : d === "2026-10-15" ? "adjusted" : null),
    });
    expect(plan.days.map((d) => d.dateStr)).toEqual(["2026-10-12", "2026-10-16"]);
    expect(plan.skippedInactive).toBe(2);
    expect(plan.skippedExisting).toBe(1);
    expect(plan.skippedBlocked).toBe(2);
  });

  it("refuses an absurdly long range and an inverted one", () => {
    expect(
      planFill({ from: "2026-01-01", to: "2026-12-31", pct: 100, schedule: DEFAULT_SCHEDULE })
        .tooLong,
    ).toBe(true);
    expect(
      planFill({ from: TO, to: FROM, pct: 100, schedule: DEFAULT_SCHEDULE }).days,
    ).toHaveLength(0);
  });
});
