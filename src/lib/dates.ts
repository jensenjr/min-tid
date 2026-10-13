// Date helpers. NOTE: several helpers deliberately keep the historic UTC-based
// `toISOString().slice(0, 10)` day keys (zero-behaviour-change extraction).

// Local YYYY-MM-DD (avoids the UTC date-shift `toISOString` can cause near midnight).
export function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Today's day key as used by the flex logic. Historic behaviour: UTC date.
export function todayLocal(): string {
  return new Date().toISOString().slice(0, 10);
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

export function weekKey(date: Date): string {
  return getWeekMonday(date).toISOString().slice(0, 10);
}
