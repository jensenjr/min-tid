// Cell value parsers for the import. Pure — no SheetJS here, only plain values
// (number | string | boolean | Date | null) as SheetJS hands them over with raw: true.
//
// Excel stores dates and times as numbers: days since 1899-12-30, with the time of day as
// the fraction. We convert by integer arithmetic on UTC so neither the machine's time zone
// nor DST can shift a date. Text cells ("2026-03-04", "08:00") are accepted too.
import { isYmd, ymdLocal } from "../dates";

export type CellValue = string | number | boolean | Date | null | undefined;
export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export const isEmptyCell = (v: CellValue): boolean =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

// Excel serial 36526 = 2000-01-01, 73415 = 2100-12-31 (the template's date validation).
const MIN_SERIAL = 36526;
const MAX_SERIAL = 73415;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function ymdFromUtcMs(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function isRealDate(ymd: string): boolean {
  if (!isYmd(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** A date cell → "YYYY-MM-DD". */
export function parseDateCell(v: CellValue): Parsed<string> {
  if (v instanceof Date) {
    // Only seen when a caller passes real Dates (the reader does not enable cellDates).
    if (Number.isNaN(v.getTime())) return { ok: false, message: "Ogiltigt datum" };
    return { ok: true, value: ymdLocal(v) };
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < MIN_SERIAL || v >= MAX_SERIAL + 1) {
      return { ok: false, message: "Ogiltigt datum – skriv ÅÅÅÅ-MM-DD" };
    }
    return { ok: true, value: ymdFromUtcMs(EXCEL_EPOCH_UTC + Math.floor(v) * 86_400_000) };
  }
  if (typeof v === "string") {
    const s = v.trim();
    const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(s);
    if (m) {
      const ymd = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      if (isRealDate(ymd)) return { ok: true, value: ymd };
    }
    return { ok: false, message: `Ogiltigt datum "${s}" – skriv ÅÅÅÅ-MM-DD` };
  }
  return { ok: false, message: "Ogiltigt datum – skriv ÅÅÅÅ-MM-DD" };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** A time cell → "HH:MM" (whole minutes; seconds are rounded away). */
export function parseTimeCell(v: CellValue): Parsed<string> {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return { ok: false, message: "Ogiltig tid – skriv TT:MM" };
    // A date-time cell keeps only its time of day. Round to whole minutes; 0.99999… → 24:00.
    const frac = v - Math.floor(v);
    const total = Math.round(frac * 1440);
    if (total >= 1440) return { ok: false, message: "Ogiltig tid – skriv TT:MM" };
    return { ok: true, value: `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}` };
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { ok: false, message: "Ogiltig tid – skriv TT:MM" };
    const total = v.getHours() * 60 + v.getMinutes();
    return { ok: true, value: `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}` };
  }
  if (typeof v === "string") {
    const s = v.trim();
    const m = /^(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/.exec(s);
    if (m) {
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (h <= 23 && min <= 59) return { ok: true, value: `${pad2(h)}:${pad2(min)}` };
    }
    return { ok: false, message: `Ogiltig tid "${s}" – skriv TT:MM, till exempel 08:00` };
  }
  return { ok: false, message: "Ogiltig tid – skriv TT:MM" };
}

/** A number cell; text with a decimal comma, spaces and "kr"/"h"/"km" suffixes is accepted. */
export function parseNumberCell(v: CellValue): Parsed<number> {
  if (typeof v === "number") {
    return Number.isFinite(v) ? { ok: true, value: v } : { ok: false, message: "Ogiltigt tal" };
  }
  if (typeof v === "string") {
    const cleaned = v
      .trim()
      .replace(/[\s ]/g, "")
      .replace(/(kr|sek|h|tim|km|min)$/i, "")
      .replace("−", "-")
      .replace(",", ".");
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return { ok: true, value: Number(cleaned) };
    return { ok: false, message: `Ogiltigt tal "${v.trim()}"` };
  }
  return { ok: false, message: "Ogiltigt tal" };
}

/** Text cell → trimmed string ("" when empty); numbers are shown as typed. */
export function cellText(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (v instanceof Date) return "";
  return String(v).trim();
}

/** "Ja"/"Nej" (and a few spellings) → boolean; empty → false. */
export function parseYesNo(v: CellValue): Parsed<boolean> {
  if (isEmptyCell(v)) return { ok: true, value: false };
  if (typeof v === "boolean") return { ok: true, value: v };
  if (typeof v === "number") {
    if (v === 1) return { ok: true, value: true };
    if (v === 0) return { ok: true, value: false };
  }
  const s = cellText(v).toLocaleLowerCase("sv-SE");
  if (["ja", "j", "yes", "y", "true", "x", "1"].includes(s)) return { ok: true, value: true };
  if (["nej", "n", "no", "false", "0"].includes(s)) return { ok: true, value: false };
  return { ok: false, message: `Kvitto ska vara Ja eller Nej, inte "${cellText(v)}"` };
}

/** The local timestamp of a day key + "HH:MM" (Europe/Stockholm in the app: the device's zone). */
export function localTimestamp(ymd: string, hm: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

/**
 * Does this wall-clock time exist on that day? In the spring DST gap (02:00–03:00 in
 * Sweden) `new Date()` silently moves the time an hour forward; that is a row error.
 */
export function localTimeExists(ymd: string, hm: string): boolean {
  const ts = new Date(localTimestamp(ymd, hm));
  return `${pad2(ts.getHours())}:${pad2(ts.getMinutes())}` === hm;
}
