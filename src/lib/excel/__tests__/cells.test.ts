import { describe, expect, it } from "vitest";
import {
  localTimeExists,
  localTimestamp,
  parseDateCell,
  parseNumberCell,
  parseTimeCell,
  parseYesNo,
  hmToFraction,
  ymdToSerial,
} from "../cells";

describe("parseDateCell", () => {
  it("Excel serials", () => {
    expect(parseDateCell(46085)).toEqual({ ok: true, value: "2026-03-04" });
    expect(parseDateCell(36526)).toEqual({ ok: true, value: "2000-01-01" });
    expect(parseDateCell(46085.75)).toEqual({ ok: true, value: "2026-03-04" });
  });
  it("text in a few spellings, but only real dates", () => {
    expect(parseDateCell("2026-03-04")).toEqual({ ok: true, value: "2026-03-04" });
    expect(parseDateCell(" 2026-3-4 ")).toEqual({ ok: true, value: "2026-03-04" });
    expect(parseDateCell("2026/03/04")).toEqual({ ok: true, value: "2026-03-04" });
    expect(parseDateCell("2026-03-04 08:00")).toEqual({ ok: true, value: "2026-03-04" });
    expect(parseDateCell("2026-02-30").ok).toBe(false);
    expect(parseDateCell("4/3/2026").ok).toBe(false); // ambiguous: never guessed
    expect(parseDateCell("").ok).toBe(false);
  });
  it("numbers outside 2000–2100 are not dates", () => {
    expect(parseDateCell(5).ok).toBe(false);
    expect(parseDateCell(99999).ok).toBe(false);
  });
  it("serial round trip", () => {
    for (const d of ["2000-01-01", "2026-03-04", "2026-03-29", "2026-10-25", "2100-12-31"]) {
      const r = parseDateCell(ymdToSerial(d));
      expect(r).toEqual({ ok: true, value: d });
    }
  });
});

describe("parseTimeCell", () => {
  it("fractions of a day, rounded to the minute", () => {
    expect(parseTimeCell(1 / 3)).toEqual({ ok: true, value: "08:00" });
    expect(parseTimeCell(hmToFraction("16:45"))).toEqual({ ok: true, value: "16:45" });
    expect(parseTimeCell(0)).toEqual({ ok: true, value: "00:00" });
    expect(parseTimeCell(0.99999).ok).toBe(false); // would round to 24:00
  });
  it("text", () => {
    expect(parseTimeCell("08:00")).toEqual({ ok: true, value: "08:00" });
    expect(parseTimeCell("8:05")).toEqual({ ok: true, value: "08:05" });
    expect(parseTimeCell("8.30")).toEqual({ ok: true, value: "08:30" });
    expect(parseTimeCell("08:00:30")).toEqual({ ok: true, value: "08:00" });
    expect(parseTimeCell("24:00").ok).toBe(false);
    expect(parseTimeCell("08:60").ok).toBe(false);
    expect(parseTimeCell("kl 8").ok).toBe(false);
  });
});

describe("parseNumberCell / parseYesNo", () => {
  it("decimal comma, spaces, unit suffixes, minus sign", () => {
    expect(parseNumberCell("2,5")).toEqual({ ok: true, value: 2.5 });
    expect(parseNumberCell("1 200,50 kr")).toEqual({ ok: true, value: 1200.5 });
    expect(parseNumberCell("-3,25")).toEqual({ ok: true, value: -3.25 });
    expect(parseNumberCell("−3,25")).toEqual({ ok: true, value: -3.25 });
    expect(parseNumberCell("42 km")).toEqual({ ok: true, value: 42 });
    expect(parseNumberCell("tre").ok).toBe(false);
    expect(parseNumberCell(Number.NaN).ok).toBe(false);
  });
  it("Ja/Nej", () => {
    expect(parseYesNo("Ja")).toEqual({ ok: true, value: true });
    expect(parseYesNo(" nej ")).toEqual({ ok: true, value: false });
    expect(parseYesNo(null)).toEqual({ ok: true, value: false });
    expect(parseYesNo("kanske").ok).toBe(false);
  });
});

describe("local time (Europe/Stockholm)", () => {
  it("DST gap and ambiguity", () => {
    expect(localTimeExists("2026-03-29", "01:59")).toBe(true);
    expect(localTimeExists("2026-03-29", "02:00")).toBe(false);
    expect(localTimeExists("2026-03-29", "02:59")).toBe(false);
    expect(localTimeExists("2026-03-29", "03:00")).toBe(true);
    // The repeated hour in October exists (twice); the first one is taken.
    expect(localTimeExists("2026-10-25", "02:30")).toBe(true);
  });
  it("timestamps use the day's own UTC offset", () => {
    expect(new Date(localTimestamp("2026-03-28", "12:00")).toISOString()).toBe(
      "2026-03-28T11:00:00.000Z",
    );
    expect(new Date(localTimestamp("2026-03-30", "12:00")).toISOString()).toBe(
      "2026-03-30T10:00:00.000Z",
    );
  });
});
