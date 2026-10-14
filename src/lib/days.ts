// One day, evaluated: the single source of truth for status, worked time and flex.
// flex.ts folds over evaluateDay; the calendar, the report and the confirm flow read it.
//
// Rules (see CLAUDE.md "Flex bank" for the full table):
// - Day keys are LOCAL dates. A session belongs to the local day of its check-in.
// - Session time is counted in whole minutes as displayed (seconds are ignored).
// - Break: if any session of the day (or the adjustment) carries a break, that is used.
//   Otherwise the schedule lunch is deducted only when the day has exactly one session
//   and it is longer than `autoLunchThresholdMin` (default 300). Several sessions = the
//   user punched out over lunch → nothing is deducted.
// - flexDelta = worked − (norm − excused absence). A flex absence is "not worked" time
//   that the bank pays for, so it is never deducted on top (it was counted twice before).
// - Precedence for what was worked: open session (ongoing) > adjustment > completed
//   sessions > "Enligt schema" (confirmed day or locked month) > nothing registered.
// - Nothing registered on a scheduled day: punch mode → "missing", schedule mode →
//   "unconfirmed" (worked per schedule). Both leave flex untouched except for a flex
//   absence on that day. Today stays "ongoing" until the scheduled end of the shift.
// - Future days and days before trackingStartDate never change flex.
import { type DayConfig, getEffectiveDayConfig, netDayMin } from "./schedule";
import { hmLocal, todayLocal, ymdLocal } from "./dates";
import { ABSENCE_LABEL, absenceForDay, getAbsencesForDate } from "./absence";
import type {
  AbsenceEntry,
  DayAdjustment,
  LockedMonth,
  ReportingMode,
  ScheduleException,
  Session,
} from "./types";

export { getAbsencesForDate }; // moved to absence.ts; re-exported for existing imports

export const DEFAULT_AUTO_LUNCH_THRESHOLD_MIN = 300;

export type DayStatus =
  | "missing" // punch mode: scheduled, past, nothing registered
  | "unconfirmed" // schedule mode: scheduled, past, nothing registered → per schedule
  | "ongoing" // open session, or today before the end of the shift
  | "reported" // worked time is known (sessions, adjustment, confirmed, locked month)
  | "absent" // absence covers the whole norm
  | "partial" // absence covers part of the norm, the rest is known
  | "off"; // not a working day, future, or before trackingStartDate

/**
 * What the `travelFor` hook returns (see travel.ts `makeTravelFor`). payrollMin/flexMin
 * are what the outside minutes are worth after factor, cap and routing.
 */
export type TravelMinutes = {
  inScheduleMin: number;
  outsideMin: number;
  payrollMin?: number;
  flexMin?: number;
};

/** `DayEvaluation.travel`: all four numbers, 0 when there is no travel. */
export type DayTravel = Required<TravelMinutes>;

export type DayContext = {
  sessions: Session[];
  absences: AbsenceEntry[];
  /** Whatever getEffectiveDayConfig accepts (a WeekSchedule or SchedulePeriod[]). */
  schedule: Parameters<typeof getEffectiveDayConfig>[1];
  exceptions?: Record<string, ScheduleException>;
  reportingMode: ReportingMode;
  trackingStartDate?: string;
  /**
   * An opening flex balance (AppState.flexBaseMinutes) is the balance at the END of this day,
   * so the day itself and everything before it is already inside it: flexDelta is 0 for
   * date <= flexBaseDate (worked time and norm are untouched).
   */
  flexBaseDate?: string;
  /** Local day key of "today". Defaults to todayLocal(). */
  today?: string;
  /** Current time in ms. Defaults to Date.now(). */
  now?: number;
  autoLunchThresholdMin?: number;
  confirmedDays?: Record<string, true>;
  lockedMonths?: Record<string, LockedMonth>;
  dayAdjustments?: Record<string, DayAdjustment>;
  /**
   * Travel time (travel.ts). Whatever it returns is passed through in `travel`.
   * `flexMin` is added to flexDelta on every day that counts; `inScheduleMin` and
   * `payrollMin` never are (see evaluateDay).
   */
  travelFor?: (date: string, cfg: DayConfig) => TravelMinutes | undefined;
};

export type DayEvaluation = {
  status: DayStatus;
  normMin: number; // scheduled net norm (before absence)
  workedMin: number; // counted work (per schedule for unconfirmed/confirmed days)
  breakMin: number;
  absence: { flexMin: number; excusedMin: number };
  travel: DayTravel;
  flexDelta: number;
  explanation: string[]; // Swedish, one line each ("Så räknades dagen")
};

// ─── Formatting (Swedish) ─────────────────────────────────────
export function fmtDuration(min: number): string {
  const total = Math.round(Math.abs(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function fmtSignedDuration(min: number): string {
  const r = Math.round(min);
  if (r === 0) return "0 min";
  return `${r > 0 ? "+" : "−"}${fmtDuration(r)}`;
}

// ─── Settings helpers ─────────────────────────────────────────
export function isReportingMode(v: unknown): v is ReportingMode {
  return v === "schedule" || v === "punch";
}

/**
 * The reporting mode for a stored or synced state: a stored value always wins; otherwise
 * existing users who have sessions keep punching ('punch') and everyone else starts with
 * 'schedule'. load() persists the result so it never flips later.
 */
export function resolveReportingMode(state: {
  reportingMode?: unknown;
  sessions?: unknown;
}): ReportingMode {
  if (isReportingMode(state.reportingMode)) return state.reportingMode;
  return Array.isArray(state.sessions) && state.sessions.length > 0 ? "punch" : "schedule";
}

export function validThreshold(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
}

export function validBreak(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
}

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export function isHm(v: unknown): v is string {
  return typeof v === "string" && HM_RE.test(v);
}

function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

// ─── Sessions ─────────────────────────────────────────────────
export function sessionDayKey(s: Session): string {
  return ymdLocal(new Date(s.checkIn));
}

// Sessions grouped by local day, cached per array (state arrays are replaced, not
// mutated; the length check guards against an in-place push).
const dayIndex = new WeakMap<Session[], { len: number; byDay: Map<string, Session[]> }>();

export function sessionsOn(sessions: Session[], date: string): Session[] {
  let idx = dayIndex.get(sessions);
  if (!idx || idx.len !== sessions.length) {
    const byDay = new Map<string, Session[]>();
    for (const s of sessions) {
      if (!s || typeof s.checkIn !== "number" || !Number.isFinite(s.checkIn)) continue;
      const d = sessionDayKey(s);
      const list = byDay.get(d);
      if (list) list.push(s);
      else byDay.set(d, [s]);
    }
    idx = { len: sessions.length, byDay };
    dayIndex.set(sessions, idx);
  }
  return idx.byDay.get(date) ?? [];
}

const minuteOf = (ms: number) => Math.floor(ms / 60_000);

function isOpen(s: Session): boolean {
  return s.checkOut === null || s.checkOut === undefined;
}

function sessionMinutes(s: Session, now: number): number {
  const end = isOpen(s) ? now : (s.checkOut as number);
  return Math.max(0, minuteOf(end) - minuteOf(s.checkIn));
}

export type BreakRule = "registered" | "auto-lunch" | "punched-out" | "short" | "none";

/** Worked minutes for a set of sessions on one day, with the break rule applied. */
export function workedFromSessions(
  sessions: Session[],
  cfg: DayConfig,
  thresholdMin: number,
  now: number,
): { rawMin: number; breakMin: number; workedMin: number; rule: BreakRule } {
  let rawMin = 0;
  for (const s of sessions) rawMin += sessionMinutes(s, now);
  let breakMin = 0;
  let rule: BreakRule;
  if (sessions.some((s) => validBreak(s.breakMinutes) !== undefined)) {
    rule = "registered";
    for (const s of sessions) breakMin += validBreak(s.breakMinutes) ?? 0;
  } else if (sessions.length === 1 && rawMin > thresholdMin) {
    rule = "auto-lunch";
    breakMin = Math.max(0, cfg.lunchMinutes || 0);
  } else if (sessions.length > 1) {
    rule = "punched-out";
  } else {
    rule = sessions.length === 1 ? "short" : "none";
  }
  return { rawMin, breakMin, workedMin: Math.max(0, rawMin - breakMin), rule };
}

/**
 * Net minutes for a list of sessions (open ones count up to now) — the history/report
 * view. Same break rule as evaluateDay.
 */
export function computeDayMinutes(
  sessions: Session[],
  dateStr: string,
  schedule: Parameters<typeof getEffectiveDayConfig>[1],
  exceptions: Record<string, ScheduleException> = {},
  autoLunchThresholdMin = DEFAULT_AUTO_LUNCH_THRESHOLD_MIN,
) {
  const cfg = getEffectiveDayConfig(dateStr, schedule, exceptions);
  const w = workedFromSessions(
    sessions,
    cfg,
    validThreshold(autoLunchThresholdMin) ?? DEFAULT_AUTO_LUNCH_THRESHOLD_MIN,
    Date.now(),
  );
  return { raw: w.rawMin, net: w.workedMin, breakMin: w.breakMin, cfg };
}

// ─── Adjustments ──────────────────────────────────────────────
type AdjustedWork = {
  start: string;
  end: string;
  workedMin: number;
  breakMin: number;
  rule: BreakRule;
};

/**
 * Worked time per a "Justera dag" adjustment. Missing times fall back to the schedule on
 * a scheduled day; on a day off both are required (otherwise the adjustment is ignored).
 * A missing break follows the auto-lunch rule as if the span were one session.
 */
function adjustedWork(
  adj: DayAdjustment,
  cfg: DayConfig,
  scheduled: boolean,
  thresholdMin: number,
): AdjustedWork | null {
  const start = isHm(adj.start) ? adj.start : scheduled ? cfg.startTime : undefined;
  const end = isHm(adj.end) ? adj.end : scheduled ? cfg.endTime : undefined;
  if (!start || !end) return null;
  const span = Math.max(0, hmToMin(end) - hmToMin(start));
  const registered = validBreak(adj.breakMin);
  let breakMin = 0;
  let rule: BreakRule = "short";
  if (registered !== undefined) {
    breakMin = registered;
    rule = "registered";
  } else if (span > thresholdMin) {
    breakMin = Math.max(0, cfg.lunchMinutes || 0);
    rule = "auto-lunch";
  }
  return { start, end, workedMin: Math.max(0, span - breakMin), breakMin, rule };
}

// ─── Explanation lines ────────────────────────────────────────
function normLine(cfg: DayConfig, normMin: number): string {
  const lunch = cfg.lunchMinutes > 0 ? `lunch ${fmtDuration(cfg.lunchMinutes)}` : "ingen lunch";
  return `Norm ${fmtDuration(normMin)} (${cfg.startTime}–${cfg.endTime}, ${lunch})`;
}

function breakLine(rule: BreakRule, breakMin: number, thresholdMin: number): string | null {
  switch (rule) {
    case "registered":
      return `Rast ${fmtDuration(breakMin)} (registrerad)`;
    case "auto-lunch":
      return breakMin > 0
        ? `Lunch ${fmtDuration(breakMin)} dragen enligt schema (ett pass längre än ${fmtDuration(thresholdMin)})`
        : null;
    case "punched-out":
      return "Ingen lunch dragen – du stämplade ut och in under dagen";
    case "short":
      return `Ingen lunch dragen – passet är ${fmtDuration(thresholdMin)} eller kortare`;
    default:
      return null;
  }
}

// ─── evaluateDay ──────────────────────────────────────────────
function endOfShiftMs(date: string, cfg: DayConfig): number {
  return new Date(`${date}T${cfg.endTime}:00`).getTime();
}

function finiteOr0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function evaluateDay(
  date: string,
  ctx: DayContext,
  opts: { explain?: boolean } = {},
): DayEvaluation {
  const explain = opts.explain !== false;
  const lines: string[] = [];
  const say = (line: string | null) => {
    if (explain && line) lines.push(line);
  };

  const today = ctx.today ?? todayLocal();
  const now = ctx.now ?? Date.now();
  const threshold = validThreshold(ctx.autoLunchThresholdMin) ?? DEFAULT_AUTO_LUNCH_THRESHOLD_MIN;
  const cfg = getEffectiveDayConfig(date, ctx.schedule, ctx.exceptions ?? {});
  const normMin = cfg.active ? netDayMin(cfg) : 0;
  const scheduled = normMin > 0;
  const abs = absenceForDay(ctx.absences, date, cfg);
  const t = ctx.travelFor?.(date, cfg);
  const travel: DayTravel = {
    inScheduleMin: finiteOr0(t?.inScheduleMin),
    outsideMin: finiteOr0(t?.outsideMin),
    payrollMin: finiteOr0(t?.payrollMin),
    flexMin: finiteOr0(t?.flexMin),
  };

  // Schedule and absence lines come first.
  say(scheduled ? normLine(cfg, normMin) : "Ledig dag enligt schema");
  const exc = ctx.exceptions?.[date];
  if (exc) say(`Ändrat schema denna dag: slutar ${exc.endTime}${exc.note ? ` (${exc.note})` : ""}`);
  if (abs.ignored) say("Frånvaro på en ledig dag räknas inte");
  for (const item of abs.items) {
    const amount = item.entry.hours === undefined ? "hela dagen" : fmtDuration(item.minutes);
    say(
      item.flex
        ? `Flexledigt ${amount} – tas från flexsaldot`
        : `${ABSENCE_LABEL[item.entry.category] ?? item.entry.category} ${amount} – minskar normen`,
    );
  }
  if (abs.capped) say("Frånvaron begränsas till dagens norm");

  const result = (
    status: DayStatus,
    workedMin: number,
    breakMin: number,
    flexDelta: number,
  ): DayEvaluation => {
    flexDelta = flexDelta === 0 ? 0 : flexDelta; // no -0 from "-abs.flexMin"
    say(`Flex ${fmtSignedDuration(flexDelta)}`);
    return {
      status,
      normMin,
      workedMin,
      breakMin,
      absence: { flexMin: abs.flexMin, excusedMin: abs.excusedMin },
      travel,
      flexDelta,
      explanation: lines,
    };
  };

  if (date > today) {
    say("Framtida dag – räknas inte än");
    return result("off", 0, 0, 0);
  }

  const daySessions = sessionsOn(ctx.sessions, date);
  const open = daySessions.filter(isOpen);
  const done = daySessions.filter((s) => !isOpen(s)).sort((a, b) => a.checkIn - b.checkIn);
  const adjRaw = ctx.dayAdjustments?.[date];
  const adj = adjRaw ? adjustedWork(adjRaw, cfg, scheduled, threshold) : null;
  const locked = !!ctx.lockedMonths?.[date.slice(0, 7)];
  const confirmed = ctx.confirmedDays?.[date] === true;
  const hasAbsence = abs.excusedMin + abs.flexMin > 0;
  const expected = normMin - abs.excusedMin; // what the day asks of you (flex is paid by the bank)
  const remainder = expected - abs.flexMin; // what is left to work after all absence

  let status: DayStatus;
  let workedMin = 0;
  let breakMin = 0;
  let flexDelta = 0;

  if (open.length > 0) {
    const w = workedFromSessions(daySessions, cfg, threshold, now);
    status = "ongoing";
    workedMin = w.workedMin;
    breakMin = w.breakMin;
    say(`Pågående pass sedan ${hmLocal(open[0].checkIn)} – räknas när du stämplat ut`);
    say(`Arbetat hittills ${fmtDuration(workedMin)}`);
  } else if (adj) {
    workedMin = adj.workedMin;
    breakMin = adj.breakMin;
    flexDelta = workedMin - expected;
    status = scheduled && hasAbsence ? "partial" : "reported";
    const brk =
      adj.rule === "registered"
        ? `rast ${fmtDuration(adj.breakMin)}`
        : adj.breakMin > 0
          ? `lunch ${fmtDuration(adj.breakMin)} enligt schema`
          : "ingen rast";
    say(`Justerad dag ${adj.start}–${adj.end}, ${brk}`);
    if (adjRaw?.note) say(`Notering: ${adjRaw.note}`);
    if (done.length > 0) say("Stämplingarna den här dagen ersätts av justeringen");
    say(`Arbetat ${fmtDuration(workedMin)}`);
  } else if (done.length > 0) {
    const w = workedFromSessions(done, cfg, threshold, now);
    workedMin = w.workedMin;
    breakMin = w.breakMin;
    flexDelta = workedMin - expected;
    status = scheduled && hasAbsence ? "partial" : "reported";
    say(
      `Stämplat ${done.map((s) => `${hmLocal(s.checkIn)}–${hmLocal(s.checkOut as number)}`).join(", ")}`,
    );
    say(breakLine(w.rule, w.breakMin, threshold));
    say(`Arbetat ${fmtDuration(workedMin)}`);
  } else if (!scheduled) {
    status = "off";
  } else if (remainder <= 0) {
    status = "absent";
    flexDelta = -abs.flexMin;
  } else if (confirmed || locked) {
    status = hasAbsence ? "partial" : "reported";
    workedMin = remainder;
    breakMin = remainder === normMin ? cfg.lunchMinutes : 0;
    flexDelta = -abs.flexMin;
    say(confirmed ? "Bekräftad enligt schema" : "Månaden är låst – räknas enligt schema");
    say(`Arbetat ${fmtDuration(workedMin)} enligt schema`);
  } else if (date === today && now < endOfShiftMs(date, cfg)) {
    status = "ongoing";
    if (ctx.reportingMode === "schedule") {
      workedMin = remainder;
      say(`Dagen pågår – räknas enligt schema, bekräfta efter ${cfg.endTime}`);
    } else {
      say("Dagen pågår – inget registrerat än");
    }
  } else if (ctx.reportingMode === "schedule") {
    status = "unconfirmed";
    workedMin = remainder;
    breakMin = remainder === normMin ? cfg.lunchMinutes : 0;
    flexDelta = -abs.flexMin;
    say("Ej bekräftad – räknas som arbetad enligt schema");
    say(`Arbetat ${fmtDuration(workedMin)} enligt schema`);
  } else {
    status = "missing";
    flexDelta = -abs.flexMin;
    say(
      hasAbsence
        ? `Ingen registrering för resten av dagen (${fmtDuration(remainder)}) – den saknas och påverkar inte flexsaldot förrän du fyller i den`
        : "Ingen registrering – dagen saknas och påverkar inte flexsaldot förrän du fyller i den",
    );
  }

  const beforeStart = !ctx.trackingStartDate || date < ctx.trackingStartDate;
  const inOpeningBalance = !beforeStart && !!ctx.flexBaseDate && date <= ctx.flexBaseDate;
  if (beforeStart || inOpeningBalance) {
    flexDelta = 0;
    if (status === "missing" || status === "unconfirmed" || (status === "ongoing" && !open.length))
      status = "off";
    say(
      inOpeningBalance
        ? `Ingår i importerat flexsaldo per ${ctx.flexBaseDate}`
        : ctx.trackingStartDate
          ? `Före flexstart (${ctx.trackingStartDate}) – räknas inte i flexsaldot`
          : "Flex räknas från din första registrering – den här dagen räknas inte",
    );
  }

  // Travel (Restid). Inside the schedule it is worked time that the schedule/punch already
  // covers, so it is only explained, never added (adding it would count it twice).
  // Outside: only the flex-routed minutes change the bank, and only on a day that counts —
  // not before the flex start and not while the day is ongoing. Payroll never touches flex.
  const counts = !!ctx.trackingStartDate && date >= ctx.trackingStartDate && status !== "ongoing";
  if (counts) flexDelta += travel.flexMin;
  if (travel.inScheduleMin > 0) {
    say(`Restid inom schemat ${fmtDuration(travel.inScheduleMin)} – ingår i arbetstiden`);
  }
  if (travel.outsideMin > 0) {
    const out = fmtDuration(travel.outsideMin);
    if (travel.flexMin > 0) {
      say(
        counts
          ? `Restid utanför schemat ${out} → flex +${fmtDuration(travel.flexMin)}`
          : `Restid utanför schemat ${out} → flex (räknas inte den här dagen än)`,
      );
    } else if (travel.payrollMin > 0) {
      const paid =
        travel.payrollMin === travel.outsideMin ? "" : ` ${fmtDuration(travel.payrollMin)}`;
      say(`Restid utanför schemat ${out} → lön${paid}`);
    } else {
      say(`Restid utanför schemat ${out} → räknas inte`);
    }
  }

  return result(status, workedMin, breakMin, flexDelta);
}

/**
 * "How is the day going" for the live "Idag" figure: worked − expected while the day is
 * open (ongoing/missing), otherwise the day's flexDelta. Display only. Nothing worked yet
 * shows 0, not −norm: an unworked morning (or a missing day) must not look like red flex.
 */
export function liveDayDelta(ev: DayEvaluation): number {
  if (ev.status === "ongoing" || ev.status === "missing") {
    // A missing day still gets its travel flex (evaluateDay adds it); an ongoing day does not.
    const travelFlex = ev.status === "missing" ? ev.travel.flexMin : 0;
    if (ev.workedMin === 0) return travelFlex;
    return ev.workedMin - (ev.normMin - ev.absence.excusedMin) + travelFlex;
  }
  return ev.flexDelta;
}
