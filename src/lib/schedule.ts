// ─── Types ────────────────────────────────────────────────────
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type DayConfig = {
  active: boolean;
  workMinutes: number;   // gross shift length including lunch
  lunchMinutes: number;  // amount to deduct (0 = no deduction)
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
  mon: { active: true,  workMinutes: 480, lunchMinutes: 45 },
  tue: { active: true,  workMinutes: 480, lunchMinutes: 45 },
  wed: { active: true,  workMinutes: 480, lunchMinutes: 45 },
  thu: { active: true,  workMinutes: 480, lunchMinutes: 45 },
  fri: { active: true,  workMinutes: 480, lunchMinutes: 45 },
  sat: { active: false, workMinutes: 480, lunchMinutes: 0  },
  sun: { active: false, workMinutes: 480, lunchMinutes: 0  },
};

// ─── Calculations ─────────────────────────────────────────────

/** Net scheduled minutes for one day (gross − lunch). */
export function netDayMin(cfg: DayConfig): number {
  return Math.max(0, cfg.workMinutes - cfg.lunchMinutes);
}

/** Total net minutes across the whole week. */
export function weeklyNetMin(s: WeekSchedule): number {
  return DAY_KEYS.reduce((sum, k) => sum + (s[k].active ? netDayMin(s[k]) : 0), 0);
}

/**
 * Apply lunch deduction for a recorded day.
 * Deducts lunchMinutes if the user worked at least (lunchMinutes + 3h).
 * This covers part-timers: a 30 min lunch requires 3h30 worked, a 1h lunch requires 4h worked.
 */
export function applyLunch(
  rawMin: number,
  cfg: DayConfig,
): { net: number; lunchDeducted: boolean } {
  if (cfg.lunchMinutes > 0 && rawMin > cfg.lunchMinutes + 180) {
    return { net: rawMin - cfg.lunchMinutes, lunchDeducted: true };
  }
  return { net: rawMin, lunchDeducted: false };
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

// ─── Preset lists (used in editors) ──────────────────────────
export const WORK_PRESETS: { label: string; value: number }[] = [
  { label: "2h",      value: 120 },
  { label: "3h",      value: 180 },
  { label: "4h",      value: 240 },
  { label: "5h",      value: 300 },
  { label: "6h",      value: 360 },
  { label: "6h 45min",value: 405 },
  { label: "7h",      value: 420 },
  { label: "7h 15min",value: 435 },
  { label: "7h 30min",value: 450 },
  { label: "7h 45min",value: 465 },
  { label: "8h",      value: 480 },
  { label: "8h 30min",value: 510 },
  { label: "9h",      value: 540 },
  { label: "10h",     value: 600 },
  { label: "12h",     value: 720 },
];

export const LUNCH_PRESETS: { label: string; value: number }[] = [
  { label: "Ingen",   value: 0  },
  { label: "15 min",  value: 15 },
  { label: "20 min",  value: 20 },
  { label: "30 min",  value: 30 },
  { label: "45 min",  value: 45 },
  { label: "60 min",  value: 60 },
  { label: "75 min",  value: 75 },
  { label: "90 min",  value: 90 },
];

/** Build a uniform schedule (same hours every active day). */
export function buildUniformSchedule(
  activeDays: Set<DayKey>,
  workMinutes: number,
  lunchMinutes: number,
): WeekSchedule {
  const base = {} as WeekSchedule;
  for (const k of DAY_KEYS) {
    const active = activeDays.has(k);
    base[k] = { active, workMinutes, lunchMinutes: active ? lunchMinutes : 0 };
  }
  return base;
}

/** Migrate old normHours (number) into a WeekSchedule. */
export function migrateNormHours(normHours: number): WeekSchedule {
  const wm = Math.round(normHours * 60);
  return {
    mon: { active: true,  workMinutes: wm, lunchMinutes: 45 },
    tue: { active: true,  workMinutes: wm, lunchMinutes: 45 },
    wed: { active: true,  workMinutes: wm, lunchMinutes: 45 },
    thu: { active: true,  workMinutes: wm, lunchMinutes: 45 },
    fri: { active: true,  workMinutes: wm, lunchMinutes: 45 },
    sat: { active: false, workMinutes: wm, lunchMinutes: 0  },
    sun: { active: false, workMinutes: wm, lunchMinutes: 0  },
  };
}
