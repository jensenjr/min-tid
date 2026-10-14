import { describe, expect, it } from "vitest";
import { parseWorkbook } from "../parse";
import { type ImportableState, applyImportPlan, buildImportPlan, snapshotOf } from "../plan";
import { computeFlex } from "../../flex";
import { migrateSchedules } from "../../schedule";
import { isDayLocked } from "../../confirm";
import { messyWorkbook } from "./fixture";

const emptyState = (over: Partial<ImportableState> = {}): ImportableState => ({
  sessions: [],
  absences: [],
  expenses: [],
  confirmedDays: {},
  lockedMonths: {},
  trackingStartDate: undefined,
  flexBaseMinutes: 0,
  flexBaseDate: undefined,
  vacation: undefined,
  ...over,
});

const TODAY = "2026-03-31";
const parsed = () => parseWorkbook(messyWorkbook());

describe("buildImportPlan", () => {
  it("counts what would be imported, keeping the parse errors", async () => {
    const plan = buildImportPlan(await parsed(), emptyState(), TODAY);
    expect(plan.sessions).toHaveLength(4);
    expect(plan.absences).toHaveLength(3);
    expect(plan.expenses).toHaveLength(2);
    expect(plan.travel).toHaveLength(1);
    expect(plan.errors).toHaveLength(17);
    expect(plan.duplicates).toHaveLength(3);
    expect(plan.skippedExamples).toBe(4);
    expect(plan.empty).toBe(false);
    // Errors are ordered by sheet and row.
    const rows = plan.errors.filter((e) => e.sheet === "Pass").map((e) => e.row);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });

  it("marks imported sessions and absence days confirmed, never a future day", async () => {
    const plan = buildImportPlan(await parsed(), emptyState(), TODAY);
    expect(plan.confirmedDays).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-23",
      "2026-03-24",
      "2026-03-25",
    ]);
    // Same file "today" = 03-24: the flex absence on 03-25 is planned, not history.
    const early = buildImportPlan(await parsed(), emptyState(), "2026-03-24");
    expect(early.confirmedDays).not.toContain("2026-03-25");
    expect(early.absences).toHaveLength(3); // the absence itself is still imported
  });

  it("moves trackingStartDate to the earliest imported day when that is earlier", async () => {
    // Fixture: first session 03-02, but Saldon is as of 02-28 → flex accrues from 03-01.
    const p = await parsed();
    expect(buildImportPlan(p, emptyState(), TODAY).trackingStartDate).toBe("2026-03-01");
    expect(
      buildImportPlan(p, emptyState({ trackingStartDate: "2025-06-01" }), TODAY).trackingStartDate,
    ).toBe("2025-06-01"); // already earlier: untouched
    expect(
      buildImportPlan(p, emptyState({ trackingStartDate: "2026-03-20" }), TODAY).trackingStartDate,
    ).toBe("2026-03-01");
  });

  it("without Saldon the earliest imported day decides", async () => {
    const p = await parsed();
    p.balances = null;
    expect(buildImportPlan(p, emptyState(), TODAY).trackingStartDate).toBe("2026-03-02");
    // earliest includes absences and travel, not expenses
    p.expenses[0].date = "2020-01-01";
    expect(buildImportPlan(p, emptyState(), TODAY).trackingStartDate).toBe("2026-03-02");
  });

  it("a row in a locked month is a row error and is not confirmed", async () => {
    const p = await parsed();
    const state = emptyState({ lockedMonths: { "2026-03": { at: 1, by: "x" } } });
    const plan = buildImportPlan(p, state, TODAY);
    expect(plan.sessions).toEqual([]);
    expect(plan.absences).toEqual([]);
    expect(plan.expenses).toEqual([]);
    expect(plan.travel).toEqual([]);
    expect(plan.confirmedDays).toEqual([]);
    expect(plan.errors.filter((e) => /låst/.test(e.message))).toHaveLength(4 + 3 + 2 + 1);
    const locked = plan.errors.find((e) => e.sheet === "Pass" && e.row === 3);
    expect(locked?.message).toMatch(/2026-03 är låst/);
    // The balances still apply: they are not a day edit.
    expect(plan.balances).not.toBeNull();
  });

  it("an absence reaching into a locked month is refused as a whole", async () => {
    const p = await parsed();
    p.absences = [
      {
        id: "a",
        category: "semester",
        startDate: "2026-02-27",
        endDate: "2026-03-02",
        manual: true,
      },
    ];
    p.rows.absences = [9];
    const plan = buildImportPlan(
      p,
      emptyState({ lockedMonths: { "2026-02": { at: 1, by: "x" } } }),
      TODAY,
    );
    expect(plan.absences).toEqual([]);
    expect(
      plan.errors.some((e) => e.sheet === "Frånvaro" && e.row === 9 && /2026-02/.test(e.message)),
    ).toBe(true);
  });

  it("sessions in the future are errors", async () => {
    const plan = buildImportPlan(await parsed(), emptyState(), "2026-03-03");
    expect(plan.sessions).toHaveLength(3); // 03-10 is in the future
    expect(plan.errors.some((e) => e.row === 14 && /framtiden/.test(e.message))).toBe(true);
  });

  it("finds duplicates of what the app already holds (re-importing the same file)", async () => {
    const first = buildImportPlan(await parsed(), emptyState(), TODAY);
    const state1 = { ...emptyState(), ...applyImportPlan(first, emptyState()) };
    const again = buildImportPlan(await parsed(), state1, TODAY);
    // fresh ids in a new parse, but the same date+start / absence / expense keys
    expect(again.sessions).toEqual([]);
    expect(again.absences).toEqual([]);
    expect(again.expenses).toEqual([]);
    expect(again.duplicates).toHaveLength(3 + 4 + 3 + 2);
    const applied = applyImportPlan(again, state1);
    expect(applied.sessions).toHaveLength(4);
    expect(applied.absences).toHaveLength(3);
    expect(applied.expenses).toHaveLength(2);
  });

  it("reports how many imported days fall on or before the balance date", async () => {
    const p = await parsed();
    p.balances = { asOf: "2026-03-03", flexMinutes: 0 };
    expect(buildImportPlan(p, emptyState(), TODAY).beforeBalance).toBe(3); // 03-02 ×2, 03-03
    p.balances = { asOf: "2026-03-03", vacationDaysLeft: 5 };
    expect(buildImportPlan(p, emptyState(), TODAY).beforeBalance).toBe(0); // no flex balance
  });

  it("an empty file imports nothing", async () => {
    const empty = await parseWorkbook(new Uint8Array([1, 2, 3]));
    expect(buildImportPlan(empty, emptyState(), TODAY).empty).toBe(true);
  });
});

describe("applyImportPlan", () => {
  it("sets the flex balance as of Per datum and the vacation opening", async () => {
    const plan = buildImportPlan(await parsed(), emptyState({ flexBaseMinutes: 99 }), TODAY);
    const patch = applyImportPlan(plan, emptyState({ flexBaseMinutes: 99 }));
    expect(patch.flexBaseMinutes).toBe(750);
    expect(patch.flexBaseDate).toBe("2026-02-28");
    expect(patch.vacation).toEqual({
      daysPerYear: 25,
      yearStart: "04-01",
      allowHalfDays: false,
      opening: { asOf: "2026-02-28", daysLeft: 14, savedDays: 5 },
    });
    expect(patch.trackingStartDate).toBe("2026-03-01");
    expect(Object.keys(patch.confirmedDays)).toHaveLength(8);
    expect(patch.sessions.map((s) => s.checkIn)).toEqual(
      [...patch.sessions.map((s) => s.checkIn)].sort((a, b) => a - b),
    );
  });

  it("keeps existing vacation settings and only replaces the opening", async () => {
    const vacation = { daysPerYear: 30, yearStart: "01-01", allowHalfDays: true };
    const state = emptyState({ vacation });
    const patch = applyImportPlan(buildImportPlan(await parsed(), state, TODAY), state);
    expect(patch.vacation).toMatchObject({
      daysPerYear: 30,
      yearStart: "01-01",
      allowHalfDays: true,
    });
    expect(patch.vacation?.opening?.daysLeft).toBe(14);
  });

  it("a Saldon without flex leaves the flex balance and date alone", async () => {
    const p = await parsed();
    p.balances = { asOf: "2026-02-28", vacationDaysLeft: 3 };
    const state = emptyState({ flexBaseMinutes: 120, flexBaseDate: "2026-01-31" });
    const patch = applyImportPlan(buildImportPlan(p, state, TODAY), state);
    expect(patch.flexBaseMinutes).toBe(120);
    expect(patch.flexBaseDate).toBe("2026-01-31");
    expect(patch.vacation?.opening).toEqual({ asOf: "2026-02-28", daysLeft: 3, savedDays: 0 });
  });

  it("the whole flow lands on the right flex total, across the DST change", async () => {
    // Opening 12.5 h at the end of 02-28. Imported 03-02..03-25: every worked day is exactly
    // the norm, VAB/sjuk are excused, and three flex absences of 2 h cost 6 h → 750 − 360.
    const state = emptyState();
    const patch = applyImportPlan(buildImportPlan(await parsed(), state, TODAY), state);
    const flex = computeFlex(
      {
        sessions: patch.sessions,
        absences: patch.absences,
        schedule: migrateSchedules({}),
        exceptions: {},
        reportingMode: "punch",
        trackingStartDate: patch.trackingStartDate,
        confirmedDays: patch.confirmedDays,
        today: TODAY,
        now: new Date(2026, 2, 31, 12).getTime(),
        flexBaseDate: patch.flexBaseDate,
      },
      {},
    );
    expect(patch.flexBaseMinutes + flex.minutes).toBe(750 - 360);
  });

  it("snapshotOf + the patch of an old state round-trips for undo", async () => {
    const state = emptyState({ trackingStartDate: "2026-01-05", flexBaseMinutes: 60 });
    const snap = snapshotOf(state);
    const patch = applyImportPlan(buildImportPlan(await parsed(), state, TODAY), state);
    expect(patch.sessions).not.toEqual(snap.sessions);
    expect(snap).toEqual({
      sessions: [],
      absences: [],
      expenses: [],
      confirmedDays: {},
      trackingStartDate: "2026-01-05",
      flexBaseMinutes: 60,
      flexBaseDate: undefined,
      vacation: undefined,
    });
    expect(isDayLocked("2026-03-02", {})).toBe(false);
  });
});
