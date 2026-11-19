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
    expect(ev.explanation).toContain("Rastregel 30 min per 5 h arbete i följd: 15 min till dras");
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
    expect(ev.explanation.join(" ")).toMatch(
      /Rastregel 30 min per 5 h arbete i följd: 20 min till dras/,
    );
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

  describe("räknas efter 3 h (ägarens regel: 30 min per 5 h i följd)", () => {
    const OWNER = { afterMin: 300, minMin: 30, earliestMin: 180 };
    const day = (...pairs: [string, string][]) =>
      evaluateDay(
        DAY,
        ctx({ minBreak: OWNER, sessions: pairs.map(([a, b]) => session(DAY, a, b)) }),
      );

    it("lunch 12:00–12:30 efter 4 h räknas", () => {
      const ev = day(["08:00", "12:00"], ["12:30", "16:30"]);
      expect(ev.breakTopUpMin).toBeUndefined();
      expect(ev.workedMin).toBe(480);
    });

    it("rast före 3 h (09:00) är bara flexminus; lunchen dras ändå", () => {
      const ev = day(["08:00", "09:00"], ["09:30", "16:30"]);
      expect(ev.breakTopUpMin).toBe(30);
      expect(ev.workedMin).toBe(60 + 420 - 30);
      expect(ev.explanation).toContain(
        "Rastregel 30 min per 5 h arbete i följd (räknas efter 3 h): 30 min till dras",
      );
    });

    it("för sen lunch (14:00 efter 6 h) räknas inte", () => {
      const ev = day(["08:00", "14:00"], ["14:30", "17:00"]);
      expect(ev.breakTopUpMin).toBe(30);
    });

    it("börjar 06, lunch 10:30 efter 4 h 30 räknas", () => {
      const ev = day(["06:00", "10:30"], ["11:00", "15:00"]);
      expect(ev.breakTopUpMin).toBeUndefined();
    });

    it("lång dag 07–19 med en lunch behöver en rast till", () => {
      const ev = day(["07:00", "12:00"], ["12:30", "19:00"]);
      // 5 h, lunch, then 6 h 30 in a row → a second 30 min break is deducted.
      expect(ev.breakTopUpMin).toBe(30);
      const ok = day(["07:00", "12:00"], ["12:30", "16:00"], ["16:30", "19:00"]);
      expect(ok.breakTopUpMin).toBeUndefined();
    });

    it("kort rast efter 3 h fylls upp, som ägarens första exempel", () => {
      const ev = day(["08:00", "12:00"], ["12:15", "16:00"]);
      expect(ev.breakTopUpMin).toBe(15);
      expect(ev.workedMin).toBe(450);
    });

    it("ett 5 h-pass utan rast behöver ingen rast", () => {
      expect(day(["08:00", "13:00"]).breakTopUpMin).toBeUndefined();
    });

    it("validMinBreak behåller earliestMin bara om den är mindre än afterMin", () => {
      expect(validMinBreak(OWNER)).toEqual(OWNER);
      expect(validMinBreak({ afterMin: 300, minMin: 30, earliestMin: 400 })).toEqual({
        afterMin: 300,
        minMin: 30,
      });
    });
  });
});
