// Names, headers and value lists of the import template (docs/min-tid-importmall.xlsx).
// The template is the source of truth: a test reads the hidden "Listor" sheet and the
// headers of the shipped file and compares them with this module.
import type { AbsenceCategory, ExpenseCategory } from "../types";

export const TEMPLATE_VERSION = 1;
export const TEMPLATE_FILENAME = "min-tid-importmall.xlsx";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const SHEETS = {
  instructions: "Instruktioner",
  sessions: "Pass",
  absences: "Frånvaro",
  expenses: "Utlägg",
  travel: "Restid",
  balances: "Saldon",
  lists: "Listor",
} as const;

export const SESSION_HEADERS = ["Datum", "Start", "Slut", "Rast (min)", "Kommentar"] as const;
export const ABSENCE_HEADERS = ["Från datum", "Till datum", "Typ", "Timmar", "Kommentar"] as const;
export const EXPENSE_HEADERS = [
  "Datum",
  "Typ",
  "Belopp (kr)",
  "Km",
  "Kvitto",
  "Kommentar",
] as const;
export const TRAVEL_HEADERS = ["Datum", "Från", "Till", "Resmål", "Kommentar"] as const;
export const BALANCE_HEADERS = ["Saldo", "Värde", "Förklaring"] as const;
export const BALANCE_LABELS = {
  asOf: "Per datum",
  flexHours: "Flexsaldo (timmar)",
  vacationLeft: "Semesterdagar kvar",
  vacationSaved: "Sparade semesterdagar",
} as const;

/** Rows with exactly this Kommentar are the template's examples and are skipped. */
export const EXAMPLE_COMMENT = "EXEMPEL – skriv över eller radera";

/** Absence types offered in the template's drop-down (Listor!A2:A9), in list order. */
export const ABSENCE_TYPE_LABELS = [
  ["Sjuk", "sjuk"],
  ["VAB", "vab"],
  ["Semester", "semester"],
  ["Föräldraledighet", "foraldraledighet"],
  ["Friskvård", "friskard"],
  ["Tjänsteledighet", "tjansteledighet"],
  ["Obetald ledighet", "obetald"],
  ["Flex", "flex"],
] as const satisfies readonly (readonly [string, AbsenceCategory])[];

/** Expense types offered in the template (Listor!B2:B8). "Resetimmar" is not an expense. */
export const EXPENSE_TYPE_LABELS = [
  ["Milersättning", "milersattning"],
  ["Traktamente", "traktamente"],
  ["Resetimmar", "resetimmar"],
  ["Parkering", "parkering"],
  ["Kost", "kost"],
  ["Representation", "representation"],
  ["Övrigt", "ovrigt"],
] as const satisfies readonly (readonly [string, ExpenseCategory])[];

export const RECEIPT_LABELS = ["Ja", "Nej"] as const;

const norm = (s: string) => s.trim().toLocaleLowerCase("sv-SE").replace(/\s+/g, " ");

const ABSENCE_BY_LABEL = new Map<string, AbsenceCategory>(
  ABSENCE_TYPE_LABELS.map(([label, cat]) => [norm(label), cat]),
);
const EXPENSE_BY_LABEL = new Map<string, ExpenseCategory>(
  EXPENSE_TYPE_LABELS.map(([label, cat]) => [norm(label), cat]),
);

/** Template label → category, or undefined for an unknown type (a row error, never a guess). */
export function absenceCategoryFromLabel(label: string): AbsenceCategory | undefined {
  return ABSENCE_BY_LABEL.get(norm(label));
}

export function expenseCategoryFromLabel(label: string): ExpenseCategory | undefined {
  return EXPENSE_BY_LABEL.get(norm(label));
}

/** Header match: case-insensitive, whitespace-trimmed. */
export function normHeader(s: unknown): string {
  return typeof s === "string" ? norm(s) : "";
}

/** True for the template's example marker (dash variants and spacing are tolerated). */
export function isExampleComment(comment: string | undefined): boolean {
  if (!comment) return false;
  const n = (s: string) => norm(s.replace(/[–—−]/g, "-"));
  return n(comment) === n(EXAMPLE_COMMENT);
}
