// Pure helpers for the app's own 5-minute time picker (TimeField). Values are "HH:MM".

export const PICKER_HOURS: number[] = Array.from({ length: 24 }, (_, i) => i);
export const PICKER_MINUTES: number[] = Array.from({ length: 12 }, (_, i) => i * 5);

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseHm(value: string | undefined | null): { h: number; m: number } | null {
  const match = HM_RE.exec(value ?? "");
  if (!match) return null;
  return { h: Number(match[1]), m: Number(match[2]) };
}

export function formatHm(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Nearest 5-minute step, kept inside the hour (57 → 55, never 60). */
export function snapMinute(m: number): number {
  return Math.min(55, Math.round(m / 5) * 5);
}

/** Change the hour; the minute is kept (snapped to 5), or 00 if there was no value. */
export function withHour(value: string, h: number): string {
  const cur = parseHm(value);
  return formatHm(h, cur ? snapMinute(cur.m) : 0);
}

/** Change the minute; the hour is kept, or `fallbackHour` if there was no value. */
export function withMinute(value: string, m: number, fallbackHour = 8): string {
  const cur = parseHm(value);
  return formatHm(cur ? cur.h : fallbackHour, m);
}
