// ─── Types ────────────────────────────────────────────────────
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type DayConfig = {
  active: boolean;
  startTime: string;    // "HH:MM" 24-hour
  endTime: string;      // "HH:MM" 24-hour
  lunchMinutes: number; // deducted from shift for net work time
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

const JS_TO_KEY: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export function dayKeyOf(date: Date): DayKey { return JS_TO_KEY[date.getDay()]; }

// Mon-Fri 08:00-17:00 with 1h lunch = 8h net — used as skip/default
export const DEFAULT_SCHEDULE: WeekSchedule = {
  mon: { active: true,  startTime: "08:00", endTime: "17:00", lunchMinutes: 60 },
  tue: { active: true,  startTime: "08:00", endTime: "17:00", lunchMinutes: 60 },
  wed: { active: true,  startTime: "08:00", endTime: "17:00", lunchMinutes: 60 },
  thu: { active: true,  startTime: "08:00", endTime: "17:00", lunchMinutes: 60 },
  fri: { active: true,  startTime: "08:00", endTime: "17:00", lunchMinutes: 60 },
  sat: { active: false, startTime: "08:00", endTime: "17:00", lunchMinutes: 0 },
  sun: { active: false, startTime: "08:00", endTime: "17:00", lunchMinutes: 0 },
};

// ─── Calculations ─────────────────────────────────────────────

/** Gross shift length in minutes (endTime − startTime). */
export function shiftMinutes(cfg: DayConfig): number {
  const [sh, sm] = cfg.startTime.split(":").map(Number);
  const [eh, em] = cfg.endTime.split(":").map(Number);
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
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
    mon: { active: true,  startTime: "08:00", endTime, lunchMinutes: 60 },
    tue: { active: true,  startTime: "08:00", endTime, lunchMinutes: 60 },
    wed: { active: true,  startTime: "08:00", endTime, lunchMinutes: 60 },
    thu: { active: true,  startTime: "08:00", endTime, lunchMinutes: 60 },
    fri: { active: true,  startTime: "08:00", endTime, lunchMinutes: 60 },
    sat: { active: false, startTime: "08:00", endTime, lunchMinutes: 0  },
    sun: { active: false, startTime: "08:00", endTime, lunchMinutes: 0  },
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
    if (!day) { result[k] = DEFAULT_SCHEDULE[k]; continue; }

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
