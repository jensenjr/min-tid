// Confirming ("Enligt schema"), month locking and the audit log. Pure: every function
// returns the new values; the caller (PunchClock) stores them.
//
// What "locked" means:
// - isDayLocked(date) is true for every day of a locked month. The UI must not let the
//   user edit sessions, absences, adjustments or confirmations on a locked day.
// - evaluateDay reads an unregistered scheduled day in a locked month as "reported" per
//   schedule (never missing/unconfirmed). Registered days keep their real values.
// - A month can be confirmed before it ends (the "Bekräfta oktober" prompt from the
//   25th): the past unconfirmed days are marked confirmed; the remaining days of the
//   month then read as per schedule once they have passed, unless something is
//   registered on them.
// - unlockMonth removes the lock and logs it. Confirmed days stay confirmed; days that
//   were only covered by the lock become missing/unconfirmed again.
import { addDaysStr } from "./schedule";
import { isYearMonth, isYmd, monthRange, todayLocal } from "./dates";
import {
  DEFAULT_AUTO_LUNCH_THRESHOLD_MIN,
  type DayContext,
  evaluateDay,
  isHm,
  resolveReportingMode,
  validBreak,
  validThreshold,
} from "./days";
import type { AuditAction, AuditEntry, DayAdjustment, LockedMonth, ReportingMode } from "./types";

type Locks = { lockedMonths?: Record<string, LockedMonth> };

export function isMonthLocked(month: string, state: Locks): boolean {
  return !!state.lockedMonths?.[month];
}

export function isDayLocked(date: string, state: Locks): boolean {
  return isMonthLocked(date.slice(0, 7), state);
}

function sortAudit(log: AuditEntry[]): AuditEntry[] {
  return [...log].sort((a, b) => a.at - b.at);
}

// ─── Single days ──────────────────────────────────────────────
type DayChange =
  | { ok: true; confirmedDays: Record<string, true> }
  | { ok: false; reason: "locked" };

/** "Enligt schema" for one day. */
export function confirmDay(
  date: string,
  state: Locks & { confirmedDays?: Record<string, true> },
): DayChange {
  if (isDayLocked(date, state)) return { ok: false, reason: "locked" };
  return { ok: true, confirmedDays: { ...(state.confirmedDays ?? {}), [date]: true } };
}

export function unconfirmDay(
  date: string,
  state: Locks & { confirmedDays?: Record<string, true> },
): DayChange {
  if (isDayLocked(date, state)) return { ok: false, reason: "locked" };
  const confirmedDays = { ...(state.confirmedDays ?? {}) };
  delete confirmedDays[date];
  return { ok: true, confirmedDays };
}

// ─── Months ───────────────────────────────────────────────────
export type ConfirmMonthResult =
  | {
      ok: true;
      confirmed: string[]; // days newly marked confirmed
      confirmedDays: Record<string, true>;
      lockedMonths: Record<string, LockedMonth>;
      auditLog: AuditEntry[];
    }
  | { ok: false; reason: "missing-days"; missingDays: string[] }
  | { ok: false; reason: "locked" | "future" | "invalid-month" };

/**
 * Confirm and lock a month ("YYYY-MM"). Every unconfirmed day up to today is marked
 * confirmed. Refuses while the month has missing days (punch mode), when it is already
 * locked, or when it has not started yet.
 */
export function confirmMonth(
  month: string,
  ctx: DayContext,
  opts: { at: number; by: string; auditLog?: AuditEntry[] },
): ConfirmMonthResult {
  if (!isYearMonth(month)) return { ok: false, reason: "invalid-month" };
  if (isMonthLocked(month, ctx)) return { ok: false, reason: "locked" };
  const today = ctx.today ?? todayLocal();
  const { first, last } = monthRange(month);
  if (first > today) return { ok: false, reason: "future" };

  const c: DayContext = { ...ctx, today, now: ctx.now ?? Date.now() };
  const end = last < today ? last : today;
  const confirmed: string[] = [];
  const missingDays: string[] = [];
  for (let d = first; d <= end; d = addDaysStr(d, 1)) {
    const { status } = evaluateDay(d, c, { explain: false });
    if (status === "unconfirmed") confirmed.push(d);
    else if (status === "missing") missingDays.push(d);
  }
  if (missingDays.length > 0) return { ok: false, reason: "missing-days", missingDays };

  const confirmedDays = { ...(ctx.confirmedDays ?? {}) };
  for (const d of confirmed) confirmedDays[d] = true;
  return {
    ok: true,
    confirmed,
    confirmedDays,
    lockedMonths: { ...(ctx.lockedMonths ?? {}), [month]: { at: opts.at, by: opts.by } },
    auditLog: sortAudit([...(opts.auditLog ?? []), { at: opts.at, action: "confirm", month }]),
  };
}

export type UnlockMonthResult =
  | { ok: true; lockedMonths: Record<string, LockedMonth>; auditLog: AuditEntry[] }
  | { ok: false; reason: "not-locked" };

export function unlockMonth(
  month: string,
  state: Locks & { auditLog?: AuditEntry[] },
  opts: { at: number },
): UnlockMonthResult {
  if (!isMonthLocked(month, state)) return { ok: false, reason: "not-locked" };
  const lockedMonths = { ...(state.lockedMonths ?? {}) };
  delete lockedMonths[month];
  return {
    ok: true,
    lockedMonths,
    auditLog: sortAudit([...(state.auditLog ?? []), { at: opts.at, action: "unlock", month }]),
  };
}

// ─── Persistence: load() / sync ───────────────────────────────
export type DayStatusState = {
  reportingMode: ReportingMode;
  autoLunchThresholdMin: number;
  confirmedDays: Record<string, true>;
  lockedMonths: Record<string, LockedMonth>;
  dayAdjustments: Record<string, DayAdjustment>;
  auditLog: AuditEntry[];
};

/** The raw (stored or synced) fields this module reads. Everything is untrusted. */
export type RawDayStatus = {
  reportingMode?: unknown;
  sessions?: unknown;
  autoLunchThresholdMin?: unknown;
  confirmedDays?: unknown;
  lockedMonths?: unknown;
  dayAdjustments?: unknown;
  auditLog?: unknown;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const AUDIT_ACTIONS: AuditAction[] = ["confirm", "unlock"];

function parseConfirmedDays(raw: unknown): Record<string, true> {
  const out: Record<string, true> = {};
  if (!isPlainObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (isYmd(k) && v === true) out[k] = true;
  return out;
}

function parseLockedMonths(raw: unknown): Record<string, LockedMonth> {
  const out: Record<string, LockedMonth> = {};
  if (!isPlainObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!isYearMonth(k) || !isPlainObject(v)) continue;
    if (typeof v.at !== "number" || !Number.isFinite(v.at)) continue;
    out[k] = { at: v.at, by: typeof v.by === "string" ? v.by : "" };
  }
  return out;
}

function parseDayAdjustments(raw: unknown): Record<string, DayAdjustment> {
  const out: Record<string, DayAdjustment> = {};
  if (!isPlainObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!isYmd(k) || !isPlainObject(v)) continue;
    const adj: DayAdjustment = { date: k };
    if (isHm(v.start)) adj.start = v.start;
    if (isHm(v.end)) adj.end = v.end;
    const breakMin = validBreak(v.breakMin);
    if (breakMin !== undefined) adj.breakMin = breakMin;
    if (typeof v.note === "string") adj.note = v.note;
    out[k] = adj;
  }
  return out;
}

function parseAuditLog(raw: unknown): AuditEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: AuditEntry[] = [];
  for (const e of raw) {
    if (!isPlainObject(e)) continue;
    if (typeof e.at !== "number" || !Number.isFinite(e.at)) continue;
    if (!AUDIT_ACTIONS.includes(e.action as AuditAction) || !isYearMonth(e.month)) continue;
    out.push({ at: e.at, action: e.action as AuditAction, month: e.month });
  }
  return sortAudit(out);
}

/**
 * Validate and default the day-status fields of a stored or synced state. Old data
 * (none of the fields) loads with empty defaults and the resolved reporting mode.
 */
export function migrateDayStatusState(raw: RawDayStatus): DayStatusState {
  return {
    reportingMode: resolveReportingMode(raw),
    autoLunchThresholdMin:
      validThreshold(raw.autoLunchThresholdMin) ?? DEFAULT_AUTO_LUNCH_THRESHOLD_MIN,
    confirmedDays: parseConfirmedDays(raw.confirmedDays),
    lockedMonths: parseLockedMonths(raw.lockedMonths),
    dayAdjustments: parseDayAdjustments(raw.dayAdjustments),
    auditLog: parseAuditLog(raw.auditLog),
  };
}

/**
 * Dirty-device sync merge: confirmed days and locked months are a union, adjustments a
 * union by date (local wins), the audit log a union by at+action+month (sorted). The
 * threshold is a local scalar. Reporting mode is merged by the caller.
 */
export function mergeDayStatusState(
  server: RawDayStatus,
  local: RawDayStatus,
): Omit<DayStatusState, "reportingMode"> {
  const auditByKey = new Map<string, AuditEntry>();
  for (const e of [...parseAuditLog(server.auditLog), ...parseAuditLog(local.auditLog)]) {
    auditByKey.set(`${e.at}|${e.action}|${e.month}`, e);
  }
  return {
    autoLunchThresholdMin:
      validThreshold(local.autoLunchThresholdMin) ??
      validThreshold(server.autoLunchThresholdMin) ??
      DEFAULT_AUTO_LUNCH_THRESHOLD_MIN,
    confirmedDays: {
      ...parseConfirmedDays(server.confirmedDays),
      ...parseConfirmedDays(local.confirmedDays),
    },
    lockedMonths: {
      ...parseLockedMonths(server.lockedMonths),
      ...parseLockedMonths(local.lockedMonths),
    },
    dayAdjustments: {
      ...parseDayAdjustments(server.dayAdjustments),
      ...parseDayAdjustments(local.dayAdjustments),
    },
    auditLog: sortAudit([...auditByKey.values()]),
  };
}
