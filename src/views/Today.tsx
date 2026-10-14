import type { ReactNode } from "react";
import AttendCard from "../components/AttendCard";
import { StatusChip } from "../components/dayUi";
import { Card, FlexSubStat, IconCalendarX, IconLock, SessionRow, Stat } from "../components/ui";
import type { AttendSummary } from "../lib/attend";
import { type DayEvaluation, fmtDuration, fmtSignedDuration } from "../lib/days";
import { fmtDur, fmtTime, monthTitle } from "../lib/format";
import { type DayConfig, fmtMin } from "../lib/schedule";
import type { LeaveEstimate } from "../lib/today";
import type { AbsenceEntry, DayAdjustment, ReportingMode, Session } from "../lib/types";
import { ABSENCE_META } from "../components/AbsenceModal";
import type { DayActions, FlexFigures } from "./types";

export type TodayProps = {
  /** Reporting mode: "schedule" shows the three schedule actions, "punch" the clock. */
  mode: ReportingMode;
  today: string;
  /** evaluateDay for today (with explanation lines). */
  evaluation: DayEvaluation;
  cfg: DayConfig;
  sessions: Session[]; // today's sessions
  absences: AbsenceEntry[]; // absences covering today
  adjustment?: DayAdjustment;
  confirmed: boolean;
  locked: boolean;
  /** "Du kan gå kl. HH:MM" from the schedule (schedule mode), or null. */
  scheduleLeave: string | null;
  flex: FlexFigures;
  attend: AttendSummary;
  actions: DayActions;
  /** Nudge cards (confirm check-in on a day off, "checka in?", "checka ut?"). */
  banners?: ReactNode;
  // ── punch clock ──
  activeSession?: Session;
  liveMs: number;
  leave: LeaveEstimate | null; // only while punched in on a working day
  isLongSession: boolean;
  onPunch: () => void;
  onFixLongSession: () => void;
  // ── misc ──
  onOpenFlex: () => void;
  onShowReceipts: () => void;
  /** Shown while a locked month blocks edits. */
  lockedMonth?: string;
};

function FlexCard({ flex, onOpen }: { flex: FlexFigures; onOpen: () => void }) {
  const tone = flex.total > 0 ? "text-green-600" : flex.total < 0 ? "text-red-500" : "text-pc-ink";
  return (
    <button
      onClick={onOpen}
      className="pc-press w-full bg-white rounded-[24px] p-5 mb-3 shadow-[0_2px_12px_rgba(81,43,43,0.04)] border border-pc-line text-left"
    >
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-pc-muted">
          Flexsaldo
        </div>
        <div className="text-[11px] font-semibold text-pc-muted">Visa veckor →</div>
      </div>
      <div className="flex items-baseline flex-wrap gap-x-2 gap-y-1">
        <div
          className={`text-[34px] font-extrabold tabular-nums tracking-tight leading-none ${tone}`}
        >
          {flex.total >= 0 ? "+" : "−"}
          {fmtMin(Math.abs(flex.total))}
        </div>
        {flex.attention && (
          <div className="text-[13px] font-semibold text-pc-muted">· {flex.attention}</div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-4">
        <FlexSubStat label="Idag" minutes={flex.today} />
        <FlexSubStat label="Veckan" minutes={flex.week} />
        <FlexSubStat label="Månaden" minutes={flex.month} />
      </div>
    </button>
  );
}

function AbsenceTile({
  a,
  onDelete,
  readOnly,
}: {
  a: AbsenceEntry;
  onDelete: () => void;
  readOnly: boolean;
}) {
  const meta = ABSENCE_META[a.category];
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0 bg-pc-peach text-pc-orange-deep rounded-[12px] px-3 py-2 flex items-center gap-2">
        <span className="text-[16px] leading-none shrink-0">{meta.emoji}</span>
        <div className="min-w-0">
          <div className="font-bold text-[13px] leading-tight">{meta.label}</div>
          <div className="text-[11px] opacity-75 font-medium">
            {a.hours !== undefined ? `${a.hours}h` : "Hel dag"}
            {a.startDate !== a.endDate && ` · ${a.startDate} – ${a.endDate}`}
          </div>
        </div>
      </div>
      {!readOnly && (
        <button
          onClick={onDelete}
          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl text-pc-muted hover:text-red-500 hover:bg-red-50 transition-colors text-[13px] font-bold"
          aria-label="Ta bort frånvaro"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * Idag. Schedule mode: three big actions — "Enligt schema ✓", "Justera dag", "Frånvaro" —
 * and "Du kan gå kl. HH:MM". Punch mode (or any open session): the punch clock.
 */
export default function Today(p: TodayProps) {
  const { mode, evaluation: ev, cfg, actions, today } = p;
  const scheduled = ev.normMin > 0;
  const showClock = mode === "punch" || !!p.activeSession;
  const lockedText = p.locked
    ? `${p.lockedMonth ? monthTitle(p.lockedMonth) : "Månaden"} är bekräftad och låst.`
    : null;

  return (
    <div className="pc-fade">
      {p.banners}

      {p.locked && (
        <div className="mt-4 rounded-[20px] bg-amber-50 border border-amber-200 p-4">
          <div className="flex items-start gap-2.5">
            <span className="text-amber-700 mt-0.5">
              <IconLock className="w-4 h-4" />
            </span>
            <div className="flex-1 text-[13px] font-semibold text-amber-800 leading-snug">
              {lockedText} Du kan inte ändra dagar förrän du låst upp månaden. Stämpling i realtid
              fungerar som vanligt.
            </div>
          </div>
          <button
            onClick={() => p.lockedMonth && actions.unlockMonth(p.lockedMonth)}
            className="pc-press w-full mt-3 py-2.5 rounded-[14px] bg-white border border-amber-200 text-amber-800 font-bold text-[13px]"
          >
            Lås upp månaden
          </button>
        </div>
      )}

      {showClock ? (
        <div className="text-center mt-6 mb-8">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-pc-muted mb-6">
            {p.activeSession ? "Du är incheckad" : "Inte incheckad"}
          </div>
          <div className="relative inline-block">
            {p.activeSession && <span className="pc-pulse-ring absolute inset-0 rounded-full" />}
            <button
              onClick={p.onPunch}
              className="pc-press relative w-[200px] h-[200px] rounded-full text-white font-extrabold flex flex-col items-center justify-center gap-1.5"
              style={{
                background: p.activeSession
                  ? "linear-gradient(145deg, #ff5f00 0%, #fb4f00 100%)"
                  : "linear-gradient(145deg, #512b2b 0%, #2d1717 100%)",
                boxShadow: p.activeSession
                  ? "0 18px 48px -12px rgba(255,95,0,0.55), inset 0 1px 0 rgba(255,255,255,0.2)"
                  : "0 18px 48px -12px rgba(81,43,43,0.45), inset 0 1px 0 rgba(255,255,255,0.1)",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                className="w-9 h-9"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {p.activeSession ? (
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                ) : (
                  <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" />
                )}
              </svg>
              <span className="text-[19px] tracking-tight">
                {p.activeSession ? "Checka ut" : "Checka in"}
              </span>
            </button>
          </div>
          {p.activeSession && (
            <div className="mt-7 pc-pop">
              <div className="text-[34px] font-extrabold tabular-nums tracking-tight text-pc-ink">
                {fmtDur(p.liveMs / 60000)}
              </div>
              <div className="text-[13px] text-pc-muted font-medium mt-0.5">
                Sedan {fmtTime(p.activeSession.checkIn)}
              </div>
              {p.leave &&
                (p.leave.reached ? (
                  <div className="text-[13px] mt-2 font-bold text-green-600">
                    Mål uppnått — du kan gå hem
                    {p.leave.overMin > 2 && (
                      <span className="text-pc-orange-deep">
                        {" "}
                        · +{fmtDur(p.leave.overMin)} över schemat
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-[13px] mt-2 text-pc-muted font-semibold">
                    Du kan gå hem kl.{" "}
                    <span className="text-pc-ink font-extrabold tabular-nums">
                      {fmtTime(p.leave.leaveAtMs)}
                    </span>
                  </div>
                ))}
              {p.leave?.lunchIncluded && (
                <div className="text-[11px] mt-1 text-pc-muted">
                  🍽️ Inkl. {cfg.lunchMinutes} min lunch (dras av om passet är längre än 5 h)
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 mb-4">
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-pc-muted">
              Idag ·{" "}
              {new Date().toLocaleDateString("sv-SE", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </div>
            <StatusChip
              status={ev.status}
              label={
                p.confirmed && !p.adjustment ? "Bekräftad" : p.adjustment ? "Justerad" : undefined
              }
            />
          </div>
          <div className="text-[28px] font-extrabold tracking-tight leading-tight">
            {scheduled ? `${cfg.startTime}–${cfg.endTime}` : "Ledig dag"}
          </div>
          <div className="text-[13px] text-pc-muted font-semibold mt-1">
            {scheduled
              ? `📋 Schema · ${cfg.lunchMinutes} min lunch · ${fmtDuration(ev.normMin)} netto`
              : "📋 Ledig dag enligt schema"}
          </div>
          {p.scheduleLeave && (
            <div className="text-[15px] mt-3 text-pc-muted font-semibold">
              Du kan gå kl.{" "}
              <span className="text-pc-ink font-extrabold tabular-nums">{p.scheduleLeave}</span>
            </div>
          )}
        </div>
      )}

      {p.isLongSession && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-[20px] p-4 pc-pop">
          <div className="text-[13px] font-bold text-amber-800 leading-snug">
            ⏰ Långt pass ({fmtDur(p.liveMs / 60000)}). Glömde du checka ut?
          </div>
          <div className="text-[12px] text-amber-700 mt-0.5 font-medium leading-snug">
            Bekräftelse sker innan utcheckning.
          </div>
          <button
            onClick={p.onFixLongSession}
            className="pc-press w-full mt-3 py-3 rounded-[14px] bg-amber-500 text-white font-bold text-[14px]"
          >
            Välj sluttid
          </button>
        </div>
      )}

      {/* The three schedule-mode actions */}
      {!showClock && (
        <div className="mb-3">
          {p.confirmed && !p.adjustment ? (
            <div className="rounded-[22px] bg-green-50 border border-green-200 p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-[16px] font-extrabold text-green-700">
                  ✓ Bekräftad enligt schema
                </div>
                <div className="text-[12px] text-green-700/80 font-medium mt-0.5">
                  Arbetat {fmtDuration(ev.workedMin)} · flex {fmtSignedDuration(ev.flexDelta)}
                </div>
              </div>
              {!p.locked && (
                <button
                  onClick={() => actions.undoSchema(today)}
                  className="shrink-0 text-[12px] font-bold text-green-700 underline"
                >
                  Ångra
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => actions.enligtSchema(today)}
              disabled={p.locked || !scheduled}
              className="pc-press w-full rounded-[22px] py-5 px-5 text-white text-left disabled:opacity-50"
              style={{
                background: "linear-gradient(135deg, #ff5f00 0%, #e04d00 100%)",
                boxShadow: "0 8px 24px -8px rgba(255,95,0,0.55)",
              }}
            >
              <div className="text-[20px] font-extrabold tracking-tight">Enligt schema ✓</div>
              <div className="text-[12px] font-semibold opacity-90 mt-0.5">
                {scheduled
                  ? `Jag jobbade ${cfg.startTime}–${cfg.endTime}`
                  : "Ledig dag – inget att bekräfta"}
              </div>
            </button>
          )}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <button
              onClick={() => actions.adjust(today)}
              disabled={p.locked}
              className="pc-press bg-white border border-pc-line rounded-[20px] py-4 font-bold text-[15px] text-pc-ink disabled:opacity-50"
            >
              Justera dag
            </button>
            <button
              onClick={() => actions.absence(today)}
              disabled={p.locked}
              className="pc-press bg-white border border-pc-line rounded-[20px] py-4 font-bold text-[15px] text-pc-ink flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span className="text-pc-muted">
                <IconCalendarX />
              </span>
              Frånvaro
            </button>
          </div>
        </div>
      )}

      {/* What today holds */}
      {(showClock || p.sessions.length > 0 || p.adjustment || p.absences.length > 0) && (
        <Card>
          <div className="flex items-baseline justify-between mb-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-pc-muted">
              Idag
            </div>
            <div className="text-[12px] font-semibold text-pc-muted capitalize">
              {new Date().toLocaleDateString("sv-SE", {
                weekday: "long",
                day: "numeric",
                month: "short",
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Netto arbetstid" value={fmtDur(ev.workedMin)} accent />
            <Stat label="Antal pass" value={`${p.sessions.length} st`} />
          </div>
          <div className="mt-3 text-[12px] font-semibold text-pc-muted">
            {scheduled
              ? `📋 Schema ${cfg.startTime}–${cfg.endTime} · ${cfg.lunchMinutes} min lunch`
              : "📋 Ledig dag enligt schema"}
          </div>
          {p.adjustment && (
            <div className="mt-3 text-[12px] font-semibold text-pc-ink bg-pc-peach rounded-[12px] px-3 py-2">
              Justerad {p.adjustment.start ?? cfg.startTime}–{p.adjustment.end ?? cfg.endTime}
              {p.adjustment.breakMin !== undefined ? `, rast ${p.adjustment.breakMin} min` : ""}
              {p.adjustment.note ? ` · ${p.adjustment.note}` : ""}
              {!p.locked && (
                <button
                  onClick={() => actions.adjust(today)}
                  className="ml-2 underline text-pc-orange-deep"
                >
                  Ändra
                </button>
              )}
            </div>
          )}
          {p.absences.length > 0 && (
            <div className="mt-3 space-y-2">
              {p.absences.map((a) => (
                <AbsenceTile
                  key={a.id}
                  a={a}
                  readOnly={p.locked}
                  onDelete={() => actions.deleteAbsence(a)}
                />
              ))}
            </div>
          )}
          {p.sessions.length > 0 && (
            <div className="mt-4 pt-4 border-t border-pc-line space-y-1">
              {p.sessions.map((s, i) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  index={i}
                  readOnly={p.locked}
                  onEdit={() => actions.editSession(s)}
                  onDelete={() => actions.deleteSession(s.id)}
                />
              ))}
            </div>
          )}
        </Card>
      )}

      <FlexCard flex={p.flex} onOpen={p.onOpenFlex} />

      {showClock && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          <button
            onClick={() => actions.addTime(today)}
            disabled={p.locked}
            className="pc-press bg-white border border-pc-line rounded-[18px] py-3.5 font-bold text-[13px] text-pc-ink disabled:opacity-50"
          >
            + Lägg till tid
          </button>
          <button
            onClick={() => actions.adjust(today)}
            disabled={p.locked}
            className="pc-press bg-white border border-pc-line rounded-[18px] py-3.5 font-bold text-[13px] text-pc-ink disabled:opacity-50"
          >
            Justera dag
          </button>
          <button
            onClick={() => actions.absence(today)}
            disabled={p.locked}
            className="pc-press bg-white border border-pc-line rounded-[18px] py-3.5 font-bold text-[13px] text-pc-ink disabled:opacity-50"
          >
            Frånvaro
          </button>
        </div>
      )}

      <AttendCard
        summary={p.attend}
        actions={actions}
        onFixLongSession={p.onFixLongSession}
        onShowReceipts={p.onShowReceipts}
      />
    </div>
  );
}
