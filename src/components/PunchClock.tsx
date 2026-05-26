import { useState, useEffect, useRef } from "react";
import Onboarding, { type OnboardingResult, WeekScheduleEditor } from "./Onboarding";
import AbsenceModal, { type AbsenceEntry, type AbsenceCategory, ABSENCE_META } from "./AbsenceModal";
import SettingsModal from "./SettingsModal";
import {
  type WeekSchedule,
  DEFAULT_SCHEDULE, dayKeyOf, netDayMin, weeklyNetMin, fmtMin,
  migrateNormHours, migrateSchedule,
} from "../lib/schedule";

// ─── Constants ────────────────────────────────────────────────
const STORAGE_KEY = "punchclock_v2";
const SHORT_SESSION_THRESHOLD_MS = 60 * 1000;

// ─── Types ────────────────────────────────────────────────────
type Session = { id: string; checkIn: number; checkOut: number | null; manual: boolean; note?: string };
type HistoryFilter = "week" | "lastweek" | "month" | "all";

type StorageShape = {
  name: string;
  schedule: WeekSchedule;
  department?: string;
  onboardingDone: boolean;
  sessions: Session[];
  absences: AbsenceEntry[];
  flexBaseMinutes: number;
};

// ─── Time helpers ─────────────────────────────────────────────
function now() { return Date.now(); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

function fmtTime(ms: number | null | undefined) {
  if (!ms) return "--:--";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtDur(minutes: number) {
  if (minutes <= 0) return "0h 0min";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function computeDayMinutes(sessions: Session[], dateStr: string, schedule: WeekSchedule) {
  const cfg = schedule[dayKeyOf(new Date(dateStr + "T12:00:00"))];
  let raw = 0;
  for (const s of sessions) {
    const end = s.checkOut ?? now();
    raw += (end - s.checkIn) / 60000;
  }
  return { raw, net: Math.max(0, raw - (cfg?.lunchMinutes ?? 0)), cfg };
}

// ─── Week helpers ─────────────────────────────────────────────
function getWeekMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function weekKey(date: Date): string {
  return getWeekMonday(date).toISOString().slice(0, 10);
}

function weekRangeLabel(mondayStr: string): string {
  const mon = new Date(mondayStr + "T12:00:00");
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  const wn = isoWeekNumber(mon);
  const monFmt = mon.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
  const sunFmt = sun.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
  return `Vecka ${wn}  •  ${monFmt} – ${sunFmt}`;
}

function groupByDate(sessions: Session[]) {
  const map: Record<string, Session[]> = {};
  for (const s of sessions) {
    const d = new Date(s.checkIn).toISOString().slice(0, 10);
    if (!map[d]) map[d] = [];
    map[d].push(s);
  }
  return map;
}

function computeWeekNet(sessions: Session[], schedule: WeekSchedule): number {
  const byDate = groupByDate(sessions);
  let total = 0;
  for (const [date, ds] of Object.entries(byDate)) {
    total += computeDayMinutes(ds, date, schedule).net;
  }
  return total;
}

function fmtDateLabel(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("sv-SE", {
    weekday: "long", day: "numeric", month: "long",
  });
}

// ─── Absence helpers ──────────────────────────────────────────
function expandAbsenceDates(absence: AbsenceEntry): string[] {
  const dates: string[] = [];
  const cur = new Date(absence.startDate + "T12:00:00");
  const end = new Date(absence.endDate + "T12:00:00");
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function getAbsencesForDate(absences: AbsenceEntry[], date: string): AbsenceEntry[] {
  return absences.filter(a => a.startDate <= date && a.endDate >= date);
}

function absenceDateRangeLabel(a: AbsenceEntry): string {
  if (a.startDate === a.endDate) return fmtDateLabel(a.startDate);
  const s = new Date(a.startDate + "T12:00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
  const e = new Date(a.endDate + "T12:00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
  return `${s} – ${e}`;
}

// ─── Filter helpers ───────────────────────────────────────────
function filterSessions(sessions: Session[], filter: HistoryFilter): Session[] {
  const ref = new Date();
  if (filter === "all") return sessions;
  if (filter === "week") {
    const mon = getWeekMonday(ref);
    const sun = new Date(mon); sun.setDate(sun.getDate() + 7);
    return sessions.filter(s => { const d = new Date(s.checkIn); return d >= mon && d < sun; });
  }
  if (filter === "lastweek") {
    const thisMon = getWeekMonday(ref);
    const lastMon = new Date(thisMon); lastMon.setDate(lastMon.getDate() - 7);
    return sessions.filter(s => { const d = new Date(s.checkIn); return d >= lastMon && d < thisMon; });
  }
  if (filter === "month") {
    const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
    return sessions.filter(s => new Date(s.checkIn) >= start);
  }
  return sessions;
}

function filterAbsences(absences: AbsenceEntry[], filter: HistoryFilter): AbsenceEntry[] {
  const ref = new Date();
  if (filter === "all") return absences;
  if (filter === "week") {
    const mon = getWeekMonday(ref).toISOString().slice(0, 10);
    const sun = new Date(getWeekMonday(ref)); sun.setDate(sun.getDate() + 6);
    const sunStr = sun.toISOString().slice(0, 10);
    return absences.filter(a => a.startDate <= sunStr && a.endDate >= mon);
  }
  if (filter === "lastweek") {
    const thisMon = getWeekMonday(ref);
    const lastMon = new Date(thisMon); lastMon.setDate(lastMon.getDate() - 7);
    const lastSun = new Date(thisMon); lastSun.setDate(lastSun.getDate() - 1);
    const lmStr = lastMon.toISOString().slice(0, 10);
    const lsStr = lastSun.toISOString().slice(0, 10);
    return absences.filter(a => a.startDate <= lsStr && a.endDate >= lmStr);
  }
  if (filter === "month") {
    const start = new Date(ref.getFullYear(), ref.getMonth(), 1).toISOString().slice(0, 10);
    return absences.filter(a => a.endDate >= start);
  }
  return absences;
}

// ─── Share text ───────────────────────────────────────────────
function buildShareText(sessions: Session[], absences: AbsenceEntry[], name: string, schedule: WeekSchedule) {
  const wNorm = weeklyNetMin(schedule);
  const completed = sessions.filter(s => s.checkOut !== null);

  const dateSet = new Set<string>();
  for (const s of completed) dateSet.add(new Date(s.checkIn).toISOString().slice(0, 10));
  for (const a of absences) expandAbsenceDates(a).forEach(d => dateSet.add(d));

  const weekMap: Record<string, Set<string>> = {};
  for (const d of dateSet) {
    const wk = weekKey(new Date(d + "T12:00:00"));
    if (!weekMap[wk]) weekMap[wk] = new Set();
    weekMap[wk].add(d);
  }

  const byDate = groupByDate(completed);
  const weeks = Object.keys(weekMap).sort((a, b) => b.localeCompare(a)).slice(0, 8);
  const lines: string[] = [`⏱ Tidrapport${name ? " – " + name : ""}\n`];
  let grandNet = 0;

  for (const wMon of weeks) {
    const wDates = [...weekMap[wMon]].sort();
    const wSessions = wDates.flatMap(d => byDate[d] ?? []);
    const wNet = computeWeekNet(wSessions, schedule);
    grandNet += wNet;
    const diff = wNet - wNorm;
    const diffStr = diff >= 0
      ? `+${fmtMin(diff)}`
      : `−${fmtMin(Math.abs(diff))}`;
    lines.push(`── ${weekRangeLabel(wMon)} ──`);
    lines.push(`Totalt: ${fmtMin(wNet)}  (${diffStr} mot norm)\n`);

    for (const d of wDates) {
      const ds = byDate[d] ?? [];
      const da = getAbsencesForDate(absences, d);
      if (ds.length === 0 && da.length === 0) continue;

      if (ds.length > 0) {
        const { net } = computeDayMinutes(ds, d, schedule);
        lines.push(`  ${fmtDateLabel(d)}: ${fmtMin(net)}`);
        for (const s of ds) {
          lines.push(`    ${fmtTime(s.checkIn)} → ${fmtTime(s.checkOut)}${s.manual ? " ✏️" : ""}`);
        }
      } else {
        const a = da[0];
        if (a.startDate === d) {
          const meta = ABSENCE_META[a.category];
          lines.push(`  ${a.startDate === a.endDate ? fmtDateLabel(d) : absenceDateRangeLabel(a)}: ${meta.emoji} ${meta.label}`);
        }
      }
      if (ds.length > 0) {
        for (const a of da) {
          const meta = ABSENCE_META[a.category];
          lines.push(`    ${meta.emoji} ${meta.label}${a.startDate !== a.endDate ? ` (${absenceDateRangeLabel(a)})` : ""}`);
        }
      }
    }
    lines.push("");
  }

  lines.push(`Total: ${fmtMin(grandNet)}`);
  lines.push(`\nGenererat ${new Date().toLocaleString("sv-SE")}`);
  return lines.join("\n");
}

// ─── Flex bank ────────────────────────────────────────────────
function computeFlexMinutes(sessions: Session[], absences: AbsenceEntry[], schedule: WeekSchedule): number {
  const today = todayStr();
  const byDate = groupByDate(
    sessions.filter(s => s.checkOut !== null && new Date(s.checkIn).toISOString().slice(0, 10) < today)
  );

  let flex = 0;

  // Each past day with sessions: actual net - scheduled net
  for (const [date, daySessions] of Object.entries(byDate)) {
    const { net } = computeDayMinutes(daySessions, date, schedule);
    const dayCfg = schedule[dayKeyOf(new Date(date + "T12:00:00"))];
    flex += net - netDayMin(dayCfg);
  }

  // Flex-leave absences on days without sessions: deduct hours from flex bank
  for (const a of absences) {
    if (a.category !== "flex") continue;
    const dates = expandAbsenceDates(a).filter(d => d < today && !byDate[d]);
    for (const date of dates) {
      const dayCfg = schedule[dayKeyOf(new Date(date + "T12:00:00"))];
      const absMin = a.hours !== undefined ? Math.round(a.hours * 60) : netDayMin(dayCfg);
      flex -= absMin;
    }
  }

  return flex;
}

// ─── CSV export ───────────────────────────────────────────────
function buildCsvExport(sessions: Session[], absences: AbsenceEntry[], schedule: WeekSchedule, year: number, month: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthStart = `${year}-${pad(month + 1)}-01`;
  const monthEnd = `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`;

  const header = ["Datum", "Veckodag", "Incheckning", "Utcheckning", "Netto (min)", "Netto (h)", "Typ", "Kategori", "Anteckning"];
  const dataRows: string[][] = [];

  for (const s of sessions) {
    if (!s.checkOut) continue;
    const d = new Date(s.checkIn).toISOString().slice(0, 10);
    if (d < monthStart || d > monthEnd) continue;
    const { net } = computeDayMinutes([s], d, schedule);
    dataRows.push([
      d,
      new Date(d + "T12:00:00").toLocaleDateString("sv-SE", { weekday: "long" }),
      fmtTime(s.checkIn),
      fmtTime(s.checkOut),
      String(Math.round(net)),
      fmtDur(net),
      "Arbete", "", "",
    ]);
  }

  for (const a of absences) {
    if (a.startDate > monthEnd || a.endDate < monthStart) continue;
    const meta = ABSENCE_META[a.category];
    for (const d of expandAbsenceDates(a).filter(x => x >= monthStart && x <= monthEnd)) {
      const dayCfg = schedule[dayKeyOf(new Date(d + "T12:00:00"))];
      const absMin = a.hours !== undefined ? Math.round(a.hours * 60) : netDayMin(dayCfg);
      dataRows.push([
        d,
        new Date(d + "T12:00:00").toLocaleDateString("sv-SE", { weekday: "long" }),
        "", "",
        String(absMin),
        fmtDur(absMin),
        "Avvikelse",
        meta.label,
        a.note ?? "",
      ]);
    }
  }

  dataRows.sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]));
  const csv = [header, ...dataRows].map(row => row.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
  return "﻿" + csv; // BOM for Excel UTF-8 detection
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Storage ──────────────────────────────────────────────────
function load(): StorageShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const p = raw ? JSON.parse(raw) : {};
    let schedule: WeekSchedule;
    if (p.schedule) {
      // Migrate old gross+lunch model → net model
      schedule = migrateSchedule(p.schedule as Record<string, unknown>);
    } else if (p.normHours) {
      schedule = migrateNormHours(p.normHours as number);
    } else {
      schedule = DEFAULT_SCHEDULE;
    }
    return {
      name: p.name ?? "",
      schedule,
      department: p.department,
      onboardingDone: p.onboardingDone ?? false,
      sessions: p.sessions ?? [],
      absences: p.absences ?? [],
      flexBaseMinutes: typeof p.flexBaseMinutes === "number" ? p.flexBaseMinutes : 0,
    };
  } catch {
    return { name: "", schedule: DEFAULT_SCHEDULE, onboardingDone: false, sessions: [], absences: [] };
  }
}

function save(data: StorageShape) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

// ─── Icons ────────────────────────────────────────────────────
function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
    </svg>
  );
}

function IconCalendarX() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="10" y1="14" x2="14" y2="18" />
      <line x1="14" y1="14" x2="10" y2="18" />
    </svg>
  );
}

// ─── Main App ─────────────────────────────────────────────────
export default function PunchClock() {
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState<WeekSchedule>(DEFAULT_SCHEDULE);
  const [department, setDepartment] = useState<string | undefined>();
  const [onboardingDone, setOnboardingDone] = useState(true);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [absences, setAbsences] = useState<AbsenceEntry[]>([]);
  const [, setTick] = useState(0);
  const [view, setView] = useState<"clock" | "history" | "share">("clock");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [addModal, setAddModal] = useState(false);
  const [absenceModal, setAbsenceModal] = useState(false);
  const [scheduleModal, setScheduleModal] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);
  const [addForDate, setAddForDate] = useState<string | null>(null);
  const [editSession, setEditSession] = useState<Session | null>(null);
  const [shareText, setShareText] = useState("");
  const [shared, setShared] = useState(false);
  const [shortWarn, setShortWarn] = useState(false);
  const [flexBaseMinutes, setFlexBaseMinutes] = useState(0);
  const [historyMode, setHistoryMode] = useState<"list" | "calendar">("list");
  const [calendarSelectedDate, setCalendarSelectedDate] = useState<string | null>(null);
  const [exportMonth, setExportMonth] = useState<{ year: number; month: number }>(() => {
    const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() };
  });

  useEffect(() => {
    const t = setInterval(() => {
      setTick(x => x + 1);

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
    const d = load();
    setName(d.name);
    setSchedule(d.schedule);
    setDepartment(d.department);
    setOnboardingDone(d.onboardingDone);
    setSessions(d.sessions);
    setAbsences(d.absences);
    setFlexBaseMinutes(d.flexBaseMinutes ?? 0);
  }, []);

  useEffect(() => {
    save({ name, schedule, department, onboardingDone, sessions, absences, flexBaseMinutes });
  }, [name, schedule, department, onboardingDone, sessions, absences, flexBaseMinutes]);

  const weeklyNorm = weeklyNetMin(schedule);
  const activeSession = sessions.find(s => !s.checkOut);
  const todaySessions = sessions.filter(s => new Date(s.checkIn).toISOString().slice(0, 10) === todayStr());
  const todayDate = todayStr();
  const { net: todayNet } = computeDayMinutes(todaySessions, todayDate, schedule);
  void todayNet;
  const isIn = !!activeSession;

  const filteredSessions = filterSessions(sessions, historyFilter);
  const filteredAbsences = filterAbsences(absences, historyFilter);
  const currentWeekKey = weekKey(new Date());

  function getHistoryDates(fSessions: Session[], fAbsences: AbsenceEntry[]) {
    const dateSet = new Set<string>();
    for (const s of fSessions) dateSet.add(new Date(s.checkIn).toISOString().slice(0, 10));
    for (const a of fAbsences) expandAbsenceDates(a).forEach(d => dateSet.add(d));
    return dateSet;
  }

  function handlePunch() {
    if (isIn && activeSession) {
      const elapsed = now() - activeSession.checkIn;
      if (elapsed < SHORT_SESSION_THRESHOLD_MS) { setShortWarn(true); return; }
      doCheckOut();
    } else {
      setSessions(prev => [...prev, { id: crypto.randomUUID(), checkIn: now(), checkOut: null, manual: false }]);
    }
  }

  function doCheckOut() {
    if (!activeSession) return;
    setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, checkOut: now() } : s));
    setShortWarn(false);
  }

  function doDiscardShort() {
    if (!activeSession) return;
    setSessions(prev => prev.filter(s => s.id !== activeSession.id));
    setShortWarn(false);
  }

  function handleDeleteSession(id: string) { setSessions(prev => prev.filter(s => s.id !== id)); }
  function handleEditSession(session: Session) { setEditSession(session); }
  function handleSaveEdit(updated: Session) {
    setSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
    setEditSession(null);
  }
  function handleDeleteAbsence(id: string) { setAbsences(prev => prev.filter(a => a.id !== id)); }
  function handleSaveAbsence(entry: AbsenceEntry) {
    setAbsences(prev => [...prev, entry]);
    setAbsenceModal(false);
  }
  function handleOnboardingComplete(result: OnboardingResult) {
    setName(result.name);
    setSchedule(result.schedule);
    setDepartment(result.department);
    setOnboardingDone(true);
  }

  function handleSettingsSave(result: { name: string; department?: string }) {
    setName(result.name);
    setDepartment(result.department);
    setSettingsModal(false);
  }

  function handleShare() {
    setShareText(buildShareText(sessions, absences, name, schedule));
    setView("share");
    setShared(false);
  }

  async function doCopy() {
    try { await navigator.clipboard.writeText(shareText); setShared(true); } catch { /* ignore */ }
  }

  async function doNativeShare() {
    if (navigator.share) {
      try { await navigator.share({ title: "Tidrapport", text: shareText }); setShared(true); } catch { /* ignore */ }
    } else { doCopy(); }
  }

  const flexTotal = flexBaseMinutes + computeFlexMinutes(sessions, absences, schedule);

  const liveMs = activeSession ? (now() - activeSession.checkIn) : 0;
  const todayCfg = schedule[dayKeyOf(new Date(todayDate + "T12:00:00"))];
  const liveNetRaw = todaySessions.reduce((a, s) => a + ((s.checkOut ?? now()) - s.checkIn), 0) / 60000;
  const liveNet = Math.max(0, liveNetRaw - (todayCfg.active ? todayCfg.lunchMinutes : 0));

  const FILTERS: { key: HistoryFilter; label: string }[] = [
    { key: "week",     label: "Den här veckan" },
    { key: "lastweek", label: "Förra veckan"   },
    { key: "month",    label: "Denna månad"    },
    { key: "all",      label: "Allt"           },
  ];

  // ── Onboarding gate ─────────────────────────────────────────
  if (!onboardingDone) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="min-h-screen bg-pc-bg font-display text-pc-ink antialiased">
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

      <div className="mx-auto max-w-[480px] min-h-screen flex flex-col relative pb-[88px]">
        <div className="h-[env(safe-area-inset-top,0px)]" />

        {/* Header */}
        <header className="px-5 pt-6 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-pc-orange flex items-center justify-center shadow-[0_4px_14px_rgba(255,95,0,0.35)]">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
              </svg>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-pc-muted">
                Tidrapport{department ? ` · ${department}` : ""}
              </div>
              <div className="text-[17px] font-bold leading-tight text-pc-ink">
                {name || "—"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isIn && (
              <div className="flex items-center gap-1.5 bg-pc-orange/10 text-pc-orange-deep px-3 py-1.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-pc-orange animate-pulse" />
                <span className="text-[12px] font-bold">LIVE</span>
              </div>
            )}
            <button
              onClick={() => setSettingsModal(true)}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-pc-muted hover:text-pc-orange hover:bg-pc-peach transition-colors"
              aria-label="Inställningar"
            >
              <IconGear />
            </button>
          </div>
        </header>

        <main className="flex-1 px-5">

          {/* ── CLOCK ── */}
          {view === "clock" && (
            <div className="pc-fade">
              <div className="text-center mt-6 mb-10">
                <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-pc-muted mb-6">
                  {isIn ? "Du är incheckad" : "Inte incheckad"}
                </div>
                <div className="relative inline-block">
                  {isIn && <span className="pc-pulse-ring absolute inset-0 rounded-full" />}
                  <button
                    onClick={handlePunch}
                    className="pc-press relative w-[200px] h-[200px] rounded-full text-white font-extrabold flex flex-col items-center justify-center gap-1.5"
                    style={{
                      background: isIn
                        ? "linear-gradient(145deg, #ff5f00 0%, #fb4f00 100%)"
                        : "linear-gradient(145deg, #512b2b 0%, #2d1717 100%)",
                      boxShadow: isIn
                        ? "0 18px 48px -12px rgba(255,95,0,0.55), inset 0 1px 0 rgba(255,255,255,0.2)"
                        : "0 18px 48px -12px rgba(81,43,43,0.45), inset 0 1px 0 rgba(255,255,255,0.1)",
                    }}
                  >
                    <svg viewBox="0 0 24 24" className="w-9 h-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      {isIn
                        ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                        : <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" />}
                    </svg>
                    <span className="text-[19px] tracking-tight">{isIn ? "Checka ut" : "Checka in"}</span>
                  </button>
                </div>
                {isIn && activeSession && (
                  <div className="mt-7 pc-pop">
                    <div className="text-[34px] font-extrabold tabular-nums tracking-tight text-pc-ink">{fmtDur(liveMs / 60000)}</div>
                    <div className="text-[13px] text-pc-muted font-medium mt-0.5">Sedan {fmtTime(activeSession.checkIn)}</div>
                  </div>
                )}
              </div>

              <section className="bg-white rounded-[24px] p-5 mb-3 shadow-[0_2px_12px_rgba(81,43,43,0.04)] border border-pc-line">
                <div className="flex items-baseline justify-between mb-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-pc-muted">Idag</div>
                  <div className="text-[12px] font-semibold text-pc-muted capitalize">
                    {new Date().toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "short" })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Netto arbetstid" value={fmtDur(liveNet)} accent />
                  <Stat label="Antal pass" value={`${todaySessions.length} st`} />
                </div>
                <div className="mt-3 pt-3 border-t border-pc-line flex items-center justify-between">
                  <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-pc-muted">Flexsaldo</div>
                  <div className={`text-[17px] font-extrabold tabular-nums ${
                    flexTotal > 0 ? "text-green-600" : flexTotal < 0 ? "text-red-500" : "text-pc-muted"
                  }`}>
                    {flexTotal > 0 ? "+" : flexTotal < 0 ? "−" : ""}{fmtMin(Math.abs(flexTotal))}
                  </div>
                </div>
                {todaySessions.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-pc-line space-y-1">
                    {todaySessions.map((s, i) => (
                      <SessionRow key={s.id} session={s} index={i}
                        onEdit={() => handleEditSession(s)}
                        onDelete={() => handleDeleteSession(s.id)} />
                    ))}
                  </div>
                )}
              </section>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <button
                  onClick={() => setAddModal(true)}
                  className="pc-press bg-white border border-pc-line rounded-[20px] py-4 font-bold text-[14px] text-pc-ink flex items-center justify-center gap-2"
                >
                  <span className="text-pc-orange text-xl leading-none">+</span> Lägg till tid
                </button>
                <button
                  onClick={() => setAbsenceModal(true)}
                  className="pc-press bg-white border border-pc-line rounded-[20px] py-4 font-bold text-[14px] text-pc-ink flex items-center justify-center gap-2"
                >
                  <span className="text-pc-muted"><IconCalendarX /></span> Avvikelse
                </button>
              </div>
              <button
                onClick={() => setScheduleModal(true)}
                className="pc-press w-full rounded-[20px] py-4 font-bold text-[15px] text-white flex items-center justify-center gap-2"
                style={{
                  background: "linear-gradient(135deg, #ff5f00 0%, #e04d00 100%)",
                  boxShadow: "0 6px 20px -6px rgba(255,95,0,0.5)",
                }}
              >
                <IconCalendar /> Planera dagar
              </button>
            </div>
          )}

          {/* ── HISTORY ── */}
          {view === "history" && (
            <div className="pc-fade pt-2">
              <div className="flex items-center justify-between mb-4">
                <h1 className="text-[28px] font-extrabold tracking-tight">Historik</h1>
                <div className="flex bg-white border border-pc-line rounded-full p-0.5">
                  <button
                    onClick={() => setHistoryMode("list")}
                    className={`px-3 py-1 rounded-full text-[12px] font-bold transition-colors ${historyMode === "list" ? "bg-pc-orange text-white" : "text-pc-muted"}`}
                  >
                    Lista
                  </button>
                  <button
                    onClick={() => setHistoryMode("calendar")}
                    className={`px-3 py-1 rounded-full text-[12px] font-bold transition-colors ${historyMode === "calendar" ? "bg-pc-orange text-white" : "text-pc-muted"}`}
                  >
                    Kalender
                  </button>
                </div>
              </div>

              {historyMode === "calendar" && (
                <>
                  <CalendarView
                    sessions={sessions}
                    absences={absences}
                    schedule={schedule}
                    selectedDate={calendarSelectedDate}
                    onSelectDate={d => setCalendarSelectedDate(prev => prev === d ? null : d)}
                  />
                  {calendarSelectedDate && (() => {
                    const daySessions = sessions.filter(s => new Date(s.checkIn).toISOString().slice(0, 10) === calendarSelectedDate);
                    const dayAbsences = getAbsencesForDate(absences, calendarSelectedDate);
                    const dayCfg = schedule[dayKeyOf(new Date(calendarSelectedDate + "T12:00:00"))];
                    const { net: dayNet } = computeDayMinutes(daySessions, calendarSelectedDate, schedule);
                    const scheduledMin = netDayMin(dayCfg);
                    const diff = dayNet - scheduledMin;
                    return (
                      <div className="bg-white rounded-[22px] border border-pc-line shadow-[0_2px_14px_rgba(81,43,43,0.05)] overflow-hidden mb-4">
                        <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
                          <div>
                            <div className="font-bold text-[18px] capitalize">{fmtDateLabel(calendarSelectedDate)}</div>
                            {daySessions.length > 0 && (
                              <div className="text-[26px] font-extrabold tabular-nums tracking-tight text-pc-orange-deep mt-0.5">{fmtDur(dayNet)}</div>
                            )}
                            {dayCfg.active && scheduledMin > 0 && (
                              <div className="text-[12px] text-pc-muted font-medium mt-0.5">
                                Schema: {dayCfg.startTime}–{dayCfg.endTime} · {fmtMin(scheduledMin)} netto
                              </div>
                            )}
                          </div>
                          {daySessions.length > 0 && scheduledMin > 0 && (
                            <div className={`shrink-0 mt-1 px-3 py-1.5 rounded-full text-[12px] font-extrabold flex items-center gap-1.5 ${
                              diff >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                            }`}>
                              <span className={`w-2 h-2 rounded-full ${diff >= 0 ? "bg-green-500" : "bg-red-400"}`} />
                              {diff >= 0 ? `+${fmtMin(diff)}` : `−${fmtMin(Math.abs(diff))}`}
                            </div>
                          )}
                        </div>

                        <div className="px-4 pb-4 pt-3 border-t border-pc-line space-y-2">
                          {dayAbsences.map(a => (
                            <div key={a.id} className="flex items-center gap-2">
                              <div className="flex-1 min-w-0 bg-pc-peach text-pc-orange-deep rounded-[12px] px-3 py-2 flex items-center gap-2">
                                <span className="text-[16px] leading-none shrink-0">{ABSENCE_META[a.category as AbsenceCategory].emoji}</span>
                                <div className="min-w-0">
                                  <div className="font-bold text-[13px] leading-tight">{ABSENCE_META[a.category as AbsenceCategory].label}</div>
                                  <div className="text-[11px] opacity-75 font-medium">
                                    {a.hours !== undefined ? `${a.hours}h` : "Hel dag"}
                                    {a.startDate !== a.endDate && ` · ${absenceDateRangeLabel(a)}`}
                                  </div>
                                  {a.note && <div className="text-[11px] opacity-70 mt-0.5 truncate">{a.note}</div>}
                                </div>
                              </div>
                              {a.startDate === calendarSelectedDate && (
                                <button
                                  onClick={() => handleDeleteAbsence(a.id)}
                                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl text-pc-muted hover:text-red-500 hover:bg-red-50 transition-colors"
                                  aria-label="Ta bort avvikelse"
                                >
                                  <IconTrash />
                                </button>
                              )}
                            </div>
                          ))}

                          {daySessions.length > 0 && (
                            <div className="space-y-0.5">
                              {daySessions.map((s, i) => (
                                <SessionRow key={s.id} session={s} index={i}
                                  onEdit={() => handleEditSession(s)}
                                  onDelete={() => handleDeleteSession(s.id)} />
                              ))}
                            </div>
                          )}

                          {daySessions.length === 0 && dayAbsences.length === 0 && (
                            <div className="text-pc-muted text-[13px] text-center py-1">Inga registreringar denna dag.</div>
                          )}

                          <button
                            onClick={() => setAddForDate(calendarSelectedDate)}
                            className="pc-press w-full flex items-center justify-center gap-1.5 py-2.5 rounded-[12px] border border-dashed border-pc-line text-pc-muted text-[13px] font-semibold hover:border-pc-orange hover:text-pc-orange transition-colors"
                          >
                            <span className="text-[15px] leading-none">+</span> Lägg till tid
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}

              {historyMode === "list" && (<>
              <div className="flex gap-2 mb-5 overflow-x-auto hide-scroll -mx-1 px-1">
                {FILTERS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setHistoryFilter(key)}
                    className={`pc-press shrink-0 px-4 py-2 rounded-full text-[13px] font-bold transition-colors ${
                      historyFilter === key
                        ? "bg-pc-orange text-white shadow-[0_4px_12px_-4px_rgba(255,95,0,0.45)]"
                        : "bg-white border border-pc-line text-pc-muted"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {(() => {
                const allDates = getHistoryDates(filteredSessions, filteredAbsences);
                if (allDates.size === 0) {
                  return (
                    <div className="text-center text-pc-muted py-20 text-[15px]">
                      <div className="text-4xl mb-3 opacity-40">📋</div>
                      Inga tider för vald period.
                    </div>
                  );
                }

                const weekMap: Record<string, string[]> = {};
                for (const d of allDates) {
                  const wk = weekKey(new Date(d + "T12:00:00"));
                  if (!weekMap[wk]) weekMap[wk] = [];
                  weekMap[wk].push(d);
                }
                const byDate = groupByDate(filteredSessions);

                return (
                  <div className="space-y-4">
                    {Object.entries(weekMap)
                      .sort((a, b) => b[0].localeCompare(a[0]))
                      .map(([wMon, wDates]) => {
                        const wSessions = wDates.flatMap(d => byDate[d] ?? []);
                        const wNet = computeWeekNet(wSessions, schedule);
                        const isCurrentWeek = wMon === currentWeekKey;
                        const meetsNorm = wNet >= weeklyNorm;
                        const diff = wNet - weeklyNorm;
                        const sortedDates = [...wDates].sort((a, b) => b.localeCompare(a));

                        return (
                          <div key={wMon} className="bg-white rounded-[22px] border border-pc-line shadow-[0_2px_14px_rgba(81,43,43,0.05)] overflow-hidden">
                            <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
                              <div>
                                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-pc-muted mb-1.5">
                                  {weekRangeLabel(wMon)}
                                </div>
                                <div className="text-[24px] font-extrabold tabular-nums tracking-tight leading-none">
                                  {fmtDur(wNet)}
                                </div>
                                <div className="text-[12px] text-pc-muted mt-0.5 font-medium">
                                  av {fmtMin(weeklyNorm)} norm
                                </div>
                              </div>
                              <div className={`shrink-0 mt-0.5 px-3 py-1.5 rounded-full text-[12px] font-extrabold flex items-center gap-1.5 ${
                                meetsNorm ? "bg-green-50 text-green-700"
                                  : isCurrentWeek ? "bg-amber-50 text-amber-700"
                                  : "bg-red-50 text-red-600"
                              }`}>
                                <span className={`w-2 h-2 rounded-full ${
                                  meetsNorm ? "bg-green-500" : isCurrentWeek ? "bg-amber-400" : "bg-red-400"
                                }`} />
                                {meetsNorm
                                  ? `+${fmtMin(diff)}`
                                  : isCurrentWeek ? "Pågår"
                                  : `−${fmtMin(Math.abs(diff))}`}
                              </div>
                            </div>

                            {sortedDates.map(date => {
                              const daySessions = byDate[date] ?? [];
                              const dayAbsences = getAbsencesForDate(filteredAbsences, date);
                              const { net: dayNet } = computeDayMinutes(daySessions, date, schedule);

                              return (
                                <div key={date} className="px-4 py-3 border-t border-pc-line">
                                  <div className="flex justify-between items-baseline mb-2">
                                    <div className="font-bold text-[14px] capitalize">{fmtDateLabel(date)}</div>
                                    {daySessions.length > 0 && (
                                      <div className="font-bold text-pc-orange text-[14px] tabular-nums">{fmtDur(dayNet)}</div>
                                    )}
                                  </div>

                                  {dayAbsences.map(a => (
                                    <div key={a.id} className="flex items-center gap-2 mb-2">
                                      <div className="flex-1 min-w-0 bg-pc-peach text-pc-orange-deep rounded-[12px] px-3 py-2 flex items-center gap-2">
                                        <span className="text-[16px] leading-none shrink-0">{ABSENCE_META[a.category as AbsenceCategory].emoji}</span>
                                        <div className="min-w-0">
                                          <div className="font-bold text-[13px] leading-tight">{ABSENCE_META[a.category as AbsenceCategory].label}</div>
                                          <div className="text-[11px] opacity-75 font-medium">
                                            {a.hours !== undefined ? `${a.hours}h` : "Hel dag"}
                                            {a.startDate !== a.endDate && ` · ${absenceDateRangeLabel(a)}`}
                                          </div>
                                          {a.note && <div className="text-[11px] opacity-70 mt-0.5 truncate">{a.note}</div>}
                                        </div>
                                      </div>
                                      {a.startDate === date && (
                                        <button
                                          onClick={() => handleDeleteAbsence(a.id)}
                                          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl text-pc-muted hover:text-red-500 hover:bg-red-50 transition-colors"
                                          aria-label="Ta bort avvikelse"
                                        >
                                          <IconTrash />
                                        </button>
                                      )}
                                    </div>
                                  ))}

                                  {daySessions.length > 0 && (
                                    <div className="space-y-0.5">
                                      {daySessions.map((s, i) => (
                                        <SessionRow key={s.id} session={s} index={i}
                                          onEdit={() => handleEditSession(s)}
                                          onDelete={() => handleDeleteSession(s.id)} />
                                      ))}
                                    </div>
                                  )}

                                  <button
                                    onClick={() => setAddForDate(date)}
                                    className="pc-press mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-[12px] border border-dashed border-pc-line text-pc-muted text-[12px] font-semibold hover:border-pc-orange hover:text-pc-orange transition-colors"
                                  >
                                    <span className="text-[14px] leading-none">+</span> Lägg till tid
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                  </div>
                );
              })()}
            </>)}
            </div>
          )}

          {/* ── SHARE ── */}
          {view === "share" && (
            <div className="pc-fade pt-2">
              <button onClick={() => setView("clock")} className="text-pc-orange font-semibold text-[15px] mb-3 flex items-center gap-1">
                ← Tillbaka
              </button>
              <h1 className="text-[28px] font-extrabold tracking-tight mb-1">Dela rapport</h1>
              <p className="text-[14px] text-pc-muted mb-5">Kopiera eller dela som text — till dig själv eller din chef.</p>
              <textarea
                readOnly value={shareText}
                className="w-full min-h-[280px] border border-pc-line rounded-[18px] p-4 text-[13px] leading-[1.7] bg-white text-pc-ink resize-none outline-none"
                style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              />
              <div className="grid grid-cols-2 gap-3 mt-4">
                <button onClick={doCopy} className="pc-press py-4 rounded-[18px] bg-white border border-pc-line text-pc-ink font-bold text-[15px]">
                  {shared ? "✓ Kopierat!" : "Kopiera"}
                </button>
                <button onClick={doNativeShare} className="pc-press py-4 rounded-[18px] bg-pc-orange text-white font-bold text-[15px] shadow-[0_8px_20px_-8px_rgba(255,95,0,0.6)]">
                  Dela
                </button>
              </div>

              {/* Excel / CSV export */}
              <div className="mt-6 pt-5 border-t border-pc-line">
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-pc-muted mb-3">Exportera per månad</div>
                <div className="flex gap-2 mb-4 overflow-x-auto hide-scroll -mx-1 px-1">
                  {Array.from({ length: 6 }, (_, i) => {
                    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
                    return { year: d.getFullYear(), month: d.getMonth() };
                  }).map(({ year, month }) => (
                    <button
                      key={`${year}-${month}`}
                      onClick={() => setExportMonth({ year, month })}
                      className={`pc-press shrink-0 px-4 py-2 rounded-full text-[13px] font-bold transition-colors ${
                        exportMonth.year === year && exportMonth.month === month
                          ? "bg-pc-orange text-white shadow-[0_4px_12px_-4px_rgba(255,95,0,0.45)]"
                          : "bg-white border border-pc-line text-pc-muted"
                      }`}
                    >
                      {new Date(year, month).toLocaleDateString("sv-SE", { month: "short", year: "2-digit" })}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => {
                    const { year, month } = exportMonth;
                    const csv = buildCsvExport(sessions, absences, schedule, year, month);
                    const pad = (n: number) => String(n).padStart(2, "0");
                    downloadCsv(csv, `tidrapport-${year}-${pad(month + 1)}.csv`);
                  }}
                  className="pc-press w-full py-4 rounded-[18px] bg-white border border-pc-line text-pc-ink font-bold text-[15px] flex items-center justify-center gap-2"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="12" y1="11" x2="12" y2="17" />
                    <polyline points="9 14 12 17 15 14" />
                  </svg>
                  Ladda ner Excel (CSV)
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Bottom nav */}
        <nav
          className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-white/85 backdrop-blur-xl border-t border-pc-line px-2"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6px)" }}
        >
          <div className="grid grid-cols-3 gap-1 pt-2">
            <NavItem active={view === "clock"} onClick={() => setView("clock")} label="Klocka" icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            } />
            <NavItem active={view === "history"} onClick={() => setView("history")} label="Historik" icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>
            } />
            <NavItem active={view === "share"} onClick={handleShare} label="Dela" icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M12 3v13" /><path d="m7 8 5-5 5 5" /><path d="M5 21h14" /></svg>
            } />
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
        <SessionModal schedule={schedule} onClose={() => setAddModal(false)}
          onSave={s => { setSessions(prev => [...prev, s]); setAddModal(false); }} />
      )}

      {addForDate && (
        <SessionModal schedule={schedule} defaultDate={addForDate}
          onClose={() => setAddForDate(null)}
          onSave={s => { setSessions(prev => [...prev, s]); setAddForDate(null); }} />
      )}

      {editSession && (
        <SessionModal schedule={schedule} session={editSession}
          onClose={() => setEditSession(null)}
          onSave={handleSaveEdit} />
      )}

      <AbsenceModal
        open={absenceModal}
        onClose={() => setAbsenceModal(false)}
        onSave={handleSaveAbsence}
      />

      <ScheduleEditorModal
        open={scheduleModal}
        schedule={schedule}
        onClose={() => setScheduleModal(false)}
        onSave={s => { setSchedule(s); setScheduleModal(false); }}
      />

      <SettingsModal
        open={settingsModal}
        initialName={name}
        initialDepartment={department}
        onClose={() => setSettingsModal(false)}
        onSave={handleSettingsSave}
      />
    </div>
  );
}

// ─── Session Row ───────────────────────────────────────────────
function SessionRow({ session, index, onEdit, onDelete }: {
  session: Session; index: number; onEdit: () => void; onDelete: () => void;
}) {
  const dur = fmtDur(((session.checkOut ?? now()) - session.checkIn) / 60000);
  const timeRange = session.checkOut
    ? `${fmtTime(session.checkIn)} → ${fmtTime(session.checkOut)}`
    : `${fmtTime(session.checkIn)} → pågår`;

  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-bold text-pc-ink">Pass {index + 1}</span>
          {session.manual && <span className="text-[11px] text-pc-muted">✏️</span>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[13px] text-pc-muted tabular-nums font-medium">{timeRange}</span>
          {session.checkOut && <span className="text-[12px] text-pc-orange-deep font-semibold tabular-nums">{dur}</span>}
        </div>
        {session.note && (
          <div className="text-[11px] text-pc-muted font-medium mt-0.5 leading-snug">{session.note}</div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {session.checkOut && (
          <button onClick={onEdit} className="w-8 h-8 flex items-center justify-center rounded-xl text-pc-muted hover:text-pc-orange hover:bg-pc-peach transition-colors" aria-label="Redigera pass">
            <IconEdit />
          </button>
        )}
        <button onClick={onDelete} className="w-8 h-8 flex items-center justify-center rounded-xl text-pc-muted hover:text-red-500 hover:bg-red-50 transition-colors" aria-label="Ta bort pass">
          <IconTrash />
        </button>
      </div>
    </div>
  );
}

// ─── Short Session Warning ─────────────────────────────────────
function ShortSessionWarning({ elapsed, onStop, onCancel }: {
  elapsed: number; onStop: () => void; onCancel: () => void;
}) {
  const secs = Math.floor(elapsed / 1000);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center pc-overlay" style={{ background: "rgba(45,23,23,0.55)" }} onClick={onCancel}>
      <div className="pc-sheet bg-white w-full max-w-[480px] rounded-t-[28px] px-6 pt-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)" }} onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-pc-line rounded-full mx-auto mb-5" />
        <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mb-4 mx-auto">
          <svg viewBox="0 0 24 24" className="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div className="text-center mb-2">
          <div className="font-extrabold text-[20px] tracking-tight mb-2">Ingen tid registreras</div>
          <div className="text-[14px] text-pc-muted leading-relaxed">
            Du har bara stämplat in i <span className="font-bold text-pc-ink">{secs} sekunder</span>.
            Pass kortare än 1 minut sparas inte.
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-6">
          <button onClick={onCancel} className="pc-press py-4 rounded-[16px] bg-pc-bg border border-pc-line font-bold text-[15px] text-pc-ink">Avbryt</button>
          <button onClick={onStop} className="pc-press py-4 rounded-[16px] bg-pc-orange text-white font-bold text-[15px] shadow-[0_8px_20px_-8px_rgba(255,95,0,0.6)]">Stoppa klockan</button>
        </div>
      </div>
    </div>
  );
}

// ─── Stat ──────────────────────────────────────────────────────
function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-pc-apricot rounded-2xl px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-1">{label}</div>
      <div className={`text-[22px] font-extrabold tabular-nums tracking-tight ${accent ? "text-pc-orange-deep" : "text-pc-ink"}`}>{value}</div>
    </div>
  );
}

// ─── Nav Item ─────────────────────────────────────────────────
function NavItem({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-0.5 py-1.5 rounded-xl transition-colors ${active ? "text-pc-orange" : "text-pc-muted"}`}>
      {icon}
      <span className="text-[10px] font-bold tracking-wide">{label}</span>
    </button>
  );
}

// ─── Session Modal ─────────────────────────────────────────────
function SessionModal({ session, defaultDate, schedule, onClose, onSave }: {
  session?: Session; defaultDate?: string; schedule: WeekSchedule;
  onClose: () => void; onSave: (s: Session) => void;
}) {
  const isEdit = !!session;
  const initDate = session
    ? new Date(session.checkIn).toISOString().slice(0, 10)
    : (defaultDate ?? todayStr());
  const initCfg = schedule[dayKeyOf(new Date(initDate + "T12:00:00"))];

  // Pre-fill times from schedule when adding a new session
  const initStart = session
    ? new Date(session.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : (initCfg.active ? initCfg.startTime : "");
  const initEnd = session?.checkOut
    ? new Date(session.checkOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : (initCfg.active ? initCfg.endTime : "");

  const [date, setDate] = useState(initDate);
  const [startTime, setStartTime] = useState(initStart);
  const [endTime, setEndTime] = useState(initEnd);
  const [note, setNote] = useState(session?.note ?? "");
  const [err, setErr] = useState("");

  const dayCfg = schedule[dayKeyOf(new Date(date + "T12:00:00"))];
  const scheduledMins = netDayMin(dayCfg);

  function handleSave() {
    if (!startTime) { setErr("Ange starttid."); return; }
    const checkIn = new Date(`${date}T${startTime}`).getTime();
    const checkOut = endTime ? new Date(`${date}T${endTime}`).getTime() : null;
    if (checkOut && checkOut <= checkIn) { setErr("Sluttid måste vara efter starttid."); return; }
    onSave({ id: session?.id ?? crypto.randomUUID(), checkIn, checkOut, manual: true, note: note.trim() || undefined });
  }

  const previewMs = startTime && endTime
    ? new Date(`${date}T${endTime}`).getTime() - new Date(`${date}T${startTime}`).getTime()
    : null;
  const previewMin = previewMs !== null && previewMs > 0 ? previewMs / 60000 : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center pc-overlay" style={{ background: "rgba(45,23,23,0.55)" }} onClick={onClose}>
      <div className="pc-sheet bg-white w-full max-w-[480px] rounded-t-[28px] px-6 pt-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)" }} onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-pc-line rounded-full mx-auto mb-5" />
        <div className="font-extrabold text-[22px] tracking-tight mb-1">{isEdit ? "Redigera pass" : "Lägg till tid"}</div>
        <div className="text-[13px] text-pc-muted mb-6">
          {dayCfg.active
            ? `Schema: ${dayCfg.startTime}–${dayCfg.endTime} · ${fmtMin(scheduledMins)} netto`
            : "Välj datum, start och sluttid."}
        </div>

        <Label>Datum</Label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="pc-input" />
        <Label>Starttid</Label>
        <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="pc-input" />
        <Label>Sluttid <span className="normal-case font-medium tracking-normal">(valfri — lämna tom om pågående)</span></Label>
        <input
          type="time"
          value={endTime}
          onChange={e => setEndTime(e.target.value)}
          className="pc-input"
          style={{ marginBottom: endTime ? "8px" : "16px" }}
        />
        {endTime && (
          <button
            type="button"
            onClick={() => setEndTime("")}
            className="w-full text-center text-[13px] text-pc-muted font-semibold mb-4 py-2 rounded-[12px] bg-pc-bg hover:text-red-500 hover:bg-red-50 transition-colors"
            aria-label="Rensa sluttid"
          >
            Rensa sluttid
          </button>
        )}

        <Label>Anteckning <span className="normal-case font-medium tracking-normal">(valfri)</span></Label>
        <textarea
          rows={2}
          placeholder="t.ex. Startade tidigt, jobbade ikapp på kvällen…"
          value={note}
          onChange={e => setNote(e.target.value)}
          style={{
            width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: "14px",
            border: "1px solid #ece6df", fontSize: "15px", outline: "none",
            background: "#fdf6ee", fontWeight: 500, color: "#2d1717",
            resize: "none", marginBottom: "16px", fontFamily: "inherit",
          }}
          onFocus={e => { e.currentTarget.style.borderColor = "#ff5f00"; e.currentTarget.style.background = "#fff"; }}
          onBlur={e => { e.currentTarget.style.borderColor = "#ece6df"; e.currentTarget.style.background = "#fdf6ee"; }}
        />

        {previewMin !== null && previewMin > 0 && (
          <div className="bg-pc-peach rounded-2xl px-4 py-3 mb-4">
            <div className="font-extrabold text-pc-orange-deep text-[17px]">{fmtDur(previewMin)}</div>
            {scheduledMins > 0 && (
              <div className="text-[12px] text-pc-muted mt-0.5">
                {previewMin >= scheduledMins
                  ? `✓ Uppfyller schema (${fmtMin(scheduledMins)})`
                  : `${fmtMin(scheduledMins - previewMin)} kvar till schema`}
              </div>
            )}
          </div>
        )}

        {err && <div className="text-red-600 text-[13px] mb-3">{err}</div>}

        <div className="grid grid-cols-2 gap-3 mt-2">
          <button onClick={onClose} className="pc-press py-4 rounded-[16px] bg-pc-bg border border-pc-line font-bold text-[15px] text-pc-ink">Avbryt</button>
          <button onClick={handleSave} className="pc-press py-4 rounded-[16px] bg-pc-orange text-white font-bold text-[15px] shadow-[0_8px_20px_-8px_rgba(255,95,0,0.6)]">
            {isEdit ? "Spara ändringar" : "Spara"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">{children}</div>;
}

// ─── Schedule Editor Modal ─────────────────────────────────────
function ScheduleEditorModal({ open, schedule, onClose, onSave }: {
  open: boolean;
  schedule: WeekSchedule;
  onClose: () => void;
  onSave: (s: WeekSchedule) => void;
}) {
  const [draft, setDraft] = useState<WeekSchedule>(schedule);

  // Reset draft when modal opens with new schedule
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) setDraft(schedule);
    prevOpen.current = open;
  }, [open, schedule]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center pc-overlay"
      style={{ background: "rgba(45,23,23,0.55)" }}
      onClick={onClose}
    >
      <div
        className="pc-sheet bg-white w-full max-w-[480px] rounded-t-[28px] px-5 pt-6 overflow-y-auto"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)", maxHeight: "92dvh" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-pc-line rounded-full mx-auto mb-5" />
        <div className="font-extrabold text-[22px] tracking-tight mb-1">Planera dagar</div>
        <div className="text-[13px] text-pc-muted mb-6">
          Ange arbetstider och lunch per dag.
          Norm/vecka: <span className="font-bold text-pc-orange-deep">{fmtMin(weeklyNetMin(draft))}</span>
        </div>

        <WeekScheduleEditor schedule={draft} onChange={setDraft} />

        <div className="grid grid-cols-2 gap-3 mt-6">
          <button
            onClick={onClose}
            style={{ padding: "15px", borderRadius: "16px", background: "#fdf6ee", border: "1.5px solid #ece6df", fontWeight: 700, fontSize: "15px", color: "#2d1717" }}
          >
            Avbryt
          </button>
          <button
            onClick={() => onSave(draft)}
            style={{ padding: "15px", borderRadius: "16px", background: "#ff5f00", color: "white", fontWeight: 700, fontSize: "15px", boxShadow: "0 8px 20px -8px rgba(255,95,0,0.6)" }}
          >
            Spara
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Calendar View ────────────────────────────────────────────
function CalendarView({ sessions, absences, schedule, selectedDate, onSelectDate }: {
  sessions: Session[];
  absences: AbsenceEntry[];
  schedule: WeekSchedule;
  selectedDate?: string | null;
  onSelectDate?: (date: string) => void;
}) {
  const [viewYM, setViewYM] = useState(() => {
    const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() };
  });
  const { year, month } = viewYM;

  // Build cell array starting from the Monday of the week containing the 1st
  const firstOfMonth = new Date(year, month, 1);
  const dow1 = firstOfMonth.getDay();
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - (dow1 === 0 ? 6 : dow1 - 1));

  const cells: Date[] = [];
  const cur = new Date(gridStart);
  do {
    cells.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  } while (cells.length < 35 || cur.getMonth() === month);
  while (cells.length % 7 !== 0) { cells.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }

  const byDate = groupByDate(sessions.filter(s => s.checkOut !== null));
  const todayS = todayStr();

  return (
    <div className="bg-white rounded-[22px] border border-pc-line shadow-[0_2px_14px_rgba(81,43,43,0.05)] p-4 mb-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setViewYM(({ year, month }) => { const d = new Date(year, month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-pc-muted hover:text-pc-ink hover:bg-pc-peach transition-colors text-[22px] font-bold leading-none"
          aria-label="Föregående månad"
        >‹</button>
        <div className="font-extrabold text-[16px] capitalize">
          {new Date(year, month).toLocaleDateString("sv-SE", { month: "long", year: "numeric" })}
        </div>
        <button
          onClick={() => setViewYM(({ year, month }) => { const d = new Date(year, month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-pc-muted hover:text-pc-ink hover:bg-pc-peach transition-colors text-[22px] font-bold leading-none"
          aria-label="Nästa månad"
        >›</button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {["M", "T", "O", "T", "F", "L", "S"].map((d, i) => (
          <div key={i} className="text-center text-[10px] font-bold text-pc-muted py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map(day => {
          const dateStr = day.toISOString().slice(0, 10);
          const inMonth = day.getMonth() === month;
          const isToday = dateStr === todayS;
          const isPast = dateStr < todayS;
          const daySessions = byDate[dateStr] ?? [];
          const dayAbsences = getAbsencesForDate(absences, dateStr);
          const dayCfg = schedule[dayKeyOf(new Date(dateStr + "T12:00:00"))];
          const scheduledMin = netDayMin(dayCfg);
          const { net } = daySessions.length > 0 ? computeDayMinutes(daySessions, dateStr, schedule) : { net: 0 };
          const hasData = daySessions.length > 0 || dayAbsences.length > 0;

          let dotColor = "";
          if (isPast && inMonth && dayCfg.active) {
            if (daySessions.length > 0) dotColor = net >= scheduledMin ? "bg-green-500" : "bg-amber-400";
            else if (dayAbsences.length > 0) dotColor = dayAbsences.some(a => a.category === "flex") ? "bg-pc-orange" : "bg-blue-400";
            else dotColor = "bg-red-300";
          }

          const isSelected = selectedDate === dateStr && inMonth;
          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => inMonth && onSelectDate?.(dateStr)}
              className={`flex flex-col items-center justify-center rounded-xl py-1.5 relative min-h-[44px] transition-colors
                ${!inMonth ? "opacity-25 cursor-default" : "cursor-pointer"}
                ${isToday ? "ring-2 ring-pc-orange ring-offset-1" : ""}
                ${isSelected ? "bg-pc-orange/10 ring-2 ring-pc-orange/60 ring-offset-1" : hasData && inMonth ? "bg-pc-apricot" : ""}
              `}
            >
              <span
                className="text-[12px] leading-none font-semibold"
                style={{ fontWeight: isToday ? 800 : 600, color: isToday ? "var(--color-pc-orange, #ff5f00)" : !inMonth ? "#9c7c5c" : "#2d1717" }}
              >
                {day.getDate()}
              </span>
              {net > 0 && inMonth && (
                <span className="text-pc-muted font-medium leading-none mt-0.5" style={{ fontSize: "9px" }}>
                  {Math.floor(net / 60)}h{net % 60 >= 30 ? "30" : ""}
                </span>
              )}
              {dayAbsences.length > 0 && !daySessions.length && inMonth && (
                <span className="leading-none mt-0.5" style={{ fontSize: "9px" }}>
                  {ABSENCE_META[dayAbsences[0].category as AbsenceCategory].emoji}
                </span>
              )}
              {dotColor && (
                <span className={`absolute bottom-0.5 w-1.5 h-1.5 rounded-full ${dotColor}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 pt-3 border-t border-pc-line">
        {[
          { color: "bg-green-500", label: "Uppfyllt" },
          { color: "bg-amber-400", label: "Deltid" },
          { color: "bg-red-300", label: "Ingen tid" },
          { color: "bg-blue-400", label: "Frånvaro" },
          { color: "bg-pc-orange", label: "Flex" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
            <span className="text-pc-muted font-semibold" style={{ fontSize: "10px" }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
