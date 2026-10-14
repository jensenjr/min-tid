// "Att åtgärda": everything the user should look at, derived from the day evaluation.
// Pure — AttendCard only renders what this returns.
import { type DayConfig, addDaysStr, shiftMinutes } from "./schedule";
import { isYmd, monthRange, ymdLocal } from "./dates";
import { type DayContext } from "./days";
import { type FlexResult, computeFlex } from "./flex";
import { isMonthLocked } from "./confirm";
import type { ExpenseEntry, ReportingMode, Session } from "./types";

/** Receipts older than this many days stop nagging (the month is long gone). */
export const RECEIPT_LOOKBACK_DAYS = 62;
/** The "Bekräfta <månad>" prompt appears from this day of the month. */
export const CONFIRM_PROMPT_DAY = 25;

/**
 * A punch-out this long after the start is "meaningfully past the shift" (scheduled shift
 * + 4 h, 10 h floor), so the late-punchout sheet takes over from the normal check-out.
 */
export function lateThresholdMs(cfg: DayConfig): number {
  const shift = cfg.active ? shiftMinutes(cfg) : 0;
  return Math.max(10 * 60, shift + 4 * 60) * 60 * 1000;
}

export type MonthPrompt = {
  month: string; // YYYY-MM
  ready: boolean; // confirmMonth would accept it (no missing days)
  missingDays: string[];
  unconfirmedCount: number;
};

export type AttendSummary = {
  dayKind: ReportingMode; // "punch" lists missing days, "schedule" unconfirmed ones
  days: string[]; // newest first
  receipts: ExpenseEntry[]; // newest first
  longSessions: { session: Session; elapsedMin: number }[];
  monthPrompt: MonthPrompt | null;
  total: number; // number of things needing attention
};

export function buildAttend(input: {
  ctx: DayContext; // sessions, absences, schedule, lock/confirm state, ...
  expenses: ExpenseEntry[];
  /** Config of a session's start day, to size the "long session" threshold. */
  cfgFor: (date: string) => DayConfig;
  today: string;
  now: number;
  /** computeFlex(ctx) when the caller already has it, to avoid folding twice. */
  flexAll?: FlexResult;
}): AttendSummary {
  const { ctx, expenses, cfgFor, today, now } = input;
  const flexCtx: DayContext = { ...ctx, today, now };
  const all = input.flexAll ?? computeFlex(flexCtx);
  const dayKind: ReportingMode = ctx.reportingMode;
  const days = [...(dayKind === "punch" ? all.missingDays : all.unconfirmedDays)].sort((a, b) =>
    b.localeCompare(a),
  );

  const cutoff = addDaysStr(today, -RECEIPT_LOOKBACK_DAYS);
  const receipts = expenses
    .filter((e) => e.hasReceipt && e.date >= cutoff && !isMonthLocked(e.date.slice(0, 7), ctx))
    .sort((a, b) => b.date.localeCompare(a.date));

  const longSessions: AttendSummary["longSessions"] = [];
  for (const s of ctx.sessions) {
    if (s.checkOut !== null && s.checkOut !== undefined) continue;
    const elapsed = now - s.checkIn;
    if (elapsed > lateThresholdMs(cfgFor(ymdLocal(new Date(s.checkIn))))) {
      longSessions.push({ session: s, elapsedMin: Math.floor(elapsed / 60000) });
    }
  }

  const monthPrompt = buildMonthPrompt(flexCtx, today);
  const total =
    days.length + (receipts.length > 0 ? 1 : 0) + longSessions.length + (monthPrompt ? 1 : 0);
  return { dayKind, days, receipts, longSessions, monthPrompt, total };
}

/** From the 25th: offer to confirm and lock the running month. */
export function buildMonthPrompt(ctx: DayContext, today: string): MonthPrompt | null {
  if (!isYmd(ctx.trackingStartDate) || ctx.trackingStartDate > today) return null;
  if (Number(today.slice(8, 10)) < CONFIRM_PROMPT_DAY) return null;
  const month = today.slice(0, 7);
  if (isMonthLocked(month, ctx)) return null;
  const { first, last } = monthRange(month);
  const r = computeFlex({ ...ctx, today }, { from: first, to: last });
  return {
    month,
    ready: r.missingDays.length === 0,
    missingDays: r.missingDays,
    unconfirmedCount: r.unconfirmedDays.length,
  };
}
