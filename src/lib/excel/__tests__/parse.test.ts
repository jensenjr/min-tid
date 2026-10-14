import { describe, expect, it } from "vitest";
import { parseWorkbook } from "../parse";
import { hmLocal, ymdLocal } from "../../dates";
import {
  ABSENCE_HEAD,
  PASS_HEAD,
  type Aoa,
  hm,
  messyWorkbook,
  serial,
  workbookBytes,
} from "./fixture";

const at = (ms: number) => `${ymdLocal(new Date(ms))} ${hmLocal(ms)}`;
const errorsOf = (p: Awaited<ReturnType<typeof parseWorkbook>>, sheet: string) =>
  p.errors.filter((e) => e.sheet === sheet).map((e) => e.row);

describe("parseWorkbook — messy fixture", () => {
  it("imports the good rows, with Excel and text dates/times", async () => {
    const p = await parseWorkbook(messyWorkbook());
    expect(p.sessions.map((s) => `${at(s.checkIn)}–${hmLocal(s.checkOut as number)}`)).toEqual([
      "2026-03-02 08:00–12:00",
      "2026-03-02 13:00–17:00",
      "2026-03-03 08:00–16:30",
      "2026-03-10 08:00–17:00",
    ]);
    expect(p.rows.sessions).toEqual([3, 4, 5, 14]);
    expect(p.sessions[0]).toMatchObject({ manual: true, note: "förmiddag" });
    expect(p.sessions[0].breakMinutes).toBeUndefined(); // empty Rast = no registered break
    expect(p.sessions[2].breakMinutes).toBe(30);

    expect(p.absences.map((a) => [a.category, a.startDate, a.endDate, a.hours])).toEqual([
      ["sjuk", "2026-03-11", "2026-03-11", undefined],
      ["vab", "2026-03-12", "2026-03-12", 4.5], // empty Till = same day; "4,5" with comma
      ["flex", "2026-03-23", "2026-03-25", 2],
    ]);

    expect(p.expenses.map((e) => [e.category, e.date, e.amount, e.km, e.hasReceipt])).toEqual([
      ["parkering", "2026-03-05", 85.5, undefined, true],
      ["milersattning", "2026-03-06", undefined, 42, false],
    ]);

    expect(p.travel).toEqual([
      { date: "2026-03-18", from: "06:30", to: "09:00", destination: "Karlstad", note: "tåg" },
    ]);
    expect(p.balances).toEqual({
      asOf: "2026-02-28",
      flexMinutes: 750,
      vacationDaysLeft: 14,
      savedVacationDays: 5,
    });
  });

  it("skips the EXEMPEL rows on every sheet", async () => {
    const p = await parseWorkbook(messyWorkbook());
    expect(p.skippedExamples).toBe(4);
    for (const row of p.errors) expect(row.message).not.toMatch(/EXEMPEL/);
    expect(p.sessions.some((s) => at(s.checkIn) === "2026-03-04 08:00")).toBe(false);
  });

  it("reports errors with sheet and row number", async () => {
    const p = await parseWorkbook(messyWorkbook());
    expect(errorsOf(p, "Pass")).toEqual([7, 8, 9, 10, 12, 13, 15]);
    expect(errorsOf(p, "Frånvaro")).toEqual([5, 6, 7]);
    expect(errorsOf(p, "Utlägg")).toEqual([5, 6, 7, 8, 9]);
    expect(errorsOf(p, "Restid")).toEqual([4, 5]);
    expect(p.errors).toHaveLength(17);
    const msg = (sheet: string, row: number) =>
      p.errors.find((e) => e.sheet === sheet && e.row === row)?.message ?? "";
    expect(msg("Pass", 7)).toMatch(/Slut före start.*midnatt/);
    expect(msg("Pass", 8)).toMatch(/samma som start/);
    expect(msg("Pass", 9)).toMatch(/Ogiltigt datum/);
    expect(msg("Pass", 10)).toMatch(/Ogiltig tid "kl 8"/);
    expect(msg("Pass", 12)).toMatch(/Rasten är längre/);
    expect(msg("Pass", 13)).toMatch(/02:30 finns inte 2026-03-29/);
    expect(msg("Pass", 15)).toMatch(/Datum saknas/);
    expect(msg("Frånvaro", 5)).toMatch(/före Från/);
    expect(msg("Frånvaro", 6)).toMatch(/Okänd frånvarotyp "Tandläkare"/);
    expect(msg("Frånvaro", 7)).toMatch(/högst 24/);
    expect(msg("Utlägg", 5)).toMatch(/belopp/);
    expect(msg("Utlägg", 6)).toMatch(/km/);
    expect(msg("Utlägg", 7)).toMatch(/Resetimmar.*Restid/); // never an expense, never a guess
    expect(msg("Utlägg", 8)).toMatch(/Okänd utläggstyp "Present"/);
    expect(msg("Utlägg", 9)).toMatch(/Kvitto/);
    expect(msg("Restid", 4)).toMatch(/Till/);
    expect(msg("Restid", 5)).toMatch(/Till är före/);
  });

  it("lists duplicates separately from errors", async () => {
    const p = await parseWorkbook(messyWorkbook());
    expect(p.duplicates.map((d) => [d.sheet, d.row])).toEqual([
      ["Pass", 6],
      ["Frånvaro", 8],
      ["Utlägg", 10],
    ]);
    expect(p.duplicates[0].message).toMatch(/rad 5/);
    // The first of two identical rows is the one kept.
    expect(p.rows.sessions).toContain(5);
    expect(p.rows.sessions).not.toContain(6);
  });
});

describe("parseWorkbook — times are Europe/Stockholm local", () => {
  const one = (aoa: Aoa) => parseWorkbook(workbookBytes({ Pass: [PASS_HEAD, ...aoa] }));

  it("builds timestamps from wall-clock time", async () => {
    const p = await one([[serial(2026, 1, 12), hm(8), hm(17), null, null]]);
    expect(p.sessions[0].checkIn).toBe(new Date(2026, 0, 12, 8, 0).getTime());
    // 08:00 in January is 07:00 UTC (CET), in July 06:00 UTC (CEST).
    expect(new Date(p.sessions[0].checkIn).toISOString()).toBe("2026-01-12T07:00:00.000Z");
    const j = await one([["2026-07-13", "08:00", "17:00", null, null]]);
    expect(new Date(j.sessions[0].checkIn).toISOString()).toBe("2026-07-13T06:00:00.000Z");
  });

  it("spring-forward day: 01:00–04:00 is two real hours", async () => {
    const p = await one([["2026-03-29", "01:00", "04:00", null, null]]);
    expect(p.errors).toEqual([]);
    const s = p.sessions[0];
    expect((s.checkOut as number) - s.checkIn).toBe(2 * 3600_000);
  });

  it("spring-forward day: a time inside the gap is a row error", async () => {
    const p = await one([["2026-03-29", "02:15", "05:00", null, null]]);
    expect(p.sessions).toEqual([]);
    expect(p.errors[0]).toMatchObject({ sheet: "Pass", row: 2 });
    expect(p.errors[0].message).toMatch(/finns inte/);
  });

  it("fall-back day: 01:00–04:00 is four real hours", async () => {
    const p = await one([["2026-10-25", "01:00", "04:00", null, null]]);
    const s = p.sessions[0];
    expect((s.checkOut as number) - s.checkIn).toBe(4 * 3600_000);
  });

  it("an Excel time with float noise rounds to the minute", async () => {
    // 0.33333333333333331 → 08:00; 0.70833333333333337 → 17:00
    const p = await one([[46085, 0.3333333333333333, 0.7083333333333334, null, null]]);
    expect(p.sessions.map((s) => `${at(s.checkIn)}–${hmLocal(s.checkOut as number)}`)).toEqual([
      "2026-03-04 08:00–17:00",
    ]);
  });

  it("a date-time cell keeps its time of day and the day number", async () => {
    const p = await one([[46085.5, 46085.3333333333, 46085.7083333333, null, null]]);
    expect(p.sessions.map((s) => `${at(s.checkIn)}–${hmLocal(s.checkOut as number)}`)).toEqual([
      "2026-03-04 08:00–17:00",
    ]);
  });
});

describe("parseWorkbook — file level", () => {
  it("a missing sheet is fine; a sheet without its header row is an error", async () => {
    const p = await parseWorkbook(
      workbookBytes({
        Pass: [
          ["Dag", "Från", "Till"],
          ["2026-03-02", "08:00", "17:00"],
        ],
      }),
    );
    expect(p.sessions).toEqual([]);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toMatchObject({ sheet: "Pass", row: 1 });
    expect(p.errors[0].message).toMatch(/Rubriken "Datum", "Start", "Slut" saknas/);
  });

  it("headers are matched by name, so reordered and extra columns work", async () => {
    const p = await parseWorkbook(
      workbookBytes({
        Frånvaro: [
          ["Typ", "Extra", "Till datum", "Från datum"],
          ["sjuk", "x", "2026-03-03", "2026-03-02"],
        ],
      }),
    );
    expect(p.errors).toEqual([]);
    expect(p.absences[0]).toMatchObject({
      category: "sjuk",
      startDate: "2026-03-02",
      endDate: "2026-03-03",
    });
  });

  it("a file with none of the sheets (a CSV, the wrong workbook) says so", async () => {
    const csv = new TextEncoder().encode("Datum,Start,Slut\n2026-03-02,08:00,17:00\n");
    const p = await parseWorkbook(csv);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toMatchObject({ row: 0 });
    expect(p.errors[0].message).toMatch(/Hittar inga flikar/);
  });

  it("garbage bytes are a file error, not an exception", async () => {
    const p = await parseWorkbook(new Uint8Array([1, 2, 3, 4, 5]));
    expect(p.errors).toHaveLength(1);
    expect(p.sessions).toEqual([]);
  });

  it("a newer template version is refused", async () => {
    const bytes = workbookBytes({
      Pass: [PASS_HEAD, ["2026-03-02", "08:00", "17:00", null, null]],
      Listor: [
        ["Frånvarotyp", "Utläggstyp", "Kvitto", "Mallversion"],
        ["Sjuk", "Kost", "Ja", 2],
      ],
    });
    const p = await parseWorkbook(bytes);
    expect(p.sessions).toEqual([]);
    expect(p.errors[0].message).toMatch(/version 2/);
  });

  it("accepts a Blob", async () => {
    const p = await parseWorkbook(new Blob([messyWorkbook() as BlobPart]));
    expect(p.sessions).toHaveLength(4);
  });

  it("absence type matching ignores case and spacing but never guesses", async () => {
    const p = await parseWorkbook(
      workbookBytes({
        Frånvaro: [
          ABSENCE_HEAD,
          ["2026-03-02", "2026-03-02", "  FÖRÄLDRALEDIGHET ", null, null],
          ["2026-03-03", "2026-03-03", "obetald  ledighet", null, null],
          ["2026-03-04", "2026-03-04", "Övertid (betald)", null, null], // a real category, not in the template list
          ["2026-03-05", "2026-03-05", "Helgdag", null, null],
        ],
      }),
    );
    expect(p.absences.map((a) => a.category)).toEqual(["foraldraledighet", "obetald"]);
    expect(p.errors.map((e) => e.row)).toEqual([4, 5]);
  });

  it("a Saldon value without Per datum is an error", async () => {
    const p = await parseWorkbook(
      workbookBytes({
        Saldon: [
          ["Saldo", "Värde"],
          ["Per datum", null],
          ["Flexsaldo (timmar)", -3.25],
        ],
      }),
    );
    expect(p.balances).toBeNull();
    expect(p.errors[0].message).toMatch(/Per datum/);
  });

  it("an empty Saldon sheet (the template as downloaded) is no error", async () => {
    const p = await parseWorkbook(
      workbookBytes({
        Saldon: [
          ["Saldo", "Värde"],
          ["Per datum", null],
          ["Flexsaldo (timmar)", null],
        ],
      }),
    );
    expect(p.balances).toBeNull();
    expect(p.errors).toEqual([]);
  });

  it("negative flex hours and the horizontal Saldon layout", async () => {
    const p = await parseWorkbook(
      workbookBytes({
        Saldon: [
          ["Per datum", "Flexsaldo (timmar)", "Semesterdagar kvar", "Sparade semesterdagar"],
          ["2026-02-28", "-3,25", null, null],
        ],
      }),
    );
    expect(p.balances).toEqual({ asOf: "2026-02-28", flexMinutes: -195 });
  });
});
