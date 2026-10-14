// Read an import workbook (docs/min-tid-importmall.xlsx layout) into domain objects.
//
// Pure apart from loading SheetJS, which happens through a dynamic import() so it never
// lands in the main bundle. Nothing here touches app state: duplicates against existing
// data and locked months are handled in plan.ts, which knows the state.
//
// Rules
// - Every sheet is optional; a sheet that is there must have its header row.
// - Dates/times are Excel serials or text (2026-03-04, 08:00). Times are wall-clock
//   Europe/Stockholm = the device's local time: timestamps are built with
//   new Date(y, m-1, d, hh, mm), so DST is applied by the platform. A time that does not
//   exist (the spring gap) is a row error.
// - A row whose Kommentar is the template's example marker is skipped.
// - Bad rows become { sheet, row, message } errors; good rows are still returned.
// - A session with the same date + start as an earlier row of the file is a duplicate
//   (skipped, listed separately, not an error).
import type { AbsenceEntry, ExpenseEntry, Session } from "../types";
import {
  type CellValue,
  cellText,
  isEmptyCell,
  localTimeExists,
  localTimestamp,
  parseDateCell,
  parseNumberCell,
  parseTimeCell,
  parseYesNo,
} from "./cells";
import {
  ABSENCE_HEADERS,
  BALANCE_LABELS,
  EXPENSE_HEADERS,
  SESSION_HEADERS,
  SHEETS,
  TEMPLATE_VERSION,
  TRAVEL_HEADERS,
  absenceCategoryFromLabel,
  expenseCategoryFromLabel,
  isExampleComment,
  normHeader,
} from "./lists";

type XLSXLib = typeof import("xlsx");
type WorkBook = import("xlsx").WorkBook;

export type RowIssue = {
  sheet: string;
  /** 1-based spreadsheet row; 0 = the file as a whole. */
  row: number;
  message: string;
};

/** A Restid row. PR 8 turns these into TravelEntry (it owns the travel state). */
export type TravelImport = {
  date: string;
  from?: string;
  to?: string;
  destination?: string;
  note?: string;
};

export type ParsedBalances = {
  /** The balances are at the END of this day (YYYY-MM-DD). */
  asOf: string;
  flexMinutes?: number;
  vacationDaysLeft?: number;
  savedVacationDays?: number;
};

export type ParsedWorkbook = {
  sessions: Session[];
  absences: AbsenceEntry[];
  expenses: ExpenseEntry[];
  travel: TravelImport[];
  balances: ParsedBalances | null;
  errors: RowIssue[];
  /** Rows skipped because the file already holds a session with the same date + start. */
  duplicates: RowIssue[];
  /** Spreadsheet row of each item above (parallel arrays), for later row-numbered errors. */
  rows: { sessions: number[]; absences: number[]; expenses: number[]; travel: number[] };
  /** Number of "EXEMPEL" rows left out. */
  skippedExamples: number;
  sheetsFound: string[];
};

export type WorkbookInput = Blob | ArrayBuffer | Uint8Array;

const MAX_SCAN_ROWS = 20_000;
const MAX_DATA_ROWS = 5_000;
const MAX_ABSENCE_DAYS = 366;
const MAX_NOTE = 500;

function newId(): string {
  return globalThis.crypto.randomUUID();
}

async function toBytes(input: WorkbookInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(await input.arrayBuffer());
}

/** SheetJS, loaded on first use only (separate chunk). */
export async function loadXlsx(): Promise<XLSXLib> {
  return await import("xlsx");
}

// ─── Table reading ────────────────────────────────────────────
type Table = {
  sheet: string;
  col: Map<string, number>; // normalised header → column index
  rows: { row: number; cells: CellValue[] }[];
};

function findSheet(wb: WorkBook, name: string): string | undefined {
  return wb.SheetNames.find((n) => normHeader(n) === normHeader(name));
}

function sheetRows(
  XLSX: XLSXLib,
  wb: WorkBook,
  name: string,
): { row: number; cells: CellValue[] }[] {
  const ws = wb.Sheets[name];
  if (!ws || !ws["!ref"]) return [];
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const clamped = {
    s: { r: range.s.r, c: 0 },
    e: { r: Math.min(range.e.r, range.s.r + MAX_SCAN_ROWS), c: Math.min(range.e.c, 25) },
  };
  const raw = XLSX.utils.sheet_to_json<CellValue[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
    range: clamped,
  });
  return raw.map((cells, i) => ({ row: clamped.s.r + i + 1, cells }));
}

/**
 * Find the header row (within the first 10 rows) and index the columns. Returns null and
 * records an error when a required header is missing.
 */
function readTable(
  XLSX: XLSXLib,
  wb: WorkBook,
  sheetName: string,
  required: readonly string[],
  errors: RowIssue[],
): Table | null {
  const actual = findSheet(wb, sheetName);
  if (!actual) return null;
  const all = sheetRows(XLSX, wb, actual);
  const need = required.map(normHeader);
  let headerIdx = -1;
  let col = new Map<string, number>();
  for (let i = 0; i < Math.min(all.length, 10); i++) {
    const m = new Map<string, number>();
    all[i].cells.forEach((c, ci) => {
      const h = normHeader(c);
      if (h && !m.has(h)) m.set(h, ci);
    });
    if (need.every((h) => m.has(h))) {
      headerIdx = i;
      col = m;
      break;
    }
  }
  if (headerIdx < 0) {
    const first = new Map<string, number>();
    (all[0]?.cells ?? []).forEach((c, ci) => {
      const h = normHeader(c);
      if (h) first.set(h, ci);
    });
    const missing = required.filter((h) => !first.has(normHeader(h)));
    errors.push({
      sheet: actual,
      row: all[0]?.row ?? 1,
      message: `Rubriken ${missing.map((h) => `"${h}"`).join(", ")} saknas. Använd mallen och ändra inte rubrikraden.`,
    });
    return null;
  }
  return { sheet: actual, col, rows: all.slice(headerIdx + 1) };
}

const cellOf = (t: Table, cells: CellValue[], header: string): CellValue => {
  const i = t.col.get(normHeader(header));
  return i === undefined ? null : (cells[i] ?? null);
};

const rowIsEmpty = (cells: CellValue[]) => cells.every(isEmptyCell);

function noteOf(v: CellValue): string | undefined {
  const s = cellText(v);
  return s ? s.slice(0, MAX_NOTE) : undefined;
}

// ─── Per-sheet parsers ────────────────────────────────────────
type Ctx = {
  out: ParsedWorkbook;
  push: (issue: RowIssue) => void;
};

/** Iterate non-empty, non-example rows; the callback returns error strings for the row. */
function eachRow(
  t: Table,
  ctx: Ctx,
  fn: (cells: CellValue[], row: number) => string[] | void,
): void {
  let seen = 0;
  for (const { row, cells } of t.rows) {
    if (rowIsEmpty(cells)) continue;
    if (isExampleComment(cellText(cellOf(t, cells, "Kommentar")))) {
      ctx.out.skippedExamples++;
      continue;
    }
    if (++seen > MAX_DATA_ROWS) {
      ctx.push({ sheet: t.sheet, row, message: `För många rader (max ${MAX_DATA_ROWS} per flik)` });
      return;
    }
    const problems = fn(cells, row);
    if (problems && problems.length > 0) {
      ctx.push({ sheet: t.sheet, row, message: problems.join(" · ") });
    }
  }
}

function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function parseSessions(t: Table, ctx: Ctx) {
  const seen = new Map<string, number>(); // date|start → first row
  eachRow(t, ctx, (cells, row) => {
    const problems: string[] = [];
    const date = parseDateCell(cellOf(t, cells, "Datum"));
    const start = parseTimeCell(cellOf(t, cells, "Start"));
    const end = parseTimeCell(cellOf(t, cells, "Slut"));
    if (!date.ok)
      problems.push(isEmptyCell(cellOf(t, cells, "Datum")) ? "Datum saknas" : date.message);
    if (!start.ok)
      problems.push(isEmptyCell(cellOf(t, cells, "Start")) ? "Start saknas" : start.message);
    if (!end.ok) problems.push(isEmptyCell(cellOf(t, cells, "Slut")) ? "Slut saknas" : end.message);

    let breakMinutes: number | undefined;
    const rawBreak = cellOf(t, cells, "Rast (min)");
    if (!isEmptyCell(rawBreak)) {
      const b = parseNumberCell(rawBreak);
      if (!b.ok) problems.push(`Rast: ${b.message}`);
      else if (b.value < 0 || b.value > 600) problems.push("Rast ska vara 0–600 minuter");
      else breakMinutes = Math.round(b.value);
    }
    if (!date.ok || !start.ok || !end.ok) return problems;

    if (!localTimeExists(date.value, start.value)) {
      problems.push(`Starttiden ${start.value} finns inte ${date.value} (sommartid)`);
    }
    if (!localTimeExists(date.value, end.value)) {
      problems.push(`Sluttiden ${end.value} finns inte ${date.value} (sommartid)`);
    }
    if (problems.length > 0) return problems;

    const checkIn = localTimestamp(date.value, start.value);
    const checkOut = localTimestamp(date.value, end.value);
    if (checkOut <= checkIn) {
      return [
        end.value === start.value
          ? "Slut är samma som start"
          : "Slut före start. Pass över midnatt delas i två rader: en till 23:59 och en från 00:00 nästa dag",
      ];
    }
    if (breakMinutes !== undefined && breakMinutes * 60_000 > checkOut - checkIn) {
      return ["Rasten är längre än passet"];
    }

    const key = `${date.value}|${start.value}`;
    const first = seen.get(key);
    if (first !== undefined) {
      ctx.out.duplicates.push({
        sheet: t.sheet,
        row,
        message: `Dubblett av rad ${first} (samma datum och start)`,
      });
      return;
    }
    seen.set(key, row);

    const session: Session = { id: newId(), checkIn, checkOut, manual: true };
    if (breakMinutes !== undefined) session.breakMinutes = breakMinutes;
    const note = noteOf(cellOf(t, cells, "Kommentar"));
    if (note) session.note = note;
    ctx.out.sessions.push(session);
    ctx.out.rows.sessions.push(row);
  });
}

function parseAbsences(t: Table, ctx: Ctx) {
  const seen = new Map<string, number>();
  eachRow(t, ctx, (cells, row) => {
    const problems: string[] = [];
    const rawFrom = cellOf(t, cells, "Från datum");
    const rawTo = cellOf(t, cells, "Till datum");
    const from = parseDateCell(rawFrom);
    // "Från och Till kan vara samma dag" — an empty Till means the same day.
    const to = isEmptyCell(rawTo) && from.ok ? from : parseDateCell(rawTo);
    if (!from.ok)
      problems.push(isEmptyCell(rawFrom) ? "Från datum saknas" : `Från datum: ${from.message}`);
    if (!to.ok) problems.push(`Till datum: ${to.message}`);

    const rawType = cellOf(t, cells, "Typ");
    const typeText = cellText(rawType);
    const category = typeText ? absenceCategoryFromLabel(typeText) : undefined;
    if (!typeText) problems.push("Typ saknas");
    else if (!category) problems.push(`Okänd frånvarotyp "${typeText}" – välj i listan`);

    let hours: number | undefined;
    const rawHours = cellOf(t, cells, "Timmar");
    if (!isEmptyCell(rawHours)) {
      const h = parseNumberCell(rawHours);
      if (!h.ok) problems.push(`Timmar: ${h.message}`);
      else if (h.value <= 0 || h.value > 24)
        problems.push("Timmar ska vara mer än 0 och högst 24 per dag");
      else hours = Math.round(h.value * 100) / 100;
    }

    if (from.ok && to.ok) {
      if (to.value < from.value) problems.push("Till datum är före Från datum");
      else if (dayDiff(from.value, to.value) + 1 > MAX_ABSENCE_DAYS) {
        problems.push(`Perioden är längre än ${MAX_ABSENCE_DAYS} dagar – dela upp den`);
      }
    }
    if (problems.length > 0 || !from.ok || !to.ok || !category) return problems;

    const key = `${category}|${from.value}|${to.value}|${hours ?? ""}`;
    const first = seen.get(key);
    if (first !== undefined) {
      ctx.out.duplicates.push({ sheet: t.sheet, row, message: `Dubblett av rad ${first}` });
      return;
    }
    seen.set(key, row);

    const entry: AbsenceEntry = {
      id: newId(),
      category,
      startDate: from.value,
      endDate: to.value,
      manual: true,
    };
    if (hours !== undefined) entry.hours = hours;
    const note = noteOf(cellOf(t, cells, "Kommentar"));
    if (note) entry.note = note;
    ctx.out.absences.push(entry);
    ctx.out.rows.absences.push(row);
  });
}

function parseExpenses(t: Table, ctx: Ctx) {
  const seen = new Map<string, number>();
  eachRow(t, ctx, (cells, row) => {
    const problems: string[] = [];
    const rawDate = cellOf(t, cells, "Datum");
    const date = parseDateCell(rawDate);
    if (!date.ok) problems.push(isEmptyCell(rawDate) ? "Datum saknas" : date.message);

    const typeText = cellText(cellOf(t, cells, "Typ"));
    const category = typeText ? expenseCategoryFromLabel(typeText) : undefined;
    if (!typeText) problems.push("Typ saknas");
    else if (!category) problems.push(`Okänd utläggstyp "${typeText}" – välj i listan`);
    else if (category === "resetimmar") {
      // PR 8 removes "Resetimmar" as an expense; a row has no from/to time to map to a
      // duration, so it cannot become a travel entry either.
      problems.push(
        "Resetimmar är inte ett utlägg – lägg resan i fliken Restid (datum, från, till)",
      );
    }

    let amount: number | undefined;
    const rawAmount = cellOf(t, cells, "Belopp (kr)");
    if (!isEmptyCell(rawAmount)) {
      const a = parseNumberCell(rawAmount);
      if (!a.ok) problems.push(`Belopp: ${a.message}`);
      else if (a.value < 0 || a.value > 1_000_000) problems.push("Belopp ska vara 0–1 000 000 kr");
      else if (a.value > 0) amount = Math.round(a.value * 100) / 100;
    }
    let km: number | undefined;
    const rawKm = cellOf(t, cells, "Km");
    if (!isEmptyCell(rawKm)) {
      const k = parseNumberCell(rawKm);
      if (!k.ok) problems.push(`Km: ${k.message}`);
      else if (k.value < 0 || k.value > 10_000) problems.push("Km ska vara 0–10 000");
      else if (k.value > 0) km = Math.round(k.value * 100) / 100;
    }
    const receipt = parseYesNo(cellOf(t, cells, "Kvitto"));
    if (!receipt.ok) problems.push(receipt.message);

    if (category === "milersattning") {
      if (km === undefined && !problems.some((p) => p.startsWith("Km")))
        problems.push("Ange antal km för milersättning");
    } else if (category && category !== "resetimmar") {
      if (amount === undefined && !problems.some((p) => p.startsWith("Belopp")))
        problems.push("Ange ett belopp");
    }
    if (problems.length > 0 || !date.ok || !category || !receipt.ok) return problems;

    const note = noteOf(cellOf(t, cells, "Kommentar"));
    const key = `${date.value}|${category}|${amount ?? ""}|${km ?? ""}|${note ?? ""}`;
    const first = seen.get(key);
    if (first !== undefined) {
      ctx.out.duplicates.push({ sheet: t.sheet, row, message: `Dubblett av rad ${first}` });
      return;
    }
    seen.set(key, row);

    const entry: ExpenseEntry = {
      id: newId(),
      category,
      date: date.value,
      hasReceipt: receipt.value,
      manual: true,
    };
    if (amount !== undefined) entry.amount = amount;
    if (category === "milersattning" && km !== undefined) entry.km = km;
    if (note) entry.note = note;
    ctx.out.expenses.push(entry);
    ctx.out.rows.expenses.push(row);
  });
}

function parseTravel(t: Table, ctx: Ctx) {
  const seen = new Map<string, number>();
  eachRow(t, ctx, (cells, row) => {
    const problems: string[] = [];
    const rawDate = cellOf(t, cells, "Datum");
    const date = parseDateCell(rawDate);
    if (!date.ok) problems.push(isEmptyCell(rawDate) ? "Datum saknas" : date.message);
    const rawFrom = cellOf(t, cells, "Från");
    const rawTo = cellOf(t, cells, "Till");
    const from = parseTimeCell(rawFrom);
    const to = parseTimeCell(rawTo);
    if (!from.ok)
      problems.push(isEmptyCell(rawFrom) ? "Från (tid) saknas" : `Från: ${from.message}`);
    if (!to.ok) problems.push(isEmptyCell(rawTo) ? "Till (tid) saknas" : `Till: ${to.message}`);
    if (from.ok && to.ok && to.value <= from.value) {
      problems.push("Till är före eller samma som Från. Resor över midnatt delas i två rader");
    }
    if (problems.length > 0 || !date.ok || !from.ok || !to.ok) return problems;

    const key = `${date.value}|${from.value}|${to.value}`;
    const first = seen.get(key);
    if (first !== undefined) {
      ctx.out.duplicates.push({ sheet: t.sheet, row, message: `Dubblett av rad ${first}` });
      return;
    }
    seen.set(key, row);

    const item: TravelImport = { date: date.value, from: from.value, to: to.value };
    const destination = noteOf(cellOf(t, cells, "Resmål"));
    if (destination) item.destination = destination;
    const note = noteOf(cellOf(t, cells, "Kommentar"));
    if (note) item.note = note;
    ctx.out.travel.push(item);
    ctx.out.rows.travel.push(row);
  });
}

/**
 * Saldon: a key/value list (Saldo | Värde | Förklaring, one balance per row). A header
 * layout with the four names as column headings is accepted as well.
 */
function parseBalances(XLSX: XLSXLib, wb: WorkBook, sheetName: string, ctx: Ctx) {
  const rows = sheetRows(XLSX, wb, sheetName);
  const labelKey = (s: unknown) => normHeader(s);
  const L = {
    asOf: labelKey(BALANCE_LABELS.asOf),
    flex: labelKey(BALANCE_LABELS.flexHours),
    left: labelKey(BALANCE_LABELS.vacationLeft),
    saved: labelKey(BALANCE_LABELS.vacationSaved),
  };
  const values: Partial<Record<keyof typeof L, { v: CellValue; row: number }>> = {};

  // Vertical: label in column A, value in column B.
  for (const { row, cells } of rows) {
    const label = labelKey(cells[0]);
    for (const k of Object.keys(L) as (keyof typeof L)[]) {
      if (label === L[k] && !values[k]) values[k] = { v: cells[1] ?? null, row };
    }
  }
  // Horizontal fallback: the names as headings, values in the row below.
  if (!values.asOf) {
    for (let i = 0; i < rows.length - 1; i++) {
      const heads = rows[i].cells.map(labelKey);
      if (!heads.includes(L.asOf)) continue;
      for (const k of Object.keys(L) as (keyof typeof L)[]) {
        const ci = heads.indexOf(L[k]);
        if (ci >= 0) values[k] = { v: rows[i + 1].cells[ci] ?? null, row: rows[i + 1].row };
      }
      break;
    }
  }

  const sheet = findSheet(wb, sheetName) as string;
  const filled = (k: keyof typeof L) => values[k] && !isEmptyCell(values[k]!.v);
  if (!filled("asOf") && !filled("flex") && !filled("left") && !filled("saved")) return;

  const issue = (row: number, message: string) => ctx.push({ sheet, row, message });
  let ok = true;
  const num = (k: "flex" | "left" | "saved", min: number, max: number, what: string) => {
    if (!filled(k)) return undefined;
    const { v, row } = values[k]!;
    const n = parseNumberCell(v);
    if (!n.ok) {
      issue(row, `${what}: ${n.message}`);
      ok = false;
      return undefined;
    }
    if (n.value < min || n.value > max) {
      issue(row, `${what} ska vara mellan ${min} och ${max}`);
      ok = false;
      return undefined;
    }
    return n.value;
  };

  let asOf: string | undefined;
  if (filled("asOf")) {
    const d = parseDateCell(values.asOf!.v);
    if (d.ok) asOf = d.value;
    else {
      issue(values.asOf!.row, `Per datum: ${d.message}`);
      ok = false;
    }
  } else {
    issue(
      values.flex?.row ?? values.left?.row ?? values.saved?.row ?? 2,
      "Fyll i Per datum – datumet saldona gäller",
    );
    ok = false;
  }
  const flexHours = num("flex", -1000, 1000, "Flexsaldo");
  const left = num("left", 0, 1000, "Semesterdagar kvar");
  const saved = num("saved", 0, 1000, "Sparade semesterdagar");
  if (!ok || !asOf) return;
  if (flexHours === undefined && left === undefined && saved === undefined) return;

  const b: ParsedBalances = { asOf };
  if (flexHours !== undefined) b.flexMinutes = Math.round(flexHours * 60);
  if (left !== undefined) b.vacationDaysLeft = left;
  if (saved !== undefined) b.savedVacationDays = saved;
  ctx.out.balances = b;
}

/** Mallversion from the hidden Listor sheet (D2), if the file has one. */
function templateVersion(XLSX: XLSXLib, wb: WorkBook): number | undefined {
  const name = findSheet(wb, SHEETS.lists);
  if (!name) return undefined;
  const rows = sheetRows(XLSX, wb, name);
  const head = rows[0]?.cells.map(normHeader) ?? [];
  const ci = head.indexOf(normHeader("Mallversion"));
  if (ci < 0) return undefined;
  const v = rows[1]?.cells[ci];
  const n = typeof v === "number" ? v : Number(cellText(v ?? null));
  return Number.isFinite(n) ? n : undefined;
}

// ─── Entry point ──────────────────────────────────────────────
export function emptyParsed(): ParsedWorkbook {
  return {
    sessions: [],
    absences: [],
    expenses: [],
    travel: [],
    balances: null,
    errors: [],
    duplicates: [],
    rows: { sessions: [], absences: [], expenses: [], travel: [] },
    skippedExamples: 0,
    sheetsFound: [],
  };
}

export async function parseWorkbook(file: WorkbookInput): Promise<ParsedWorkbook> {
  const out = emptyParsed();
  const fileError = (message: string) => {
    out.errors.push({ sheet: "Filen", row: 0, message });
    return out;
  };

  let XLSX: XLSXLib;
  let wb: WorkBook;
  try {
    XLSX = await loadXlsx();
    wb = XLSX.read(await toBytes(file), { type: "array", cellDates: false });
  } catch {
    return fileError(
      "Filen kunde inte läsas som en Excel-arbetsbok (.xlsx). Använd mallen och spara som .xlsx.",
    );
  }

  const version = templateVersion(XLSX, wb);
  if (version !== undefined && version > TEMPLATE_VERSION) {
    return fileError(
      `Mallen har version ${version}, men appen förstår version ${TEMPLATE_VERSION}. Uppdatera appen och försök igen.`,
    );
  }

  const ctx: Ctx = { out, push: (i) => out.errors.push(i) };

  const sessionsT = readTable(XLSX, wb, SHEETS.sessions, SESSION_HEADERS.slice(0, 3), out.errors);
  const absencesT = readTable(XLSX, wb, SHEETS.absences, ABSENCE_HEADERS.slice(0, 3), out.errors);
  const expensesT = readTable(XLSX, wb, SHEETS.expenses, EXPENSE_HEADERS.slice(0, 2), out.errors);
  const travelT = readTable(XLSX, wb, SHEETS.travel, TRAVEL_HEADERS.slice(0, 3), out.errors);
  const balanceSheet = findSheet(wb, SHEETS.balances);

  for (const name of [
    SHEETS.sessions,
    SHEETS.absences,
    SHEETS.expenses,
    SHEETS.travel,
    SHEETS.balances,
  ]) {
    const found = findSheet(wb, name);
    if (found) out.sheetsFound.push(found);
  }
  if (out.sheetsFound.length === 0) {
    return fileError(
      "Hittar inga flikar (Pass, Frånvaro, Utlägg, Restid, Saldon). Är det mallen du fyllt i? CSV fungerar inte.",
    );
  }

  if (sessionsT) parseSessions(sessionsT, ctx);
  if (absencesT) parseAbsences(absencesT, ctx);
  if (expensesT) parseExpenses(expensesT, ctx);
  if (travelT) parseTravel(travelT, ctx);
  if (balanceSheet) parseBalances(XLSX, wb, balanceSheet, ctx);

  // Keep the lists tidy: errors by sheet order is already natural; sort items by date.
  const order = <T>(items: T[], rows: number[], key: (t: T) => string) => {
    const idx = items
      .map((_, i) => i)
      .sort((a, b) => key(items[a]).localeCompare(key(items[b])) || rows[a] - rows[b]);
    return { items: idx.map((i) => items[i]), rows: idx.map((i) => rows[i]) };
  };
  const s = order(out.sessions, out.rows.sessions, (x) => String(x.checkIn).padStart(16, "0"));
  out.sessions = s.items;
  out.rows.sessions = s.rows;
  const a = order(out.absences, out.rows.absences, (x) => x.startDate);
  out.absences = a.items;
  out.rows.absences = a.rows;
  const e = order(out.expenses, out.rows.expenses, (x) => x.date);
  out.expenses = e.items;
  out.rows.expenses = e.rows;
  const t = order(out.travel, out.rows.travel, (x) => x.date + (x.from ?? ""));
  out.travel = t.items;
  out.rows.travel = t.rows;

  return out;
}
