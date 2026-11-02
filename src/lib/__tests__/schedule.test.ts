import { describe, expect, it } from "vitest";
import {
  DAY_KEYS,
  DEFAULT_SCHEDULE,
  type DayConfig,
  type SchedulePeriod,
  type WeekSchedule,
  addDaysStr,
  appendPeriod,
  getEffectiveDayConfig,
  legacyScheduleOf,
  mergePeriods,
  migrateSchedules,
  mod,
  mondayOfStr,
  parsePeriods,
  periodFor,
  periodFromWeek,
  rotationPosition,
  toPeriods,
  weekScheduleFor,
  weeklyNetMinFor,
  weeksBetween,
} from "../schedule";

// A Mon–Fri week that starts at `start` (everything else = DEFAULT_SCHEDULE).
function weekStarting(start: string, end = "17:00"): WeekSchedule {
  const w = { ...DEFAULT_SCHEDULE };
  for (const k of ["mon", "tue", "wed", "thu", "fri"] as const) {
    w[k] = { ...DEFAULT_SCHEDULE[k], startTime: start, endTime: end };
  }
  return w;
}

function period(validFrom: string, anchorMonday: string, weeks: WeekSchedule[]): SchedulePeriod {
  return { validFrom, anchorMonday, rotation: { weeks } };
}

const startOf = (cfg: DayConfig) => cfg.startTime;

// 2026-03-09 is a Monday.
const MON = "2026-03-09";

describe("date helpers", () => {
  it("mod is always non-negative", () => {
    expect(mod(-1, 4)).toBe(3);
    expect(mod(-8, 4)).toBe(0);
    expect(mod(5, 4)).toBe(1);
  });

  it("mondayOfStr maps every weekday to the Monday of that (Mon–Sun) week", () => {
    expect(mondayOfStr("2026-03-09")).toBe("2026-03-09");
    expect(mondayOfStr("2026-03-11")).toBe("2026-03-09");
    expect(mondayOfStr("2026-03-15")).toBe("2026-03-09"); // Sunday belongs to the week before
    expect(mondayOfStr("2026-03-16")).toBe("2026-03-16");
    expect(mondayOfStr("2026-01-01")).toBe("2025-12-29"); // across a year boundary
  });

  it("weeksBetween counts whole weeks, also across DST changes and negative", () => {
    expect(weeksBetween("2026-03-23", "2026-03-30")).toBe(1); // spring-forward Sunday in between
    expect(weeksBetween("2026-10-19", "2026-10-26")).toBe(1); // fall-back Sunday in between
    expect(weeksBetween("2026-03-09", "2026-03-09")).toBe(0);
    expect(weeksBetween("2026-03-09", "2026-03-02")).toBe(-1);
    expect(weeksBetween("2020-01-06", "2026-03-09")).toBe(322);
  });

  it("addDaysStr is a pure calendar add", () => {
    expect(addDaysStr("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDaysStr("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("plain WeekSchedule (backwards compatible)", () => {
  it("behaves as one 1-week period valid forever", () => {
    expect(getEffectiveDayConfig("2026-03-11", DEFAULT_SCHEDULE)).toEqual(DEFAULT_SCHEDULE.wed);
    expect(getEffectiveDayConfig("1999-01-02", DEFAULT_SCHEDULE).active).toBe(false); // Saturday
    expect(getEffectiveDayConfig("2099-06-17", DEFAULT_SCHEDULE)).toEqual(DEFAULT_SCHEDULE.wed);
  });

  it("toPeriods wraps a week and passes periods through", () => {
    const wrapped = toPeriods(DEFAULT_SCHEDULE);
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0].rotation.weeks).toEqual([DEFAULT_SCHEDULE]);
    const periods = [period("2026-01-05", "2026-01-05", [DEFAULT_SCHEDULE])];
    expect(toPeriods(periods)).toBe(periods);
  });

  it("toPeriods sorts unsorted periods and survives an empty list", () => {
    const a = period("2026-01-05", "2026-01-05", [DEFAULT_SCHEDULE]);
    const b = period("2026-06-01", "2026-06-01", [DEFAULT_SCHEDULE]);
    expect(toPeriods([b, a]).map((p) => p.validFrom)).toEqual(["2026-01-05", "2026-06-01"]);
    expect(toPeriods([])[0].rotation.weeks).toEqual([DEFAULT_SCHEDULE]);
  });

  it("exceptions are applied on top of the period's day", () => {
    const periods = [period("2026-01-05", "2026-01-05", [DEFAULT_SCHEDULE])];
    const exc = { "2026-03-13": { type: "override" as const, endTime: "13:00", lunchMinutes: 0 } };
    const expected = { ...DEFAULT_SCHEDULE.fri, endTime: "13:00", lunchMinutes: 0 };
    expect(getEffectiveDayConfig("2026-03-13", periods, exc)).toEqual(expected);
    expect(getEffectiveDayConfig("2026-03-13", DEFAULT_SCHEDULE, exc)).toEqual(expected);
  });
});

describe("rotation: alternating weeks", () => {
  const A = weekStarting("08:00");
  const B = weekStarting("10:00");
  const periods = [period("2000-01-01", MON, [A, B])];
  const start = (d: string) => startOf(getEffectiveDayConfig(d, periods));

  it("alternates week by week from the anchor", () => {
    expect(start("2026-03-09")).toBe("08:00"); // anchor Monday = week 1
    expect(start("2026-03-13")).toBe("08:00"); // Friday, same week
    expect(start("2026-03-16")).toBe("10:00");
    expect(start("2026-03-23")).toBe("08:00");
    expect(start("2026-03-30")).toBe("10:00"); // across the DST change
  });

  it("keeps the weekend with the week that started on Monday", () => {
    // Sunday 15th is the last day of week 1 (A); Sat/Sun are inactive in both weeks.
    expect(getEffectiveDayConfig("2026-03-15", periods)).toEqual(A.sun);
    expect(rotationPosition(periods, "2026-03-15").week).toBe(1);
    expect(rotationPosition(periods, "2026-03-16").week).toBe(2);
  });
});

describe("rotation: 4 weeks", () => {
  const weeks = [
    weekStarting("07:00"),
    weekStarting("08:00"),
    weekStarting("09:00"),
    weekStarting("10:00"),
  ];
  const periods = [period("2000-01-01", MON, weeks)];
  const start = (d: string) => startOf(getEffectiveDayConfig(d, periods));

  it("cycles 1-2-3-4-1…", () => {
    expect(start("2026-03-09")).toBe("07:00");
    expect(start("2026-03-16")).toBe("08:00");
    expect(start("2026-03-23")).toBe("09:00");
    expect(start("2026-03-30")).toBe("10:00");
    expect(start("2026-04-06")).toBe("07:00");
    expect(start("2026-05-04")).toBe("07:00"); // 8 weeks after the anchor
    expect(start("2026-05-12")).toBe("08:00");
  });

  it("reports the position in the cycle", () => {
    expect(rotationPosition(periods, "2026-03-25")).toMatchObject({ week: 3, total: 4 });
    expect(rotationPosition(periods, "2026-04-06")).toMatchObject({ week: 1, total: 4 });
  });

  it("weekScheduleFor / weeklyNetMinFor follow the rotation", () => {
    expect(weekScheduleFor(periods, "2026-03-31")).toBe(weeks[3]);
    expect(weeklyNetMinFor(periods, "2026-03-31")).toBe(5 * (7 * 60 - 60)); // 10–17 minus 60 min lunch
  });
});

describe("dates before the anchor", () => {
  const A = weekStarting("08:00");
  const B = weekStarting("10:00");
  const four = [
    weekStarting("07:00"),
    weekStarting("08:00"),
    weekStarting("09:00"),
    weekStarting("10:00"),
  ];

  it("uses a positive modulo for a 2-week rotation", () => {
    const periods = [period("2000-01-01", MON, [A, B])];
    expect(startOf(getEffectiveDayConfig("2026-03-02", periods))).toBe("10:00"); // −1 week
    expect(startOf(getEffectiveDayConfig("2026-02-23", periods))).toBe("08:00"); // −2 weeks
    expect(startOf(getEffectiveDayConfig("2020-01-13", periods))).toBe("10:00"); // −321 weeks (odd)
    expect(rotationPosition(periods, "2026-03-08").week).toBe(2); // Sunday of the week before
  });

  it("uses a positive modulo for a 4-week rotation", () => {
    const periods = [period("2000-01-01", MON, four)];
    expect(rotationPosition(periods, "2026-03-02").week).toBe(4); // −1
    expect(rotationPosition(periods, "2026-02-23").week).toBe(3); // −2
    expect(rotationPosition(periods, "2026-02-09").week).toBe(1); // −4
    expect(startOf(getEffectiveDayConfig("2026-02-25", periods))).toBe("09:00");
  });

  it("an anchor after validFrom still gives the right phase", () => {
    // validFrom is long before the anchor; week 1 is anchored at 2026-03-09.
    const periods = [period("2026-01-05", MON, four)];
    // 2026-01-05 is 9 weeks before the anchor: mod(-9, 4) = 3, i.e. rotation week 4.
    expect(rotationPosition(periods, "2026-01-05").week).toBe(4);
    expect(startOf(getEffectiveDayConfig("2026-01-05", periods))).toBe("10:00");
  });
});

describe("period switch", () => {
  const OLD = weekStarting("08:00", "16:00");
  const NEW = weekStarting("09:00", "18:00");
  const periods = [
    period("2026-01-05", "2026-01-05", [OLD]),
    period("2026-03-11", "2026-03-09", [NEW]), // starts on a Wednesday
  ];

  it("switches mid-week on validFrom", () => {
    expect(getEffectiveDayConfig("2026-03-09", periods).startTime).toBe("08:00"); // Mon
    expect(getEffectiveDayConfig("2026-03-10", periods).startTime).toBe("08:00"); // Tue
    expect(getEffectiveDayConfig("2026-03-11", periods).startTime).toBe("09:00"); // Wed
    expect(getEffectiveDayConfig("2026-03-13", periods).endTime).toBe("18:00"); // Fri
    expect(getEffectiveDayConfig("2026-03-16", periods).startTime).toBe("09:00");
  });

  it("keeps history on the old norm and uses the first period before it starts", () => {
    expect(getEffectiveDayConfig("2026-02-02", periods).endTime).toBe("16:00");
    expect(getEffectiveDayConfig("2025-06-02", periods).endTime).toBe("16:00");
    expect(periodFor(periods, "2025-06-02")).toBe(periods[0]);
    expect(periodFor(periods, "2026-03-10")).toBe(periods[0]);
    expect(periodFor(periods, "2026-03-11")).toBe(periods[1]);
  });

  it("each period has its own rotation", () => {
    const mixed = [
      period("2026-01-05", "2026-01-05", [OLD]),
      period("2026-03-09", "2026-03-09", [weekStarting("07:00"), weekStarting("11:00")]),
    ];
    expect(getEffectiveDayConfig("2026-03-17", mixed).startTime).toBe("11:00");
    expect(getEffectiveDayConfig("2026-02-17", mixed).startTime).toBe("08:00");
    expect(rotationPosition(mixed, "2026-03-17")).toMatchObject({ week: 2, total: 2 });
  });
});

describe("appendPeriod / mergePeriods / legacyScheduleOf", () => {
  const p1 = period("2026-01-05", "2026-01-05", [weekStarting("08:00")]);
  const p2 = period("2026-03-09", "2026-03-09", [weekStarting("09:00")]);

  it("appendPeriod keeps earlier periods untouched and sorts", () => {
    const next = appendPeriod([p1], p2);
    expect(next).toEqual([p1, p2]);
    expect(next[0]).toBe(p1);
  });

  it("appendPeriod replaces a period with the same validFrom", () => {
    const edited = period("2026-03-09", "2026-03-09", [weekStarting("06:00")]);
    expect(appendPeriod([p1, p2], edited)).toEqual([p1, edited]);
  });

  it("mergePeriods unions by validFrom with local winning", () => {
    const localP2 = period("2026-03-09", "2026-03-09", [weekStarting("06:00")]);
    const p3 = period("2026-06-01", "2026-06-01", [weekStarting("10:00")]);
    expect(mergePeriods([p1, p2], [localP2, p3])).toEqual([p1, localP2, p3]);
  });

  it("legacyScheduleOf is week 1 of the period valid today", () => {
    const rot = period("2026-03-09", "2026-03-09", [weekStarting("06:00"), weekStarting("07:00")]);
    const periods = [p1, rot];
    expect(legacyScheduleOf(periods, "2026-03-10")).toBe(rot.rotation.weeks[0]);
    expect(legacyScheduleOf(periods, "2026-02-01")).toBe(p1.rotation.weeks[0]);
  });
});

describe("migration of stored state", () => {
  it("maps an old state with only `schedule` to one period", () => {
    const old = { schedule: DEFAULT_SCHEDULE, trackingStartDate: "2026-02-02" };
    const periods = migrateSchedules(old);
    expect(periods).toEqual([
      {
        validFrom: "2026-02-02",
        anchorMonday: "2026-02-02",
        rotation: { weeks: [DEFAULT_SCHEDULE] },
      },
    ]);
    // Behaves exactly as the old single schedule on any date.
    for (const d of ["2025-12-24", "2026-02-02", "2026-03-11", "2027-07-04"]) {
      expect(getEffectiveDayConfig(d, periods)).toEqual(getEffectiveDayConfig(d, DEFAULT_SCHEDULE));
    }
  });

  it("falls back to 2000-01-01 without a tracking start date", () => {
    const [p] = migrateSchedules({ schedule: DEFAULT_SCHEDULE });
    expect(p.validFrom).toBe("2000-01-01");
    expect(p.anchorMonday).toBe("1999-12-27"); // Monday of that week
    expect(DAY_KEYS.every((k) => p.rotation.weeks[0][k])).toBe(true);
  });

  it("still migrates the oldest formats (workMinutes, normHours)", () => {
    const oldFormat = {
      schedule: { mon: { active: true, workMinutes: 480, lunchMinutes: 60 } },
    };
    const [p] = migrateSchedules(oldFormat);
    expect(p.rotation.weeks[0].mon).toEqual({
      active: true,
      startTime: "08:00",
      endTime: "17:00",
      lunchMinutes: 60,
    });
    const [n] = migrateSchedules({ normHours: 7 });
    expect(n.rotation.weeks[0].mon.endTime).toBe("15:00");
    expect(migrateSchedules({})[0].rotation.weeks[0]).toEqual(DEFAULT_SCHEDULE);
  });

  it("prefers `schedules` over the legacy `schedule`", () => {
    const stored = [period("2026-03-09", "2026-03-09", [weekStarting("06:00")])];
    const periods = migrateSchedules({ schedules: stored, schedule: DEFAULT_SCHEDULE });
    expect(periods).toEqual(stored);
  });

  it("round-trips: migrate → serialise → reload gives the same periods", () => {
    const first = migrateSchedules({ schedule: DEFAULT_SCHEDULE, trackingStartDate: "2026-02-02" });
    const edited = appendPeriod(
      first,
      period("2026-03-09", "2026-03-09", [weekStarting("08:00"), weekStarting("10:00")]),
    );
    // What PunchClock persists: schedules + the legacy single schedule next to it.
    const stored = JSON.parse(
      JSON.stringify({ schedules: edited, schedule: legacyScheduleOf(edited, "2026-03-10") }),
    );
    const reloaded = migrateSchedules(stored);
    expect(reloaded).toEqual(edited);
    expect(stored.schedule).toEqual(edited[1].rotation.weeks[0]);
    // A second save/reload is stable.
    expect(migrateSchedules(JSON.parse(JSON.stringify({ schedules: reloaded })))).toEqual(reloaded);
  });

  it("parsePeriods drops junk, caps at 8 weeks and snaps the anchor to a Monday", () => {
    const nine = Array.from({ length: 9 }, () => DEFAULT_SCHEDULE);
    const parsed = parsePeriods([
      null,
      { validFrom: "not-a-date", rotation: { weeks: [DEFAULT_SCHEDULE] } },
      { validFrom: "2026-03-09", rotation: { weeks: [] } },
      { validFrom: "2026-03-11", anchorMonday: "2026-03-12", rotation: { weeks: nine } },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed![0].anchorMonday).toBe("2026-03-09");
    expect(parsed![0].rotation.weeks).toHaveLength(8);
    expect(parsePeriods([])).toBeNull();
    expect(parsePeriods("nope")).toBeNull();
    expect(parsePeriods(undefined)).toBeNull();
  });

  it("periodFromWeek defaults the anchor to the Monday of validFrom", () => {
    expect(periodFromWeek(DEFAULT_SCHEDULE, "2026-03-11").anchorMonday).toBe("2026-03-09");
  });
});
