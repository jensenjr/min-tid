import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE } from "../schedule";
import { evaluateDay, type DayContext } from "../days";
import { computeFlex } from "../flex";
import {
  confirmDay,
  confirmMonth,
  isDayLocked,
  isMonthLocked,
  mergeDayStatusState,
  migrateDayStatusState,
  unconfirmDay,
  unlockMonth,
} from "../confirm";
import type { AuditEntry } from "../types";
import { absence, at, session } from "./helpers";

const START = "2026-03-02";

function ctx(today: string, over: Partial<DayContext> = {}): DayContext {
  return {
    sessions: [],
    absences: [],
    schedule: DEFAULT_SCHEDULE,
    exceptions: {},
    reportingMode: "schedule",
    trackingStartDate: START,
    today,
    now: at(today, "12:00"),
    ...over,
  };
}

// All Mon–Fri dates of March 2026 from the 2nd (the 1st is a Sunday).
const MARCH_WEEKDAYS = [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 23, 24, 25, 26, 27]
  .concat([30, 31])
  .map((d) => `2026-03-${String(d).padStart(2, "0")}`);

describe("locks", () => {
  const state = { lockedMonths: { "2026-03": { at: 1, by: "Anna" } } };

  it("isDayLocked covers exactly the locked month", () => {
    expect(isDayLocked("2026-03-01", state)).toBe(true);
    expect(isDayLocked("2026-03-31", state)).toBe(true);
    expect(isDayLocked("2026-04-01", state)).toBe(false);
    expect(isDayLocked("2026-02-28", state)).toBe(false);
    expect(isDayLocked("2026-03-01", {})).toBe(false);
  });

  it("isMonthLocked", () => {
    expect(isMonthLocked("2026-03", state)).toBe(true);
    expect(isMonthLocked("2026-04", state)).toBe(false);
  });
});

describe("confirmMonth — schedule mode", () => {
  const base = (over: Partial<DayContext> = {}) =>
    ctx("2026-04-02", {
      sessions: [session("2026-03-02", "08:00", "17:00")],
      absences: [absence("semester", "2026-03-03")],
      confirmedDays: { "2026-03-04": true },
      ...over,
    });

  it("marks every unconfirmed day reported, locks the month and logs it", () => {
    const at0 = at("2026-04-02", "09:00");
    const r = confirmMonth("2026-03", base(), { at: at0, by: "Anna" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.confirmed).toEqual(MARCH_WEEKDAYS.slice(3));
    expect(Object.keys(r.confirmedDays).sort()).toEqual(MARCH_WEEKDAYS.slice(2));
    expect(r.lockedMonths).toEqual({ "2026-03": { at: at0, by: "Anna" } });
    expect(r.auditLog).toEqual([{ at: at0, action: "confirm", month: "2026-03" }]);

    const after = base({ confirmedDays: r.confirmedDays, lockedMonths: r.lockedMonths });
    expect(evaluateDay("2026-03-05", after).status).toBe("reported");
    expect(computeFlex(after, { from: "2026-03-01", to: "2026-03-31" }).unconfirmedDays).toEqual(
      [],
    );
  });

  it("keeps earlier audit entries", () => {
    const earlier: AuditEntry[] = [{ at: 5, action: "unlock", month: "2026-02" }];
    const r = confirmMonth("2026-03", base(), { at: 10, by: "Anna", auditLog: earlier });
    expect(r.ok && r.auditLog).toEqual([
      ...earlier,
      { at: 10, action: "confirm", month: "2026-03" },
    ]);
  });

  it("mid-month: confirms the past, the rest of the month reads as per schedule", () => {
    const today = "2026-03-11";
    const c = ctx(today);
    const r = confirmMonth("2026-03", c, { at: at(today, "12:00"), by: "Anna" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.confirmed).toEqual(MARCH_WEEKDAYS.slice(0, 7)); // 2nd–10th; today is ongoing
    const locked = { ...c, confirmedDays: r.confirmedDays, lockedMonths: r.lockedMonths };
    expect(evaluateDay(today, locked).status).toBe("reported");
    expect(evaluateDay("2026-03-12", locked).status).toBe("off"); // future stays off
  });

  it("refuses a month that is already locked", () => {
    const lockedMonths = { "2026-03": { at: 1, by: "Anna" } };
    expect(confirmMonth("2026-03", base({ lockedMonths }), { at: 2, by: "Anna" })).toEqual({
      ok: false,
      reason: "locked",
    });
  });

  it("refuses a future month and a malformed month", () => {
    expect(confirmMonth("2026-05", base(), { at: 2, by: "Anna" })).toEqual({
      ok: false,
      reason: "future",
    });
    expect(confirmMonth("2026-3", base(), { at: 2, by: "Anna" })).toEqual({
      ok: false,
      reason: "invalid-month",
    });
  });
});

describe("confirmMonth — punch mode", () => {
  const punch = (over: Partial<DayContext> = {}) =>
    ctx("2026-04-02", { reportingMode: "punch", trackingStartDate: "2026-03-23", ...over });

  it("refuses while missing days exist and lists them", () => {
    const r = confirmMonth(
      "2026-03",
      punch({ sessions: [session("2026-03-23", "08:00", "17:00")] }),
      { at: 1, by: "Anna" },
    );
    expect(r).toEqual({
      ok: false,
      reason: "missing-days",
      missingDays: [
        "2026-03-24",
        "2026-03-25",
        "2026-03-26",
        "2026-03-27",
        "2026-03-30",
        "2026-03-31",
      ],
    });
  });

  it("locks once every day is registered (sessions, absence or 'Enligt schema')", () => {
    const r = confirmMonth(
      "2026-03",
      punch({
        sessions: ["23", "24", "25", "26"].map((d) => session(`2026-03-${d}`, "08:00", "17:00")),
        absences: [absence("semester", "2026-03-27", "2026-03-30")],
        confirmedDays: { "2026-03-31": true },
      }),
      { at: 7, by: "Anna" },
    );
    expect(r).toMatchObject({
      ok: true,
      confirmed: [],
      lockedMonths: { "2026-03": { at: 7, by: "Anna" } },
    });
  });
});

describe("unlockMonth", () => {
  it("removes the lock, logs it and keeps confirmed days", () => {
    const state = {
      lockedMonths: { "2026-03": { at: 1, by: "Anna" }, "2026-02": { at: 1, by: "Anna" } },
      auditLog: [{ at: 1, action: "confirm" as const, month: "2026-03" }],
    };
    const r = unlockMonth("2026-03", state, { at: 9 });
    expect(r).toEqual({
      ok: true,
      lockedMonths: { "2026-02": { at: 1, by: "Anna" } },
      auditLog: [
        { at: 1, action: "confirm", month: "2026-03" },
        { at: 9, action: "unlock", month: "2026-03" },
      ],
    });
  });

  it("refuses when the month is not locked", () => {
    expect(unlockMonth("2026-03", {}, { at: 9 })).toEqual({ ok: false, reason: "not-locked" });
  });

  it("after unlocking, confirmed days stay reported and lock-only days are unconfirmed again", () => {
    const r = confirmMonth("2026-03", ctx("2026-03-11"), { at: 1, by: "Anna" });
    if (!r.ok) throw new Error(r.reason);
    const u = unlockMonth("2026-03", r, { at: 2 });
    if (!u.ok) throw new Error(u.reason);
    const later = ctx("2026-04-02", { confirmedDays: r.confirmedDays });
    // While locked, a day that was still in the future at lock time reads as reported.
    expect(evaluateDay("2026-03-16", { ...later, lockedMonths: r.lockedMonths }).status).toBe(
      "reported",
    );
    const unlocked = { ...later, lockedMonths: u.lockedMonths };
    expect(evaluateDay("2026-03-10", unlocked).status).toBe("reported"); // confirmed explicitly
    expect(evaluateDay("2026-03-16", unlocked).status).toBe("unconfirmed"); // only the lock
  });
});

describe("confirmDay / unconfirmDay", () => {
  it("adds and removes a confirmation", () => {
    const r = confirmDay("2026-03-05", { confirmedDays: { "2026-03-04": true } });
    expect(r).toEqual({ ok: true, confirmedDays: { "2026-03-04": true, "2026-03-05": true } });
    const u = unconfirmDay("2026-03-04", { confirmedDays: { "2026-03-04": true } });
    expect(u).toEqual({ ok: true, confirmedDays: {} });
  });

  it("refuses inside a locked month", () => {
    const lockedMonths = { "2026-03": { at: 1, by: "Anna" } };
    expect(confirmDay("2026-03-05", { lockedMonths })).toEqual({ ok: false, reason: "locked" });
    expect(unconfirmDay("2026-03-05", { lockedMonths, confirmedDays: {} })).toEqual({
      ok: false,
      reason: "locked",
    });
  });
});

describe("migrateDayStatusState (load() / sync tolerate old data)", () => {
  const oldUser = {
    name: "Anna",
    schedule: DEFAULT_SCHEDULE,
    sessions: [{ id: "s1", checkIn: at("2026-03-02", "08:00"), checkOut: null, manual: false }],
    absences: [],
    expenses: [],
    flexBaseMinutes: 0,
  };

  it("an old state with sessions gets punch mode and empty defaults", () => {
    expect(migrateDayStatusState(oldUser)).toEqual({
      reportingMode: "punch",
      autoLunchThresholdMin: 300,
      confirmedDays: {},
      lockedMonths: {},
      dayAdjustments: {},
      auditLog: [],
    });
  });

  it("a new user gets schedule mode", () => {
    expect(migrateDayStatusState({}).reportingMode).toBe("schedule");
  });

  it("the resolved mode is persisted, so it never flips later", () => {
    const first = migrateDayStatusState({});
    const saved = JSON.parse(JSON.stringify({ ...first, sessions: oldUser.sessions }));
    expect(migrateDayStatusState(saved).reportingMode).toBe("schedule");
    const punch = migrateDayStatusState(oldUser);
    const savedPunch = JSON.parse(JSON.stringify({ ...punch, sessions: [] }));
    expect(migrateDayStatusState(savedPunch).reportingMode).toBe("punch");
  });

  it("keeps valid values and drops garbage", () => {
    const r = migrateDayStatusState({
      reportingMode: "schedule",
      autoLunchThresholdMin: 240,
      confirmedDays: { "2026-03-02": true, bad: true, "2026-03-03": "yes" },
      lockedMonths: {
        "2026-03": { at: 5, by: "Anna" },
        "2026-3": { at: 1 },
        "2026-04": "x",
        "2026-02": { at: 3 },
      },
      dayAdjustments: {
        "2026-03-02": { start: "08:00", end: "9", breakMin: -1, note: 5 },
        "2026-03-03": { date: "2026-03-03", end: "15:00", breakMin: 30, note: "Tandläkare" },
        nope: { start: "08:00" },
        "2026-03-04": "garbage",
      },
      auditLog: [
        { at: 9, action: "unlock", month: "2026-03" },
        { at: 2, action: "confirm", month: "2026-03" },
        { at: "x", action: "confirm", month: "2026-03" },
        { at: 3, action: "explode", month: "2026-03" },
        null,
      ],
    });
    expect(r).toEqual({
      reportingMode: "schedule",
      autoLunchThresholdMin: 240,
      confirmedDays: { "2026-03-02": true },
      lockedMonths: { "2026-03": { at: 5, by: "Anna" }, "2026-02": { at: 3, by: "" } },
      dayAdjustments: {
        "2026-03-02": { date: "2026-03-02", start: "08:00" },
        "2026-03-03": { date: "2026-03-03", end: "15:00", breakMin: 30, note: "Tandläkare" },
      },
      auditLog: [
        { at: 2, action: "confirm", month: "2026-03" },
        { at: 9, action: "unlock", month: "2026-03" },
      ],
    });
  });

  it("falls back to 300 for a broken threshold", () => {
    for (const v of [0, -5, Number.NaN, "300", null]) {
      expect(migrateDayStatusState({ autoLunchThresholdMin: v }).autoLunchThresholdMin).toBe(300);
    }
  });

  it("is idempotent through a JSON round-trip (load → save → reload)", () => {
    const once = migrateDayStatusState({
      ...oldUser,
      confirmedDays: { "2026-03-02": true },
      lockedMonths: { "2026-02": { at: 1, by: "Anna" } },
      dayAdjustments: { "2026-03-03": { date: "2026-03-03", end: "15:00" } },
      auditLog: [{ at: 1, action: "confirm", month: "2026-02" }],
    });
    const twice = migrateDayStatusState(JSON.parse(JSON.stringify({ ...oldUser, ...once })));
    expect(twice).toEqual(once);
  });
});

describe("mergeDayStatusState (dirty sync merge)", () => {
  it("unions days, months and adjustments (local wins) and audit entries by at+action", () => {
    const server = {
      autoLunchThresholdMin: 300,
      confirmedDays: { "2026-03-02": true, "2026-03-03": true },
      lockedMonths: { "2026-01": { at: 1, by: "server" }, "2026-02": { at: 2, by: "server" } },
      dayAdjustments: {
        "2026-03-04": { date: "2026-03-04", end: "15:00" },
        "2026-03-05": { date: "2026-03-05", end: "14:00" },
      },
      auditLog: [
        { at: 1, action: "confirm", month: "2026-01" },
        { at: 2, action: "confirm", month: "2026-02" },
      ],
    };
    const local = {
      autoLunchThresholdMin: 240,
      confirmedDays: { "2026-03-04": true },
      lockedMonths: { "2026-02": { at: 3, by: "local" } },
      dayAdjustments: { "2026-03-05": { date: "2026-03-05", end: "16:00" } },
      auditLog: [
        { at: 2, action: "confirm", month: "2026-02" },
        { at: 0, action: "unlock", month: "2026-02" },
      ],
    };
    expect(mergeDayStatusState(server, local)).toEqual({
      autoLunchThresholdMin: 240,
      confirmedDays: { "2026-03-02": true, "2026-03-03": true, "2026-03-04": true },
      lockedMonths: { "2026-01": { at: 1, by: "server" }, "2026-02": { at: 3, by: "local" } },
      dayAdjustments: {
        "2026-03-04": { date: "2026-03-04", end: "15:00" },
        "2026-03-05": { date: "2026-03-05", end: "16:00" },
      },
      auditLog: [
        { at: 0, action: "unlock", month: "2026-02" },
        { at: 1, action: "confirm", month: "2026-01" },
        { at: 2, action: "confirm", month: "2026-02" },
      ],
    });
  });

  it("tolerates a server state without any of the new fields", () => {
    expect(mergeDayStatusState({}, { confirmedDays: { "2026-03-02": true } })).toEqual({
      autoLunchThresholdMin: 300,
      confirmedDays: { "2026-03-02": true },
      lockedMonths: {},
      dayAdjustments: {},
      auditLog: [],
    });
  });
});
