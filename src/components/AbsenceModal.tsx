import { useState, useEffect } from "react";
import { type ScheduleSource, getEffectiveDayConfig, netDayMin } from "../lib/schedule";
import { type VacationState, vacationWarning } from "../lib/vacation";
import { todayLocal } from "../lib/dates";

export type AbsenceCategory =
  | "sjuk"
  | "vab"
  | "semester"
  | "foraldraledighet"
  | "friskard"
  | "tjansteledighet"
  | "obetald"
  | "overtid_betald"
  | "flex"
  | "helgdag";

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
  sjuk: { emoji: "🤒", label: "Sjuk" },
  vab: { emoji: "👶", label: "VAB" },
  semester: { emoji: "✈️", label: "Semester" },
  foraldraledighet: { emoji: "👨‍👩‍👧", label: "Föräldraledighet" },
  friskard: { emoji: "💪", label: "Friskvård" },
  tjansteledighet: { emoji: "💼", label: "Tjänsteledighet" },
  obetald: { emoji: "💸", label: "Obetald ledighet" },
  overtid_betald: { emoji: "💰", label: "Övertid (betald)" },
  flex: { emoji: "⏰", label: "Flex" },
  helgdag: { emoji: "🏖️", label: "Helgdag (röd dag)" },
};

const CATEGORIES = Object.entries(ABSENCE_META) as [
  AbsenceCategory,
  { emoji: string; label: string },
][];

function todayStr() {
  return todayLocal();
}

export default function AbsenceModal({
  open,
  initialDate,
  schedule,
  vacationState,
  onClose,
  onSave,
}: {
  open: boolean;
  initialDate?: string;
  schedule?: ScheduleSource;
  /** Absences, schedules, exceptions and vacation settings; enables the (non-blocking) semester warning. */
  vacationState?: VacationState;
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
  const refDay = schedule ? getEffectiveDayConfig(startDate || todayStr(), schedule) : undefined;
  const refHours = refDay && refDay.active ? netDayMin(refDay) / 60 : 8;
  const presetPcts = [100, 75, 50, 25] as const;
  function applyPreset(pct: number) {
    const v = Math.round(refHours * pct) / 100;
    // Snap to 0.5h increments, keep at least 0.5h
    const snapped = Math.max(0.5, Math.round(v * 2) / 2);
    setManualHours(String(snapped));
  }

  if (!open) return null;

  // Non-blocking: warn when this semester would exceed the vacation balance.
  const parsedHours = parseFloat(manualHours);
  const vacWarning =
    vacationState && category === "semester" && startDate && endDate && endDate >= startDate
      ? vacationWarning(vacationState, {
          id: "draft",
          category,
          startDate,
          endDate,
          hours: fullDay || isNaN(parsedHours) || parsedHours <= 0 ? undefined : parsedHours,
          manual: true,
        })
      : null;

  function handleSave() {
    if (!startDate) {
      setErr("Ange startdatum.");
      return;
    }
    if (!endDate) {
      setErr("Ange slutdatum.");
      return;
    }
    if (endDate < startDate) {
      setErr("Slutdatum måste vara samma som eller efter startdatum.");
      return;
    }

    let hours: number | undefined = undefined;
    if (!fullDay) {
      const parsed = parseFloat(manualHours);
      if (isNaN(parsed) || parsed <= 0) {
        setErr("Ange ett giltigt antal timmar.");
        return;
      }
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
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-6"
      style={{ background: "var(--pc-overlay)", animation: "pcOverlay 0.25s ease" }}
      onClick={onClose}
    >
      <div
        className="pc-sheet bg-pc-surface w-full max-w-[480px] md:max-w-[560px] rounded-t-[28px] md:rounded-[28px] px-6 pt-6 overflow-y-auto"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
          animation: "pcSheet 0.32s cubic-bezier(0.32,0.72,0,1)",
          maxHeight: "90dvh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-(--pc-line) rounded-full mx-auto md:hidden mb-5" />

        <div className="font-extrabold text-[22px] tracking-tight mb-1">Registrera avvikelse</div>
        <div className="text-[13px] text-(--pc-taupe) mb-6">
          Välj typ, period och lägg till en valfri anteckning.
        </div>

        {/* Category grid */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-(--pc-taupe) mb-3">
          Typ
        </div>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {CATEGORIES.map(([key, meta]) => (
            <button
              key={key}
              onClick={() => setCategory(key)}
              className={`py-2.5 px-2 rounded-[14px] text-[12px] font-bold border transition-colors flex flex-col items-center gap-1 ${
                category === key
                  ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgb(var(--pc-orange-rgb)/0.45)]"
                  : "bg-(--pc-apricot) border-(--pc-line) text-(--pc-ink)"
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
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-(--pc-taupe) mb-2">
              Startdatum
            </div>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (e.target.value > endDate) setEndDate(e.target.value);
              }}
              style={{
                width: "100%",
                boxSizing: "border-box",
                WebkitAppearance: "none",
                padding: "12px 14px",
                borderRadius: "14px",
                border: "1.5px solid var(--pc-line)",
                fontSize: "16px",
                outline: "none",
                background: "var(--pc-apricot)",
                fontWeight: 600,
                color: "var(--pc-ink)",
              }}
            />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-(--pc-taupe) mb-2">
              Slutdatum
            </div>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                WebkitAppearance: "none",
                padding: "12px 14px",
                borderRadius: "14px",
                border: "1.5px solid var(--pc-line)",
                fontSize: "16px",
                outline: "none",
                background: "var(--pc-apricot)",
                fontWeight: 600,
                color: "var(--pc-ink)",
              }}
            />
          </div>
        </div>

        {/* Duration */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-(--pc-taupe) mb-2">
          Tid
        </div>
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setFullDay(true)}
            className={`flex-1 py-2.5 rounded-[14px] text-[13px] font-bold border transition-colors ${
              fullDay
                ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgb(var(--pc-orange-rgb)/0.45)]"
                : "bg-(--pc-apricot) border-(--pc-line) text-(--pc-ink)"
            }`}
          >
            Hel dag
          </button>
          <button
            type="button"
            onClick={() => setFullDay(false)}
            className={`flex-1 py-2.5 rounded-[14px] text-[13px] font-bold border transition-colors ${
              !fullDay
                ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgb(var(--pc-orange-rgb)/0.45)]"
                : "bg-(--pc-apricot) border-(--pc-line) text-(--pc-ink)"
            }`}
          >
            Ange timmar
          </button>
        </div>
        {!fullDay && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-(--pc-taupe) mb-2">
              Snabbval{" "}
              <span className="normal-case font-medium tracking-normal text-(--pc-taupe)">
                (av {refHours.toString().replace(".", ",")} h)
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {presetPcts.map((pct) => {
                const hoursForPct = Math.max(0.5, Math.round(((refHours * pct) / 100) * 2) / 2);
                const active = Math.abs(parseFloat(manualHours) - hoursForPct) < 0.01;
                return (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => applyPreset(pct)}
                    className={`py-2 rounded-[12px] text-[12px] font-bold border transition-colors ${
                      active
                        ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgb(var(--pc-orange-rgb)/0.45)]"
                        : "bg-(--pc-apricot) border-(--pc-line) text-(--pc-ink)"
                    }`}
                  >
                    {pct}%
                  </button>
                );
              })}
            </div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-(--pc-taupe) mb-2">
              Antal timmar{" "}
              <span className="normal-case font-medium tracking-normal text-(--pc-taupe)">
                (per dag)
              </span>
            </div>
            <input
              type="number"
              min={0.5}
              max={24}
              step={0.5}
              value={manualHours}
              onChange={(e) => setManualHours(e.target.value)}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: "14px",
                border: "1.5px solid var(--pc-line)",
                fontSize: "16px",
                outline: "none",
                background: "var(--pc-apricot)",
                fontWeight: 600,
                color: "var(--pc-ink)",
                marginBottom: "16px",
              }}
            />
          </>
        )}

        {/* Note */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-(--pc-taupe) mb-2">
          Anteckning{" "}
          <span className="normal-case font-medium tracking-normal text-(--pc-taupe)">
            (valfri)
          </span>
        </div>
        <textarea
          rows={2}
          placeholder="t.ex. Läkarintyg lämnat"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: "14px",
            border: "1.5px solid var(--pc-line)",
            fontSize: "15px",
            outline: "none",
            background: "var(--pc-apricot)",
            fontWeight: 500,
            color: "var(--pc-ink)",
            resize: "none",
            marginBottom: "16px",
            fontFamily: "inherit",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--pc-orange)";
            e.currentTarget.style.background = "var(--pc-surface)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--pc-line)";
            e.currentTarget.style.background = "var(--pc-apricot)";
          }}
        />

        {vacWarning && (
          <div className="text-pc-orange-deep text-[13px] mb-3 font-semibold">
            ⚠️ {vacWarning} Du kan spara ändå.
          </div>
        )}
        {err && <div className="text-red-600 text-[13px] mb-3 font-semibold">{err}</div>}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onClose}
            style={{
              padding: "16px",
              borderRadius: "16px",
              background: "var(--pc-apricot)",
              border: "1.5px solid var(--pc-line)",
              fontWeight: 700,
              fontSize: "15px",
              color: "var(--pc-ink)",
            }}
          >
            Avbryt
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: "16px",
              borderRadius: "16px",
              background: "var(--pc-orange)",
              color: "white",
              fontWeight: 700,
              fontSize: "15px",
              boxShadow: "0 8px 20px -8px rgb(var(--pc-orange-rgb) / 0.6)",
            }}
          >
            Spara
          </button>
        </div>
      </div>
    </div>
  );
}
