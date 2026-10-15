// Pure helpers for TimeField. Values are "HH:MM". Typed times are taken exactly as
// written; only the device's own clock picker is snapped to 5-minute steps.

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const LAST_SLOT_MIN = 23 * 60 + 55;

export function parseHm(value: string | undefined | null): { h: number; m: number } | null {
  const match = HM_RE.exec(value ?? "");
  if (!match) return null;
  return { h: Number(match[1]), m: Number(match[2]) };
}

export function formatHm(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fromMinutes(total: number): string {
  const t = Math.max(0, Math.min(LAST_SLOT_MIN, total));
  return formatHm(Math.floor(t / 60), t % 60);
}

/** Nearest 5-minute step, carrying into the hour (16:58 → 17:00), never past 23:55. */
export function snapHm(h: number, m: number): string {
  return fromMinutes(Math.round((h * 60 + m) / 5) * 5);
}

/** Snap an "HH:MM" string (e.g. from the device's own picker); null if it isn't one. */
export function snapValue(value: string): string | null {
  const cur = parseHm(value);
  return cur ? snapHm(cur.h, cur.m) : null;
}

/**
 * Read what the user typed, exactly (no rounding). Accepts "1645", "16:45", "16.45",
 * "16,45", "16 45", "945" (09:45), "9" / "16" (whole hours) and "16:3" (16:30).
 * Returns "" for empty input and null when it can't be a time.
 */
export function parseTyped(text: string): string | null {
  const t = text.trim().replace(/[.,;\s]+/g, ":");
  if (t === "") return "";
  let h: number;
  let m: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{1,2}):(\d{1,2})$/.exec(t))) {
    h = Number(match[1]);
    m = match[2].length === 1 ? Number(match[2]) * 10 : Number(match[2]);
  } else if (/^\d{1,4}$/.test(t)) {
    if (t.length <= 2) {
      h = Number(t);
      m = 0;
    } else {
      h = Number(t.slice(0, t.length - 2));
      m = Number(t.slice(-2));
    }
  } else {
    return null;
  }
  if (h > 23 || m > 59) return null;
  return formatHm(h, m);
}

/** True once the typed text unambiguously names a full time ("1645", "9:45", "16:45"). */
export function isCompleteTyped(text: string): boolean {
  const t = text.trim().replace(/[.,;\s]+/g, ":");
  return /^\d{3,4}$/.test(t) || /^\d{1,2}:\d{2}$/.test(t);
}
