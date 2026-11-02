// Date helpers. Day keys are always LOCAL calendar dates (YYYY-MM-DD) — never
// `toISOString().slice(0, 10)`, which rolls local midnight..02:00 back to the previous
// day in Sweden. Whole-day arithmetic on day keys lives in schedule.ts
// (`addDaysStr`, `mondayOfStr`), which is DST-safe.

// Local YYYY-MM-DD (avoids the UTC date-shift `toISOString` can cause near midnight).
export function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Today's local day key.
export function todayLocal(): string {
  return ymdLocal(new Date());
}

export function getWeekMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

// Local day key of the week's Monday.
export function weekKey(date: Date): string {
  return ymdLocal(getWeekMonday(date));
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isYmd(v: unknown): v is string {
  return typeof v === "string" && YMD_RE.test(v);
}

export function isYearMonth(v: unknown): v is string {
  return typeof v === "string" && YM_RE.test(v);
}

/** First and last day key of a "YYYY-MM" month. */
export function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** Local "HH:MM" of a timestamp. */
export function hmLocal(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
