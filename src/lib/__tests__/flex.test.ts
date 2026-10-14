import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCHEDULE, periodFromWeek, type WeekSchedule } from "../schedule";
import {
  type FlexContext,
  computeFlex,
  computeFlexMinutes,
  computeTodayContribution,
  computeTodayDelta,
  computeWeeklyFlex,
  computeWeeklyFlexBreakdown,
} from "../flex";
import { computeDayMinutes, type DayContext } from "../days";
import { absence, at, session } from "./helpers";

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

// ─── Old API (kept as thin wrappers over evaluateDay) ─────────
describe("computeFlexMinutes (past days only)", () => {
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
    // Sunday: norm 0; 08:00–12:00 = 240, a single session under 5 h gets no lunch.
    expect(flex([session(SUN_PAST, "08:00", "12:00")], [], SUN_PAST, SUN_PAST)).toBe(240);
  });

  it("a full-day non-flex absence excuses the day", () => {
    expect(flex([], [absence("sjuk", MON)], MON, MON)).toBe(0);
    expect(flex([], [absence("helgdag", MON)], MON, MON)).toBe(0);
  });

  it("a partial non-flex absence lowers the norm", () => {
    // PR 1 used 08:00–13:00 (300 min − 60 lunch). Under the new lunch rule a 5 h session
    // keeps its lunch-free 300 min, so the half day here is 08:00–12:00.
    expect(flex([session(MON, "08:00", "12:00")], [absence("vab", MON, MON, 4)], MON, MON)).toBe(0);
  });

  it("ignores open sessions on past days", () => {
    expect(flex([session(MON, "08:00", null)], [absence("sjuk", MON)], MON, MON)).toBe(0);
    expect(flex([session(MON, "08:00", null)], [], MON, MON)).toBe(0);
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

  it("accepts schedule periods (PR 4) as well as a plain week", () => {
    const periods = [periodFromWeek(DEFAULT_SCHEDULE, "2026-01-01")];
    expect(computeFlexMinutes([session(MON, "08:00", "18:00")], [], periods, START, MON, MON)).toBe(
      60,
    );
  });
});

describe("computeTodayContribution", () => {
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
    // See "a partial non-flex absence lowers the norm" for why this is 08:00–12:00 now.
    expect(contribution([session(WED, "08:00", "12:00")], [absence("vab", WED, WED, 4)])).toBe(0);
  });

  it("a full-day flex absence today settles at once, counted once", () => {
    expect(contribution([], [absence("flex", WED)])).toBe(-480);
  });
});

describe("computeTodayDelta (live 'Idag')", () => {
  it("is live: open session counts up to now()", () => {
    // 08:00 → now 12:00 = 240 min. PR 1 deducted the 60 min lunch before it was taken
    // (−300); a single session under 5 h gets no lunch now.
    expect(computeTodayDelta([session(WED, "08:00", null)], DEFAULT_SCHEDULE.wed)).toBe(-240);
  });

  it("goes positive after overshoot", () => {
    expect(computeTodayDelta([session(WED, "08:00", "18:00")], DEFAULT_SCHEDULE.wed)).toBe(60);
  });

  it("does not deduct lunch when the user punched out over lunch", () => {
    const s = [session(WED, "07:00", "11:00"), session(WED, "11:30", null)];
    expect(computeTodayDelta(s, DEFAULT_SCHEDULE.wed)).toBe(-210);
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

describe("computeWeeklyFlexBreakdown", () => {
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
    // PR 1 pinned ["2026-03-08", "2026-03-01"]: UTC dates of local-midnight Mondays, which
    // made the week labels start on a Sunday. Keys are local Mondays now.
    expect(rows.map((r) => r.mondayStr)).toEqual(["2026-03-09", "2026-03-02"]);
    expect(rows[0].minutes).toBe(45);
    expect(rows[1].minutes).toBe(60);
  });

  it("stops once a week ends before trackingStartDate", () => {
    const rows = computeWeeklyFlexBreakdown([], [], DEFAULT_SCHEDULE, START, 10, 0);
    expect(rows.length).toBeLessThan(10);
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ─── PR 1's known bugs, now fixed ─────────────────────────────
describe("known bugs (fixed in PR 3)", () => {
  it("(a) a scheduled past day with no session and no absence gives 0, not −norm", () => {
    const flex = computeFlexMinutes([], [], DEFAULT_SCHEDULE, START, MON, MON);
    expect(flex).toBe(0);
  });

  it("(b) a full-day flex absence deducts the norm once, not twice", () => {
    const flex = computeFlexMinutes([], [absence("flex", MON)], DEFAULT_SCHEDULE, START, MON, MON);
    expect(flex).toBe(-480);
  });

  it("(c) schedule lunch is not deducted when the user punched out for lunch", () => {
    const sessions = [session(WED, "08:00", "12:00"), session(WED, "13:00", "17:00")];
    const { net } = computeDayMinutes(sessions, WED, DEFAULT_SCHEDULE);
    expect(net).toBe(480);
  });

  it("(d) a session between 00:00 and 02:00 local belongs to that local day", () => {
    // 00:30–09:00 local on Tue 03-10 is 23:30 UTC on 03-09.
    const sessions = [session(TUE, "00:30", "09:00")];
    const contribution = computeTodayContribution(sessions, [], DEFAULT_SCHEDULE, TUE, START);
    expect(contribution).toBe(450 - 480); // 510 raw − 60 lunch − 480 norm
  });
});

// ─── New API: a fold over evaluateDay ─────────────────────────
function ctx(over: Partial<FlexContext> = {}): FlexContext {
  return {
    sessions: [],
    absences: [],
    schedule: DEFAULT_SCHEDULE,
    exceptions: {},
    reportingMode: "punch",
    trackingStartDate: START,
    today: WED,
    now: at(WED, "12:00"),
    ...over,
  };
}

describe("computeFlex", () => {
  it("returns zeros without a trackingStartDate", () => {
    expect(computeFlex(ctx({ trackingStartDate: undefined }))).toEqual({
      minutes: 0,
      missingDays: [],
      unconfirmedDays: [],
    });
  });

  it("punch mode: forgotten days are listed as missing and do not drain flex", () => {
    const r = computeFlex(ctx({ sessions: [session(MON, "08:00", "18:00")] }));
    expect(r.minutes).toBe(60);
    expect(r.missingDays).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      TUE,
    ]);
    expect(r.unconfirmedDays).toEqual([]);
  });

  it("schedule mode: forgotten days are unconfirmed and count as worked per schedule", () => {
    const r = computeFlex(
      ctx({ reportingMode: "schedule", sessions: [session(MON, "08:00", "18:00")] }),
    );
    expect(r.minutes).toBe(60);
    expect(r.unconfirmedDays).toHaveLength(6);
    expect(r.missingDays).toEqual([]);
  });

  it("includes today only once it is settled", () => {
    expect(computeFlex(ctx({ sessions: [session(WED, "08:00", null)] })).minutes).toBe(0);
    expect(computeFlex(ctx({ sessions: [session(WED, "08:00", "18:00")] })).minutes).toBe(60);
    // nothing registered today, before end of shift: not missing yet
    expect(computeFlex(ctx()).missingDays).not.toContain(WED);
    // after end of shift it is
    expect(computeFlex(ctx({ now: at(WED, "17:00") })).missingDays).toContain(WED);
  });

  it("never counts future days", () => {
    const r = computeFlex(ctx({ sessions: [session("2026-03-12", "08:00", "18:00")] }), {
      from: MON,
      to: "2026-03-31",
    });
    expect(r.minutes).toBe(0);
    expect(r.missingDays).toEqual([MON, TUE]);
  });

  it("clamps the range to trackingStartDate", () => {
    const r = computeFlex(ctx({ sessions: [session("2026-02-27", "08:00", "18:00")] }), {
      from: "2026-02-01",
      to: "2026-03-03",
    });
    expect(r.minutes).toBe(0);
    expect(r.missingDays).toEqual(["2026-03-02", "2026-03-03"]);
  });

  it("half-day absences", () => {
    const r = computeFlex(
      ctx({
        sessions: [session(MON, "08:00", "12:00"), session(TUE, "08:00", "12:00")],
        absences: [absence("vab", MON, MON, 4), absence("flex", TUE, TUE, 4)],
      }),
      { from: MON, to: TUE },
    );
    expect(r.minutes).toBe(-240);
    expect(r.missingDays).toEqual([]);
  });

  it("weekend work adds to the week", () => {
    const r = computeFlex(
      ctx({
        sessions: [
          session(FRI_PAST, "08:00", "17:00"),
          session("2026-03-07", "10:00", "14:00"),
          session(SUN_PAST, "10:00", "11:30"),
        ],
      }),
      { from: FRI_PAST, to: SUN_PAST },
    );
    expect(r.minutes).toBe(240 + 90);
  });

  it("multi-day semester over a weekend excuses only the scheduled days", () => {
    const r = computeFlex(ctx({ absences: [absence("semester", FRI_PAST, MON)] }), {
      from: FRI_PAST,
      to: MON,
    });
    expect(r).toEqual({ minutes: 0, missingDays: [], unconfirmedDays: [] });
  });

  it("multi-day flex over a weekend costs only the scheduled days", () => {
    const r = computeFlex(ctx({ absences: [absence("flex", FRI_PAST, MON)] }), {
      from: FRI_PAST,
      to: MON,
    });
    expect(r.minutes).toBe(-960);
  });

  it("helgdag excuses the day; a shortened eve uses the exception norm", () => {
    // 2026-04-02 skärtorsdag ends 13:00 without lunch; 2026-04-03 långfredag is a helgdag.
    const r = computeFlex(
      ctx({
        today: "2026-04-07",
        now: at("2026-04-07", "12:00"),
        exceptions: {
          "2026-04-02": { type: "override", endTime: "13:00", lunchMinutes: 0 },
        },
        sessions: [session("2026-04-02", "08:00", "13:30")],
        absences: [absence("helgdag", "2026-04-03"), absence("helgdag", "2026-04-06")],
      }),
      { from: "2026-04-02", to: "2026-04-06" },
    );
    expect(r.minutes).toBe(30);
    expect(r.missingDays).toEqual([]);
  });

  it("iterates each day exactly once across the spring DST week", () => {
    const r = computeFlex(
      ctx({ today: "2026-04-01", now: at("2026-04-01", "12:00"), trackingStartDate: "2026-03-23" }),
      { from: "2026-03-23", to: "2026-03-29" },
    );
    expect(r.missingDays).toEqual([
      "2026-03-23",
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
    ]);
  });

  it("iterates each day exactly once across the autumn DST week", () => {
    const r = computeFlex(
      ctx({
        today: "2026-10-28",
        now: at("2026-10-28", "12:00"),
        trackingStartDate: "2026-10-19",
        reportingMode: "schedule",
        sessions: [session("2026-10-25", "00:30", "09:00")],
      }),
      { from: "2026-10-19", to: "2026-10-25" },
    );
    expect(r.unconfirmedDays).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]);
    expect(r.minutes).toBe(570); // Sunday 00:30–09:00 = 9 h 30 min real time, no lunch (off day)
  });

  it("a locked month is never missing or unconfirmed", () => {
    const lockedMonths = { "2026-03": { at: at(WED, "08:00"), by: "Anna" } };
    expect(computeFlex(ctx({ lockedMonths }))).toEqual({
      minutes: 0,
      missingDays: [],
      unconfirmedDays: [],
    });
  });

  it("works with rotating schedule periods", () => {
    const off: WeekSchedule = {
      ...DEFAULT_SCHEDULE,
      mon: { ...DEFAULT_SCHEDULE.mon, active: false },
      tue: { ...DEFAULT_SCHEDULE.tue, active: false },
      wed: { ...DEFAULT_SCHEDULE.wed, active: false },
      thu: { ...DEFAULT_SCHEDULE.thu, active: false },
      fri: { ...DEFAULT_SCHEDULE.fri, active: false },
    };
    // Week of 2026-03-02 works, week of 2026-03-09 is off (2-week rotation anchored 03-02).
    const schedule = [
      {
        validFrom: "2026-01-01",
        anchorMonday: "2026-03-02",
        rotation: { weeks: [DEFAULT_SCHEDULE, off] },
      },
    ];
    const r = computeFlex(ctx({ schedule }));
    expect(r.missingDays).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
    ]);
  });
});

describe("computeWeeklyFlex", () => {
  it("uses local Mondays and includes settled today in the current week", () => {
    const rows = computeWeeklyFlex(
      ctx({
        now: at(WED, "18:00"),
        sessions: [session("2026-03-02", "08:00", "18:00"), session(WED, "08:00", "17:30")],
      }),
      2,
    );
    expect(rows.map((r) => r.mondayStr)).toEqual(["2026-03-09", "2026-03-02"]);
    expect(rows[0].minutes).toBe(30);
    expect(rows[1].minutes).toBe(60);
    expect(rows[1].missingDays).toHaveLength(4);
  });

  it("stops before trackingStartDate", () => {
    expect(computeWeeklyFlex(ctx(), 10)).toHaveLength(2);
    expect(computeWeeklyFlex(ctx({ trackingStartDate: undefined }), 10)).toEqual([]);
  });
});

describe("computeFlex with flexBaseDate (opening balance)", () => {
  // The balance is at the END of flexBaseDate, so only later days accrue.
  const MON_PAST = "2026-03-02";

  it("accrues only from the day after flexBaseDate", () => {
    const sessions = [
      session(MON_PAST, "08:00", "18:00"), // +60, covered by the balance
      session("2026-03-03", "08:00", "18:00"), // +60, the base day itself: covered
      session("2026-03-04", "08:00", "17:30"), // +30, counts
    ];
    expect(computeFlex(ctx({ sessions })).minutes).toBe(150);
    expect(computeFlex(ctx({ sessions, flexBaseDate: "2026-03-03" })).minutes).toBe(30);
  });

  it("does not list missing days on or before the base date", () => {
    const r = computeFlex(ctx({ flexBaseDate: "2026-03-05" }));
    expect(r.missingDays).toEqual(["2026-03-06", MON, TUE]);
  });

  it("is ignored when it is before trackingStartDate", () => {
    const sessions = [session(MON_PAST, "08:00", "18:00")];
    const base = computeFlex(ctx({ sessions })).minutes;
    expect(computeFlex(ctx({ sessions, flexBaseDate: "2026-01-01" })).minutes).toBe(base);
  });

  it("clamps ranges that start before the base date", () => {
    const sessions = [
      session("2026-03-03", "08:00", "18:00"),
      session("2026-03-04", "08:00", "17:30"),
    ];
    const r = computeFlex(ctx({ sessions, flexBaseDate: "2026-03-03" }), {
      from: MON_PAST,
      to: "2026-03-06",
    });
    expect(r.minutes).toBe(30);
  });

  it("a base date in the future accrues nothing", () => {
    expect(computeFlex(ctx({ flexBaseDate: "2026-03-20" })).minutes).toBe(0);
  });
});
