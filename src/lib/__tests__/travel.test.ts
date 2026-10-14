import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE, getEffectiveDayConfig } from "../schedule";
import { evaluateDay, liveDayDelta, type DayContext } from "../days";
import { computeFlex } from "../flex";
import { buildCsv, buildReport, buildShareText } from "../report";
import {
  DEFAULT_TRAVEL_RULES,
  makeTravelFor,
  mergeTravelState,
  migrateTravelState,
  parseTravel,
  parseTravelRules,
  splitTravel,
  splitTravelDay,
  travelDurationMin,
  travelTotals,
  type TravelEntry,
  type TravelRules,
} from "../travel";
import type { ExpenseEntry } from "../types";
import { at, session } from "./helpers";

// Default schedule: Mon–Fri 08:00–17:00 (lunch 60). 2026-03-11 is a Wednesday.
const WED = "2026-03-11";
const SAT = "2026-03-14";
const cfgOf = (date: string, exceptions = {}) =>
  getEffectiveDayConfig(date, DEFAULT_SCHEDULE, exceptions);
const rules = (over: Partial<TravelRules> = {}): TravelRules => ({
  ...DEFAULT_TRAVEL_RULES,
  ...over,
});
let seq = 0;
const trip = (from: string, to: string, date = WED): TravelEntry => ({
  id: `t${++seq}`,
  date,
  from,
  to,
});

describe("splitTravel — inside / outside the schedule", () => {
  it("a trip fully inside the scheduled hours is worked time, nothing to payroll", () => {
    expect(splitTravel(trip("09:00", "11:00"), cfgOf(WED), rules())).toEqual({
      inScheduleMin: 120,
      outsideMin: 0,
      payrollMin: 0,
      flexMin: 0,
    });
  });

  it("a trip fully outside goes to payroll by default", () => {
    expect(splitTravel(trip("18:00", "20:30"), cfgOf(WED), rules())).toEqual({
      inScheduleMin: 0,
      outsideMin: 150,
      payrollMin: 150,
      flexMin: 0,
    });
  });

  it("a trip straddling the shift end splits at the schedule edge", () => {
    expect(splitTravel(trip("16:00", "18:00"), cfgOf(WED), rules())).toEqual({
      inScheduleMin: 60,
      outsideMin: 60,
      payrollMin: 60,
      flexMin: 0,
    });
  });

  it("a trip straddling the shift start splits at the schedule edge", () => {
    const s = splitTravel(trip("06:30", "09:00"), cfgOf(WED), rules());
    expect(s.inScheduleMin).toBe(60);
    expect(s.outsideMin).toBe(90);
  });

  it("outside time routed to flex gives flexMin and no payroll", () => {
    const s = splitTravel(trip("17:00", "18:00"), cfgOf(WED), rules({ outside: "flex" }));
    expect(s).toEqual({ inScheduleMin: 0, outsideMin: 60, payrollMin: 0, flexMin: 60 });
  });

  it("'none' pays nothing and adds no flex (inside stays worked time)", () => {
    const s = splitTravel(trip("16:00", "18:00"), cfgOf(WED), rules({ outside: "none" }));
    expect(s).toEqual({ inScheduleMin: 60, outsideMin: 60, payrollMin: 0, flexMin: 0 });
  });

  it("a trip on a non-scheduled day is entirely outside", () => {
    const s = splitTravel(trip("09:00", "11:00", SAT), cfgOf(SAT), rules());
    expect(s).toMatchObject({ inScheduleMin: 0, outsideMin: 120, payrollMin: 120 });
  });

  it("follows a schedule exception (shortened end)", () => {
    const cfg = cfgOf(WED, { [WED]: { type: "override", endTime: "13:00" } });
    const s = splitTravel(trip("12:00", "15:00"), cfg, rules());
    expect(s).toMatchObject({ inScheduleMin: 60, outsideMin: 120 });
  });

  it("lunch inside the shift window counts as inside", () => {
    expect(splitTravel(trip("11:30", "13:00"), cfgOf(WED), rules()).inScheduleMin).toBe(90);
  });
});

describe("splitTravel — midnight, night, DST", () => {
  it("a trip across midnight: the part after 24:00 is outside", () => {
    const e = trip("23:00", "01:30");
    expect(travelDurationMin(e)).toBe(150);
    expect(splitTravel(e, cfgOf(WED), rules())).toMatchObject({
      inScheduleMin: 0,
      outsideMin: 150,
      payrollMin: 150,
    });
  });

  it("to == from is an empty trip", () => {
    expect(splitTravel(trip("10:00", "10:00"), cfgOf(WED), rules())).toMatchObject({
      inScheduleMin: 0,
      outsideMin: 0,
    });
  });

  it("night exclusion drops outside minutes between 22:00 and 06:00", () => {
    // 20:00–23:30 → 20:00–22:00 counts (120), 22:00–23:30 is night (90).
    const s = splitTravel(trip("20:00", "23:30"), cfgOf(WED), rules({ excludeNight: true }));
    expect(s).toMatchObject({ outsideMin: 120, payrollMin: 120 });
    // Off: all 210.
    expect(splitTravel(trip("20:00", "23:30"), cfgOf(WED), rules()).outsideMin).toBe(210);
  });

  it("night exclusion across midnight: 21:00–07:00 keeps 21–22 and 06–07", () => {
    const s = splitTravel(trip("21:00", "07:00"), cfgOf(WED), rules({ excludeNight: true }));
    // 21:00–22:00 (60) + 06:00–07:00 (60); 07:00 is before the 08:00 shift start.
    expect(s.outsideMin).toBe(120);
  });

  it("night exclusion never removes inside-schedule minutes (night shifts)", () => {
    const night = { active: true, startTime: "22:00", endTime: "23:59", lunchMinutes: 0 };
    const s = splitTravel(trip("22:30", "23:30"), night, rules({ excludeNight: true }));
    expect(s).toMatchObject({ inScheduleMin: 60, outsideMin: 0 });
  });

  it("is wall-clock based on a DST day (spring switch 2026-03-29)", () => {
    const s = splitTravel(trip("01:30", "03:30", "2026-03-29"), cfgOf("2026-03-29"), rules());
    expect(s.outsideMin).toBe(120);
  });
});

describe("splitTravel — factor and cap", () => {
  it("factor 0.5 halves the outside minutes only (inside is 1:1)", () => {
    const s = splitTravel(trip("16:00", "19:00"), cfgOf(WED), rules({ factor: 0.5 }));
    expect(s).toEqual({ inScheduleMin: 60, outsideMin: 120, payrollMin: 60, flexMin: 0 });
  });

  it("factor 1.5 and rounding to whole minutes", () => {
    const s = splitTravel(trip("18:00", "18:45"), cfgOf(WED), rules({ factor: 1.5 }));
    expect(s.payrollMin).toBe(68); // 67.5 → 68
  });

  it("maxPerDayMin caps the credited outside minutes (after the factor)", () => {
    const s = splitTravel(trip("18:00", "22:00"), cfgOf(WED), rules({ maxPerDayMin: 90 }));
    expect(s).toMatchObject({ outsideMin: 240, payrollMin: 90 });
    // Cap is after the factor: 240 × 0.5 = 120 → capped at 90.
    const half = splitTravel(
      trip("18:00", "22:00"),
      cfgOf(WED),
      rules({ maxPerDayMin: 90, factor: 0.5 }),
    );
    expect(half.payrollMin).toBe(90);
    // …and 60 × 0.5 = 30 stays under the cap.
    expect(
      splitTravel(trip("18:00", "19:00"), cfgOf(WED), rules({ maxPerDayMin: 90, factor: 0.5 }))
        .payrollMin,
    ).toBe(30);
  });

  it("the cap never reduces inside (worked) minutes", () => {
    const s = splitTravel(trip("09:00", "12:00"), cfgOf(WED), rules({ maxPerDayMin: 30 }));
    expect(s.inScheduleMin).toBe(180);
  });

  it("the cap is per day: several trips share it", () => {
    const day = splitTravelDay(
      [trip("17:30", "18:30"), trip("19:00", "20:00")],
      cfgOf(WED),
      rules({ maxPerDayMin: 90 }),
    );
    expect(day).toMatchObject({ outsideMin: 120, payrollMin: 90 });
  });

  it("flex routing honours factor and cap too", () => {
    const s = splitTravel(
      trip("18:00", "21:00"),
      cfgOf(WED),
      rules({ outside: "flex", factor: 2, maxPerDayMin: 240 }),
    );
    expect(s).toMatchObject({ outsideMin: 180, flexMin: 240, payrollMin: 0 });
  });
});

describe("duration-only entries (imported)", () => {
  const imp: TravelEntry = { id: "i1", date: WED, durationMin: 90, imported: true };

  it("cannot be placed in the schedule, so they count entirely as outside", () => {
    expect(splitTravel(imp, cfgOf(WED), rules())).toEqual({
      inScheduleMin: 0,
      outsideMin: 90,
      payrollMin: 90,
      flexMin: 0,
    });
  });

  it("night exclusion cannot apply (no times); factor and cap do", () => {
    const s = splitTravel(imp, cfgOf(WED), rules({ excludeNight: true, factor: 0.5 }));
    expect(s).toMatchObject({ outsideMin: 90, payrollMin: 45 });
  });

  it("an entry with neither times nor duration is worth nothing", () => {
    expect(splitTravel({ id: "x", date: WED }, cfgOf(WED), rules())).toMatchObject({
      inScheduleMin: 0,
      outsideMin: 0,
    });
  });
});

describe("makeTravelFor and evaluateDay", () => {
  const ctx = (travelFor: DayContext["travelFor"], over: Partial<DayContext> = {}): DayContext => ({
    sessions: [],
    absences: [],
    schedule: DEFAULT_SCHEDULE,
    exceptions: {},
    reportingMode: "punch",
    trackingStartDate: "2026-03-02",
    today: "2026-03-12",
    now: at("2026-03-12", "12:00"),
    travelFor,
    ...over,
  });
  const full = [session(WED, "08:00", "17:00")]; // a normal 8 h day: flexDelta 0 without travel

  it("feeds all four numbers into evaluateDay's travel field", () => {
    const f = makeTravelFor([trip("16:00", "19:00")], rules());
    expect(evaluateDay(WED, ctx(f)).travel).toEqual({
      inScheduleMin: 60,
      outsideMin: 120,
      payrollMin: 120,
      flexMin: 0,
    });
  });

  it("returns nothing for days without trips and sums several trips on one day", () => {
    const f = makeTravelFor([trip("17:00", "18:00"), trip("19:00", "20:00")], rules());
    expect(f("2026-03-10", cfgOf("2026-03-10"))).toBeUndefined();
    expect(f(WED, cfgOf(WED))).toMatchObject({ outsideMin: 120, payrollMin: 120 });
    expect(evaluateDay("2026-03-10", ctx(f)).travel).toEqual({
      inScheduleMin: 0,
      outsideMin: 0,
      payrollMin: 0,
      flexMin: 0,
    });
  });

  describe("flex rule", () => {
    const flexRules = rules({ outside: "flex" });

    it("adds the flex-routed minutes to flexDelta exactly once", () => {
      const f = makeTravelFor([trip("17:00", "19:00")], flexRules);
      const ev = evaluateDay(WED, ctx(f, { sessions: full }));
      expect(ev.flexDelta).toBe(120);
      expect(ev.explanation).toContain("Restid utanför schemat 2 h → flex +2 h");
      expect(ev.explanation.at(-1)).toBe("Flex +2 h");
    });

    it("respects factor and cap", () => {
      const f = makeTravelFor(
        [trip("17:00", "20:00")],
        rules({ outside: "flex", factor: 0.5, maxPerDayMin: 60 }),
      );
      expect(evaluateDay(WED, ctx(f, { sessions: full })).flexDelta).toBe(60);
    });

    it("payroll and 'none' never change flex; explanations say where the time goes", () => {
      const pay = makeTravelFor([trip("17:00", "19:00")], rules());
      const evPay = evaluateDay(WED, ctx(pay, { sessions: full }));
      expect(evPay.flexDelta).toBe(0);
      expect(evPay.explanation).toContain("Restid utanför schemat 2 h → lön");
      const none = makeTravelFor([trip("17:00", "19:00")], rules({ outside: "none" }));
      const evNone = evaluateDay(WED, ctx(none, { sessions: full }));
      expect(evNone.flexDelta).toBe(0);
      expect(evNone.explanation).toContain("Restid utanför schemat 2 h → räknas inte");
    });

    it("inside-schedule travel is never added to worked time or flex", () => {
      const f = makeTravelFor([trip("09:00", "11:00")], flexRules);
      const base = evaluateDay(WED, ctx(undefined, { sessions: full }));
      const ev = evaluateDay(WED, ctx(f, { sessions: full }));
      expect(ev.workedMin).toBe(base.workedMin);
      expect(ev.flexDelta).toBe(base.flexDelta);
      expect(ev.explanation).toContain("Restid inom schemat 2 h – ingår i arbetstiden");
    });

    it("a missing day still gets its travel flex", () => {
      const f = makeTravelFor([trip("17:30", "18:30")], flexRules);
      const ev = evaluateDay(WED, ctx(f));
      expect(ev.status).toBe("missing");
      expect(ev.flexDelta).toBe(60);
    });

    it("an unconfirmed day (schedule mode) still gets its travel flex", () => {
      const f = makeTravelFor([trip("17:30", "18:30")], flexRules);
      const ev = evaluateDay(WED, ctx(f, { reportingMode: "schedule" }));
      expect(ev.status).toBe("unconfirmed");
      expect(ev.flexDelta).toBe(60);
    });

    it("a day off with travel (weekend trip) gets its travel flex", () => {
      const f = makeTravelFor([trip("09:00", "11:00", SAT)], flexRules);
      const ev = evaluateDay(SAT, ctx(f, { today: "2026-03-16", now: at("2026-03-16", "12:00") }));
      expect(ev.flexDelta).toBe(120);
    });

    it("today while ongoing is excluded (open session or before the end of the shift)", () => {
      const f = makeTravelFor([trip("07:00", "08:00", "2026-03-12")], flexRules);
      const open = evaluateDay(
        "2026-03-12",
        ctx(f, { sessions: [session("2026-03-12", "08:00", null)] }),
      );
      expect(open.status).toBe("ongoing");
      expect(open.flexDelta).toBe(0);
      const morning = evaluateDay("2026-03-12", ctx(f));
      expect(morning.status).toBe("ongoing");
      expect(morning.flexDelta).toBe(0);
      expect(morning.explanation.join("\n")).toContain("flex (räknas inte den här dagen)");
    });

    it("today counts once the day is settled (punched out)", () => {
      const f = makeTravelFor([trip("17:00", "18:00", "2026-03-12")], flexRules);
      const ev = evaluateDay(
        "2026-03-12",
        ctx(f, { sessions: [session("2026-03-12", "08:00", "17:00")] }),
      );
      expect(ev.flexDelta).toBe(60);
    });

    it("future days and days before the flex start are excluded", () => {
      const f = makeTravelFor(
        [trip("17:00", "18:00", "2026-03-13"), trip("17:00", "18:00", "2026-03-04")],
        flexRules,
      );
      expect(evaluateDay("2026-03-13", ctx(f)).flexDelta).toBe(0);
      const early = evaluateDay("2026-03-04", ctx(f, { trackingStartDate: "2026-03-09" }));
      expect(early.flexDelta).toBe(0);
      expect(early.travel.flexMin).toBe(60); // reported, just not banked
      expect(evaluateDay("2026-03-04", ctx(f, { trackingStartDate: undefined })).flexDelta).toBe(0);
    });

    it("a travel day inside the imported opening balance gets no travel flex", () => {
      const f = makeTravelFor(
        [trip("17:00", "18:00", "2026-03-10"), trip("17:00", "18:00", "2026-03-12")],
        flexRules,
      );
      const c = ctx(f, { flexBaseDate: "2026-03-10", today: "2026-03-13" });
      const inside = evaluateDay("2026-03-10", c);
      expect(inside.flexDelta).toBe(0);
      expect(inside.travel.flexMin).toBe(60); // reported, but part of the imported balance
      expect(evaluateDay("2026-03-12", c).flexDelta).toBe(60); // after "Per datum": counts
      expect(computeFlex(c).minutes).toBe(60);
    });

    it("liveDayDelta: a missing day shows its travel flex, an ongoing day does not", () => {
      const f = makeTravelFor(
        [trip("17:30", "18:30"), trip("07:00", "08:00", "2026-03-12")],
        flexRules,
      );
      expect(liveDayDelta(evaluateDay(WED, ctx(f)))).toBe(60);
      expect(liveDayDelta(evaluateDay("2026-03-12", ctx(f)))).toBe(0);
    });

    it("the report total equals the flex card (computeFlex), travel included", () => {
      const f = makeTravelFor(
        [trip("17:00", "19:00"), trip("17:30", "18:30", "2026-03-10"), trip("18:00", "19:00", SAT)],
        flexRules,
      );
      const c = ctx(f, {
        sessions: [session(WED, "08:00", "17:00"), session("2026-03-12", "08:00", "17:00")],
        today: "2026-03-16",
        now: at("2026-03-16", "12:00"),
      });
      const card = computeFlex(c).minutes;
      const report = buildReport(c, "2026-03-02", "2026-03-16");
      expect(report.totals.flexMin).toBe(card);
      expect(card).toBeGreaterThanOrEqual(120 + 60 + 60);
      // Travel flex on a day off is listed in the report rows too.
      expect(report.rows.some((r) => r.date === SAT)).toBe(true);
    });
  });
});

describe("travelTotals", () => {
  it("sums a range for the report: total, split, payroll and flex", () => {
    const entries = [
      trip("16:00", "18:00", WED), // 60 in, 60 out
      trip("18:00", "19:00", "2026-03-12"), // 60 out
      trip("10:00", "11:00", "2026-04-01"), // outside the range
    ];
    const t = travelTotals(entries, rules(), cfgOf, { from: "2026-03-01", to: "2026-03-31" });
    expect(t).toEqual({
      inScheduleMin: 60,
      outsideMin: 120,
      payrollMin: 120,
      flexMin: 0,
      totalMin: 180,
      days: 2,
    });
  });
});

describe("parsing", () => {
  it("falls back to defaults for missing or junk rules", () => {
    expect(parseTravelRules(undefined)).toEqual(DEFAULT_TRAVEL_RULES);
    expect(parseTravelRules({ outside: "x", factor: -1, maxPerDayMin: 0 })).toEqual(
      DEFAULT_TRAVEL_RULES,
    );
    expect(
      parseTravelRules({ outside: "flex", factor: 0.5, maxPerDayMin: 60, excludeNight: true }),
    ).toEqual({ outside: "flex", factor: 0.5, maxPerDayMin: 60, excludeNight: true });
  });

  it("drops entries without id or valid date and bad times, keeps the rest", () => {
    const got = parseTravel([
      null,
      { id: "a", date: "nope" },
      { id: "b", date: WED, from: "9:00", to: "11:00", durationMin: 30 },
      { id: "c", date: WED, from: "09:00", to: "11:00", destination: "Göteborg" },
    ]);
    expect(got.map((e) => e.id)).toEqual(["b", "c"]);
    expect(got[0]).toEqual({ id: "b", date: WED, durationMin: 30 }); // bad times dropped
    expect(got[1].destination).toBe("Göteborg");
  });
});

describe("migration of 'resetimmar' expenses", () => {
  const exp = (over: Partial<ExpenseEntry>): ExpenseEntry => ({
    id: "e1",
    category: "resetimmar",
    date: WED,
    amount: 2.5,
    hasReceipt: false,
    manual: true,
    ...over,
  });
  const other = exp({ id: "e2", category: "parkering", amount: 40 });

  it("turns a resetimmar expense into a duration-only imported entry", () => {
    const r = migrateTravelState({ expenses: [exp({ note: "Kundmöte" }), other] });
    expect(r.expenses).toEqual([other]);
    expect(r.travel).toEqual([
      {
        id: "imp-e1",
        date: WED,
        durationMin: 150,
        note: "Kundmöte · Importerad Resetimmar (2.5 i beloppsfältet)",
        imported: true,
      },
    ]);
    expect(r).toMatchObject({ migrated: 1, kept: 0 });
  });

  it("is idempotent: running again on the result changes nothing", () => {
    const once = migrateTravelState({ expenses: [exp({}), other] });
    const twice = migrateTravelState({ expenses: once.expenses, travel: once.travel });
    expect(twice.travel).toEqual(once.travel);
    expect(twice.expenses).toEqual(once.expenses);
    expect(twice.migrated).toBe(0);
  });

  it("does not duplicate when an old device re-introduces the same expense", () => {
    const once = migrateTravelState({ expenses: [exp({})] });
    const again = migrateTravelState({ expenses: [exp({})], travel: once.travel });
    expect(again.travel).toHaveLength(1);
    expect(again.expenses).toEqual([]);
  });

  it("keeps an expense whose amount is not a plausible number of hours", () => {
    const money = exp({ id: "e3", amount: 350 });
    const none = exp({ id: "e4", amount: undefined });
    const r = migrateTravelState({ expenses: [money, none] });
    expect(r.expenses).toEqual([money, none]);
    expect(r.travel).toEqual([]);
    expect(r.kept).toBe(2);
  });

  it("leaves existing travel and rules alone and tolerates a state without them", () => {
    const mine = trip("09:00", "10:00");
    const r = migrateTravelState({
      expenses: [],
      travel: [mine],
      travelRules: { outside: "flex" },
    });
    expect(r.travel).toEqual([mine]);
    expect(r.travelRules.outside).toBe("flex");
    expect(migrateTravelState({}).travelRules).toEqual(DEFAULT_TRAVEL_RULES);
  });

  it("survives a JSON round trip (load → save → reload)", () => {
    const once = migrateTravelState({ expenses: [exp({})] });
    const stored = JSON.parse(JSON.stringify({ expenses: once.expenses, travel: once.travel }));
    expect(migrateTravelState(stored).travel).toEqual(once.travel);
  });
});

describe("sync merge", () => {
  it("unions travel by id, local wins, rules are local", () => {
    const a: TravelEntry = { id: "a", date: WED, durationMin: 10 };
    const bServer: TravelEntry = { id: "b", date: WED, durationMin: 20 };
    const bLocal: TravelEntry = { id: "b", date: WED, durationMin: 25 };
    const m = mergeTravelState(
      { travel: [a, bServer], travelRules: { outside: "flex" } },
      { travel: [bLocal], travelRules: { outside: "none" } },
    );
    expect(m.travel).toEqual([a, bLocal]);
    expect(m.travelRules.outside).toBe("none");
  });
});

describe("report: Restid in totals, CSV and share text", () => {
  const entries = [trip("16:00", "19:00"), trip("18:00", "19:00", "2026-03-12")];
  const c: DayContext = {
    sessions: [session(WED, "08:00", "17:00")],
    absences: [],
    schedule: DEFAULT_SCHEDULE,
    exceptions: {},
    reportingMode: "punch",
    trackingStartDate: "2026-03-02",
    today: "2026-03-13",
    now: at("2026-03-13", "12:00"),
    travelFor: makeTravelFor(entries, rules()),
  };
  const report = buildReport(c, "2026-03-09", "2026-03-15");

  it("totals match travelTotals for the same period", () => {
    const t = travelTotals(entries, rules(), cfgOf, { from: "2026-03-09", to: "2026-03-15" });
    expect(report.totals.travel).toEqual({
      inScheduleMin: t.inScheduleMin,
      outsideMin: t.outsideMin,
      payrollMin: t.payrollMin,
      flexMin: t.flexMin,
      totalMin: t.inScheduleMin + t.outsideMin,
    });
    expect(report.totals.travel.payrollMin).toBe(180);
  });

  it("CSV has the Restid columns and the share text a summary line", () => {
    const csv = buildCsv(report);
    expect(csv).toContain('"Restid (min)","Restid till lön (min)"');
    expect(csv).toContain('"180","120"'); // WED: 1 h inside + 2 h outside, 2 h to payroll
    const text = buildShareText(report, {
      name: "",
      periodLabel: "v11",
      expenses: [],
      mode: "punch",
    });
    expect(text).toContain("Restid: 4 h (1 h under arbetstid, 3 h utanför) · till lön 3 h");
  });
});
