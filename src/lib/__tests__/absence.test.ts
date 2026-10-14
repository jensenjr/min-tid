import { describe, expect, it } from "vitest";
import { ABSENCE_LABEL, absenceForDay, getAbsencesForDate, isFlexAbsence } from "../absence";
import { DEFAULT_SCHEDULE, getEffectiveDayConfig, type WeekSchedule } from "../schedule";
import { ABSENCE_META } from "../../components/AbsenceModal";
import { absence } from "./helpers";

const MON = "2026-03-09";
const FRI = "2026-03-13";
const SAT = "2026-03-14";
const cfg = (date: string, schedule: WeekSchedule = DEFAULT_SCHEDULE, exceptions = {}) =>
  getEffectiveDayConfig(date, schedule, exceptions);

describe("getAbsencesForDate", () => {
  it("includes both ends of a range and nothing outside it", () => {
    const list = [absence("semester", "2026-03-13", "2026-03-16"), absence("vab", MON)];
    expect(getAbsencesForDate(list, "2026-03-12")).toHaveLength(0);
    expect(getAbsencesForDate(list, "2026-03-13")).toHaveLength(1);
    expect(getAbsencesForDate(list, "2026-03-15")).toHaveLength(1);
    expect(getAbsencesForDate(list, "2026-03-16")).toHaveLength(1);
    expect(getAbsencesForDate(list, "2026-03-17")).toHaveLength(0);
    expect(getAbsencesForDate(list, MON)).toHaveLength(1);
  });
});

describe("absenceForDay", () => {
  it("a full-day non-flex absence excuses the whole norm", () => {
    const r = absenceForDay([absence("vab", MON)], MON, cfg(MON));
    expect(r).toMatchObject({ excusedMin: 480, flexMin: 0, ignored: false, capped: false });
  });

  it("absence in hours counts those hours (per day)", () => {
    expect(absenceForDay([absence("vab", MON, MON, 4)], MON, cfg(MON)).excusedMin).toBe(240);
    expect(absenceForDay([absence("flex", MON, MON, 1.5)], MON, cfg(MON)).flexMin).toBe(90);
  });

  it("a full-day flex absence is the norm once", () => {
    const r = absenceForDay([absence("flex", MON)], MON, cfg(MON));
    expect(r).toMatchObject({ excusedMin: 0, flexMin: 480 });
  });

  it("is ignored on a non-scheduled day", () => {
    const r = absenceForDay([absence("flex", SAT), absence("semester", SAT)], SAT, cfg(SAT));
    expect(r).toMatchObject({ excusedMin: 0, flexMin: 0, ignored: true });
    const off: WeekSchedule = { ...DEFAULT_SCHEDULE, fri: { ...DEFAULT_SCHEDULE.fri, active: false } };
    expect(absenceForDay([absence("vab", FRI)], FRI, cfg(FRI, off)).ignored).toBe(true);
  });

  it("never exceeds the day's norm (excused first, then flex)", () => {
    expect(absenceForDay([absence("vab", MON, MON, 10)], MON, cfg(MON))).toMatchObject({
      excusedMin: 480,
      capped: true,
    });
    expect(absenceForDay([absence("flex", MON, MON, 10)], MON, cfg(MON)).flexMin).toBe(480);
    expect(absenceForDay([absence("sjuk", MON), absence("flex", MON)], MON, cfg(MON))).toMatchObject(
      { excusedMin: 480, flexMin: 0, capped: true },
    );
    expect(
      absenceForDay([absence("vab", MON, MON, 4), absence("flex", MON, MON, 2)], MON, cfg(MON)),
    ).toMatchObject({ excusedMin: 240, flexMin: 120, capped: false });
  });

  it("uses the effective (exception) norm for a full day", () => {
    const exceptions = { [FRI]: { type: "override" as const, endTime: "13:00", lunchMinutes: 0 } };
    const r = absenceForDay([absence("semester", FRI)], FRI, cfg(FRI, DEFAULT_SCHEDULE, exceptions));
    expect(r.excusedMin).toBe(300);
  });

  it("treats zero, negative or broken hours safely", () => {
    expect(absenceForDay([absence("vab", MON, MON, 0)], MON, cfg(MON)).excusedMin).toBe(0);
    expect(absenceForDay([absence("vab", MON, MON, -3)], MON, cfg(MON)).excusedMin).toBe(0);
    const broken = { ...absence("vab", MON), hours: Number.NaN };
    expect(absenceForDay([broken], MON, cfg(MON)).excusedMin).toBe(480);
  });

  it("lists the entries that applied", () => {
    const r = absenceForDay([absence("vab", MON, MON, 4), absence("flex", MON, MON, 2)], MON, cfg(MON));
    expect(r.items.map((i) => [i.entry.category, i.minutes, i.flex])).toEqual([
      ["vab", 240, false],
      ["flex", 120, true],
    ]);
  });
});

describe("absence labels", () => {
  it("isFlexAbsence is only the flex category", () => {
    expect(isFlexAbsence(absence("flex", MON))).toBe(true);
    expect(isFlexAbsence(absence("semester", MON))).toBe(false);
  });

  it("match the absence sheet's labels", () => {
    for (const [cat, meta] of Object.entries(ABSENCE_META)) {
      expect(ABSENCE_LABEL[cat as keyof typeof ABSENCE_LABEL]).toBe(meta.label);
    }
  });
});
