import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildTemplate } from "../template";
import { parseWorkbook } from "../parse";
import {
  ABSENCE_HEADERS,
  ABSENCE_TYPE_LABELS,
  BALANCE_HEADERS,
  EXPENSE_HEADERS,
  EXPENSE_TYPE_LABELS,
  SESSION_HEADERS,
  TEMPLATE_VERSION,
  TRAVEL_HEADERS,
} from "../lists";

const docsFile = () => new Uint8Array(readFileSync("docs/min-tid-importmall.xlsx"));

describe("buildTemplate", () => {
  it("is the docs template, byte for byte", async () => {
    const built = await buildTemplate();
    expect(built.length).toBe(docsFile().length);
    expect(Buffer.from(built).equals(Buffer.from(docsFile()))).toBe(true);
  });

  const read = async () => XLSX.read(await buildTemplate(), { type: "array" });
  const header = (wb: XLSX.WorkBook, name: string) =>
    (XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1 })[0] ?? []) as string[];

  it("has the sheets in order, Listor hidden, Mallversion 1", async () => {
    const wb = await read();
    expect(wb.SheetNames).toEqual([
      "Instruktioner",
      "Pass",
      "Frånvaro",
      "Utlägg",
      "Restid",
      "Saldon",
      "Listor",
    ]);
    expect(wb.Workbook?.Sheets?.map((s) => s.Hidden)).toEqual([0, 0, 0, 0, 0, 0, 1]);
    expect(wb.Sheets.Listor.D2.v).toBe(TEMPLATE_VERSION);
    expect(TEMPLATE_VERSION).toBe(1);
  });

  it("headers match lists.ts (column order matters)", async () => {
    const wb = await read();
    expect(header(wb, "Pass")).toEqual([...SESSION_HEADERS]);
    expect(header(wb, "Frånvaro")).toEqual([...ABSENCE_HEADERS]);
    expect(header(wb, "Utlägg")).toEqual([...EXPENSE_HEADERS]);
    expect(header(wb, "Restid")).toEqual([...TRAVEL_HEADERS]);
    expect(header(wb, "Saldon")).toEqual([...BALANCE_HEADERS]);
  });

  it("the drop-down lists in Listor match the type maps", async () => {
    const wb = await read();
    const col = (c: string, n: number) =>
      Array.from({ length: n }, (_, i) => wb.Sheets.Listor[`${c}${i + 2}`]?.v);
    expect(col("A", ABSENCE_TYPE_LABELS.length)).toEqual(ABSENCE_TYPE_LABELS.map(([l]) => l));
    expect(col("B", EXPENSE_TYPE_LABELS.length)).toEqual(EXPENSE_TYPE_LABELS.map(([l]) => l));
    expect(wb.Sheets.Listor[`A${ABSENCE_TYPE_LABELS.length + 2}`]).toBeUndefined();
    expect(wb.Sheets.Listor[`B${EXPENSE_TYPE_LABELS.length + 2}`]).toBeUndefined();
  });

  it("imports as: no errors, nothing imported, four example rows skipped", async () => {
    const p = await parseWorkbook(await buildTemplate());
    expect(p.errors).toEqual([]);
    expect(p.sessions).toEqual([]);
    expect(p.absences).toEqual([]);
    expect(p.expenses).toEqual([]);
    expect(p.travel).toEqual([]);
    expect(p.balances).toBeNull();
    expect(p.skippedExamples).toBe(4);
    expect(p.sheetsFound).toEqual(["Pass", "Frånvaro", "Utlägg", "Restid", "Saldon"]);
  });

  it("the example rows are real, valid rows (only the marker keeps them out)", async () => {
    // Blank the marker on the Pass example → it must parse cleanly as 2026-03-04 08:00–17:00.
    const wb = await read();
    wb.Sheets.Pass.E2 = { t: "s", v: "min rad" };
    const bytes = new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "array" }));
    const p = await parseWorkbook(bytes);
    expect(p.errors).toEqual([]);
    expect(p.sessions).toHaveLength(1);
    expect(p.sessions[0]).toMatchObject({ breakMinutes: 60, note: "min rad" });
    expect(new Date(p.sessions[0].checkIn).getHours()).toBe(8);
  });
});
