import { useState, useEffect } from "react";

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
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (entry: AbsenceEntry) => void;
}) {
  const [category, setCategory] = useState<AbsenceCategory>("sjuk");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  // Reset fields every time the modal opens
  useEffect(() => {
    if (open) {
      setCategory("sjuk");
      setStartDate(todayStr());
      setEndDate(todayStr());
      setNote("");
      setErr("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  function handleSave() {
    if (!startDate) { setErr("Ange startdatum."); return; }
    if (!endDate) { setErr("Ange slutdatum."); return; }
    if (endDate < startDate) { setErr("Slutdatum måste vara samma som eller efter startdatum."); return; }
    onSave({
      id: crypto.randomUUID(),
      category,
      startDate,
      endDate,
      note: note.trim() || undefined,
      manual: true,
    });
    setCategory("sjuk");
    setStartDate(todayStr());
    setEndDate(todayStr());
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
        <div className="grid grid-cols-2 gap-3 mb-4" style={{ minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">Startdatum</div>
            <input
              type="date"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }}
              style={{
                width: "100%", minWidth: 0, boxSizing: "border-box",
                padding: "12px 10px", borderRadius: "14px",
                border: "1.5px solid #ece6df", fontSize: "14px", outline: "none",
                background: "#fdf6ee", fontWeight: 600, color: "#2d1717",
              }}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">Slutdatum</div>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={e => setEndDate(e.target.value)}
              style={{
                width: "100%", minWidth: 0, boxSizing: "border-box",
                padding: "12px 10px", borderRadius: "14px",
                border: "1.5px solid #ece6df", fontSize: "14px", outline: "none",
                background: "#fdf6ee", fontWeight: 600, color: "#2d1717",
              }}
            />
          </div>
        </div>

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
