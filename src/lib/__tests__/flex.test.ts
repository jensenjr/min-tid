import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCHEDULE } from "../schedule";
import {
  computeFlexMinutes,
  computeTodayContribution,
  computeTodayDelta,
  computeWeeklyFlexBreakdown,
} from "../flex";
import { computeDayMinutes } from "../days";
import { absence, session } from "./helpers";

// Fixed "now": Wednesday 2026-03-11, 12:00 local (Europe/Stockholm).
// Default schedule: Mon–Fri 08:00–17:00, 60 min lunch → 480 min net norm.
const MON = "2026-03-09";
const TUE = "2026-03-10";
const WED = "2026-03-11";
const FRI_PAST = "2026-03-06";
const SUN_PAST = "2026-03-08";
const START = "2026-03-02";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 2, 11, 12, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("computeFlexMinutes (current behaviour)", () => {
  const flex = (
    sessions: ReturnType<typeof session>[],
    absences: ReturnType<typeof absence>[],
    rangeStart: string,
    rangeEnd: string,
    exceptions = {},
  ) =>
    computeFlexMinutes(
      sessions,
      absences,
      DEFAULT_SCHEDULE,
      START,
      rangeStart,
      rangeEnd,
      exceptions,
    );

  it("returns 0 without a trackingStartDate", () => {
    expect(computeFlexMinutes([], [], DEFAULT_SCHEDULE, undefined)).toBe(0);
  });

  it("a day worked exactly to the norm gives 0", () => {
    expect(flex([session(MON, "08:00", "17:00")], [], MON, MON)).toBe(0);
  });

  it("overtime and undertime accrue", () => {
    expect(flex([session(MON, "08:00", "18:00")], [], MON, MON)).toBe(60);
    expect(flex([session(MON, "08:00", "16:00")], [], MON, MON)).toBe(-60);
  });

  it("sums consecutive worked days", () => {
    const s = [session(MON, "08:00", "18:00"), session(TUE, "08:00", "16:30")];
    expect(flex(s, [], MON, TUE)).toBe(60 - 30);
  });

  it("unscheduled days (weekend) with no sessions give 0", () => {
    expect(flex([], [], SUN_PAST, SUN_PAST)).toBe(0);
  });

  it("work on an unscheduled day counts fully as flex", () => {
    // Sunday: norm 0; 08:00–12:00 = 240 raw, lunch 0 for inactive day.
    expect(flex([session(SUN_PAST, "08:00", "12:00")], [], SUN_PAST, SUN_PAST)).toBe(240);
  });

  it("a full-day non-flex absence excuses the day", () => {
    expect(flex([], [absence("sjuk", MON)], MON, MON)).toBe(0);
    expect(flex([], [absence("helgdag", MON)], MON, MON)).toBe(0);
  });

  it("a partial non-flex absence lowers the norm", () => {
    // 4 h VAB → norm 240; worked 08:00–13:00 = 300 raw − 60 lunch = 240 → 0.
    expect(flex([session(MON, "08:00", "13:00")], [absence("vab", MON, MON, 4)], MON, MON)).toBe(0);
  });

  it("ignores open sessions on past days", () => {
    expect(flex([session(MON, "08:00", null)], [absence("sjuk", MON)], MON, MON)).toBe(0);
  });

  it("today is excluded from the accrual", () => {
    expect(flex([session(WED, "08:00", "18:00")], [], WED, WED)).toBe(0);
    const worked = [session(MON, "08:00", "17:00"), session(TUE, "08:00", "17:00")];
    expect(flex([...worked, session(WED, "08:00", "18:00")], [], MON, "2026-12-31")).toBe(0);
  });

  it("nothing accrues before trackingStartDate", () => {
    expect(
      computeFlexMinutes(
        [session(FRI_PAST, "08:00", "18:00")],
        [],
        DEFAULT_SCHEDULE,
        MON,
        FRI_PAST,
        FRI_PAST,
      ),
    ).toBe(0);
  });

  it("honours schedule exceptions (shortened day)", () => {
    const exceptions = { [MON]: { type: "override" as const, endTime: "13:00", lunchMinutes: 0 } };
    expect(flex([session(MON, "08:00", "13:00")], [], MON, MON, exceptions)).toBe(0);
  });
});

describe("computeTodayContribution (current behaviour)", () => {
  const contribution = (
    sessions: ReturnType<typeof session>[],
    absences: ReturnType<typeof absence>[] = [],
    today = WED,
    start = START,
  ) => computeTodayContribution(sessions, absences, DEFAULT_SCHEDULE, today, start);

  it("is 0 without trackingStartDate or before it", () => {
    const s = [session(WED, "08:00", "18:00")];
    expect(computeTodayContribution(s, [], DEFAULT_SCHEDULE, WED, undefined)).toBe(0);
    expect(contribution([session(WED, "08:00", "18:00")], [], WED, "2026-03-12")).toBe(0);
  });

  it("is 0 while a session is active", () => {
    expect(contribution([session(WED, "08:00", null)])).toBe(0);
    expect(contribution([session(WED, "08:00", "12:00"), session(WED, "12:30", null)])).toBe(0);
  });

  it("is 0 before the user has done anything today", () => {
    expect(contribution([])).toBe(0);
  });

  it("returns actual − norm once settled", () => {
    expect(contribution([session(WED, "08:00", "17:00")])).toBe(0);
    expect(contribution([session(WED, "08:00", "18:00")])).toBe(60);
    expect(contribution([session(WED, "08:00", "15:00")])).toBe(-120);
  });

  it("a non-flex absence lowers today's norm", () => {
    expect(contribution([session(WED, "08:00", "13:00")], [absence("vab", WED, WED, 4)])).toBe(0);
  });
});

describe("computeTodayDelta (current behaviour)", () => {
  it("is live: open session counts up to now()", () => {
    // 08:00 → now 12:00 = 240 raw − 60 lunch = 180 net; target 480.
    expect(computeTodayDelta([session(WED, "08:00", null)], DEFAULT_SCHEDULE.wed)).toBe(-300);
  });

  it("goes positive after overshoot", () => {
    expect(computeTodayDelta([session(WED, "08:00", "18:00")], DEFAULT_SCHEDULE.wed)).toBe(60);
  });

  it("inactive day has no lunch and no target", () => {
    expect(computeTodayDelta([session(SUN_PAST, "08:00", "10:00")], DEFAULT_SCHEDULE.sun)).toBe(
      120,
    );
    expect(computeTodayDelta([], DEFAULT_SCHEDULE.sun)).toBe(0);
  });

  it("no sessions on a working day equals −norm", () => {
    expect(computeTodayDelta([], DEFAULT_SCHEDULE.wed)).toBe(-480);
  });
});

describe("computeWeeklyFlexBreakdown (current behaviour)", () => {
  it("returns [] without trackingStartDate", () => {
    expect(computeWeeklyFlexBreakdown([], [], DEFAULT_SCHEDULE, undefined, 4, 0)).toEqual([]);
  });

  it("lists newest week first, adds today's contribution to the current week", () => {
    const sessions = [
      session("2026-03-02", "08:00", "18:00"),
      session("2026-03-03", "08:00", "17:00"),
      session("2026-03-04", "08:00", "17:00"),
      session("2026-03-05", "08:00", "17:00"),
      session("2026-03-06", "08:00", "17:00"),
      session(MON, "08:00", "17:00"),
      session(TUE, "08:00", "17:00"),
    ];
    const rows = computeWeeklyFlexBreakdown(sessions, [], DEFAULT_SCHEDULE, START, 2, 45);
    expect(rows).toHaveLength(2);
    // Keys are UTC dates of local-midnight Mondays → one day early in Stockholm.
    expect(rows.map((r) => r.mondayStr)).toEqual(["2026-03-08", "2026-03-01"]);
    expect(rows[0].minutes).toBe(45);
    expect(rows[1].minutes).toBe(60);
  });

  it("stops once a week ends before trackingStartDate", () => {
    const rows = computeWeeklyFlexBreakdown([], [], DEFAULT_SCHEDULE, START, 10, 0);
    expect(rows.length).toBeLessThan(10);
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ─── Known bugs (fixed in PR 3) ──────────────────────────────
// Each case asserts the CORRECT behaviour, so it fails today and passes as `it.fails`.
// PR 3 fixes the bug and flips these to plain `it`.
describe("known bugs", () => {
  it.fails("(a) a scheduled past day with no session and no absence gives 0, not −norm", () => {
    const flex = computeFlexMinutes([], [], DEFAULT_SCHEDULE, START, MON, MON);
    expect(flex).toBe(0);
  });

  it.fails("(b) a full-day flex absence deducts the norm once, not twice", () => {
    const flex = computeFlexMinutes([], [absence("flex", MON)], DEFAULT_SCHEDULE, START, MON, MON);
    expect(flex).toBe(-480);
  });

  it.fails("(c) schedule lunch is not deducted when the user punched out for lunch", () => {
    const sessions = [session(WED, "08:00", "12:00"), session(WED, "13:00", "17:00")];
    const { net } = computeDayMinutes(sessions, WED, DEFAULT_SCHEDULE);
    expect(net).toBe(480);
  });

  it.fails("(d) a session between 00:00 and 02:00 local belongs to that local day", () => {
    // 00:30–09:00 local on Tue 03-10 is 23:30 UTC on 03-09 → grouped under the previous day.
    const sessions = [session(TUE, "00:30", "09:00")];
    const contribution = computeTodayContribution(sessions, [], DEFAULT_SCHEDULE, TUE, START);
    expect(contribution).toBe(450 - 480); // 510 raw − 60 lunch − 480 norm
  });
});
