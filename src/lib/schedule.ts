import type { ScheduleException } from "./types";

// ─── Types ────────────────────────────────────────────────────
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type DayConfig = {
  active: boolean;
  startTime: string; // "HH:MM" 24-hour
  endTime: string; // "HH:MM" 24-hour
  lunchMinutes: number; // deducted from shift for net work time
};

export type WeekSchedule = Record<DayKey, DayConfig>;

// ─── Constants ────────────────────────────────────────────────
export const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const DAY_LABEL_LONG: Record<DayKey, string> = {
  mon: "Måndag",
  tue: "Tisdag",
  wed: "Onsdag",
  thu: "Torsdag",
  fri: "Fredag",
  sat: "Lördag",
  sun: "Söndag",
};

export const DAY_LABEL_SHORT: Record<DayKey, string> = {
  mon: "Mån",
  tue: "Tis",
  wed: "Ons",
  thu: "Tor",
  fri: "Fre",
  sat: "Lör",
  sun: "Sön",
};

const JS_TO_KEY: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export function dayKeyOf(date: Date): DayKey {
  return JS_TO_KEY[date.getDay()];
}

// Mon-Fri 08:00-17:00 with 1h lunch = 8h net — used as skip/default
export const DEFAULT_SCHEDULE: WeekSchedule = {
  mon: { active: true, startTime: "08:00", endTime: "17:00", lunchMinutes: 60 },
  tue: { active: true, startTime: "08:00", endTime: "17:00", lunchMinutes: 60 },
  wed: { active: true, startTime: "08:00", endTime: "17:00", lunchMinutes: 60 },
  thu: { active: true, startTime: "08:00", endTime: "17:00", lunchMinutes: 60 },
  fri: { active: true, startTime: "08:00", endTime: "17:00", lunchMinutes: 60 },
  sat: { active: false, startTime: "08:00", endTime: "17:00", lunchMinutes: 0 },
  sun: { active: false, startTime: "08:00", endTime: "17:00", lunchMinutes: 0 },
};

// ─── Calculations ─────────────────────────────────────────────

/** Gross shift length in minutes (endTime − startTime). */
export function shiftMinutes(cfg: DayConfig): number {
  const [sh, sm] = cfg.startTime.split(":").map(Number);
  const [eh, em] = cfg.endTime.split(":").map(Number);
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

/** Net worked minutes for one day (shift − lunch). 0 if inactive. */
export function netDayMin(cfg: DayConfig): number {
  return cfg.active ? Math.max(0, shiftMinutes(cfg) - cfg.lunchMinutes) : 0;
}

/** Total net minutes across the whole week. */
export function weeklyNetMin(s: WeekSchedule): number {
  return DAY_KEYS.reduce((sum, k) => sum + netDayMin(s[k]), 0);
}

/** Format minutes as "Xh Ymin" / "Xh" / "Ymin". */
export function fmtMin(min: number): string {
  if (min <= 0) return "0min";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

/** Add offsetMinutes to a base hour, return "HH:MM". Clamps at 23:59. */
export function addMinutes(baseHour: number, offsetMinutes: number): string {
  const total = Math.min(baseHour * 60 + offsetMinutes, 23 * 60 + 59);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ─── Migration ────────────────────────────────────────────────

export function migrateNormHours(normHours: number): WeekSchedule {
  const endTime = addMinutes(8, Math.round(normHours * 60));
  return {
    mon: { active: true, startTime: "08:00", endTime, lunchMinutes: 60 },
    tue: { active: true, startTime: "08:00", endTime, lunchMinutes: 60 },
    wed: { active: true, startTime: "08:00", endTime, lunchMinutes: 60 },
    thu: { active: true, startTime: "08:00", endTime, lunchMinutes: 60 },
    fri: { active: true, startTime: "08:00", endTime, lunchMinutes: 60 },
    sat: { active: false, startTime: "08:00", endTime, lunchMinutes: 0 },
    sun: { active: false, startTime: "08:00", endTime, lunchMinutes: 0 },
  };
}

/**
 * Migrate a saved schedule from any previous format.
 * 1. New format (startTime/endTime/lunchMinutes) — pass through
 * 2. New format without lunchMinutes — default to 0
 * 3. Old workMinutes/lunchMinutes — reconstruct shift window assuming 08:00 start
 */
export function migrateSchedule(raw: Record<string, unknown>): WeekSchedule {
  const result = {} as WeekSchedule;
  for (const k of DAY_KEYS) {
    const day = raw[k] as Record<string, unknown> | undefined;
    if (!day) {
      result[k] = DEFAULT_SCHEDULE[k];
      continue;
    }

    if (typeof day.startTime === "string" && typeof day.endTime === "string") {
      result[k] = {
        active: Boolean(day.active),
        startTime: day.startTime,
        endTime: day.endTime,
        lunchMinutes: typeof day.lunchMinutes === "number" ? day.lunchMinutes : 0,
      };
    } else {
      // Old workMinutes/lunchMinutes format
      const workMinutes = Number(day.workMinutes) || 480;
      const lunchMinutes = Number(day.lunchMinutes) || 0;
      result[k] = {
        active: Boolean(day.active),
        startTime: "08:00",
        endTime: addMinutes(8, workMinutes + lunchMinutes),
        lunchMinutes,
      };
    }
  }
  return result;
}

// ─── Rotation & schedule periods ──────────────────────────────

/** A repeating cycle of 1–MAX_ROTATION_WEEKS weekly schedules. */
export type ScheduleRotation = { weeks: WeekSchedule[] };

/**
 * One norm that applies from `validFrom` until the next period starts. `anchorMonday`
 * is the Monday of a week that is rotation week 1 (index 0); any Monday of the right
 * phase works, including one after `validFrom`.
 */
export type SchedulePeriod = {
  validFrom: string; // YYYY-MM-DD (local), first day this period applies
  anchorMonday: string; // YYYY-MM-DD (local), must be a Monday
  rotation: ScheduleRotation;
};

/** Anything the day-config lookup accepts: one plain week (valid forever) or periods. */
export type ScheduleSource = WeekSchedule | SchedulePeriod[];

export const MAX_ROTATION_WEEKS = 8;
/** validFrom of the period migrated from the old single `schedule` when there is no start date. */
export const LEGACY_VALID_FROM = "2000-01-01";
// A plain WeekSchedule is "valid forever": it sorts before every real date.
const ALWAYS_FROM = "0000-01-01";
const ANCHOR_FALLBACK = "2000-01-03"; // a Monday

const DAY_MS = 86_400_000;

/** Mathematical modulo — always in [0, m), also for negative n. */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

// Calendar math runs on whole-day numbers derived from Date.UTC(y, m, d), so DST can
// never shift a day — inputs/outputs are plain local YYYY-MM-DD strings.
function dayNumber(dateStr: string): number {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromDayNumber(n: number): string {
  const d = new Date(n * DAY_MS);
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday-based weekday index of a YYYY-MM-DD date (mon = 0 … sun = 6). */
function weekdayIndex(dateStr: string): number {
  return mod(dayNumber(dateStr) + 3, 7); // 1970-01-01 was a Thursday
}

/** Add whole days to a YYYY-MM-DD date (DST-safe). */
export function addDaysStr(dateStr: string, days: number): string {
  return fromDayNumber(dayNumber(dateStr) + days);
}

/** The Monday (YYYY-MM-DD) of the week containing the given local date. */
export function mondayOfStr(dateStr: string): string {
  return addDaysStr(dateStr, -weekdayIndex(dateStr));
}

/** Whole weeks from one Monday to another (negative when `toMonday` is earlier). */
export function weeksBetween(fromMonday: string, toMonday: string): number {
  return Math.round((dayNumber(toMonday) - dayNumber(fromMonday)) / 7);
}

/** Wrap a single week as a one-week period. */
export function periodFromWeek(
  week: WeekSchedule,
  validFrom = LEGACY_VALID_FROM,
  anchorMonday?: string,
): SchedulePeriod {
  return {
    validFrom,
    anchorMonday: anchorMonday ?? mondayOfStr(validFrom),
    rotation: { weeks: [week] },
  };
}

function byValidFrom(a: SchedulePeriod, b: SchedulePeriod): number {
  return a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0;
}

/** Periods sorted by validFrom. Returns the input itself when it already is sorted. */
function sortedByValidFrom(periods: SchedulePeriod[]): SchedulePeriod[] {
  for (let i = 1; i < periods.length; i++) {
    if (periods[i - 1].validFrom > periods[i].validFrom) return [...periods].sort(byValidFrom);
  }
  return periods;
}

/**
 * Normalise any ScheduleSource to a sorted, non-empty period list. A plain WeekSchedule
 * becomes a single one-week period that is valid forever.
 */
export function toPeriods(source: ScheduleSource): SchedulePeriod[] {
  if (Array.isArray(source)) {
    return source.length > 0
      ? sortedByValidFrom(source)
      : [periodFromWeek(DEFAULT_SCHEDULE, ALWAYS_FROM, ANCHOR_FALLBACK)];
  }
  return [periodFromWeek(source, ALWAYS_FROM, ANCHOR_FALLBACK)];
}

/**
 * The period in force on a date: the last one with validFrom <= date. A date before the
 * first period uses the first period (history keeps the oldest norm we know of).
 */
export function periodFor(source: ScheduleSource, dateStr: string): SchedulePeriod {
  const periods = toPeriods(source);
  let found = periods[0];
  for (const p of periods) {
    if (p.validFrom <= dateStr) found = p;
    else break;
  }
  return found;
}

/** 0-based rotation week index for a date within a period (positive modulo before the anchor). */
export function rotationWeekIndex(period: SchedulePeriod, dateStr: string): number {
  const n = period.rotation.weeks.length;
  return mod(weeksBetween(period.anchorMonday, mondayOfStr(dateStr)), n);
}

/** "Vecka X av N" data for the week containing a date (`week` is 1-based). */
export function rotationPosition(
  source: ScheduleSource,
  dateStr: string,
): { week: number; total: number; period: SchedulePeriod } {
  const period = periodFor(source, dateStr);
  return {
    week: rotationWeekIndex(period, dateStr) + 1,
    total: period.rotation.weeks.length,
    period,
  };
}

/** The WeekSchedule that applies to the week containing a date. */
export function weekScheduleFor(source: ScheduleSource, dateStr: string): WeekSchedule {
  const period = periodFor(source, dateStr);
  return period.rotation.weeks[rotationWeekIndex(period, dateStr)];
}

/** Net norm minutes of the week containing a date. */
export function weeklyNetMinFor(source: ScheduleSource, dateStr: string): number {
  return weeklyNetMin(weekScheduleFor(source, dateStr));
}

/**
 * The schedule for a date: the period in force → its rotation week → the weekday.
 * A schedule exception (company-wide shortened day etc.) overrides endTime/lunch on top.
 * A plain WeekSchedule behaves as before (one week, valid forever).
 */
export function getEffectiveDayConfig(
  dateStr: string,
  schedule: ScheduleSource,
  exceptions: Record<string, ScheduleException> = {},
): DayConfig {
  const period = periodFor(schedule, dateStr);
  const week = period.rotation.weeks[rotationWeekIndex(period, dateStr)];
  const base = week[DAY_KEYS[weekdayIndex(dateStr)]];
  const exc = exceptions[dateStr];
  if (!exc) return base;
  return {
    ...base,
    endTime: exc.endTime,
    lunchMinutes: exc.lunchMinutes ?? base.lunchMinutes,
  };
}

/**
 * Add a period, replacing any existing one with the same validFrom, keeping the list
 * sorted. Earlier periods are never touched, so history keeps its old norm.
 */
export function appendPeriod(periods: SchedulePeriod[], next: SchedulePeriod): SchedulePeriod[] {
  return [...periods.filter((p) => p.validFrom !== next.validFrom), next].sort(byValidFrom);
}

/** Union by validFrom (local wins on collision), sorted. Used by the sync merge. */
export function mergePeriods(server: SchedulePeriod[], local: SchedulePeriod[]): SchedulePeriod[] {
  const byFrom = new Map<string, SchedulePeriod>();
  for (const p of server) byFrom.set(p.validFrom, p);
  for (const p of local) byFrom.set(p.validFrom, p);
  return [...byFrom.values()].sort(byValidFrom);
}

/**
 * The single WeekSchedule a pre-rotation build understands: week 1 of the period in
 * force on `today`. Written next to `schedules` so rolling back to an older build works.
 */
export function legacyScheduleOf(periods: SchedulePeriod[], today: string): WeekSchedule {
  return periodFor(periods, today).rotation.weeks[0];
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate persisted/synced periods. Returns null when the value is not a usable,
 * non-empty list. Weeks go through migrateSchedule; anchors are snapped to a Monday.
 */
export function parsePeriods(raw: unknown): SchedulePeriod[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SchedulePeriod[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const rot = p.rotation as { weeks?: unknown } | undefined;
    if (typeof p.validFrom !== "string" || !YMD_RE.test(p.validFrom)) continue;
    if (!rot || !Array.isArray(rot.weeks) || rot.weeks.length === 0) continue;
    const weeks = rot.weeks
      .slice(0, MAX_ROTATION_WEEKS)
      .map((w) =>
        migrateSchedule((w && typeof w === "object" ? w : {}) as Record<string, unknown>),
      );
    out.push({
      validFrom: p.validFrom,
      anchorMonday:
        typeof p.anchorMonday === "string" && YMD_RE.test(p.anchorMonday)
          ? mondayOfStr(p.anchorMonday)
          : mondayOfStr(p.validFrom),
      rotation: { weeks },
    });
  }
  return out.length > 0 ? mergePeriods([], out) : null;
}

/**
 * Build the period list from raw persisted state (localStorage or a synced payload):
 * `schedules` if present, else the old single `schedule` (or `normHours`) becomes one
 * period valid from trackingStartDate (or LEGACY_VALID_FROM).
 */
export function migrateSchedules(raw: {
  schedules?: unknown;
  schedule?: unknown;
  normHours?: unknown;
  trackingStartDate?: string;
}): SchedulePeriod[] {
  const periods = parsePeriods(raw.schedules);
  if (periods) return periods;
  let week: WeekSchedule;
  if (raw.schedule && typeof raw.schedule === "object") {
    week = migrateSchedule(raw.schedule as Record<string, unknown>);
  } else if (typeof raw.normHours === "number" && raw.normHours) {
    week = migrateNormHours(raw.normHours);
  } else {
    week = DEFAULT_SCHEDULE;
  }
  return [periodFromWeek(week, raw.trackingStartDate ?? LEGACY_VALID_FROM)];
}
