// ─── Types ────────────────────────────────────────────────────
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type DayConfig = {
  active: boolean;
  startTime: string;  // "HH:MM" 24-hour, e.g. "08:00"
  endTime: string;    // "HH:MM" 24-hour, e.g. "17:00"
};

export type WeekSchedule = Record<DayKey, DayConfig>;

// ─── Constants ────────────────────────────────────────────────
export const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const DAY_LABEL_LONG: Record<DayKey, string> = {
  mon: "Måndag", tue: "Tisdag", wed: "Onsdag", thu: "Torsdag",
  fri: "Fredag", sat: "Lördag", sun: "Söndag",
};

export const DAY_LABEL_SHORT: Record<DayKey, string> = {
  mon: "Mån", tue: "Tis", wed: "Ons", thu: "Tor",
  fri: "Fre", sat: "Lör", sun: "Sön",
};

// JS Date.getDay() (0 = Sun) → DayKey
const JS_TO_KEY: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export function dayKeyOf(date: Date): DayKey { return JS_TO_KEY[date.getDay()]; }

export const DEFAULT_SCHEDULE: WeekSchedule = {
  mon: { active: true,  startTime: "08:00", endTime: "17:00" },
  tue: { active: true,  startTime: "08:00", endTime: "17:00" },
  wed: { active: true,  startTime: "08:00", endTime: "17:00" },
  thu: { active: true,  startTime: "08:00", endTime: "17:00" },
  fri: { active: true,  startTime: "08:00", endTime: "17:00" },
  sat: { active: false, startTime: "08:00", endTime: "17:00" },
  sun: { active: false, startTime: "08:00", endTime: "17:00" },
};

// ─── Calculations ─────────────────────────────────────────────

/** Shift length in minutes (endTime − startTime). Never negative. */
export function shiftMinutes(cfg: DayConfig): number {
  const [sh, sm] = cfg.startTime.split(":").map(Number);
  const [eh, em] = cfg.endTime.split(":").map(Number);
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
}

/** Scheduled minutes for one day (0 if inactive). */
export function netDayMin(cfg: DayConfig): number {
  return cfg.active ? shiftMinutes(cfg) : 0;
}

/** Total scheduled minutes across the whole week. */
export function weeklyNetMin(s: WeekSchedule): number {
  return DAY_KEYS.reduce((sum, k) => sum + netDayMin(s[k]), 0);
}

/** Format minutes as "Xh Ymin" (or just "Ymin" / "Xh"). */
export function fmtMin(min: number): string {
  if (min <= 0) return "0min";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

/**
 * Add offsetMinutes to a base hour and return an "HH:MM" string.
 * Clamps to 23:59 to avoid wrapping past midnight.
 */
export function addMinutes(baseHour: number, offsetMinutes: number): string {
  const total = Math.min(baseHour * 60 + offsetMinutes, 23 * 60 + 59);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ─── Migration ────────────────────────────────────────────────

/** Migrate old normHours (number) into a WeekSchedule. */
export function migrateNormHours(normHours: number): WeekSchedule {
  // normHours was gross (e.g. 8.75h = 8h45min including lunch). Assume 08:00 start.
  const endTime = addMinutes(8, Math.round(normHours * 60));
  return {
    mon: { active: true,  startTime: "08:00", endTime },
    tue: { active: true,  startTime: "08:00", endTime },
    wed: { active: true,  startTime: "08:00", endTime },
    thu: { active: true,  startTime: "08:00", endTime },
    fri: { active: true,  startTime: "08:00", endTime },
    sat: { active: false, startTime: "08:00", endTime },
    sun: { active: false, startTime: "08:00", endTime },
  };
}

/**
 * Migrate a saved schedule from any previous format to the current one.
 *
 * Handles three formats:
 *   1. New format — { active, startTime, endTime } → pass through
 *   2. workMinutes/lunchMinutes format → reconstruct assuming 08:00 start,
 *      total shift = workMinutes + lunchMinutes
 *   3. workMinutes only (no lunchMinutes) → same but lunchMinutes = 0
 */
export function migrateSchedule(raw: Record<string, unknown>): WeekSchedule {
  const result = {} as WeekSchedule;
  for (const k of DAY_KEYS) {
    const day = raw[k] as Record<string, unknown> | undefined;
    if (!day) { result[k] = DEFAULT_SCHEDULE[k]; continue; }

    if (typeof day.startTime === "string" && typeof day.endTime === "string") {
      // Already current format
      result[k] = {
        active: Boolean(day.active),
        startTime: day.startTime,
        endTime: day.endTime,
      };
    } else {
      // Old workMinutes/lunchMinutes format — reconstruct shift window
      const active = Boolean(day.active);
      const workMinutes = Number(day.workMinutes) || 480;
      const lunchMinutes = Number(day.lunchMinutes) || 0;
      result[k] = {
        active,
        startTime: "08:00",
        endTime: addMinutes(8, workMinutes + lunchMinutes),
      };
    }
  }
  return result;
}
