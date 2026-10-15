import { useState } from "react";
import { type ScheduleSource, getEffectiveDayConfig } from "../lib/schedule";
import type { ScheduleException } from "../lib/types";
import TimeField from "./TimeField";

// ─── Day Exception Modal ───────────────────────────────────────
// Bottom sheet for overriding the effective schedule of a single calendar date.
// Used for company-wide shortened workdays (e.g. "everyone leaves at 13:00").
// Public holidays (röda dagar) where no work was done are handled separately via
// the "Helgdag" absence category.
export default function DayExceptionModal({
  dateStr,
  schedule,
  current,
  onClose,
  onSave,
}: {
  dateStr: string;
  schedule: ScheduleSource;
  current: ScheduleException | null;
  onClose: () => void;
  onSave: (exc: ScheduleException | null) => void;
}) {
  const baseCfg = getEffectiveDayConfig(dateStr, schedule);
  const [endTime, setEndTime] = useState(current?.endTime ?? baseCfg.endTime);
  const [lunchMinutes, setLunchMinutes] = useState(
    current?.lunchMinutes !== undefined
      ? String(current.lunchMinutes)
      : String(baseCfg.lunchMinutes),
  );
  const [note, setNote] = useState(current?.note ?? "");
  const [err, setErr] = useState("");

  const baseStart = baseCfg.startTime;
  const dateLabel = new Date(dateStr + "T12:00:00").toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  function handleSave() {
    if (!endTime) {
      setErr("Ange sluttid.");
      return;
    }
    const [sh, sm] = baseStart.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    if (eh * 60 + em <= sh * 60 + sm) {
      setErr("Sluttid måste vara efter starttid.");
      return;
    }
    const lunch = parseInt(lunchMinutes, 10);
    if (isNaN(lunch) || lunch < 0) {
      setErr("Ange giltigt antal minuter för lunch.");
      return;
    }
    onSave({ type: "override", endTime, lunchMinutes: lunch, note: note.trim() || undefined });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(45,23,23,0.55)", animation: "pcOverlay 0.25s ease" }}
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-[480px] rounded-t-[28px] px-6 pt-6 overflow-y-auto"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
          animation: "pcSheet 0.32s cubic-bezier(0.32,0.72,0,1)",
          maxHeight: "90dvh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-[#ece6df] rounded-full mx-auto mb-5" />

        <div className="font-extrabold text-[22px] tracking-tight mb-1 capitalize">{dateLabel}</div>
        <div className="text-[13px] text-pc-muted mb-1">
          Normalt schema: {baseStart}–{baseCfg.endTime}
          {baseCfg.lunchMinutes > 0 ? ` · ${baseCfg.lunchMinutes} min lunch` : ""}
        </div>
        <div className="text-[13px] text-pc-muted mb-6">
          Ange en kortare sluttid för att justera flexsaldot för denna dag.
        </div>

        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">
          Ny sluttid
        </div>
        <TimeField
          label="Ny sluttid"
          value={endTime}
          onChange={(v) => {
            setEndTime(v);
            setErr("");
          }}
        />

        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">
          Lunch{" "}
          <span className="normal-case font-medium tracking-normal text-pc-muted">(minuter)</span>
        </div>
        <input
          type="number"
          min={0}
          max={120}
          step={15}
          value={lunchMinutes}
          onChange={(e) => {
            setLunchMinutes(e.target.value);
            setErr("");
          }}
          className="pc-input"
        />

        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">
          Anteckning{" "}
          <span className="normal-case font-medium tracking-normal text-pc-muted">(valfri)</span>
        </div>
        <textarea
          rows={2}
          placeholder="t.ex. Kontoret stängde tidigt"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: "14px",
            border: "1.5px solid #ece6df",
            fontSize: "15px",
            outline: "none",
            background: "#fdf6ee",
            fontWeight: 500,
            color: "#2d1717",
            resize: "none",
            marginBottom: "16px",
            fontFamily: "inherit",
            boxSizing: "border-box",
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

        {err && <div className="text-red-600 text-[13px] mb-3 font-semibold">{err}</div>}

        {current && (
          <button
            onClick={() => onSave(null)}
            className="w-full py-3 mb-3 rounded-[14px] text-[13px] font-bold text-red-600 bg-red-50 border border-red-200"
          >
            Återställ normalt schema
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onClose}
            style={{
              padding: "16px",
              borderRadius: "16px",
              background: "#fdf6ee",
              border: "1.5px solid #ece6df",
              fontWeight: 700,
              fontSize: "15px",
              color: "#2d1717",
            }}
          >
            Avbryt
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: "16px",
              borderRadius: "16px",
              background: "#ff5f00",
              color: "white",
              fontWeight: 700,
              fontSize: "15px",
              boxShadow: "0 8px 20px -8px rgba(255,95,0,0.6)",
            }}
          >
            Spara
          </button>
        </div>
      </div>
    </div>
  );
}
