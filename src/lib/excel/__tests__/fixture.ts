// A fixture workbook, built in code with SheetJS (so no binary in the repo besides the
// template). Mirrors docs/min-tid-importmall.xlsx: same sheets, headers and column order.
import * as XLSX from "xlsx";

export type Aoa = (string | number | boolean | null)[][];

// Excel serials (1900 system): 2026-03-04 is 46085, a day is 1, a time is a fraction.
export const serial = (y: number, m: number, d: number) =>
  Math.round(Date.UTC(y, m - 1, d) / 86_400_000) + 25569;
export const hm = (h: number, m = 0) => (h * 60 + m) / 1440;

export function workbookBytes(sheets: Record<string, Aoa>, hidden: string[] = []): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  if (hidden.length) {
    wb.Workbook = {
      Sheets: wb.SheetNames.map((n) => ({ name: n, Hidden: hidden.includes(n) ? 1 : 0 })),
    };
  }
  return new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "array" }));
}

export const PASS_HEAD = ["Datum", "Start", "Slut", "Rast (min)", "Kommentar"];
export const ABSENCE_HEAD = ["Från datum", "Till datum", "Typ", "Timmar", "Kommentar"];
export const EXPENSE_HEAD = ["Datum", "Typ", "Belopp (kr)", "Km", "Kvitto", "Kommentar"];
export const TRAVEL_HEAD = ["Datum", "Från", "Till", "Resmål", "Kommentar"];
export const EXAMPLE = "EXEMPEL – skriv över eller radera";

/** One workbook with good rows, bad rows, duplicates and example rows on every sheet. */
export function messyWorkbook(): Uint8Array {
  const pass: Aoa = [
    PASS_HEAD,
    [serial(2026, 3, 4), hm(8), hm(17), 60, EXAMPLE], // 2: example → skipped
    [serial(2026, 3, 2), hm(8), hm(12), null, "förmiddag"], // 3: ok (Excel date/time)
    ["2026-03-02", "13:00", "17:00", null, null], // 4: ok (text date/time), same day second session
    [serial(2026, 3, 3), hm(8), hm(16, 30), 30, null], // 5: ok with break
    ["2026-03-03", "08:00", "16:30", 30, null], // 6: duplicate of row 5 (date + start)
    [serial(2026, 3, 4), hm(17), hm(8), null, null], // 7: error, end before start
    [serial(2026, 3, 5), hm(8), hm(8), null, null], // 8: error, end = start
    ["i går", "08:00", "17:00", null, null], // 9: error, bad date
    [serial(2026, 3, 6), "kl 8", hm(17), null, null], // 10: error, bad time
    [null, null, null, null, null], // 11: empty row, ignored silently
    [serial(2026, 3, 9), hm(8), hm(9), 90, null], // 12: error, break longer than the session
    [serial(2026, 3, 29), "02:30", "03:30", null, null], // 13: error, 02:30 does not exist (DST)
    [serial(2026, 3, 10), hm(8), hm(17), null, null], // 14: ok
    [null, hm(8), hm(17), null, "datum saknas"], // 15: error, no date
  ];
  const absences: Aoa = [
    ABSENCE_HEAD,
    [serial(2026, 3, 16), serial(2026, 3, 20), "Semester", null, EXAMPLE], // 2: example
    [serial(2026, 3, 11), serial(2026, 3, 11), "Sjuk", null, null], // 3: ok
    ["2026-03-12", null, "vab", "4,5", "halv dag"], // 4: ok, empty Till = same day, "4,5" text, lower-case
    [serial(2026, 3, 13), serial(2026, 3, 12), "Sjuk", null, null], // 5: error, Till before Från
    [serial(2026, 3, 13), serial(2026, 3, 13), "Tandläkare", null, null], // 6: error, unknown type
    [serial(2026, 3, 14), serial(2026, 3, 14), "Semester", 30, null], // 7: error, 30 h per day
    [serial(2026, 3, 11), serial(2026, 3, 11), "Sjuk", null, null], // 8: duplicate of row 3
    [serial(2026, 3, 23), serial(2026, 3, 25), "Flex", 2, null], // 9: ok
  ];
  const expenses: Aoa = [
    EXPENSE_HEAD,
    [serial(2026, 3, 5), "Parkering", 120, null, "Ja", EXAMPLE], // 2: example
    [serial(2026, 3, 5), "Parkering", 85.5, null, "Ja", "Kv 1"], // 3: ok
    [serial(2026, 3, 6), "Milersättning", null, 42, "Nej", null], // 4: ok, km only
    [serial(2026, 3, 6), "Kost", null, null, "Nej", null], // 5: error, amount missing
    [serial(2026, 3, 6), "Milersättning", 100, null, null, null], // 6: error, km missing
    [serial(2026, 3, 7), "Resetimmar", 3, null, null, null], // 7: error, belongs on Restid
    [serial(2026, 3, 7), "Present", 100, null, null, null], // 8: error, unknown type
    [serial(2026, 3, 8), "Kost", "1 200,50 kr", null, "kanske", null], // 9: error, bad Kvitto
    [serial(2026, 3, 5), "Parkering", 85.5, null, "Ja", "Kv 1"], // 10: duplicate of row 3
  ];
  const travel: Aoa = [
    TRAVEL_HEAD,
    [serial(2026, 3, 17), hm(6, 30), hm(8), "Åmål", EXAMPLE], // 2: example
    [serial(2026, 3, 18), hm(6, 30), hm(9), "Karlstad", "tåg"], // 3: ok
    [serial(2026, 3, 19), hm(18), null, null, null], // 4: error, Till missing
    [serial(2026, 3, 20), hm(9), hm(8), null, null], // 5: error, Till before Från
  ];
  const balances: Aoa = [
    ["Saldo", "Värde", "Förklaring"],
    ["Per datum", serial(2026, 2, 28), "…"],
    ["Flexsaldo (timmar)", 12.5, "…"],
    ["Semesterdagar kvar", 14, "…"],
    ["Sparade semesterdagar", 5, "…"],
  ];
  const lists: Aoa = [
    ["Frånvarotyp", "Utläggstyp", "Kvitto", "Mallversion"],
    ["Sjuk", "Milersättning", "Ja", 1],
  ];
  return workbookBytes(
    {
      Instruktioner: [["x"]],
      Pass: pass,
      Frånvaro: absences,
      Utlägg: expenses,
      Restid: travel,
      Saldon: balances,
      Listor: lists,
    },
    ["Listor"],
  );
}
