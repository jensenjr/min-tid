import { ABSENCE_META } from "./AbsenceModal";
import { StatusChip } from "./dayUi";
import { IconLock, Label, SessionRow, Sheet } from "./ui";
import { isDayLocked } from "../lib/confirm";
import {
  type DayContext,
  evaluateDay,
  fmtDuration,
  fmtSignedDuration,
  getAbsencesForDate,
  sessionsOn,
} from "../lib/days";
import { fmtDateLabel, monthTitle } from "../lib/format";
import { getEffectiveDayConfig } from "../lib/schedule";
import type { DayActions } from "../views/types";

/**
 * A day from the calendar: what was registered, what it counted as, and — under
 * "Så räknades dagen" — the explanation lines from evaluateDay. Editing is blocked on
 * locked days (with "Lås upp månaden").
 */
export default function DaySheet({
  date,
  ctx,
  actions,
  onClose,
}: {
  date: string | null;
  ctx: DayContext;
  actions: DayActions;
  onClose: () => void;
}) {
  if (!date) return null;
  const ev = evaluateDay(date, ctx);
  const cfg = getEffectiveDayConfig(date, ctx.schedule, ctx.exceptions ?? {});
  const sessions = sessionsOn(ctx.sessions, date)
    .slice()
    .sort((a, b) => a.checkIn - b.checkIn);
  const absences = getAbsencesForDate(ctx.absences, date);
  const adj = ctx.dayAdjustments?.[date];
  const exception = ctx.exceptions?.[date];
  const locked = isDayLocked(date, ctx);
  const confirmed = ctx.confirmedDays?.[date] === true;
  const month = date.slice(0, 7);
  const scheduled = ev.normMin > 0;
  const today = ctx.today ?? "";
  const future = date > today;

  const quick =
    "pc-press flex-1 min-w-0 py-2.5 rounded-[12px] border border-pc-line bg-pc-bg text-[13px] font-bold text-pc-ink";
  const dashed =
    "pc-press flex items-center justify-center gap-1.5 py-2.5 rounded-[12px] border border-dashed border-pc-line text-pc-muted text-[13px] font-semibold hover:border-pc-orange hover:text-pc-orange transition-colors";

  const worked = ev.status !== "off" || ev.workedMin > 0;

  return (
    <Sheet open onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-extrabold text-[20px] tracking-tight capitalize leading-tight">
            {fmtDateLabel(date)}
          </div>
          <div className="text-[12px] text-pc-muted font-medium mt-1">
            {scheduled
              ? `Schema ${cfg.startTime}–${cfg.endTime} · ${fmtDuration(ev.normMin)} netto`
              : "Ledig dag enligt schema"}
          </div>
        </div>
        <StatusChip
          status={ev.status}
          label={
            confirmed && ev.status === "reported" && !adj && sessions.length === 0
              ? "Bekräftad"
              : adj && ev.status === "reported"
                ? "Justerad"
                : undefined
          }
        />
      </div>

      {worked && !future && (
        <div className="flex items-end justify-between gap-3 mt-4">
          <div className="text-[30px] font-extrabold tabular-nums tracking-tight text-pc-orange-deep leading-none">
            {fmtDuration(ev.workedMin)}
          </div>
          {scheduled && (
            <div
              className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-extrabold ${
                ev.flexDelta >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
              }`}
            >
              Flex {fmtSignedDuration(ev.flexDelta)}
            </div>
          )}
        </div>
      )}

      {locked && (
        <div className="mt-4 rounded-[16px] bg-amber-50 border border-amber-200 p-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-800">
            <IconLock className="w-4 h-4 shrink-0" />
            {monthTitle(month)} är låst — dagen kan inte ändras.
          </div>
          <button
            onClick={() => actions.unlockMonth(month)}
            className="pc-press w-full mt-2.5 py-2.5 rounded-[12px] bg-white border border-amber-200 text-amber-800 font-bold text-[13px]"
          >
            Lås upp månaden
          </button>
        </div>
      )}

      {/* Entries */}
      <div className="mt-4 space-y-2">
        {absences.map((a) => {
          const meta = ABSENCE_META[a.category];
          return (
            <div key={a.id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0 bg-pc-peach text-pc-orange-deep rounded-[12px] px-3 py-2 flex items-center gap-2">
                <span className="text-[16px] leading-none shrink-0">{meta.emoji}</span>
                <div className="min-w-0">
                  <div className="font-bold text-[13px] leading-tight">{meta.label}</div>
                  <div className="text-[11px] opacity-75 font-medium">
                    {a.hours !== undefined ? `${a.hours}h` : "Hel dag"}
                    {a.startDate !== a.endDate && ` · ${a.startDate} – ${a.endDate}`}
                  </div>
                  {a.note && <div className="text-[11px] opacity-70 mt-0.5 truncate">{a.note}</div>}
                </div>
              </div>
              {!locked && (
                <button
                  onClick={() => actions.deleteAbsence(a)}
                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl text-pc-muted hover:text-red-500 hover:bg-red-50 transition-colors text-[13px] font-bold"
                  aria-label="Ta bort frånvaro"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}

        {adj && (
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 bg-pc-apricot rounded-[12px] px-3 py-2">
              <div className="font-bold text-[13px] leading-tight">
                Justerad {adj.start ?? cfg.startTime}–{adj.end ?? cfg.endTime}
                {adj.breakMin !== undefined ? `, rast ${adj.breakMin} min` : ""}
              </div>
              {adj.note && <div className="text-[11px] text-pc-muted mt-0.5">{adj.note}</div>}
            </div>
            {!locked && (
              <button
                onClick={() => actions.removeAdjustment(date)}
                className="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl text-pc-muted hover:text-red-500 hover:bg-red-50 transition-colors text-[13px] font-bold"
                aria-label="Ta bort justering"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {sessions.length > 0 && (
          <div className="space-y-0.5">
            {sessions.map((s, i) => (
              <SessionRow
                key={s.id}
                session={s}
                index={i}
                readOnly={locked}
                onEdit={() => actions.editSession(s)}
                onDelete={() => actions.deleteSession(s.id)}
              />
            ))}
          </div>
        )}

        {sessions.length === 0 && absences.length === 0 && !adj && (
          <div className="text-pc-muted text-[13px] text-center py-1">
            {confirmed ? "Bekräftad enligt schema." : "Inga registreringar denna dag."}
          </div>
        )}
      </div>

      {/* Actions */}
      {!locked && (
        <div className="mt-4 space-y-2">
          <div className="flex gap-2">
            {confirmed ? (
              <button onClick={() => actions.undoSchema(date)} className={quick}>
                Ångra bekräftelse
              </button>
            ) : (
              <button
                onClick={() => actions.enligtSchema(date)}
                disabled={!scheduled || future}
                className={`${quick} disabled:opacity-40`}
              >
                Enligt schema
              </button>
            )}
            <button onClick={() => actions.adjust(date)} className={quick}>
              Justera
            </button>
            <button onClick={() => actions.absence(date)} className={quick}>
              Frånvaro
            </button>
          </div>
          <button onClick={() => actions.addTime(date)} className={`${dashed} w-full`}>
            <span className="text-[15px] leading-none">+</span> Lägg till tid
          </button>
          <button
            onClick={() => actions.editException(date)}
            className={`pc-press w-full flex items-center justify-center gap-2 py-2 rounded-[12px] text-[12px] font-semibold transition-colors ${
              exception
                ? "bg-blue-50 text-blue-600 border border-blue-200"
                : "border border-dashed border-pc-line text-pc-muted hover:border-pc-orange hover:text-pc-orange"
            }`}
          >
            {exception ? `Förkortad dag · ${exception.endTime}` : "Ändra schema för dag"}
          </button>
        </div>
      )}

      {/* Explanation */}
      <div className="mt-5 pt-4 border-t border-pc-line">
        <Label>Så räknades dagen</Label>
        <ul className="space-y-1.5">
          {ev.explanation.map((line, i) => (
            <li key={i} className="flex gap-2 text-[13px] text-pc-ink leading-snug">
              <span className="text-pc-muted shrink-0">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={onClose}
        className="pc-press w-full mt-5 py-3.5 rounded-[16px] bg-pc-bg border border-pc-line font-bold text-[14px] text-pc-ink"
      >
        Stäng
      </button>
    </Sheet>
  );
}
