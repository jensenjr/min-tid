// ─── Types ────────────────────────────────────────────────────
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type DayConfig = {
  active: boolean;
  workMinutes: number;   // net worked time (what the user actually works)
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
  mon: { active: true,  workMinutes: 480 },
  tue: { active: true,  workMinutes: 480 },
  wed: { active: true,  workMinutes: 480 },
  thu: { active: true,  workMinutes: 480 },
  fri: { active: true,  workMinutes: 480 },
  sat: { active: false, workMinutes: 480 },
  sun: { active: false, workMinutes: 480 },
};

// ─── Calculations ─────────────────────────────────────────────

/** Scheduled minutes for one day. workMinutes is already the net worked time. */
export function netDayMin(cfg: DayConfig): number {
  return cfg.workMinutes;
}

/** Total net minutes across the whole week. */
export function weeklyNetMin(s: WeekSchedule): number {
  return DAY_KEYS.reduce((sum, k) => sum + (s[k].active ? netDayMin(s[k]) : 0), 0);
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

/** Build a uniform schedule (same hours every active day). */
export function buildUniformSchedule(
  activeDays: Set<DayKey>,
  workMinutes: number,
): WeekSchedule {
  const base = {} as WeekSchedule;
  for (const k of DAY_KEYS) {
    base[k] = { active: activeDays.has(k), workMinutes };
  }
  return base;
}

/** Migrate old normHours (number) into a WeekSchedule. */
export function migrateNormHours(normHours: number): WeekSchedule {
  const wm = Math.round(normHours * 60);
  return {
    mon: { active: true,  workMinutes: wm },
    tue: { active: true,  workMinutes: wm },
    wed: { active: true,  workMinutes: wm },
    thu: { active: true,  workMinutes: wm },
    fri: { active: true,  workMinutes: wm },
    sat: { active: false, workMinutes: wm },
    sun: { active: false, workMinutes: wm },
  };
}

/**
 * Migrate a saved schedule that may still contain the old lunchMinutes field.
 * Since workMinutes was previously gross (including lunch), we subtract lunchMinutes
 * so the stored value becomes net worked time matching the new model.
 */
export function migrateSchedule(raw: Record<string, unknown>): WeekSchedule {
  const result = {} as WeekSchedule;
  for (const k of DAY_KEYS) {
    const day = raw[k] as Record<string, unknown> | undefined;
    if (!day) { result[k] = DEFAULT_SCHEDULE[k]; continue; }
    const active = Boolean(day.active);
    const workMinutes = Number(day.workMinutes) || 480;
    const lunchMinutes = Number(day.lunchMinutes) || 0;
    // Old model stored gross; subtract lunch to get net
    result[k] = { active, workMinutes: Math.max(0, workMinutes - lunchMinutes) };
  }
  return result;
}
