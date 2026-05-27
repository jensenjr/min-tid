import { useState, useEffect } from "react";
import { type WeekSchedule, dayKeyOf, netDayMin } from "../lib/schedule";

export type AbsenceCategory =
  | "sjuk"
  | "vab"
  | "semester"
  | "foraldraledighet"
  | "friskard"
  | "tjansteledighet"
  | "obetald"
  | "overtid_betald"
  | "flex";

export type AbsenceEntry = {
  id: string;
  category: AbsenceCategory;
  startDate: string;
  endDate: string;
  hours?: number; // undefined = full day (use schedule hours); number = manual hours per day
  note?: string;
  manual: true;
};

export const ABSENCE_META: Record<AbsenceCategory, { emoji: string; label: string }> = {
  sjuk:             { emoji: "🤒", label: "Sjuk" },
  vab:              { emoji: "👶", label: "VAB" },
  semester:         { emoji: "✈️",  label: "Semester" },
  foraldraledighet: { emoji: "👨‍👩‍👧", label: "Föräldraledighet" },
  friskard:         { emoji: "💪", label: "Friskvård" },
  tjansteledighet:  { emoji: "💼", label: "Tjänsteledighet" },
  obetald:          { emoji: "💸", label: "Obetald ledighet" },
  overtid_betald:   { emoji: "💰", label: "Övertid (betald)" },
  flex:             { emoji: "⏰", label: "Flex" },
};

const CATEGORIES = Object.entries(ABSENCE_META) as [AbsenceCategory, { emoji: string; label: string }][];

function todayStr() { return new Date().toISOString().slice(0, 10); }

export default function AbsenceModal({
  open,
  initialDate,
  schedule,
  onClose,
  onSave,
}: {
  open: boolean;
  initialDate?: string;
  schedule?: WeekSchedule;
  onClose: () => void;
  onSave: (entry: AbsenceEntry) => void;
}) {
  const [category, setCategory] = useState<AbsenceCategory>("sjuk");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [fullDay, setFullDay] = useState(true);
  const [manualHours, setManualHours] = useState("8");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      const d = initialDate ?? todayStr();
      setCategory("sjuk");
      setStartDate(d);
      setEndDate(d);
      setFullDay(true);
      setManualHours("8");
      setNote("");
      setErr("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reference hours = scheduled net minutes for the start day (fall back to 8h)
  const refDay = schedule ? schedule[dayKeyOf(new Date((startDate || todayStr()) + "T12:00:00"))] : undefined;
  const refHours = refDay && refDay.active ? netDayMin(refDay) / 60 : 8;
  const presetPcts = [100, 75, 50, 25] as const;
  function applyPreset(pct: number) {
    const v = Math.round(refHours * pct) / 100;
    // Snap to 0.5h increments, keep at least 0.5h
    const snapped = Math.max(0.5, Math.round(v * 2) / 2);
    setManualHours(String(snapped));
  }

  if (!open) return null;

  function handleSave() {
    if (!startDate) { setErr("Ange startdatum."); return; }
    if (!endDate) { setErr("Ange slutdatum."); return; }
    if (endDate < startDate) { setErr("Slutdatum måste vara samma som eller efter startdatum."); return; }

    let hours: number | undefined = undefined;
    if (!fullDay) {
      const parsed = parseFloat(manualHours);
      if (isNaN(parsed) || parsed <= 0) { setErr("Ange ett giltigt antal timmar."); return; }
      hours = parsed;
    }

    onSave({
      id: crypto.randomUUID(),
      category,
      startDate,
      endDate,
      hours,
      note: note.trim() || undefined,
      manual: true,
    });
    setCategory("sjuk");
    setStartDate(todayStr());
    setEndDate(todayStr());
    setFullDay(true);
    setManualHours("8");
    setNote("");
    setErr("");
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
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-[#ece6df] rounded-full mx-auto mb-5" />

        <div className="font-extrabold text-[22px] tracking-tight mb-1">Registrera avvikelse</div>
        <div className="text-[13px] text-[#9c7c5c] mb-6">
          Välj typ, period och lägg till en valfri anteckning.
        </div>

        {/* Category grid */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-3">Typ</div>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {CATEGORIES.map(([key, meta]) => (
            <button
              key={key}
              onClick={() => setCategory(key)}
              className={`py-2.5 px-2 rounded-[14px] text-[12px] font-bold border transition-colors flex flex-col items-center gap-1 ${
                category === key
                  ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgba(255,95,0,0.45)]"
                  : "bg-[#fdf6ee] border-[#ece6df] text-[#2d1717]"
              }`}
            >
              <span className="text-[18px] leading-none">{meta.emoji}</span>
              <span className="leading-tight text-center">{meta.label}</span>
            </button>
          ))}
        </div>

        {/* Dates */}
        <div className="flex flex-col gap-3 mb-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">Startdatum</div>
            <input
              type="date"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }}
              style={{
                width: "100%", boxSizing: "border-box", WebkitAppearance: "none",
                padding: "12px 14px", borderRadius: "14px",
                border: "1.5px solid #ece6df", fontSize: "16px", outline: "none",
                background: "#fdf6ee", fontWeight: 600, color: "#2d1717",
              }}
            />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">Slutdatum</div>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={e => setEndDate(e.target.value)}
              style={{
                width: "100%", boxSizing: "border-box", WebkitAppearance: "none",
                padding: "12px 14px", borderRadius: "14px",
                border: "1.5px solid #ece6df", fontSize: "16px", outline: "none",
                background: "#fdf6ee", fontWeight: 600, color: "#2d1717",
              }}
            />
          </div>
        </div>

        {/* Duration */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">Tid</div>
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setFullDay(true)}
            className={`flex-1 py-2.5 rounded-[14px] text-[13px] font-bold border transition-colors ${
              fullDay
                ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgba(255,95,0,0.45)]"
                : "bg-[#fdf6ee] border-[#ece6df] text-[#2d1717]"
            }`}
          >
            Hel dag
          </button>
          <button
            type="button"
            onClick={() => setFullDay(false)}
            className={`flex-1 py-2.5 rounded-[14px] text-[13px] font-bold border transition-colors ${
              !fullDay
                ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgba(255,95,0,0.45)]"
                : "bg-[#fdf6ee] border-[#ece6df] text-[#2d1717]"
            }`}
          >
            Ange timmar
          </button>
        </div>
        {!fullDay && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">
              Snabbval <span className="normal-case font-medium tracking-normal text-[#9c7c5c]">(av {refHours.toString().replace(".", ",")} h)</span>
            </div>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {presetPcts.map(pct => {
                const hoursForPct = Math.max(0.5, Math.round(refHours * pct / 100 * 2) / 2);
                const active = Math.abs(parseFloat(manualHours) - hoursForPct) < 0.01;
                return (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => applyPreset(pct)}
                    className={`py-2 rounded-[12px] text-[12px] font-bold border transition-colors ${
                      active
                        ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgba(255,95,0,0.45)]"
                        : "bg-[#fdf6ee] border-[#ece6df] text-[#2d1717]"
                    }`}
                  >
                    {pct}%
                  </button>
                );
              })}
            </div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">
              Antal timmar <span className="normal-case font-medium tracking-normal text-[#9c7c5c]">(per dag)</span>
            </div>
            <input
              type="number"
              min={0.5}
              max={24}
              step={0.5}
              value={manualHours}
              onChange={e => setManualHours(e.target.value)}
              style={{
                width: "100%", padding: "12px 14px", borderRadius: "14px",
                border: "1.5px solid #ece6df", fontSize: "16px", outline: "none",
                background: "#fdf6ee", fontWeight: 600, color: "#2d1717",
                marginBottom: "16px",
              }}
            />
          </>
        )}

        {/* Note */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">
          Anteckning <span className="normal-case font-medium tracking-normal text-[#9c7c5c]">(valfri)</span>
        </div>
        <textarea
          rows={2}
          placeholder="t.ex. Läkarintyg lämnat"
          value={note}
          onChange={e => setNote(e.target.value)}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: "14px",
            border: "1.5px solid #ece6df", fontSize: "15px", outline: "none",
            background: "#fdf6ee", fontWeight: 500, color: "#2d1717",
            resize: "none", marginBottom: "16px", fontFamily: "inherit",
          }}
          onFocus={e => { e.currentTarget.style.borderColor = "#ff5f00"; e.currentTarget.style.background = "#fff"; }}
          onBlur={e => { e.currentTarget.style.borderColor = "#ece6df"; e.currentTarget.style.background = "#fdf6ee"; }}
        />

        {err && <div className="text-red-600 text-[13px] mb-3 font-semibold">{err}</div>}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onClose}
            style={{
              padding: "16px", borderRadius: "16px", background: "#fdf6ee",
              border: "1.5px solid #ece6df", fontWeight: 700, fontSize: "15px", color: "#2d1717",
            }}
          >
            Avbryt
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: "16px", borderRadius: "16px", background: "#ff5f00",
              color: "white", fontWeight: 700, fontSize: "15px",
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
