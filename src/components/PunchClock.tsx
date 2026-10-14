import { useState, useEffect, useRef, type ReactNode } from "react";
import Onboarding, { type OnboardingResult } from "./Onboarding";
import ScheduleEditorModal from "./schedule/ScheduleEditorModal";
import AbsenceModal, { type AbsenceEntry } from "./AbsenceModal";
import ExpenseModal, { type ExpenseEntry } from "./ExpenseModal";
import SettingsModal from "./SettingsModal";
import SyncModal from "./SyncModal";
import FlexBreakdownModal from "./FlexBreakdownModal";
import LatePunchoutModal from "./LatePunchoutModal";
import AutomationModal from "./AutomationModal";
import SessionModal, { type DayBlock } from "./SessionModal";
import DayExceptionModal from "./DayExceptionModal";
import AdjustDaySheet from "./AdjustDaySheet";
import ConfirmSheet from "./ConfirmSheet";
import { ScheduleBanner } from "./dayUi";
import { NAV_ICONS } from "./ui";
import Today from "../views/Today";
import Calendar from "../views/Calendar";
import Report from "../views/Report";
import More from "../views/More";
import type { DayActions, MoreSlots, ReportSlots } from "../views/types";
import {
  consumeActionFromUrl,
  isDuplicateAction,
  rememberAction,
  SOURCE_META,
  type ParsedAction,
  type ActionSource,
} from "../lib/actions";
import {
  syncPush,
  syncPull,
  syncDeleteAccount,
  syncForgetDeviceKey,
  SyncApiError,
  SYNC_TOKEN_KEY,
  SYNC_REV_KEY,
  SYNC_DIRTY_KEY,
  SYNC_USERNAME_KEY,
  SYNC_PHONE_KEY,
  type SyncState,
} from "../lib/sync";
import {
  logSyncFailure,
  readSyncErrorLog,
  explainSyncError,
  type SyncFailure,
} from "../lib/syncDiagnostics";
import {
  type WeekSchedule,
  type SchedulePeriod,
  DEFAULT_SCHEDULE,
  addDaysStr,
  netDayMin,
  migrateSchedules,
  mergePeriods,
  parsePeriods,
  periodFromWeek,
  legacyScheduleOf,
  getEffectiveDayConfig,
} from "../lib/schedule";
import { ymdLocal, todayLocal as todayStr, getWeekMonday } from "../lib/dates";
import {
  evaluateDay,
  liveDayDelta,
  resolveReportingMode,
  sessionsOn,
  getAbsencesForDate,
  type DayContext,
} from "../lib/days";
import { computeFlex, computeWeeklyFlex } from "../lib/flex";
import {
  confirmDay,
  confirmMonth,
  isDayLocked,
  migrateDayStatusState,
  mergeDayStatusState,
  unconfirmDay,
  unlockMonth,
} from "../lib/confirm";
import { buildAttend, lateThresholdMs } from "../lib/attend";
import { fmtTime, monthTitle } from "../lib/format";
import { nextTrackingStart, punchLeaveEstimate, scheduledLeaveTime } from "../lib/today";
import type {
  Session,
  ScheduleException,
  ReportingMode,
  AuditEntry,
  DayAdjustment,
  LockedMonth,
  AppState as StorageShape,
} from "../lib/types";

// ─── Constants ────────────────────────────────────────────────
const STORAGE_KEY = "punchclock_v2";
const SHORT_SESSION_THRESHOLD_MS = 60 * 1000;

function now() {
  return Date.now();
}

// ─── Storage ──────────────────────────────────────────────────
function load(): StorageShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const p = raw ? JSON.parse(raw) : {};
    // Derive trackingStartDate for existing users who don't have it yet:
    // use the earliest session date, so historic flex isn't blown up by missing days.
    let trackingStartDate: string | undefined = p.trackingStartDate;
    if (!trackingStartDate && Array.isArray(p.sessions) && p.sessions.length > 0) {
      const dates = (p.sessions as Session[]).map((s) => ymdLocal(new Date(s.checkIn))).sort();
      trackingStartDate = dates[0];
    }
    // `schedules` is the source of truth. An older state with only `schedule` (or the
    // oldest `normHours`) becomes one period valid from the tracking start date.
    const schedules = migrateSchedules({
      schedules: p.schedules,
      schedule: p.schedule,
      normHours: p.normHours,
      trackingStartDate,
    });
    return {
      name: p.name ?? "",
      schedule: legacyScheduleOf(schedules, ymdLocal(new Date())),
      schedules,
      department: p.department,
      onboardingDone: p.onboardingDone ?? false,
      sessions: p.sessions ?? [],
      absences: p.absences ?? [],
      expenses: p.expenses ?? [],
      flexBaseMinutes: typeof p.flexBaseMinutes === "number" ? p.flexBaseMinutes : 0,
      trackingStartDate,
      scheduleExceptions:
        p.scheduleExceptions &&
        typeof p.scheduleExceptions === "object" &&
        !Array.isArray(p.scheduleExceptions)
          ? (p.scheduleExceptions as Record<string, ScheduleException>)
          : {},
      // Day status: reportingMode resolved once (stored wins, else "punch" for users with
      // sessions, else "schedule") and persisted by save(); the rest defaults to empty.
      ...migrateDayStatusState(p),
    };
  } catch {
    return {
      name: "",
      schedule: DEFAULT_SCHEDULE,
      schedules: migrateSchedules({}),
      onboardingDone: false,
      sessions: [],
      absences: [],
      expenses: [],
      flexBaseMinutes: 0,
      scheduleExceptions: {},
      ...migrateDayStatusState({}),
    };
  }
}

function save(data: StorageShape) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

// ─── Sync merge ───────────────────────────────────────────────
// Used only when this device has local edits the server has never seen *and* another
// device wrote in the meantime. Union by id — an entry that exists on either side is
// kept, and the local copy wins for an id present on both (the user just touched it).
// When the device is clean we adopt the server state wholesale instead, so deletions
// made on the other device propagate properly.
function mergeById<T extends { id: string }>(server: T[], local: T[]): T[] {
  const byId = new Map<string, T>();
  for (const e of server) if (e && e.id) byId.set(e.id, e);
  for (const e of local) if (e && e.id) byId.set(e.id, e);
  return [...byId.values()];
}

function mergeSyncState(server: SyncState, local: SyncState): SyncState {
  const trackingStartDate = [server.trackingStartDate, local.trackingStartDate]
    .filter((d): d is string => !!d)
    .sort()[0];
  return {
    // Scalars: the local device has unsaved edits, so its values win.
    name: local.name || server.name,
    department: local.department ?? server.department,
    schedule: local.schedule ?? server.schedule,
    // Schedule periods: union by validFrom, local wins on a collision.
    schedules: mergePeriods(
      parsePeriods(server.schedules) ?? [],
      parsePeriods(local.schedules) ?? [],
    ),
    reportingMode: local.reportingMode ?? server.reportingMode,
    flexBaseMinutes: local.flexBaseMinutes,
    trackingStartDate,
    sessions: mergeById(
      (server.sessions ?? []) as Session[],
      (local.sessions ?? []) as Session[],
    ).sort((a, b) => a.checkIn - b.checkIn),
    absences: mergeById(
      (server.absences ?? []) as AbsenceEntry[],
      (local.absences ?? []) as AbsenceEntry[],
    ),
    expenses: mergeById(
      (server.expenses ?? []) as ExpenseEntry[],
      (local.expenses ?? []) as ExpenseEntry[],
    ),
    scheduleExceptions: {
      ...((server.scheduleExceptions as Record<string, ScheduleException>) ?? {}),
      ...((local.scheduleExceptions as Record<string, ScheduleException>) ?? {}),
    },
    // confirmedDays/lockedMonths: union; dayAdjustments: union by date, local wins;
    // auditLog: union by at+action, sorted; autoLunchThresholdMin: local wins.
    ...mergeDayStatusState(server, local),
  };
}

// ─── Main App ─────────────────────────────────────────────────
// The shell: state, persistence, sync and the bottom navigation. What each tab shows lives
// in src/views/ (Today, Calendar, Report, More); the sheets that edit a day live in
// src/components/.
type View = "today" | "calendar" | "report" | "more";

export default function PunchClock() {
  // Read localStorage once, synchronously, before the first render. Loading in an
  // effect instead used to let the save-effect fire with empty defaults first.
  const bootRef = useRef<StorageShape | null>(null);
  if (bootRef.current === null) bootRef.current = load();
  const boot = bootRef.current;

  const [name, setName] = useState(boot.name);
  const [schedules, setSchedules] = useState<SchedulePeriod[]>(boot.schedules);
  const [reportingMode, setReportingMode] = useState<ReportingMode | undefined>(boot.reportingMode);
  const [autoLunchThresholdMin, setAutoLunchThresholdMin] = useState(boot.autoLunchThresholdMin);
  const [confirmedDays, setConfirmedDays] = useState<Record<string, true>>(
    boot.confirmedDays ?? {},
  );
  const [lockedMonths, setLockedMonths] = useState<Record<string, LockedMonth>>(
    boot.lockedMonths ?? {},
  );
  const [dayAdjustments, setDayAdjustments] = useState<Record<string, DayAdjustment>>(
    boot.dayAdjustments ?? {},
  );
  const [auditLog, setAuditLog] = useState<AuditEntry[]>(boot.auditLog ?? []);
  const [department, setDepartment] = useState<string | undefined>(boot.department);
  const [onboardingDone, setOnboardingDone] = useState(boot.onboardingDone);
  const [sessions, setSessions] = useState<Session[]>(boot.sessions);
  const [absences, setAbsences] = useState<AbsenceEntry[]>(boot.absences);
  const [, setTick] = useState(0);
  const [view, setView] = useState<View>("today");
  const [addModal, setAddModal] = useState(false);
  const [absenceModal, setAbsenceModal] = useState(false);
  const [scheduleModal, setScheduleModal] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);
  const [addForDate, setAddForDate] = useState<string | null>(null);
  const [absenceForDate, setAbsenceForDate] = useState<string | null>(null);
  const [adjustDate, setAdjustDate] = useState<string | null>(null);
  const [editSession, setEditSession] = useState<Session | null>(null);
  const [shortWarn, setShortWarn] = useState(false);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>(boot.expenses ?? []);
  const [expenseModal, setExpenseModal] = useState(false);
  const [flexBaseMinutes, setFlexBaseMinutes] = useState(boot.flexBaseMinutes ?? 0);
  const [trackingStartDate, setTrackingStartDate] = useState<string | undefined>(
    boot.trackingStartDate,
  );
  const [scheduleExceptions, setScheduleExceptions] = useState<Record<string, ScheduleException>>(
    boot.scheduleExceptions ?? {},
  );
  const [exceptionModal, setExceptionModal] = useState<string | null>(null); // YYYY-MM-DD being edited
  const [flexBreakdownOpen, setFlexBreakdownOpen] = useState(false);
  const [latePunchoutOpen, setLatePunchoutOpen] = useState(false);
  const [confirmSheet, setConfirmSheet] = useState<{
    kind: "confirm" | "unlock";
    month: string;
  } | null>(null);
  const [focusExpenses, setFocusExpenses] = useState(false);
  const [syncToken, setSyncToken] = useState<string | null>(() =>
    localStorage.getItem(SYNC_TOKEN_KEY),
  );
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "pulling" | "ok" | "error">(
    "idle",
  );
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [syncFailure, setSyncFailure] = useState<SyncFailure | null>(
    () => readSyncErrorLog()[0] ?? null,
  );
  const [syncErrorLog, setSyncErrorLog] = useState<SyncFailure[]>(() => readSyncErrorLog());
  // A dismissed banner stays hidden until the *next* failure — a red bar you can
  // never get rid of is worse than one that comes back when it matters.
  const [bannerHiddenFor, setBannerHiddenFor] = useState<number | null>(null);
  const [syncHelpOpen, setSyncHelpOpen] = useState(false);
  const [syncModal, setSyncModal] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Sync bookkeeping ──
  // syncRev      last server revision this device has seen (pushed or pulled)
  // dirty        local edits the server has not acknowledged (survives reloads)
  // hydrated     we have read the server at least once this session → safe to push
  // suppressPush the next save-effect run comes from applying server data, not the user
  // stateRef     latest payload, so timers/listeners never push a stale closure
  const syncRevRef = useRef<number>(Number(localStorage.getItem(SYNC_REV_KEY) ?? 0) || 0);
  const dirtyRef = useRef<boolean>(localStorage.getItem(SYNC_DIRTY_KEY) === "1");
  const hydratedRef = useRef(false);
  const suppressPushRef = useRef(false);
  const pullingRef = useRef(false);
  const stateRef = useRef<SyncState | null>(null);
  const syncTokenRef = useRef<string | null>(null);
  syncTokenRef.current = syncToken;
  const [automationModal, setAutomationModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<ParsedAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<ParsedAction | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Schedule banners ("you start at 08:00 — check in?") are dismissible per day.
  const [bannerDismissed, setBannerDismissed] = useState<string>(
    () => localStorage.getItem("punchclock_banner_dismissed") ?? "",
  );

  function dismissBanner(kind: "start" | "end") {
    // Keep today's dismissals only — yesterday's are irrelevant tomorrow.
    const keys = bannerDismissed.split(",").filter((k) => k.startsWith(todayStr()));
    keys.push(`${todayStr()}:${kind}`);
    const next = keys.join(",");
    localStorage.setItem("punchclock_banner_dismissed", next);
    setBannerDismissed(next);
  }

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => {
    const t = setInterval(() => {
      setTick((x) => x + 1);

      // 🔔 NOTIFICATION HOOK — fires every 10 s.
      // To add smart start/stop reminders, check here:
      //   const key  = dayKeyOf(new Date());
      //   const cfg  = schedule[key];           // has cfg.startTime / cfg.endTime
      //   const now  = new Date().toTimeString().slice(0, 5);  // "HH:MM"
      //   if (!isIn && cfg.active && now === cfg.startTime)
      //     → prompt "Your schedule says you start at HH:MM — start the timer?"
      //   if ( isIn && cfg.active && now === cfg.endTime)
      //     → prompt "You usually finish at HH:MM — stop the timer?"
      // Requires notification permission + a persistent "already prompted today" flag.
    }, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // ?action=in|out|toggle from a QR code / NFC tag / WiFi automation.
    // Parked in state and executed by the effect below once onboarding is done.
    const urlAction = consumeActionFromUrl();
    if (urlAction) setPendingAction(urlAction);
  }, []);

  useEffect(() => {
    if (!pendingAction || !onboardingDone) return;
    const a = pendingAction;
    setPendingAction(null);
    executeAction(a);
  }, [pendingAction, onboardingDone]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync engine ─────────────────────────────────────────────
  function rememberRev(rev: number) {
    syncRevRef.current = rev;
    try {
      localStorage.setItem(SYNC_REV_KEY, String(rev));
    } catch {
      /* ignore */
    }
  }

  /** Record a failed sync call so the banner, the help panel and the felanmälan agree. */
  function noteSyncFailure(e: unknown) {
    const api = e instanceof SyncApiError ? e : null;
    const failure: SyncFailure = {
      at: Date.now(),
      status: api?.status ?? 0,
      path: api?.path ?? "/api/sync",
      method: api?.method ?? "GET",
      message: (e as Error)?.message ?? "Okänt fel",
      online: typeof navigator === "undefined" ? true : navigator.onLine,
    };
    setSyncFailure(failure);
    setSyncErrorLog(logSyncFailure(failure));
    setSyncStatus("error");
  }

  function clearSyncFailure() {
    setSyncFailure(null);
    setBannerHiddenFor(null);
  }

  function markDirty(dirty: boolean) {
    dirtyRef.current = dirty;
    try {
      if (dirty) localStorage.setItem(SYNC_DIRTY_KEY, "1");
      else localStorage.removeItem(SYNC_DIRTY_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Write the server's copy into local state. Does not trigger a push. */
  function applyRemoteState(s: SyncState, opts: { push?: boolean } = {}) {
    suppressPushRef.current = !opts.push;
    setName(s.name ?? "");
    setDepartment(s.department);
    setSchedules(
      migrateSchedules({
        schedules: s.schedules,
        schedule: s.schedule,
        trackingStartDate: s.trackingStartDate,
      }),
    );
    // A payload without the day-status fields (older build) gets the same defaults as
    // load(): its own stored mode, else "punch" when it has sessions.
    const ds = migrateDayStatusState(s);
    setReportingMode(ds.reportingMode);
    setAutoLunchThresholdMin(ds.autoLunchThresholdMin);
    setConfirmedDays(ds.confirmedDays);
    setLockedMonths(ds.lockedMonths);
    setDayAdjustments(ds.dayAdjustments);
    setAuditLog(ds.auditLog);
    setSessions((s.sessions ?? []) as Session[]);
    setAbsences((s.absences ?? []) as AbsenceEntry[]);
    setExpenses((s.expenses ?? []) as ExpenseEntry[]);
    setFlexBaseMinutes(typeof s.flexBaseMinutes === "number" ? s.flexBaseMinutes : 0);
    setTrackingStartDate(s.trackingStartDate);
    setScheduleExceptions(
      s.scheduleExceptions &&
        typeof s.scheduleExceptions === "object" &&
        !Array.isArray(s.scheduleExceptions)
        ? (s.scheduleExceptions as Record<string, ScheduleException>)
        : {},
    );
  }

  async function pushNow() {
    const token = syncTokenRef.current;
    const payload = stateRef.current;
    if (!token || !payload || !hydratedRef.current) return;
    setSyncStatus("syncing");
    try {
      const rev = await syncPush(token, payload);
      rememberRev(rev);
      markDirty(false);
      setSyncedAt(Date.now());
      clearSyncFailure();
      setSyncStatus("ok");
    } catch (e) {
      noteSyncFailure(e);
    }
  }

  function pushSoon(delay = 3000) {
    if (!syncTokenRef.current || !hydratedRef.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      void pushNow();
    }, delay);
  }

  /**
   * Read the server and reconcile. This is what makes the sync two-way: without it
   * a device only ever pushed, so whichever device you opened last silently
   * overwrote the other one's day.
   */
  async function pullNow(opts: { manual?: boolean } = {}) {
    const token = syncTokenRef.current;
    if (!token || pullingRef.current) return;
    pullingRef.current = true;
    setSyncStatus("pulling");
    try {
      const { state, updatedAt } = await syncPull(token);
      if (!state) {
        // Account exists but has never been written to — this device seeds it.
        hydratedRef.current = true;
        rememberRev(updatedAt);
        clearSyncFailure();
        setSyncStatus("ok");
        if (opts.manual) showToast("Molnet är tomt ännu — dina data laddas upp.");
        pushSoon(0);
        return;
      }
      const changed = updatedAt !== syncRevRef.current;
      const local = stateRef.current;
      hydratedRef.current = true;
      rememberRev(updatedAt);
      let merged = false;
      if (changed || opts.manual) {
        if (dirtyRef.current && local) {
          // Both sides moved: keep everything. The save effect pushes the union back
          // once React has committed it — pushing here would send the pre-merge state.
          merged = true;
          applyRemoteState(mergeSyncState(state, local), { push: true });
          if (opts.manual) showToast("Data hämtad och sammanslagen med dina lokala ändringar.");
        } else {
          applyRemoteState(state);
          markDirty(false);
          if (opts.manual) showToast(changed ? "Data hämtad från molnet." : "Redan uppdaterad.");
        }
      }
      setSyncedAt(Date.now());
      clearSyncFailure();
      setSyncStatus("ok");
      // Edits made while offline / before hydration: get them up now.
      if (!merged && dirtyRef.current) pushSoon(0);
    } catch (e) {
      noteSyncFailure(e);
      if (opts.manual)
        showToast(
          "Kunde inte hämta: " +
            explainSyncError({
              at: Date.now(),
              status: e instanceof SyncApiError ? e.status : 0,
              path: "",
              method: "",
              message: (e as Error).message,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            }).headline.toLowerCase(),
        );
    } finally {
      pullingRef.current = false;
    }
  }

  // Persist locally on every change, then push (once we know what the server holds).
  useEffect(() => {
    const legacySchedule = legacyScheduleOf(schedules, ymdLocal(new Date()));
    save({
      name,
      schedule: legacySchedule,
      schedules,
      reportingMode,
      department,
      onboardingDone,
      sessions,
      absences,
      expenses,
      flexBaseMinutes,
      trackingStartDate,
      scheduleExceptions,
      autoLunchThresholdMin,
      confirmedDays,
      lockedMonths,
      dayAdjustments,
      auditLog,
    });
    stateRef.current = {
      name,
      schedule: legacySchedule,
      schedules,
      reportingMode,
      department,
      sessions,
      absences,
      expenses,
      flexBaseMinutes,
      trackingStartDate,
      scheduleExceptions,
      autoLunchThresholdMin,
      confirmedDays,
      lockedMonths,
      dayAdjustments,
      auditLog,
    };
    if (!syncToken) return;
    if (suppressPushRef.current) {
      suppressPushRef.current = false;
      return;
    }
    markDirty(true);
    pushSoon();
  }, [
    name,
    schedules,
    reportingMode,
    department,
    onboardingDone,
    sessions,
    absences,
    expenses,
    flexBaseMinutes,
    trackingStartDate,
    scheduleExceptions,
    autoLunchThresholdMin,
    confirmedDays,
    lockedMonths,
    dayAdjustments,
    auditLog,
    syncToken,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pull when the app opens with a token, and whenever it comes back to the
  // foreground or regains network — that is when the other device's changes land.
  useEffect(() => {
    if (!syncToken) return;
    void pullNow();
    const onVisible = () => {
      if (document.visibilityState === "visible") void pullNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [syncToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Don't leave a queued push behind when the tab goes away.
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current) void pushNow();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const todayDate = todayStr();
  const activeSession = sessions.find((s) => !s.checkOut);
  const todaySessions = sessions.filter((s) => ymdLocal(new Date(s.checkIn)) === todayDate);
  const isIn = !!activeSession;
  // A stored mode always wins; otherwise users with sessions keep punching.
  const resolvedMode: ReportingMode = reportingMode ?? resolveReportingMode({ sessions });
  const todayCfg = getEffectiveDayConfig(todayDate, schedules, scheduleExceptions);

  // Keep the scroll position of one tab from leaking into the next.
  const mainRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [view]);

  function handlePunch() {
    if (isIn && activeSession) {
      const elapsed = now() - activeSession.checkIn;
      if (elapsed < SHORT_SESSION_THRESHOLD_MS) {
        setShortWarn(true);
        return;
      }
      if (elapsed > lateThresholdMs(todayCfg)) {
        setLatePunchoutOpen(true);
        return;
      }
      doCheckOut();
    } else {
      doCheckIn();
    }
  }

  function doCheckIn(source?: ActionSource, atMs?: number) {
    const checkInTime = atMs ?? now();
    if (!trackingStartDate) {
      setTrackingStartDate(ymdLocal(new Date(checkInTime)));
    }
    setSessions((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        checkIn: checkInTime,
        checkOut: null,
        manual: atMs !== undefined,
        ...(source ? { source } : {}),
      },
    ]);
  }

  // Execute a URL action (QR / NFC / WiFi / shortcut) schedule-aware:
  // duplicates within 2 min are swallowed (WiFi flapping, double scans) and an
  // auto check-in on a day the schedule marks as free asks for confirmation.
  function executeAction(a: ParsedAction, confirmed = false) {
    const meta = SOURCE_META[a.source];
    const resolved: "in" | "out" = a.action === "toggle" ? (isIn ? "out" : "in") : a.action;

    if (resolved === "in") {
      if (isIn) {
        showToast("Du är redan incheckad");
        return;
      }
      if (isDuplicateAction("in")) {
        showToast("Incheckning ignorerad — nyss utförd");
        return;
      }
      if (!todayCfg.active && !confirmed) {
        setConfirmAction(a);
        return;
      }
      rememberAction("in");
      doCheckIn(a.source);
      showToast(`${meta.emoji} Incheckad ${fmtTime(now())} via ${meta.label}`);
    } else {
      if (!activeSession) {
        showToast("Du är inte incheckad");
        return;
      }
      if (isDuplicateAction("out")) {
        showToast("Utcheckning ignorerad — nyss utförd");
        return;
      }
      const elapsed = now() - activeSession.checkIn;
      if (elapsed < SHORT_SESSION_THRESHOLD_MS) {
        setShortWarn(true);
        return;
      }
      if (elapsed > lateThresholdMs(todayCfg)) {
        setLatePunchoutOpen(true);
        return;
      }
      rememberAction("out");
      doCheckOut();
      showToast(`${meta.emoji} Utcheckad ${fmtTime(now())} via ${meta.label}`);
    }
  }

  function handleLatePunchoutSave(endTime: number) {
    if (!activeSession) return;
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSession.id ? { ...s, checkOut: endTime } : s)),
    );
    setLatePunchoutOpen(false);
  }

  function doCheckOut() {
    if (!activeSession) return;
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSession.id ? { ...s, checkOut: now() } : s)),
    );
    setShortWarn(false);
  }

  function doDiscardShort() {
    if (!activeSession) return;
    setSessions((prev) => prev.filter((s) => s.id !== activeSession.id));
    setShortWarn(false);
  }

  // ── Locked months, flex anchor ──────────────────────────────
  // A locked month blocks every edit of its days (adjust, "Enligt schema", sessions,
  // absences). Live punching today stays allowed even in a locked month: a punch records
  // the time as it happens, evaluateDay already lets registered days keep their real
  // values in a locked month, and blocking the clock for the rest of a month confirmed
  // early (from the 25th) would make the app unusable. The Today view says so.
  const isLocked = (date: string) => isDayLocked(date, { lockedMonths });

  function blockIfLocked(date: string): boolean {
    if (!isLocked(date)) return false;
    showToast("Månaden är låst. Lås upp den för att ändra dagen.");
    return true;
  }

  function rangeLocked(start: string, end: string): boolean {
    for (let d = start, n = 0; d <= end && n < 3700; d = addDaysStr(d, 1), n++) {
      if (isLocked(d)) return true;
    }
    return false;
  }

  /**
   * Schedule-mode users never punch, so nothing else would set the flex start. The first
   * registration (Enligt schema, adjustment, confirmation, time, absence) anchors it; an
   * existing anchor is never moved.
   */
  function anchorTracking(date: string) {
    setTrackingStartDate((prev) => nextTrackingStart(prev, date, todayStr()));
  }

  // ── Day edits ───────────────────────────────────────────────
  function addSessions(list: Session[]) {
    if (list.length === 0) return;
    const first = list.map((s) => ymdLocal(new Date(s.checkIn))).sort()[0];
    anchorTracking(first);
    setSessions((prev) => [...prev, ...list]);
  }

  function handleSaveEdit(updated: Session) {
    if (blockIfLocked(ymdLocal(new Date(updated.checkIn)))) return;
    setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setEditSession(null);
  }

  function handleSaveAbsence(entry: AbsenceEntry) {
    if (rangeLocked(entry.startDate, entry.endDate)) {
      showToast("Perioden innehåller dagar i en låst månad. Lås upp månaden först.");
      return;
    }
    anchorTracking(entry.startDate);
    setAbsences((prev) => [...prev, entry]);
    setAbsenceModal(false);
    setAbsenceForDate(null);
  }

  function handleSaveException(dateStr: string, exc: ScheduleException | null) {
    setScheduleExceptions((prev) => {
      const next = { ...prev };
      if (exc === null) delete next[dateStr];
      else next[dateStr] = exc;
      return next;
    });
    setExceptionModal(null);
  }

  function handleSaveAdjustment(adj: DayAdjustment) {
    if (blockIfLocked(adj.date)) return;
    anchorTracking(adj.date);
    setDayAdjustments((prev) => ({ ...prev, [adj.date]: adj }));
    setAdjustDate(null);
    showToast("Dagen är justerad.");
  }

  function handleSaveExpense(entry: ExpenseEntry) {
    setExpenses((prev) => [...prev, entry]);
    setExpenseModal(false);
  }
  function handleDeleteExpense(id: string) {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }

  function runConfirmMonth(month: string) {
    const res = confirmMonth(month, flexCtx, { at: Date.now(), by: name, auditLog });
    if (res.ok) {
      anchorTracking(todayStr());
      setConfirmedDays(res.confirmedDays);
      setLockedMonths(res.lockedMonths);
      setAuditLog(res.auditLog);
      showToast(`${monthTitle(month)} är bekräftad och låst.`);
    } else if (res.reason === "missing-days") {
      const n = res.missingDays.length;
      showToast(
        `${n} ${n === 1 ? "dag saknas" : "dagar saknas"} — fyll i ${n === 1 ? "den" : "dem"} först.`,
      );
    } else if (res.reason === "locked") {
      showToast("Månaden är redan låst.");
    } else if (res.reason === "future") {
      showToast("Månaden har inte börjat än.");
    }
    setConfirmSheet(null);
  }

  function runUnlockMonth(month: string) {
    const res = unlockMonth(month, { lockedMonths, auditLog }, { at: Date.now() });
    if (res.ok) {
      setLockedMonths(res.lockedMonths);
      setAuditLog(res.auditLog);
      showToast(`${monthTitle(month)} är upplåst.`);
    }
    setConfirmSheet(null);
  }

  const actions: DayActions = {
    enligtSchema(date) {
      if (blockIfLocked(date)) return;
      const r = confirmDay(date, { lockedMonths, confirmedDays });
      if (!r.ok) return;
      anchorTracking(date);
      setConfirmedDays(r.confirmedDays);
      showToast("Enligt schema ✓");
    },
    undoSchema(date) {
      if (blockIfLocked(date)) return;
      const r = unconfirmDay(date, { lockedMonths, confirmedDays });
      if (r.ok) setConfirmedDays(r.confirmedDays);
    },
    adjust(date) {
      if (blockIfLocked(date)) return;
      setAdjustDate(date);
    },
    absence(date) {
      if (blockIfLocked(date)) return;
      setAbsenceForDate(date);
    },
    addTime(date) {
      if (blockIfLocked(date)) return;
      setAddForDate(date);
    },
    editSession(s) {
      if (blockIfLocked(ymdLocal(new Date(s.checkIn)))) return;
      setEditSession(s);
    },
    deleteSession(id) {
      const s = sessions.find((x) => x.id === id);
      if (s && blockIfLocked(ymdLocal(new Date(s.checkIn)))) return;
      setSessions((prev) => prev.filter((x) => x.id !== id));
    },
    deleteAbsence(a) {
      if (rangeLocked(a.startDate, a.endDate)) {
        showToast("Perioden innehåller dagar i en låst månad. Lås upp månaden först.");
        return;
      }
      setAbsences((prev) => prev.filter((x) => x.id !== a.id));
    },
    editException(date) {
      if (blockIfLocked(date)) return;
      setExceptionModal(date);
    },
    confirmMonth: (month) => setConfirmSheet({ kind: "confirm", month }),
    unlockMonth: (month) => setConfirmSheet({ kind: "unlock", month }),
    removeAdjustment(date) {
      if (blockIfLocked(date)) return;
      setDayAdjustments((prev) => {
        const next = { ...prev };
        delete next[date];
        return next;
      });
      setAdjustDate(null);
    },
  };

  function handleOnboardingComplete(result: OnboardingResult) {
    if (result.syncToken) {
      localStorage.setItem(SYNC_TOKEN_KEY, result.syncToken);
      setSyncToken(result.syncToken);
    }
    if (result.syncUsername) {
      localStorage.setItem(SYNC_USERNAME_KEY, result.syncUsername);
    }
    if (result.restoredState) {
      // The server copy is the truth here — the user asked to restore it.
      adoptRestoredState(result.restoredState, result.syncRev ?? 0, {
        fallbackName: result.name,
        fallbackSchedule: result.schedule,
        fallbackDepartment: result.department,
      });
    } else {
      setName(result.name);
      setSchedules([periodFromWeek(result.schedule)]);
      setDepartment(result.department);
      // Enligt schema users never punch, so nothing else would start the flex clock.
      if (resolvedMode === "schedule") setTrackingStartDate((prev) => prev ?? todayStr());
    }
    setOnboardingDone(true);
  }

  /** Replace everything local with a state fetched from the server (restore / login). */
  function adoptRestoredState(
    s: SyncState,
    rev: number,
    fallback?: {
      fallbackName?: string;
      fallbackSchedule?: WeekSchedule;
      fallbackDepartment?: string;
    },
  ) {
    hydratedRef.current = true;
    rememberRev(rev);
    markDirty(false);
    applyRemoteState({
      ...s,
      name: s.name ?? fallback?.fallbackName ?? "",
      department: s.department ?? fallback?.fallbackDepartment,
      schedule: s.schedule ?? fallback?.fallbackSchedule ?? DEFAULT_SCHEDULE,
    });
    setSyncedAt(Date.now());
    clearSyncFailure();
    setSyncStatus("ok");
  }

  function handleSettingsSave(result: { name: string; department?: string }) {
    setName(result.name);
    setDepartment(result.department);
    setSettingsModal(false);
  }

  function handleSyncToken(token: string, username: string) {
    localStorage.setItem(SYNC_TOKEN_KEY, token);
    localStorage.setItem(SYNC_USERNAME_KEY, username);
    // Fresh account: this device's data is the seed, so it is by definition unpushed.
    hydratedRef.current = false;
    rememberRev(0);
    markDirty(true);
    setSyncToken(token);
    setSyncModal(false);
  }

  function handleSyncRestore(token: string, state: SyncState, username: string, rev: number) {
    localStorage.setItem(SYNC_TOKEN_KEY, token);
    localStorage.setItem(SYNC_USERNAME_KEY, username);
    setSyncToken(token);
    adoptRestoredState(state, rev, {
      fallbackName: name,
      fallbackSchedule: legacyScheduleOf(schedules, ymdLocal(new Date())),
      fallbackDepartment: department,
    });
    setSyncModal(false);
    showToast("Data hämtad från molnet.");
  }

  /** Stop syncing on this device. The account and its data stay on the server. */
  function handleDisconnectSync() {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    localStorage.removeItem(SYNC_TOKEN_KEY);
    localStorage.removeItem(SYNC_USERNAME_KEY);
    localStorage.removeItem(SYNC_PHONE_KEY);
    localStorage.removeItem(SYNC_REV_KEY);
    localStorage.removeItem(SYNC_DIRTY_KEY);
    // The device key goes with the token: "Koppla från här" must not leave a usable key behind.
    void syncForgetDeviceKey();
    hydratedRef.current = false;
    syncRevRef.current = 0;
    dirtyRef.current = false;
    setSyncToken(null);
    setSyncStatus("idle");
    clearSyncFailure();
    setSyncedAt(null);
    showToast("Synk avstängd här. Kontot finns kvar — logga in igen när du vill.");
  }

  /** Destructive: removes the account and every synced copy from the server. */
  async function handleDeleteSyncAccount() {
    const token = syncTokenRef.current;
    if (!token) return;
    try {
      await syncDeleteAccount(token);
    } catch {
      /* ignore */
    }
    handleDisconnectSync();
    showToast("Synk-kontot raderat. Dina data finns kvar på den här enheten.");
  }

  const monthStartStr = `${todayDate.slice(0, 7)}-01`;
  const weekStartStr = ymdLocal(getWeekMonday(new Date()));
  // Flex = a fold over evaluateDay (src/lib/days.ts). Today counts once it is settled.
  // Everything the views show about a day is derived from this one context.
  const flexCtx: DayContext = {
    sessions,
    absences,
    schedule: schedules,
    exceptions: scheduleExceptions,
    reportingMode: resolvedMode,
    trackingStartDate,
    today: todayDate,
    now: now(),
    autoLunchThresholdMin,
    confirmedDays,
    lockedMonths,
    dayAdjustments,
  };
  const flexAll = computeFlex(flexCtx);
  const flexTotal = flexBaseMinutes + flexAll.minutes;
  const flexMonth = computeFlex(flexCtx, { from: monthStartStr, to: todayDate }).minutes;
  const flexWeek = computeFlex(flexCtx, { from: weekStartStr, to: todayDate }).minutes;
  // "· N dagar saknas" (punch) / "· N ej bekräftade" (schedule) next to the balance.
  const flexAttention =
    resolvedMode === "punch"
      ? flexAll.missingDays.length > 0
        ? `${flexAll.missingDays.length} ${flexAll.missingDays.length === 1 ? "dag saknas" : "dagar saknas"}`
        : null
      : flexAll.unconfirmedDays.length > 0
        ? `${flexAll.unconfirmedDays.length} ej ${flexAll.unconfirmedDays.length === 1 ? "bekräftad" : "bekräftade"}`
        : null;

  // Today's evaluation drives "Netto arbetstid", the status chip and the "Idag" figure —
  // liveDayDelta never shows −norm for a day nothing has been worked on yet.
  const todayEval = evaluateDay(todayDate, flexCtx);
  const todayDelta = liveDayDelta(todayEval);

  const liveMs = activeSession ? now() - activeSession.checkIn : 0;

  // Leave-time predictor — only on active workdays with an ongoing session.
  const todayWorkedRaw = todaySessions.reduce(
    (sum, s) => sum + ((s.checkOut ?? now()) - s.checkIn) / 60000,
    0,
  );
  const leave =
    isIn && todayCfg.active
      ? punchLeaveEstimate({
          cfg: todayCfg,
          workedRawMin: todayWorkedRaw,
          sessionCount: todaySessions.length,
          nowMs: now(),
        })
      : null;

  // A session that has run past the late-punchout threshold (forgotten check-out
  // territory). Surfaces a reassuring "choose the end time" helper on the clock so
  // a scary-looking 29 h timer doesn't stop the user from punching out.
  const isLongSession = isIn && !!activeSession && liveMs > lateThresholdMs(todayCfg);
  // The scheduled end-of-day for the day the active session started — offered as a
  // one-tap "check out at scheduled time" option in the late-punchout sheet.
  let lateScheduledEndMs: number | undefined;
  if (activeSession) {
    const ciDate = ymdLocal(new Date(activeSession.checkIn));
    const ciCfg = getEffectiveDayConfig(ciDate, schedules, scheduleExceptions);
    if (ciCfg.active) {
      const ms = new Date(`${ciDate}T${ciCfg.endTime}`).getTime();
      if (ms > activeSession.checkIn && ms <= now()) lateScheduledEndMs = ms;
    }
  }

  const attend = buildAttend({
    ctx: flexCtx,
    expenses,
    cfgFor: (d) => getEffectiveDayConfig(d, schedules, scheduleExceptions),
    today: todayDate,
    now: now(),
    flexAll,
  });

  // Schedule prompts: nudge to check in once the scheduled start has passed (punch mode
  // only) and to check out after the scheduled end. Dismissible per day; re-evaluated by
  // the 10 s tick.
  const nowHM = new Date().toTimeString().slice(0, 5);
  const showStartBanner =
    resolvedMode === "punch" &&
    !isIn &&
    todayCfg.active &&
    todaySessions.length === 0 &&
    nowHM >= todayCfg.startTime &&
    nowHM < todayCfg.endTime &&
    !bannerDismissed.includes(`${todayDate}:start`);
  // Sync failure banner: only when sync is actually set up, and only until the
  // user dismisses *this* failure (a newer one shows it again).
  const showSyncErrorBanner =
    !!syncToken && syncStatus === "error" && !!syncFailure && bannerHiddenFor !== syncFailure.at;
  const syncErrorInfo = explainSyncError(syncFailure);

  const showEndBanner =
    isIn &&
    todayCfg.active &&
    nowHM >= todayCfg.endTime &&
    !bannerDismissed.includes(`${todayDate}:end`);

  // ── Wave 3 integration slots ────────────────────────────────
  // Each later PR plugs in with one line here. They render nothing until filled.
  //   moreSlots.excelImport = <MoreRow … />            (PR 6, Mer → "Importera från Excel")
  //   moreSlots.vacation    = <MoreRow … />            (PR 7, Mer → "Semester")
  //   moreSlots.travelRules = <MoreRow … />            (PR 8, Mer → "Restidsregler")
  //   reportSlots.excelExport = (p) => <… period={p} /> (PR 6, Rapport → "Exportera Excel")
  //   reportSlots.vacation    = (p) => <… />            (PR 7, "Semester: 17 av 25 dagar kvar")
  //   reportSlots.travel      = (p) => <… />            (PR 8, "Restid" row)
  //   adjustTravelSlot        = <TravelTimeEditor date={adjustDate} />  (PR 8, in "Justera dag")
  const moreSlots: MoreSlots = {};
  const reportSlots: ReportSlots = {};
  const adjustTravelSlot: ReactNode = null;

  const banners = (
    <>
      {confirmAction && (
        <ScheduleBanner
          emoji="🤔"
          text={`Idag är du ledig enligt schemat. Vill du checka in ändå (via ${SOURCE_META[confirmAction.source].label})?`}
          primary={{
            label: "Checka in",
            onClick: () => {
              const a = confirmAction;
              setConfirmAction(null);
              executeAction(a, true);
            },
          }}
          onDismiss={() => setConfirmAction(null)}
        />
      )}
      {!confirmAction && showStartBanner && (
        <ScheduleBanner
          emoji="⏰"
          text={`Enligt schemat började du ${todayCfg.startTime}. Checka in?`}
          primary={{ label: "Checka in nu", onClick: () => doCheckIn() }}
          secondary={{
            label: `Från ${todayCfg.startTime}`,
            onClick: () =>
              doCheckIn(undefined, new Date(`${todayDate}T${todayCfg.startTime}`).getTime()),
          }}
          onDismiss={() => dismissBanner("start")}
        />
      )}
      {!confirmAction && showEndBanner && (
        <ScheduleBanner
          emoji="🏁"
          text={`Din arbetsdag slutade ${todayCfg.endTime}. Dags att checka ut?`}
          primary={{ label: "Checka ut", onClick: handlePunch }}
          onDismiss={() => dismissBanner("end")}
        />
      )}
    </>
  );

  const NAV: { key: View; label: string; icon: ReactNode }[] = [
    { key: "today", label: "Idag", icon: NAV_ICONS.today },
    { key: "calendar", label: "Kalender", icon: NAV_ICONS.calendar },
    { key: "report", label: "Rapport", icon: NAV_ICONS.report },
    { key: "more", label: "Mer", icon: NAV_ICONS.more },
  ];

  const lockedToday = isLocked(todayDate);
  const dayBlock = (d: string): DayBlock =>
    isLocked(d) ? "locked" : dayAdjustments[d] ? "adjusted" : null;

  // ── Onboarding gate ─────────────────────────────────────────
  if (!onboardingDone) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="fixed inset-0 bg-pc-bg font-display text-pc-ink antialiased">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        .pc-fade { animation: pcFade 0.35s cubic-bezier(0.16,1,0.3,1); }
        @keyframes pcFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .pc-pop { animation: pcPop 0.4s cubic-bezier(0.34,1.56,0.64,1); }
        @keyframes pcPop { 0% { transform: scale(0.85); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        .pc-pulse-ring::before {
          content: ''; position: absolute; inset: -8px; border-radius: 50%;
          border: 2px solid #ff5f00; opacity: 0.6;
          animation: pcRing 2s ease-out infinite;
        }
        @keyframes pcRing { 0% { transform: scale(0.95); opacity: 0.6; } 100% { transform: scale(1.25); opacity: 0; } }
        .pc-press:active { transform: scale(0.96); }
        .pc-press { transition: transform 0.15s, box-shadow 0.2s; }
        .pc-sheet { animation: pcSheet 0.32s cubic-bezier(0.32,0.72,0,1); }
        @keyframes pcSheet { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .pc-overlay { animation: pcOverlay 0.25s ease; }
        @keyframes pcOverlay { from { opacity: 0; } to { opacity: 1; } }
        .pc-input {
          width: 100%; max-width: 100%; box-sizing: border-box;
          padding: 14px 16px; border-radius: 16px;
          border: 1px solid #ece6df; font-size: 16px; outline: none;
          margin-bottom: 16px; background: #fdf6ee; font-weight: 600; color: #2d1717;
          -webkit-appearance: none; appearance: none;
        }
        .pc-input:focus { border-color: #ff5f00; background: #fff; }
        .hide-scroll { scrollbar-width: none; }
        .hide-scroll::-webkit-scrollbar { display: none; }
      `}</style>

      <div className="mx-auto max-w-[480px] h-full flex flex-col">
        <div className="shrink-0 h-[env(safe-area-inset-top,0px)]" />

        {/* Header */}
        <header className="shrink-0 px-5 pt-6 pb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-2xl bg-pc-orange flex items-center justify-center shadow-[0_4px_14px_rgba(255,95,0,0.35)]">
              <svg
                viewBox="0 0 24 24"
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-pc-muted truncate">
                Tidrapport{department ? ` · ${department}` : ""}
              </div>
              <div className="text-[17px] font-bold leading-tight text-pc-ink truncate">
                {name || "—"}
              </div>
            </div>
          </div>
          {isIn && (
            <div className="shrink-0 flex items-center gap-1.5 bg-pc-orange/10 text-pc-orange-deep px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-pc-orange animate-pulse" />
              <span className="text-[12px] font-bold">LIVE</span>
            </div>
          )}
        </header>

        {showSyncErrorBanner && (
          <div className="shrink-0 px-5 pb-3">
            <SyncErrorBanner
              headline={syncErrorInfo.headline}
              detail={
                syncErrorInfo.networkBlocked
                  ? "Din tid sparas på enheten, men den når inte molnet."
                  : "Din tid sparas på enheten, men synken till molnet misslyckas."
              }
              onReadMore={() => {
                setSyncHelpOpen(true);
                setSettingsModal(true);
              }}
              onDismiss={() => setBannerHiddenFor(syncFailure?.at ?? Date.now())}
            />
          </div>
        )}

        <main ref={mainRef} className="flex-1 min-h-0 overflow-y-auto px-5">
          {view === "today" && (
            <Today
              mode={resolvedMode}
              today={todayDate}
              evaluation={todayEval}
              cfg={todayCfg}
              sessions={todaySessions}
              absences={getAbsencesForDate(absences, todayDate)}
              adjustment={dayAdjustments[todayDate]}
              confirmed={confirmedDays[todayDate] === true}
              locked={lockedToday}
              lockedMonth={lockedToday ? todayDate.slice(0, 7) : undefined}
              scheduleLeave={scheduledLeaveTime(todayCfg, dayAdjustments[todayDate])}
              flex={{
                total: flexTotal,
                week: flexWeek,
                month: flexMonth,
                today: todayDelta,
                attention: flexAttention,
              }}
              attend={attend}
              actions={actions}
              banners={banners}
              activeSession={activeSession}
              liveMs={liveMs}
              leave={leave}
              isLongSession={isLongSession}
              onPunch={handlePunch}
              onFixLongSession={() => setLatePunchoutOpen(true)}
              onOpenFlex={() => setFlexBreakdownOpen(true)}
              onShowReceipts={() => {
                setFocusExpenses(true);
                setView("report");
              }}
            />
          )}

          {view === "calendar" && <Calendar ctx={flexCtx} actions={actions} />}

          {view === "report" && (
            <Report
              ctx={flexCtx}
              expenses={expenses}
              name={name}
              slots={reportSlots}
              focusExpenses={focusExpenses}
              onAddExpense={() => setExpenseModal(true)}
              onDeleteExpense={handleDeleteExpense}
            />
          )}

          {view === "more" && (
            <More
              name={name}
              department={department}
              mode={resolvedMode}
              syncToken={syncToken}
              syncStatus={syncStatus}
              syncedAt={syncedAt}
              syncDirty={dirtyRef.current}
              slots={moreSlots}
              onOpenProfile={() => setSettingsModal(true)}
              onOpenSchedule={() => setScheduleModal(true)}
              onSetupSync={() => setSyncModal(true)}
              onOpenSyncAccount={() => setSettingsModal(true)}
              onPullNow={() => {
                void pullNow({ manual: true });
              }}
              onOpenAutomation={() => setAutomationModal(true)}
            />
          )}
          <div className="h-4" />
        </main>

        {/* Bottom nav */}
        <nav
          className="shrink-0 w-full bg-white/85 backdrop-blur-xl border-t border-pc-line px-2"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6px)" }}
        >
          <div className="grid grid-cols-4 gap-1 pt-2">
            {NAV.map((n) => (
              <NavItem
                key={n.key}
                active={view === n.key}
                onClick={() => {
                  setFocusExpenses(false);
                  setView(n.key);
                }}
                label={n.label}
                icon={n.icon}
              />
            ))}
          </div>
        </nav>
      </div>

      {shortWarn && activeSession && (
        <ShortSessionWarning
          elapsed={now() - activeSession.checkIn}
          onStop={doDiscardShort}
          onCancel={() => setShortWarn(false)}
        />
      )}

      {addModal && (
        <SessionModal
          schedule={schedules}
          existingSessions={sessions}
          dayBlock={dayBlock}
          onClose={() => setAddModal(false)}
          onSave={(s) => {
            addSessions([s]);
            setAddModal(false);
          }}
          onSaveMany={(list) => {
            addSessions(list);
            setAddModal(false);
          }}
        />
      )}

      {addForDate && (
        <SessionModal
          schedule={schedules}
          defaultDate={addForDate}
          existingSessions={sessions}
          dayBlock={dayBlock}
          onClose={() => setAddForDate(null)}
          onSave={(s) => {
            addSessions([s]);
            setAddForDate(null);
          }}
          onSaveMany={(list) => {
            addSessions(list);
            setAddForDate(null);
          }}
        />
      )}

      {editSession && (
        <SessionModal
          schedule={schedules}
          session={editSession}
          dayBlock={dayBlock}
          onClose={() => setEditSession(null)}
          onSave={handleSaveEdit}
        />
      )}

      <AbsenceModal
        open={absenceModal || absenceForDate !== null}
        initialDate={absenceForDate ?? undefined}
        schedule={schedules}
        onClose={() => {
          setAbsenceModal(false);
          setAbsenceForDate(null);
        }}
        onSave={handleSaveAbsence}
      />

      <ExpenseModal
        open={expenseModal}
        onClose={() => setExpenseModal(false)}
        onSave={handleSaveExpense}
      />

      <AdjustDaySheet
        open={adjustDate !== null}
        date={adjustDate ?? todayDate}
        cfg={getEffectiveDayConfig(adjustDate ?? todayDate, schedules, scheduleExceptions)}
        current={adjustDate ? dayAdjustments[adjustDate] : undefined}
        hasSessions={adjustDate ? sessionsOn(sessions, adjustDate).length > 0 : false}
        preview={(adj) =>
          evaluateDay(
            adj.date,
            { ...flexCtx, dayAdjustments: { ...dayAdjustments, [adj.date]: adj } },
            { explain: false },
          )
        }
        onSave={handleSaveAdjustment}
        onRemove={() => adjustDate && actions.removeAdjustment(adjustDate)}
        onClose={() => setAdjustDate(null)}
        travelSlot={adjustTravelSlot}
      />

      <ScheduleEditorModal
        open={scheduleModal}
        schedules={schedules}
        reportingMode={reportingMode}
        onClose={() => setScheduleModal(false)}
        onSave={(next, mode) => {
          setSchedules(next);
          if (mode) {
            setReportingMode(mode);
            // Schedule-mode users never punch: anchor the flex start so days start counting.
            if (mode === "schedule") anchorTracking(todayDate);
          }
          setScheduleModal(false);
        }}
      />

      <SettingsModal
        open={settingsModal}
        initialName={name}
        initialDepartment={department}
        syncToken={syncToken}
        syncStatus={syncStatus}
        syncedAt={syncedAt}
        syncFailure={syncFailure}
        syncErrorLog={syncErrorLog}
        openSyncHelp={syncHelpOpen}
        dirty={dirtyRef.current}
        onClose={() => {
          setSettingsModal(false);
          setSyncHelpOpen(false);
        }}
        onSave={handleSettingsSave}
        onSetupSync={() => {
          setSettingsModal(false);
          setSyncModal(true);
        }}
        onPullNow={() => {
          void pullNow({ manual: true });
        }}
        onDisconnectSync={handleDisconnectSync}
        onDeleteSyncAccount={handleDeleteSyncAccount}
        onOpenAutomation={() => {
          setSettingsModal(false);
          setAutomationModal(true);
        }}
      />

      <SyncModal
        open={syncModal}
        onClose={() => setSyncModal(false)}
        onToken={handleSyncToken}
        onRestore={handleSyncRestore}
      />

      <FlexBreakdownModal
        open={flexBreakdownOpen}
        onClose={() => setFlexBreakdownOpen(false)}
        trackingStartDate={trackingStartDate}
        weeks={computeWeeklyFlex(flexCtx, 12)}
        total={flexTotal}
      />

      {latePunchoutOpen && activeSession && (
        <LatePunchoutModal
          activeSession={activeSession}
          todaysTargetMin={todayCfg.active ? netDayMin(todayCfg) + todayCfg.lunchMinutes : 0}
          scheduledEndMs={lateScheduledEndMs}
          onCancel={() => setLatePunchoutOpen(false)}
          onSave={handleLatePunchoutSave}
        />
      )}

      <AutomationModal open={automationModal} onClose={() => setAutomationModal(false)} />

      {exceptionModal && (
        <DayExceptionModal
          dateStr={exceptionModal}
          schedule={schedules}
          current={scheduleExceptions[exceptionModal] ?? null}
          onClose={() => setExceptionModal(null)}
          onSave={(exc) => handleSaveException(exceptionModal, exc)}
        />
      )}

      <ConfirmSheet
        open={confirmSheet !== null}
        title={
          confirmSheet?.kind === "unlock"
            ? `Lås upp ${confirmSheet.month ? monthTitle(confirmSheet.month).toLowerCase() : ""}?`
            : `Bekräfta ${confirmSheet?.month ? monthTitle(confirmSheet.month).split(" ")[0].toLowerCase() : ""}?`
        }
        text={
          confirmSheet?.kind === "unlock"
            ? "Du kan ändra dagarna i månaden igen. Dagar du bekräftat förblir bekräftade, och upplåsningen sparas i loggen."
            : "Dagar som inte är bekräftade räknas enligt schema och månaden låses. Du kan inte ändra dagarna förrän du låser upp den igen."
        }
        confirmLabel={confirmSheet?.kind === "unlock" ? "Lås upp" : "Bekräfta och lås"}
        danger={confirmSheet?.kind === "unlock"}
        onCancel={() => setConfirmSheet(null)}
        onConfirm={() => {
          if (!confirmSheet) return;
          if (confirmSheet.kind === "unlock") runUnlockMonth(confirmSheet.month);
          else runConfirmMonth(confirmSheet.month);
        }}
      />

      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[60] pointer-events-none pc-pop max-w-[calc(100vw-32px)]"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)" }}
        >
          <div className="bg-pc-ink text-white text-[13px] font-bold px-4 py-3 rounded-2xl shadow-[0_8px_28px_rgba(45,23,23,0.4)] text-center">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sync failure banner ───────────────────────────────────────
// Red, unmissable, and on every tab: a sync that silently stopped working is the
// one failure the user cannot discover on their own.
function SyncErrorBanner({
  headline,
  detail,
  onReadMore,
  onDismiss,
}: {
  headline: string;
  detail: string;
  onReadMore: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-[18px] px-4 py-3 pc-pop"
      style={{
        background: "#fef2f2",
        border: "1.5px solid #fca5a5",
        boxShadow: "0 4px 16px rgba(220,38,38,0.10)",
      }}
    >
      <div className="flex items-start gap-3">
        <span className="text-[18px] leading-none mt-0.5 shrink-0">⚠️</span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-extrabold leading-tight" style={{ color: "#b91c1c" }}>
            {headline}
          </div>
          <div className="text-[12px] leading-snug mt-0.5" style={{ color: "#9f1239" }}>
            {detail}
          </div>
          <button
            onClick={onReadMore}
            className="mt-2 text-[12px] font-extrabold underline"
            style={{ color: "#b91c1c" }}
          >
            Läs mer och åtgärda →
          </button>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg"
          style={{ color: "#b91c1c" }}
          aria-label="Dölj"
        >
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Short Session Warning ─────────────────────────────────────
function ShortSessionWarning({
  elapsed,
  onStop,
  onCancel,
}: {
  elapsed: number;
  onStop: () => void;
  onCancel: () => void;
}) {
  const secs = Math.floor(elapsed / 1000);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center pc-overlay"
      style={{ background: "rgba(45,23,23,0.55)" }}
      onClick={onCancel}
    >
      <div
        className="pc-sheet bg-white w-full max-w-[480px] rounded-t-[28px] px-6 pt-6"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-pc-line rounded-full mx-auto mb-5" />
        <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mb-4 mx-auto">
          <svg
            viewBox="0 0 24 24"
            className="w-7 h-7 text-amber-600"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div className="text-center mb-2">
          <div className="font-extrabold text-[20px] tracking-tight mb-2">
            Ingen tid registreras
          </div>
          <div className="text-[14px] text-pc-muted leading-relaxed">
            Du har bara stämplat in i <span className="font-bold text-pc-ink">{secs} sekunder</span>
            . Pass kortare än 1 minut sparas inte.
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-6">
          <button
            onClick={onCancel}
            className="pc-press py-4 rounded-[16px] bg-pc-bg border border-pc-line font-bold text-[15px] text-pc-ink"
          >
            Avbryt
          </button>
          <button
            onClick={onStop}
            className="pc-press py-4 rounded-[16px] bg-pc-orange text-white font-bold text-[15px] shadow-[0_8px_20px_-8px_rgba(255,95,0,0.6)]"
          >
            Stoppa klockan
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Nav Item ─────────────────────────────────────────────────
function NavItem({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 py-1.5 rounded-xl transition-colors ${active ? "text-pc-orange" : "text-pc-muted"}`}
    >
      {icon}
      <span className="text-[10px] font-bold tracking-wide">{label}</span>
    </button>
  );
}
