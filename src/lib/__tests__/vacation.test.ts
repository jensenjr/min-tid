import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE, type SchedulePeriod, type WeekSchedule } from "../schedule";
import {
  DEFAULT_VACATION,
  type VacationState,
  balanceWarning,
  fmtDays,
  parseVacation,
  vacationBalance,
  vacationDaysBetween,
  vacationDaysOn,
  vacationLine,
  vacationWarning,
  vacationYearOf,
} from "../vacation";
import type { VacationSettings } from "../types";
import { absence } from "./helpers";

const FULL: SchedulePeriod[] = [
  { validFrom: "2000-01-01", anchorMonday: "2026-06-01", rotation: { weeks: [DEFAULT_SCHEDULE] } },
];

// Week A = Mon–Fri, week B = Mon–Wed only (Thu/Fri off). Anchor Monday 2026-06-01 = week A.
const midWeek: WeekSchedule = {
  ...DEFAULT_SCHEDULE,
  thu: { ...DEFAULT_SCHEDULE.thu, active: false },
  fri: { ...DEFAULT_SCHEDULE.fri, active: false },
};
const ROTATION: SchedulePeriod[] = [
  {
    validFrom: "2000-01-01",
    anchorMonday: "2026-06-01",
    rotation: { weeks: [DEFAULT_SCHEDULE, midWeek] },
  },
];

function st(
  absences: VacationState["absences"],
  opts: { schedules?: SchedulePeriod[]; vacation?: Partial<VacationSettings> } = {},
): VacationState {
  return {
    absences,
    schedules: opts.schedules ?? FULL,
    vacation: opts.vacation ? { ...DEFAULT_VACATION, ...opts.vacation } : undefined,
  };
}

describe("vacationDaysOn / vacationDaysBetween", () => {
  it("counts one day per scheduled weekday", () => {
    const s = st([absence("semester", "2026-06-01", "2026-06-05")]);
    expect(vacationDaysBetween("2026-06-01", "2026-06-30", s)).toBe(5);
  });

  it("a semester over a weekend consumes nothing on Sat/Sun", () => {
    const s = st([absence("semester", "2026-06-05", "2026-06-08")]); // Fri..Mon
    expect(vacationDaysBetween("2026-06-01", "2026-06-30", s)).toBe(2);
    expect(vacationDaysOn("2026-06-06", s)).toBe(0);
    expect(vacationDaysOn("2026-06-07", s)).toBe(0);
  });

  it("a weekend-only semester consumes 0", () => {
    const s = st([absence("semester", "2026-06-06", "2026-06-07")]);
    expect(vacationDaysBetween("2026-06-01", "2026-06-30", s)).toBe(0);
  });

  it("2-week rotation: non-scheduled rotation days consume nothing", () => {
    const s = st([absence("semester", "2026-06-01", "2026-06-14")], { schedules: ROTATION });
    // week A: 5 days, week B: Mon-Wed = 3
    expect(vacationDaysBetween("2026-06-01", "2026-06-30", s)).toBe(8);
    expect(vacationDaysOn("2026-06-11", s)).toBe(0); // Thursday of week B
    expect(vacationDaysOn("2026-06-04", s)).toBe(1); // Thursday of week A
  });

  it("a helgdag inside a semester week consumes nothing", () => {
    const s = st([
      absence("semester", "2026-06-01", "2026-06-05"),
      absence("helgdag", "2026-06-03"),
    ]);
    expect(vacationDaysBetween("2026-06-01", "2026-06-30", s)).toBe(4);
  });

  it("half days: off = whole day, on = rounded to nearest half", () => {
    const four = st([absence("semester", "2026-06-01", "2026-06-01", 4)]);
    expect(vacationDaysOn("2026-06-01", four)).toBe(1);
    const fourHalf = st([absence("semester", "2026-06-01", "2026-06-01", 4)], {
      vacation: { allowHalfDays: true },
    });
    expect(vacationDaysOn("2026-06-01", fourHalf)).toBe(0.5);
    const six = st([absence("semester", "2026-06-01", "2026-06-01", 6)], {
      vacation: { allowHalfDays: true },
    });
    expect(vacationDaysOn("2026-06-01", six)).toBe(1);
    const one = st([absence("semester", "2026-06-01", "2026-06-01", 1)], {
      vacation: { allowHalfDays: true },
    });
    expect(vacationDaysOn("2026-06-01", one)).toBe(0.5);
    const zero = st([absence("semester", "2026-06-01", "2026-06-01", 0)]);
    expect(vacationDaysOn("2026-06-01", zero)).toBe(0);
  });

  it("two half-day entries on one day add up to a day", () => {
    const s = st(
      [
        absence("semester", "2026-06-01", "2026-06-01", 4),
        absence("semester", "2026-06-01", "2026-06-01", 4),
      ],
      { vacation: { allowHalfDays: true } },
    );
    expect(vacationDaysOn("2026-06-01", s)).toBe(1);
  });

  it("other categories do not consume", () => {
    const s = st([absence("vab", "2026-06-01", "2026-06-05")]);
    expect(vacationDaysBetween("2026-06-01", "2026-06-30", s)).toBe(0);
  });

  it("DST weeks count like any other (spring and autumn)", () => {
    const spring = st([absence("semester", "2027-03-22", "2027-03-28")]);
    expect(vacationDaysBetween("2027-03-01", "2027-03-31", spring)).toBe(5);
    const autumn = st([absence("semester", "2026-10-19", "2026-10-25")]);
    expect(vacationDaysBetween("2026-10-01", "2026-10-31", autumn)).toBe(5);
  });
});

describe("vacationYearOf", () => {
  it("splits on yearStart", () => {
    expect(vacationYearOf("2026-04-01", "04-01")).toEqual({
      start: "2026-04-01",
      end: "2027-03-31",
    });
    expect(vacationYearOf("2026-03-31", "04-01")).toEqual({
      start: "2025-04-01",
      end: "2026-03-31",
    });
    expect(vacationYearOf("2027-01-15", "04-01").start).toBe("2026-04-01");
    expect(vacationYearOf("2026-06-01", "01-01")).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
    });
  });
});

describe("vacationBalance", () => {
  it("defaults: 25 days, nothing used", () => {
    const b = vacationBalance(st([]), "2026-06-10");
    expect(b).toMatchObject({ total: 25, left: 25, consumed: 0, saved: 0, fromOpening: false });
    expect(vacationLine(b)).toBe("Semester: 25 av 25 dagar kvar");
  });

  it("subtracts used semester: 17 av 25", () => {
    // 8 working days in the past (Mon 1 June - Wed 10 June)
    const s = st([absence("semester", "2026-06-01", "2026-06-10")]);
    const b = vacationBalance(s, "2026-06-20");
    expect(b.used).toBe(8);
    expect(b.left).toBe(17);
    expect(vacationLine(b)).toBe("Semester: 17 av 25 dagar kvar");
  });

  it("planned future semester counts as consumed", () => {
    const s = st([absence("semester", "2026-07-06", "2026-07-10")]);
    const b = vacationBalance(s, "2026-06-01");
    expect(b).toMatchObject({ used: 0, planned: 5, consumed: 5, left: 20 });
  });

  it("the year boundary on 04-01 splits the balance", () => {
    const s = st([absence("semester", "2027-03-30", "2027-04-02")]);
    expect(vacationBalance(s, "2026-12-01").left).toBe(23); // 30 + 31 March
    expect(vacationBalance(s, "2027-04-10").left).toBe(23); // 1 + 2 April
    expect(vacationBalance(s, "2027-03-31").consumed).toBe(2);
    expect(vacationBalance(s, "2027-03-31").yearEnd).toBe("2027-03-31");
  });

  it("opening balance as of a date: only later days count, saved shown separately", () => {
    const s = st(
      [
        absence("semester", "2026-08-03", "2026-08-07"), // before asOf: already in the opening
        absence("semester", "2026-09-14", "2026-09-18"),
      ],
      { vacation: { opening: { asOf: "2026-08-31", daysLeft: 20, savedDays: 5 } } },
    );
    const b = vacationBalance(s, "2026-09-01");
    expect(b).toMatchObject({ left: 15, planned: 5, used: 0, saved: 5, fromOpening: true });
    expect(vacationLine(b)).toBe("Semester: 15 av 25 dagar kvar + 5 sparade");
  });

  it("an opening from an earlier vacation year is ignored", () => {
    const s = st([], {
      vacation: { opening: { asOf: "2026-02-01", daysLeft: 3, savedDays: 9 } },
    });
    const b = vacationBalance(s, "2026-06-01");
    expect(b).toMatchObject({ left: 25, saved: 0, fromOpening: false });
  });

  it("custom daysPerYear and half days", () => {
    const s = st([absence("semester", "2026-06-01", "2026-06-01", 4)], {
      vacation: { daysPerYear: 30, allowHalfDays: true },
    });
    const b = vacationBalance(s, "2026-06-10");
    expect(b.left).toBe(29.5);
    expect(vacationLine(b)).toBe("Semester: 29,5 av 30 dagar kvar");
  });

  it("over-booked balance warns", () => {
    const s = st([absence("semester", "2026-07-06", "2026-07-10")], {
      vacation: { daysPerYear: 3 },
    });
    const b = vacationBalance(s, "2026-06-01");
    expect(b.left).toBe(-2);
    expect(balanceWarning(b)).toMatch(/överskrider saldot med 2 dagar/);
    expect(balanceWarning(vacationBalance(st([]), "2026-06-01"))).toBeNull();
  });
});

describe("vacationWarning", () => {
  const base = st([absence("semester", "2026-06-01", "2026-06-02")], {
    vacation: { daysPerYear: 5 },
  });

  it("is null when the new semester fits", () => {
    expect(vacationWarning(base, absence("semester", "2026-07-06", "2026-07-08"))).toBeNull();
  });

  it("warns when it exceeds the balance", () => {
    const w = vacationWarning(base, absence("semester", "2026-07-06", "2026-07-10"));
    expect(w).toMatch(/överskrider saldot med 2 dagar/);
  });

  it("ignores other categories and weekend-only semester", () => {
    expect(vacationWarning(base, absence("vab", "2026-07-06", "2026-07-31"))).toBeNull();
    expect(vacationWarning(base, absence("semester", "2026-07-11", "2026-07-12"))).toBeNull();
  });

  it("editing an entry replaces it instead of double counting", () => {
    const existing = absence("semester", "2026-07-06", "2026-07-08");
    const s = st([...base.absences, existing], { vacation: { daysPerYear: 6 } });
    expect(vacationWarning(s, { ...existing, endDate: "2026-07-09" })).toBeNull();
    expect(vacationWarning(s, { ...existing, endDate: "2026-07-10" })).not.toBeNull();
  });

  it("checks the next vacation year when the semester spans the boundary", () => {
    const s = st([], { vacation: { daysPerYear: 1 } });
    // Tue 30 Mar .. Fri 2 Apr 2027: 2 days in one year, 2 in the next, 1 allowed each.
    expect(vacationWarning(s, absence("semester", "2027-03-30", "2027-04-02"))).toMatch(
      /överskrider/,
    );
  });
});

describe("parseVacation / formatting", () => {
  it("returns undefined for junk and sanitises fields", () => {
    expect(parseVacation(undefined)).toBeUndefined();
    expect(parseVacation("x")).toBeUndefined();
    expect(parseVacation({ daysPerYear: -1, yearStart: "13-40", allowHalfDays: "yes" })).toEqual(
      DEFAULT_VACATION,
    );
    expect(
      parseVacation({
        daysPerYear: 30,
        yearStart: "01-01",
        allowHalfDays: true,
        opening: { asOf: "2026-05-01", daysLeft: 12.5 },
      }),
    ).toEqual({
      daysPerYear: 30,
      yearStart: "01-01",
      allowHalfDays: true,
      opening: { asOf: "2026-05-01", daysLeft: 12.5, savedDays: 0 },
    });
  });

  it("fmtDays", () => {
    expect(fmtDays(17)).toBe("17");
    expect(fmtDays(16.5)).toBe("16,5");
    expect(fmtDays(-2)).toBe("-2");
  });
});
