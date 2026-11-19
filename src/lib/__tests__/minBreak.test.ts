import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE, type WeekSchedule } from "../schedule";
import { computeDayMinutes, evaluateDay, validMinBreak, type DayContext } from "../days";
import { at, session } from "./helpers";

// Minimum break (off unless DayContext.minBreak is set). Default schedule: Mon–Fri 08:00–17:00,
// 60 min lunch. Rule used here: at least 30 min break on a day with more than 5 h of work.
const TODAY = "2026-03-11";
const DAY = "2026-03-10";
const RULE = { afterMin: 300, minMin: 30 };

function ctx(over: Partial<DayContext> = {}): DayContext {
  return {
    sessions: [],
    absences: [],
    schedule: DEFAULT_SCHEDULE,
    exceptions: {},
    reportingMode: "punch",
    trackingStartDate: "2026-03-02",
    today: TODAY,
    now: at(TODAY, "12:00"),
    minBreak: RULE,
    ...over,
  };
}

describe("minsta rast", () => {
  it("ägarens exempel: 08–12 och 12:15–16 med 15 min rast ger 30 min rast", () => {
    const sessions = [session(DAY, "08:00", "12:00"), session(DAY, "12:15", "16:00")];
    const ev = evaluateDay(DAY, ctx({ sessions }));
    expect(ev.workedMin).toBe(7 * 60 + 30);
    expect(ev.breakMin).toBe(15);
    expect(ev.breakTopUpMin).toBe(15);
    expect(ev.flexDelta).toBe(-30);
    expect(ev.explanation).toContain(
      "Minsta rast 30 min efter 5 h arbete: längsta rasten var 15 min, 15 min till dras",
    );
    // Without the rule (min-tid's default) the same day counts all 7 h 45 min.
    const off = evaluateDay(DAY, ctx({ sessions, minBreak: undefined }));
    expect(off.workedMin).toBe(7 * 60 + 45);
    expect(off.breakTopUpMin).toBeUndefined();
  });

  it("förmiddagen räknas fullt; under gränsen dras inget", () => {
    const ev = evaluateDay(DAY, ctx({ sessions: [session(DAY, "08:00", "12:00")] }));
    expect(ev.workedMin).toBe(240);
    expect(ev.breakTopUpMin).toBeUndefined();
    // Exactly 5 h is not "more than" 5 h.
    const five = evaluateDay(
      DAY,
      ctx({ sessions: [session(DAY, "08:00", "11:00"), session(DAY, "11:05", "13:05")] }),
    );
    expect(five.workedMin).toBe(300);
  });

  it("utstämplad 30 min eller mer: inget dras", () => {
    const ev = evaluateDay(
      DAY,
      ctx({ sessions: [session(DAY, "08:00", "12:00"), session(DAY, "12:30", "16:30")] }),
    );
    expect(ev.workedMin).toBe(480);
    expect(ev.breakTopUpMin).toBeUndefined();
  });

  it("korta raster räknas inte ihop: tre pauser på 10 min ger ingen 30-minutersrast", () => {
    const ev = evaluateDay(
      DAY,
      ctx({
        sessions: [
          session(DAY, "08:00", "10:00"),
          session(DAY, "10:10", "12:00"),
          session(DAY, "12:10", "14:00"),
          session(DAY, "14:10", "16:30"),
        ],
      }),
    );
    // Raw 2 h + 1 h 50 + 1 h 50 + 2 h 20 = 8 h; longest break 10 → 20 more.
    expect(ev.breakTopUpMin).toBe(20);
    expect(ev.workedMin).toBe(7 * 60 + 40);
    expect(ev.explanation.join(" ")).toMatch(/längsta rasten var 10 min, 20 min till dras/);
  });

  it("en lång rast räcker även om det finns korta pauser", () => {
    const ev = evaluateDay(
      DAY,
      ctx({
        sessions: [
          session(DAY, "08:00", "10:00"),
          session(DAY, "10:10", "12:00"),
          session(DAY, "12:30", "16:30"),
        ],
      }),
    );
    expect(ev.breakTopUpMin).toBeUndefined();
    expect(ev.workedMin).toBe(2 * 60 + 110 + 240);
  });

  it("ett långt pass utan schemalunch fylls upp till minimum", () => {
    const noLunch: WeekSchedule = Object.fromEntries(
      Object.entries(DEFAULT_SCHEDULE).map(([k, d]) => [k, { ...d, lunchMinutes: 0 }]),
    ) as WeekSchedule;
    const ev = evaluateDay(
      DAY,
      ctx({ schedule: noLunch, sessions: [session(DAY, "08:00", "16:00")] }),
    );
    expect(ev.breakMin).toBe(30);
    expect(ev.workedMin).toBe(450);
  });

  it("schemats lunch på ett långt pass räcker; registrerad kort rast fylls upp", () => {
    const lunch = evaluateDay(DAY, ctx({ sessions: [session(DAY, "08:00", "17:00")] }));
    expect(lunch.breakMin).toBe(60);
    expect(lunch.breakTopUpMin).toBeUndefined();
    const reg = evaluateDay(
      DAY,
      ctx({ sessions: [session(DAY, "08:00", "16:20", DAY, { breakMinutes: 10 })] }),
    );
    expect(reg.breakMin).toBe(30);
    expect(reg.workedMin).toBe(470);
  });

  it("justerad dag följer samma regel", () => {
    const ev = evaluateDay(
      DAY,
      ctx({ dayAdjustments: { [DAY]: { date: DAY, start: "08:00", end: "16:15", breakMin: 15 } } }),
    );
    expect(ev.breakMin).toBe(30);
    expect(ev.workedMin).toBe(465);
    expect(ev.explanation.join(" ")).toMatch(/rast 15 min/);
  });

  it("computeDayMinutes (historik, CSV) använder samma regel", () => {
    const sessions = [session(DAY, "08:00", "12:00"), session(DAY, "12:15", "16:00")];
    expect(computeDayMinutes(sessions, DAY, DEFAULT_SCHEDULE, {}, 300, RULE).net).toBe(450);
    expect(computeDayMinutes(sessions, DAY, DEFAULT_SCHEDULE, {}, 300).net).toBe(465);
  });

  it("ogiltiga regler betyder av", () => {
    expect(validMinBreak(undefined)).toBeUndefined();
    expect(validMinBreak({ afterMin: 0, minMin: 30 })).toBeUndefined();
    expect(validMinBreak({ afterMin: 300, minMin: 500 })).toBeUndefined();
    expect(validMinBreak({ afterMin: "300", minMin: 30 })).toBeUndefined();
    expect(validMinBreak({ afterMin: 300, minMin: 30 })).toEqual(RULE);
  });
});
