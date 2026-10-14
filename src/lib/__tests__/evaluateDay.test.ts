import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE, type WeekSchedule } from "../schedule";
import {
  DEFAULT_AUTO_LUNCH_THRESHOLD_MIN,
  evaluateDay,
  fmtDuration,
  fmtSignedDuration,
  liveDayDelta,
  resolveReportingMode,
  type DayContext,
} from "../days";
import { absence, at, session } from "./helpers";

// Fixed "now": Wednesday 2026-03-11 12:00 local (Europe/Stockholm).
// Default schedule: Mon–Fri 08:00–17:00, 60 min lunch → 480 min net norm.
const TODAY = "2026-03-11";
const NOW = at(TODAY, "12:00");
const MON = "2026-03-09";
const TUE = "2026-03-10";
const WED = TODAY;
const THU = "2026-03-12";
const SAT_PREV = "2026-03-07";
const SUN_PREV = "2026-03-08";
const START = "2026-03-02";

function ctx(over: Partial<DayContext> = {}): DayContext {
  return {
    sessions: [],
    absences: [],
    schedule: DEFAULT_SCHEDULE,
    exceptions: {},
    reportingMode: "punch",
    trackingStartDate: START,
    today: TODAY,
    now: NOW,
    ...over,
  };
}

const ALL_WEEK: WeekSchedule = {
  ...DEFAULT_SCHEDULE,
  sat: { active: true, startTime: "08:00", endTime: "17:00", lunchMinutes: 60 },
  sun: { active: true, startTime: "08:00", endTime: "17:00", lunchMinutes: 60 },
};

describe("duration formatting", () => {
  it("formats minutes the Swedish way", () => {
    expect(fmtDuration(0)).toBe("0 min");
    expect(fmtDuration(20)).toBe("20 min");
    expect(fmtDuration(60)).toBe("1 h");
    expect(fmtDuration(460)).toBe("7 h 40 min");
    expect(fmtDuration(-90)).toBe("1 h 30 min");
    expect(fmtSignedDuration(-20)).toBe("−20 min");
    expect(fmtSignedDuration(60)).toBe("+1 h");
    expect(fmtSignedDuration(0)).toBe("0 min");
  });
});

describe("evaluateDay — punch mode, past days", () => {
  it("a scheduled day with no entries is missing and does not touch flex", () => {
    const r = evaluateDay(MON, ctx());
    expect(r).toMatchObject({ status: "missing", normMin: 480, workedMin: 0, flexDelta: 0 });
    expect(r.explanation.join("\n")).toContain("saknas");
  });

  it("explains a worked day line by line", () => {
    const r = evaluateDay(MON, ctx({ sessions: [session(MON, "08:00", "16:40")] }));
    expect(r).toMatchObject({ status: "reported", workedMin: 460, breakMin: 60, flexDelta: -20 });
    expect(r.explanation).toContain("Norm 8 h (08:00–17:00, lunch 1 h)");
    expect(r.explanation).toContain("Arbetat 7 h 40 min");
    expect(r.explanation).toContain("Flex −20 min");
    expect(r.explanation.join("\n")).toContain("08:00–16:40");
  });

  it("overtime and exact days", () => {
    expect(evaluateDay(MON, ctx({ sessions: [session(MON, "08:00", "17:00")] })).flexDelta).toBe(0);
    const over = evaluateDay(MON, ctx({ sessions: [session(MON, "08:00", "18:00")] }));
    expect(over.flexDelta).toBe(60);
    expect(over.explanation).toContain("Flex +1 h");
  });

  it("no lunch is deducted when the user punched out over lunch", () => {
    const s = [session(MON, "08:00", "12:00"), session(MON, "13:00", "17:00")];
    const r = evaluateDay(MON, ctx({ sessions: s }));
    expect(r).toMatchObject({ workedMin: 480, breakMin: 0, flexDelta: 0, status: "reported" });
    expect(r.explanation.join("\n")).toContain("stämplade ut");
  });

  it("two sessions never get the schedule lunch, even if one is long", () => {
    const s = [session(MON, "07:00", "08:00"), session(MON, "09:00", "17:00")];
    expect(evaluateDay(MON, ctx({ sessions: s }))).toMatchObject({ workedMin: 540, breakMin: 0 });
  });

  it("a single session gets the lunch only when longer than the threshold (300 min)", () => {
    expect(DEFAULT_AUTO_LUNCH_THRESHOLD_MIN).toBe(300);
    const exactly = evaluateDay(MON, ctx({ sessions: [session(MON, "08:00", "13:00")] }));
    expect(exactly).toMatchObject({ workedMin: 300, breakMin: 0, flexDelta: -180 });
    const longer = evaluateDay(MON, ctx({ sessions: [session(MON, "08:00", "13:01")] }));
    expect(longer).toMatchObject({ workedMin: 241, breakMin: 60, flexDelta: -239 });
  });

  it("honours a custom autoLunchThresholdMin", () => {
    const r = evaluateDay(
      MON,
      ctx({ sessions: [session(MON, "08:00", "12:30")], autoLunchThresholdMin: 240 }),
    );
    expect(r).toMatchObject({ workedMin: 210, breakMin: 60 });
  });

  it("uses registered breakMinutes instead of the schedule lunch", () => {
    const one = [session(MON, "08:00", "17:00", MON, { breakMinutes: 30 })];
    expect(evaluateDay(MON, ctx({ sessions: one }))).toMatchObject({
      workedMin: 510,
      breakMin: 30,
      flexDelta: 30,
    });
    const two = [
      session(MON, "08:00", "12:00", MON, { breakMinutes: 15 }),
      session(MON, "12:30", "17:00", MON, { breakMinutes: 15 }),
    ];
    expect(evaluateDay(MON, ctx({ sessions: two })).breakMin).toBe(30);
    const zero = [session(MON, "08:00", "17:00", MON, { breakMinutes: 0 })];
    expect(evaluateDay(MON, ctx({ sessions: zero }))).toMatchObject({
      workedMin: 540,
      breakMin: 0,
    });
  });

  it("an open session on a past day is ongoing and does not touch flex", () => {
    const r = evaluateDay(MON, ctx({ sessions: [session(MON, "08:00", null)] }));
    expect(r.status).toBe("ongoing");
    expect(r.flexDelta).toBe(0);
  });

  it("counts seconds as displayed: whole minutes only", () => {
    const s = { ...session(MON, "08:00", "17:00"), checkIn: at(MON, "08:00") + 45_000 };
    expect(evaluateDay(MON, ctx({ sessions: [s] })).workedMin).toBe(480);
  });

  it("clamps a corrupt session (check-out before check-in) to zero", () => {
    const s = { ...session(MON, "08:00", "17:00"), checkOut: at(MON, "07:00") };
    expect(evaluateDay(MON, ctx({ sessions: [s] })).workedMin).toBe(0);
  });
});

describe("evaluateDay — absences", () => {
  it("a full-day flex absence costs the norm once", () => {
    const r = evaluateDay(MON, ctx({ absences: [absence("flex", MON)] }));
    expect(r).toMatchObject({
      status: "absent",
      workedMin: 0,
      flexDelta: -480,
      absence: { flexMin: 480, excusedMin: 0 },
    });
  });

  it("a flex absence in hours costs those hours", () => {
    const r = evaluateDay(
      MON,
      ctx({ absences: [absence("flex", MON, MON, 2)], sessions: [session(MON, "08:00", "15:00")] }),
    );
    expect(r).toMatchObject({ status: "partial", workedMin: 360, flexDelta: -120 });
  });

  it("flex taken but the full day worked anyway gives 0", () => {
    const r = evaluateDay(
      MON,
      ctx({ absences: [absence("flex", MON, MON, 2)], sessions: [session(MON, "08:00", "17:00")] }),
    );
    expect(r.flexDelta).toBe(0);
  });

  it("a full-day non-flex absence excuses the day", () => {
    const r = evaluateDay(MON, ctx({ absences: [absence("sjuk", MON)] }));
    expect(r).toMatchObject({ status: "absent", flexDelta: 0, absence: { excusedMin: 480 } });
  });

  it("half-day VAB plus half a day worked balances", () => {
    const r = evaluateDay(
      MON,
      ctx({ absences: [absence("vab", MON, MON, 4)], sessions: [session(MON, "08:00", "12:00")] }),
    );
    expect(r).toMatchObject({
      status: "partial",
      workedMin: 240,
      flexDelta: 0,
      absence: { excusedMin: 240 },
    });
  });

  it("half-day VAB and nothing else is missing in punch mode (the uncovered half)", () => {
    const r = evaluateDay(MON, ctx({ absences: [absence("vab", MON, MON, 4)] }));
    expect(r).toMatchObject({ status: "missing", flexDelta: 0, workedMin: 0 });
  });

  it("half-day flex and nothing else still takes the flex", () => {
    const r = evaluateDay(MON, ctx({ absences: [absence("flex", MON, MON, 4)] }));
    expect(r).toMatchObject({ status: "missing", flexDelta: -240 });
  });

  it("absence hours above the norm are capped", () => {
    expect(evaluateDay(MON, ctx({ absences: [absence("flex", MON, MON, 10)] })).flexDelta).toBe(
      -480,
    );
    const both = evaluateDay(MON, ctx({ absences: [absence("sjuk", MON), absence("flex", MON)] }));
    expect(both).toMatchObject({ status: "absent", flexDelta: 0 });
  });

  it("sick all day but came in for two hours: the two hours are plus", () => {
    const r = evaluateDay(
      MON,
      ctx({ absences: [absence("sjuk", MON)], sessions: [session(MON, "10:00", "12:00")] }),
    );
    expect(r).toMatchObject({ status: "partial", workedMin: 120, flexDelta: 120 });
  });

  it("absence on a non-scheduled day is ignored", () => {
    const r = evaluateDay(SAT_PREV, ctx({ absences: [absence("flex", SAT_PREV)] }));
    expect(r).toMatchObject({
      status: "off",
      flexDelta: 0,
      absence: { flexMin: 0, excusedMin: 0 },
    });
    expect(r.explanation.join("\n")).toContain("ledig dag");
  });
});

describe("evaluateDay — weekend work, exceptions, helgdag", () => {
  it("work on a non-scheduled day is all flex", () => {
    const r = evaluateDay(SAT_PREV, ctx({ sessions: [session(SAT_PREV, "10:00", "14:00")] }));
    expect(r).toMatchObject({ status: "reported", normMin: 0, workedMin: 240, flexDelta: 240 });
    expect(r.explanation).toContain("Ledig dag enligt schema");
  });

  it("weekend work with a semester absence on the same weekend day is still all flex", () => {
    const r = evaluateDay(
      SUN_PREV,
      ctx({
        absences: [absence("semester", SAT_PREV, SUN_PREV)],
        sessions: [session(SUN_PREV, "10:00", "12:00")],
      }),
    );
    expect(r).toMatchObject({ status: "reported", flexDelta: 120 });
  });

  it("a shortened-day exception lowers the norm", () => {
    const exceptions = { [MON]: { type: "override" as const, endTime: "13:00", lunchMinutes: 0 } };
    const unworked = evaluateDay(MON, ctx({ exceptions, reportingMode: "schedule" }));
    expect(unworked).toMatchObject({ status: "unconfirmed", normMin: 300, workedMin: 300 });
    expect(unworked.explanation).toContain("Norm 5 h (08:00–13:00, ingen lunch)");
    const worked = evaluateDay(
      MON,
      ctx({ exceptions, sessions: [session(MON, "08:00", "13:00")] }),
    );
    expect(worked.flexDelta).toBe(0);
  });

  it("a helgdag absence excuses the day and is not missing", () => {
    const r = evaluateDay(MON, ctx({ absences: [absence("helgdag", MON)] }));
    expect(r).toMatchObject({ status: "absent", flexDelta: 0 });
  });

  it("work on a helgdag is all plus", () => {
    const r = evaluateDay(
      MON,
      ctx({ absences: [absence("helgdag", MON)], sessions: [session(MON, "10:00", "12:00")] }),
    );
    expect(r).toMatchObject({ status: "partial", workedMin: 120, flexDelta: 120 });
  });

  it("helgdag on a shortened-day exception excuses the exception's norm", () => {
    const exceptions = { [MON]: { type: "override" as const, endTime: "13:00", lunchMinutes: 0 } };
    const r = evaluateDay(MON, ctx({ exceptions, absences: [absence("helgdag", MON)] }));
    expect(r).toMatchObject({ status: "absent", absence: { excusedMin: 300 }, flexDelta: 0 });
  });
});

describe("evaluateDay — local day keys (00:30 case and DST)", () => {
  it("a session starting 00:30 belongs to that local day", () => {
    const s = [session(TUE, "00:30", "09:00")];
    expect(evaluateDay(MON, ctx({ sessions: s })).status).toBe("missing");
    expect(evaluateDay(TUE, ctx({ sessions: s }))).toMatchObject({
      workedMin: 450,
      flexDelta: -30,
    });
  });

  it("a session over midnight belongs to its check-in day", () => {
    const s = [session(MON, "22:00", "02:00", TUE)];
    expect(evaluateDay(MON, ctx({ sessions: s })).workedMin).toBe(240);
    expect(evaluateDay(TUE, ctx({ sessions: s })).status).toBe("missing");
  });

  it("spring-forward night: 00:30–09:00 on 2026-03-29 is 7 h 30 min of real time", () => {
    const s = [session("2026-03-29", "00:30", "09:00")];
    const r = evaluateDay(
      "2026-03-29",
      ctx({ schedule: ALL_WEEK, sessions: s, today: "2026-04-01", now: at("2026-04-01", "12:00") }),
    );
    expect(r).toMatchObject({ workedMin: 390, breakMin: 60, flexDelta: -90 });
  });

  it("fall-back night: 00:30–09:00 on 2026-10-25 is 9 h 30 min of real time", () => {
    const s = [session("2026-10-25", "00:30", "09:00")];
    const r = evaluateDay(
      "2026-10-25",
      ctx({ schedule: ALL_WEEK, sessions: s, today: "2026-10-28", now: at("2026-10-28", "12:00") }),
    );
    expect(r).toMatchObject({ workedMin: 510, flexDelta: 30 });
  });
});

describe("evaluateDay — schedule mode", () => {
  const sched = (over: Partial<DayContext> = {}) => ctx({ reportingMode: "schedule", ...over });

  it("a forgotten day is unconfirmed and counted as worked per schedule", () => {
    const r = evaluateDay(MON, sched());
    expect(r).toMatchObject({ status: "unconfirmed", workedMin: 480, breakMin: 60, flexDelta: 0 });
    expect(r.explanation.join("\n")).toContain("Ej bekräftad");
  });

  it("a confirmed day is reported per schedule", () => {
    const r = evaluateDay(MON, sched({ confirmedDays: { [MON]: true } }));
    expect(r).toMatchObject({ status: "reported", workedMin: 480, flexDelta: 0 });
  });

  it("an adjustment is worked as adjusted", () => {
    const r = evaluateDay(
      MON,
      sched({
        dayAdjustments: { [MON]: { date: MON, start: "08:00", end: "16:00", breakMin: 30 } },
      }),
    );
    expect(r).toMatchObject({ status: "reported", workedMin: 450, breakMin: 30, flexDelta: -30 });
    expect(r.explanation.join("\n")).toContain("Justerad dag 08:00–16:00, rast 30 min");
  });

  it("an adjustment fills missing times from the schedule and applies the lunch rule", () => {
    const left = evaluateDay(
      MON,
      sched({ dayAdjustments: { [MON]: { date: MON, end: "15:00" } } }),
    );
    expect(left).toMatchObject({ workedMin: 360, breakMin: 60, flexDelta: -120 });
    const short = evaluateDay(
      MON,
      sched({ dayAdjustments: { [MON]: { date: MON, start: "08:00", end: "12:00" } } }),
    );
    expect(short).toMatchObject({ workedMin: 240, breakMin: 0, flexDelta: -240 });
    const noteOnly = evaluateDay(
      MON,
      sched({ dayAdjustments: { [MON]: { date: MON, note: "Kundbesök" } } }),
    );
    expect(noteOnly).toMatchObject({ status: "reported", workedMin: 480, flexDelta: 0 });
    expect(noteOnly.explanation.join("\n")).toContain("Kundbesök");
  });

  it("ignores malformed adjustment times", () => {
    const r = evaluateDay(
      MON,
      sched({ dayAdjustments: { [MON]: { date: MON, start: "8", end: "nope", breakMin: -5 } } }),
    );
    expect(r).toMatchObject({ workedMin: 480, flexDelta: 0 });
  });

  it("an adjustment wins over sessions", () => {
    const r = evaluateDay(
      MON,
      sched({
        sessions: [session(MON, "08:00", "09:00")],
        dayAdjustments: { [MON]: { date: MON, start: "08:00", end: "17:00" } },
      }),
    );
    expect(r).toMatchObject({ workedMin: 480, flexDelta: 0 });
  });

  it("sessions win over 'Enligt schema'", () => {
    const r = evaluateDay(
      MON,
      sched({ sessions: [session(MON, "08:00", "18:00")], confirmedDays: { [MON]: true } }),
    );
    expect(r).toMatchObject({ status: "reported", workedMin: 540, flexDelta: 60 });
  });

  it("a half-day flex absence on a forgotten day takes the flex, the rest per schedule", () => {
    const r = evaluateDay(MON, sched({ absences: [absence("flex", MON, MON, 4)] }));
    expect(r).toMatchObject({ status: "unconfirmed", workedMin: 240, flexDelta: -240 });
  });

  it("a half-day VAB on a confirmed day is partial", () => {
    const r = evaluateDay(
      MON,
      sched({ absences: [absence("vab", MON, MON, 4)], confirmedDays: { [MON]: true } }),
    );
    expect(r).toMatchObject({ status: "partial", workedMin: 240, flexDelta: 0 });
  });

  it("a full-day absence is absent, not unconfirmed", () => {
    expect(evaluateDay(MON, sched({ absences: [absence("semester", MON)] })).status).toBe("absent");
  });

  it("a non-scheduled day is off", () => {
    expect(evaluateDay(SAT_PREV, sched())).toMatchObject({ status: "off", flexDelta: 0 });
    expect(evaluateDay(SAT_PREV, sched({ confirmedDays: { [SAT_PREV]: true } })).status).toBe(
      "off",
    );
  });

  it("an adjustment on a non-scheduled day counts when it has both times", () => {
    const r = evaluateDay(
      SAT_PREV,
      sched({ dayAdjustments: { [SAT_PREV]: { date: SAT_PREV, start: "10:00", end: "13:00" } } }),
    );
    expect(r).toMatchObject({ status: "reported", workedMin: 180, flexDelta: 180 });
    const partial = evaluateDay(
      SAT_PREV,
      sched({ dayAdjustments: { [SAT_PREV]: { date: SAT_PREV, end: "13:00" } } }),
    );
    expect(partial).toMatchObject({ status: "off", flexDelta: 0 });
  });
});

describe("evaluateDay — today", () => {
  it("punch mode, nothing yet, before end of shift: ongoing, no flex", () => {
    const r = evaluateDay(WED, ctx());
    expect(r).toMatchObject({ status: "ongoing", flexDelta: 0 });
    expect(liveDayDelta(r)).toBe(0);
  });

  it("punch mode, open session: ongoing with live worked time", () => {
    const r = evaluateDay(WED, ctx({ sessions: [session(WED, "08:00", null)] }));
    expect(r).toMatchObject({ status: "ongoing", workedMin: 240, breakMin: 0, flexDelta: 0 });
    expect(liveDayDelta(r)).toBe(-240);
  });

  it("an open single session gets the lunch once it passes the threshold", () => {
    const r = evaluateDay(
      WED,
      ctx({ sessions: [session(WED, "08:00", null)], now: at(WED, "14:00") }),
    );
    expect(r).toMatchObject({ workedMin: 300, breakMin: 60 });
  });

  it("punch mode, punched out: settled at once (baseline behaviour)", () => {
    const r = evaluateDay(WED, ctx({ sessions: [session(WED, "08:00", "12:00")] }));
    expect(r).toMatchObject({ status: "reported", workedMin: 240, flexDelta: -240 });
    expect(liveDayDelta(r)).toBe(-240);
  });

  it("punch mode, nothing at all after the end of shift: missing", () => {
    const r = evaluateDay(WED, ctx({ now: at(WED, "17:30") }));
    expect(r).toMatchObject({ status: "missing", flexDelta: 0 });
    expect(liveDayDelta(r)).toBe(0);
  });

  it("schedule mode, nothing yet, before end of shift: ongoing, on track", () => {
    const r = evaluateDay(WED, ctx({ reportingMode: "schedule" }));
    expect(r).toMatchObject({ status: "ongoing", flexDelta: 0 });
    expect(liveDayDelta(r)).toBe(0);
  });

  it("schedule mode, after the end of shift: unconfirmed", () => {
    const r = evaluateDay(WED, ctx({ reportingMode: "schedule", now: at(WED, "17:00") }));
    expect(r).toMatchObject({ status: "unconfirmed", flexDelta: 0, workedMin: 480 });
  });

  it("schedule mode, confirmed in the morning: reported", () => {
    const r = evaluateDay(WED, ctx({ reportingMode: "schedule", confirmedDays: { [WED]: true } }));
    expect(r).toMatchObject({ status: "reported", flexDelta: 0 });
  });

  it("a full-day flex absence today settles immediately", () => {
    const r = evaluateDay(WED, ctx({ absences: [absence("flex", WED)] }));
    expect(r).toMatchObject({ status: "absent", flexDelta: -480 });
  });

  it("a partial flex absence today waits for the end of the shift", () => {
    const r = evaluateDay(WED, ctx({ absences: [absence("flex", WED, WED, 2)] }));
    expect(r).toMatchObject({ status: "ongoing", flexDelta: 0 });
  });

  it("a non-scheduled today with nothing is off", () => {
    const r = evaluateDay(
      "2026-03-14",
      ctx({ today: "2026-03-14", now: at("2026-03-14", "12:00") }),
    );
    expect(r.status).toBe("off");
  });
});

describe("evaluateDay — future and before tracking start", () => {
  it("future days are off and never count", () => {
    const r = evaluateDay(THU, ctx({ sessions: [session(THU, "08:00", "18:00")] }));
    expect(r).toMatchObject({ status: "off", normMin: 480, flexDelta: 0 });
    expect(r.explanation.join("\n")).toContain("Framtida");
  });

  it("days before trackingStartDate never count and are never missing", () => {
    const empty = evaluateDay("2026-02-27", ctx());
    expect(empty).toMatchObject({ status: "off", flexDelta: 0 });
    const worked = evaluateDay(
      "2026-02-27",
      ctx({ sessions: [session("2026-02-27", "08:00", "18:00")] }),
    );
    expect(worked).toMatchObject({ status: "reported", workedMin: 540, flexDelta: 0 });
    expect(worked.explanation.join("\n")).toContain("Före flexstart");
  });

  it("without a trackingStartDate nothing counts", () => {
    expect(evaluateDay(MON, ctx({ trackingStartDate: undefined }))).toMatchObject({
      status: "off",
      flexDelta: 0,
    });
  });
});

describe("evaluateDay — locked months", () => {
  const locked = { "2026-03": { at: at(TODAY, "09:00"), by: "Anna" } };

  it("an unregistered day in a locked month reads as reported (punch and schedule)", () => {
    expect(evaluateDay(MON, ctx({ lockedMonths: locked }))).toMatchObject({
      status: "reported",
      workedMin: 480,
      flexDelta: 0,
    });
    expect(evaluateDay(MON, ctx({ lockedMonths: locked, reportingMode: "schedule" })).status).toBe(
      "reported",
    );
    expect(evaluateDay(MON, ctx({ lockedMonths: locked })).explanation.join("\n")).toContain(
      "låst",
    );
  });

  it("registered days in a locked month keep their real values", () => {
    const r = evaluateDay(
      MON,
      ctx({ lockedMonths: locked, sessions: [session(MON, "08:00", "18:00")] }),
    );
    expect(r).toMatchObject({ status: "reported", flexDelta: 60 });
  });

  it("a flex absence in a locked month still costs flex", () => {
    const r = evaluateDay(
      MON,
      ctx({ lockedMonths: locked, absences: [absence("flex", MON, MON, 2)] }),
    );
    expect(r).toMatchObject({ status: "partial", workedMin: 360, flexDelta: -120 });
  });

  it("another month is not affected", () => {
    expect(
      evaluateDay("2026-02-27", ctx({ lockedMonths: locked, trackingStartDate: "2026-02-01" }))
        .status,
    ).toBe("missing");
  });
});

describe("evaluateDay — travel hook", () => {
  it("returns zero travel by default", () => {
    expect(evaluateDay(MON, ctx()).travel).toEqual({ inScheduleMin: 0, outsideMin: 0 });
  });

  it("passes travel from ctx.travelFor through without touching flex (PR 8 wires the rules)", () => {
    const r = evaluateDay(
      MON,
      ctx({
        sessions: [session(MON, "08:00", "17:00")],
        travelFor: (date) => (date === MON ? { inScheduleMin: 30, outsideMin: 90 } : undefined),
      }),
    );
    expect(r.travel).toEqual({ inScheduleMin: 30, outsideMin: 90 });
    expect(r.flexDelta).toBe(0);
  });
});

describe("resolveReportingMode", () => {
  it("a stored value always wins", () => {
    expect(resolveReportingMode({ reportingMode: "schedule", sessions: [{}] })).toBe("schedule");
    expect(resolveReportingMode({ reportingMode: "punch", sessions: [] })).toBe("punch");
  });

  it("existing users with sessions get punch, everyone else schedule", () => {
    expect(resolveReportingMode({ sessions: [{ id: "x" }] })).toBe("punch");
    expect(resolveReportingMode({ sessions: [] })).toBe("schedule");
    expect(resolveReportingMode({})).toBe("schedule");
    expect(resolveReportingMode({ sessions: "garbage" })).toBe("schedule");
    expect(resolveReportingMode({ reportingMode: "bogus", sessions: [{}] })).toBe("punch");
  });
});

describe("evaluateDay with flexBaseDate (opening balance)", () => {
  const overtime = [session(MON, "08:00", "18:00"), session(TUE, "08:00", "18:00")];
  const LINE = (d: string) => `Ingår i importerat flexsaldo per ${d}`;

  it("a day before flexBaseDate adds no flex but keeps its status, worked time and norm", () => {
    const ev = evaluateDay(MON, ctx({ sessions: overtime, flexBaseDate: TUE }));
    expect(ev.flexDelta).toBe(0);
    expect(ev.status).toBe("reported");
    expect(ev.workedMin).toBe(540);
    expect(ev.normMin).toBe(480);
    expect(ev.explanation).toContain(LINE(TUE));
  });

  it("flexBaseDate itself is inside the balance; the day after counts", () => {
    const c = ctx({ sessions: overtime, flexBaseDate: MON });
    expect(evaluateDay(MON, c).flexDelta).toBe(0);
    expect(evaluateDay(MON, c).explanation).toContain(LINE(MON));
    const after = evaluateDay(TUE, c);
    expect(after.flexDelta).toBe(60);
    expect(after.explanation.some((l) => l.includes("importerat flexsaldo"))).toBe(false);
  });

  it("missing days inside the balance are not listed as missing, later ones are", () => {
    const c = ctx({ flexBaseDate: MON });
    expect(evaluateDay("2026-03-06", c).status).toBe("off"); // Friday, covered by the balance
    expect(evaluateDay(TUE, c).status).toBe("missing");
  });

  it("a flex absence inside the balance is already in it", () => {
    const c = ctx({ absences: [absence("flex", MON)], flexBaseDate: MON });
    expect(evaluateDay(MON, c).flexDelta).toBe(0);
    expect(evaluateDay(MON, ctx({ absences: [absence("flex", MON)] })).flexDelta).toBe(-480);
  });

  it("a flexBaseDate before trackingStartDate changes nothing", () => {
    const withBase = evaluateDay(MON, ctx({ sessions: overtime, flexBaseDate: "2026-01-01" }));
    const without = evaluateDay(MON, ctx({ sessions: overtime }));
    expect(withBase).toEqual(without);
    expect(withBase.flexDelta).toBe(60);
  });

  it("before trackingStartDate the usual line wins", () => {
    const ev = evaluateDay(
      "2026-03-02",
      ctx({ trackingStartDate: "2026-03-05", flexBaseDate: "2026-03-10" }),
    );
    expect(ev.explanation.some((l) => l.startsWith("Före flexstart"))).toBe(true);
  });

  it("without flexBaseDate nothing changes", () => {
    expect(evaluateDay(MON, ctx({ sessions: overtime })).flexDelta).toBe(60);
  });
});
