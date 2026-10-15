import { useState } from "react";
import { type ScheduleSource, fmtMin, getEffectiveDayConfig, netDayMin } from "../lib/schedule";
import { todayLocal as todayStr, ymdLocal } from "../lib/dates";
import { fmtDur } from "../lib/format";
import type { Session } from "../lib/types";
import { type DayBlock, fillSessions, planFill } from "../lib/fill";
import { Label } from "./ui";
import TimeField from "./TimeField";

// ─── Session Modal ─────────────────────────────────────────────
// "Lägg till tid" (single day or "Flera dagar") and "Redigera pass".
export type { DayBlock };

export default function SessionModal({
  session,
  defaultDate,
  schedule,
  existingSessions,
  dayBlock,
  onClose,
  onSave,
  onSaveMany,
}: {
  session?: Session;
  defaultDate?: string;
  schedule: ScheduleSource;
  existingSessions?: Session[];
  /** Why a day cannot take new sessions: locked month, or an adjustment already covers it. */
  dayBlock?: (date: string) => DayBlock;
  onClose: () => void;
  onSave: (s: Session) => void;
  onSaveMany?: (s: Session[]) => void;
}) {
  const isEdit = !!session;
  const initDate = session ? ymdLocal(new Date(session.checkIn)) : (defaultDate ?? todayStr());
  const initCfg = getEffectiveDayConfig(initDate, schedule);

  // Pre-fill times from schedule when adding a new session
  const initStart = session
    ? new Date(session.checkIn).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : initCfg.active
      ? initCfg.startTime
      : "";
  const initEnd = session?.checkOut
    ? new Date(session.checkOut).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : initCfg.active
      ? initCfg.endTime
      : "";

  const [multiDay, setMultiDay] = useState(false);
  const [date, setDate] = useState(initDate);
  const [startTime, setStartTime] = useState(initStart);
  const [endTime, setEndTime] = useState(initEnd);
  // Multi-day range + percentage of each day's scheduled net
  const [fromDate, setFromDate] = useState(initDate);
  const [toDate, setToDate] = useState(initDate);
  const [pct, setPct] = useState(100);
  const [note, setNote] = useState(session?.note ?? "");
  const [err, setErr] = useState("");

  const dayCfg = getEffectiveDayConfig(date, schedule);
  const scheduledMins = netDayMin(dayCfg);

  const presetPcts = [100, 75, 50, 25] as const;

  // The sessions a multi-day save would create (see lib/fill.ts for the rules).
  function buildMultiDayPlan() {
    return planFill({ from: fromDate, to: toDate, pct, schedule, existingSessions, dayBlock });
  }

  function handleSave() {
    if (!startTime) {
      setErr("Ange starttid.");
      return;
    }
    const block = dayBlock?.(date);
    if (block === "locked") {
      setErr("Månaden är låst. Lås upp den först.");
      return;
    }
    const checkIn = new Date(`${date}T${startTime}`).getTime();
    const checkOut = endTime ? new Date(`${date}T${endTime}`).getTime() : null;
    if (checkOut && checkOut <= checkIn) {
      setErr("Sluttid måste vara efter starttid.");
      return;
    }
    onSave({
      ...(session ?? {}),
      id: session?.id ?? crypto.randomUUID(),
      checkIn,
      checkOut,
      manual: true,
      note: note.trim() || undefined,
    });
  }

  function handleSaveMulti() {
    if (!fromDate || !toDate) {
      setErr("Ange period.");
      return;
    }
    if (toDate < fromDate) {
      setErr("Slutdatum måste vara samma som eller efter startdatum.");
      return;
    }
    const plan = buildMultiDayPlan();
    if (plan.tooLong) {
      setErr("Perioden är för lång (max ca 4 månader).");
      return;
    }
    if (plan.days.length === 0) {
      setErr("Inga schemalagda dagar att fylla i perioden.");
      return;
    }
    const sessions = fillSessions(plan, note);
    (onSaveMany ?? ((list: Session[]) => list.forEach(onSave)))(sessions);
  }

  const previewMs =
    startTime && endTime
      ? new Date(`${date}T${endTime}`).getTime() - new Date(`${date}T${startTime}`).getTime()
      : null;
  const previewMin = previewMs !== null && previewMs > 0 ? previewMs / 60000 : null;

  const plan = multiDay ? buildMultiDayPlan() : null;
  const singleBlock = !multiDay ? dayBlock?.(date) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center pc-overlay"
      style={{ background: "rgba(45,23,23,0.55)" }}
      onClick={onClose}
    >
      <div
        className="pc-sheet bg-white w-full max-w-[480px] rounded-t-[28px] px-6 pt-6 overflow-y-auto"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
          maxHeight: "92dvh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-pc-line rounded-full mx-auto mb-5" />
        <div className="font-extrabold text-[22px] tracking-tight mb-1">
          {isEdit ? "Redigera pass" : "Lägg till tid"}
        </div>
        <div className="text-[13px] text-pc-muted mb-5">
          {multiDay
            ? "Fyll flera dagar på en gång med en andel av schemat."
            : dayCfg.active
              ? `Schema: ${dayCfg.startTime}–${dayCfg.endTime} · ${fmtMin(scheduledMins)} netto`
              : "Välj datum, start och sluttid."}
        </div>

        {/* Single day / multi-day toggle (only when adding) */}
        {!isEdit && (
          <div className="flex gap-2 mb-5">
            <button
              type="button"
              onClick={() => {
                setMultiDay(false);
                setErr("");
              }}
              className={`flex-1 py-2.5 rounded-[14px] text-[13px] font-bold border transition-colors ${
                !multiDay
                  ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgba(255,95,0,0.45)]"
                  : "bg-pc-bg border-pc-line text-pc-ink"
              }`}
            >
              En dag
            </button>
            <button
              type="button"
              onClick={() => {
                setMultiDay(true);
                setErr("");
              }}
              className={`flex-1 py-2.5 rounded-[14px] text-[13px] font-bold border transition-colors ${
                multiDay
                  ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgba(255,95,0,0.45)]"
                  : "bg-pc-bg border-pc-line text-pc-ink"
              }`}
            >
              Flera dagar
            </button>
          </div>
        )}

        {!multiDay ? (
          <>
            <Label>Datum</Label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="pc-input"
            />
            {singleBlock === "locked" && (
              <div className="text-[12px] text-amber-700 font-semibold -mt-2 mb-4">
                🔒 Månaden är låst — lås upp den för att lägga till tid.
              </div>
            )}
            {singleBlock === "adjusted" && (
              <div className="text-[12px] text-amber-700 font-semibold -mt-2 mb-4">
                Dagen är justerad. Stämplingar ersätts av justeringen.
              </div>
            )}
            <Label>Starttid</Label>
            <TimeField label="Starttid" value={startTime} onChange={setStartTime} />
            <Label>
              Sluttid{" "}
              <span className="normal-case font-medium tracking-normal">
                (valfri — lämna tom om pågående)
              </span>
            </Label>
            <TimeField
              label="Sluttid"
              value={endTime}
              onChange={setEndTime}
              placeholder="Pågående"
              clearable
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
          </>
        ) : (
          <>
            <Label>Från</Label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                if (e.target.value > toDate) setToDate(e.target.value);
              }}
              className="pc-input"
            />
            <Label>Till</Label>
            <input
              type="date"
              value={toDate}
              min={fromDate}
              onChange={(e) => setToDate(e.target.value)}
              className="pc-input"
            />

            <Label>
              Hur mycket jobbade du?{" "}
              <span className="normal-case font-medium tracking-normal">
                (andel av schemat per dag)
              </span>
            </Label>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {presetPcts.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPct(p)}
                  className={`py-2.5 rounded-[12px] text-[13px] font-bold border transition-colors ${
                    pct === p
                      ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgba(255,95,0,0.45)]"
                      : "bg-pc-bg border-pc-line text-pc-ink"
                  }`}
                >
                  {p}%
                </button>
              ))}
            </div>
          </>
        )}

        <Label>
          Anteckning <span className="normal-case font-medium tracking-normal">(valfri)</span>
        </Label>
        <textarea
          rows={2}
          placeholder={
            multiDay
              ? "t.ex. VAB 50 %, delad omsorg"
              : "t.ex. Startade tidigt, jobbade ikapp på kvällen…"
          }
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "12px 14px",
            borderRadius: "14px",
            border: "1px solid #ece6df",
            fontSize: "15px",
            outline: "none",
            background: "#fdf6ee",
            fontWeight: 500,
            color: "#2d1717",
            resize: "none",
            marginBottom: "16px",
            fontFamily: "inherit",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "#ff5f00";
            e.currentTarget.style.background = "#fff";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "#ece6df";
            e.currentTarget.style.background = "#fdf6ee";
          }}
        />

        {!multiDay && previewMin !== null && previewMin > 0 && (
          <div className="bg-pc-peach rounded-2xl px-4 py-3 mb-4">
            <div className="font-extrabold text-pc-orange-deep text-[17px]">
              {fmtDur(previewMin)}
            </div>
            {scheduledMins > 0 && (
              <div className="text-[12px] text-pc-muted mt-0.5">
                {previewMin >= scheduledMins
                  ? `✓ Uppfyller schema (${fmtMin(scheduledMins)})`
                  : `${fmtMin(scheduledMins - previewMin)} kvar till schema`}
              </div>
            )}
          </div>
        )}

        {multiDay && plan && !plan.tooLong && (
          <div className="bg-pc-peach rounded-2xl px-4 py-3 mb-4">
            {plan.days.length > 0 ? (
              <>
                <div className="font-extrabold text-pc-orange-deep text-[17px]">
                  {plan.days.length} {plan.days.length === 1 ? "dag" : "dagar"} ·{" "}
                  {fmtDur(plan.totalNet)} totalt
                </div>
                <div className="text-[12px] text-pc-muted mt-0.5">
                  {pct}% av schemat per dag
                  {plan.skippedInactive > 0 && ` · ${plan.skippedInactive} lediga hoppas över`}
                  {plan.skippedExisting > 0 && ` · ${plan.skippedExisting} redan registrerade`}
                  {plan.skippedBlocked > 0 && ` · ${plan.skippedBlocked} låsta/justerade`}
                </div>
              </>
            ) : (
              <div className="text-[13px] text-pc-muted">
                Inga schemalagda dagar i perioden.
                {plan.skippedExisting > 0 &&
                  ` ${plan.skippedExisting} dag(ar) är redan registrerade.`}
                {plan.skippedBlocked > 0 && ` ${plan.skippedBlocked} dag(ar) är låsta/justerade.`}
              </div>
            )}
          </div>
        )}

        {err && <div className="text-red-600 text-[13px] mb-3">{err}</div>}

        <div className="grid grid-cols-2 gap-3 mt-2">
          <button
            onClick={onClose}
            className="pc-press py-4 rounded-[16px] bg-pc-bg border border-pc-line font-bold text-[15px] text-pc-ink"
          >
            Avbryt
          </button>
          <button
            onClick={multiDay ? handleSaveMulti : handleSave}
            className="pc-press py-4 rounded-[16px] bg-pc-orange text-white font-bold text-[15px] shadow-[0_8px_20px_-8px_rgba(255,95,0,0.6)]"
          >
            {isEdit
              ? "Spara ändringar"
              : multiDay
                ? `Spara ${plan?.days.length ?? 0} dagar`
                : "Spara"}
          </button>
        </div>
      </div>
    </div>
  );
}
