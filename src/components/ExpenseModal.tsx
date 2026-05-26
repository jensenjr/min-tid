import { useState, useEffect } from "react";

export type ExpenseCategory =
  | "milersattning"
  | "traktamente"
  | "resetimmar"
  | "parkering"
  | "kost"
  | "representation"
  | "ovrigt";

export type ExpenseEntry = {
  id: string;
  category: ExpenseCategory;
  date: string;        // "YYYY-MM-DD"
  amount: number;      // SEK
  hasReceipt: boolean;
  note?: string;
  manual: true;
};

export const EXPENSE_META: Record<ExpenseCategory, { emoji: string; label: string }> = {
  milersattning: { emoji: "🚗", label: "Milersättning" },
  traktamente:   { emoji: "🏨", label: "Traktamente" },
  resetimmar:    { emoji: "⏱️", label: "Resetimmar" },
  parkering:     { emoji: "🅿️", label: "Parkering" },
  kost:          { emoji: "🍽️", label: "Kost" },
  representation:{ emoji: "🤝", label: "Representation" },
  ovrigt:        { emoji: "📋", label: "Övrigt" },
};

const CATEGORIES = Object.entries(EXPENSE_META) as [ExpenseCategory, { emoji: string; label: string }][];

function todayStr() { return new Date().toISOString().slice(0, 10); }

export default function ExpenseModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (entry: ExpenseEntry) => void;
}) {
  const [category, setCategory] = useState<ExpenseCategory>("milersattning");
  const [date, setDate] = useState(todayStr());
  const [amount, setAmount] = useState("");
  const [hasReceipt, setHasReceipt] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setCategory("milersattning");
      setDate(todayStr());
      setAmount("");
      setHasReceipt(false);
      setNote("");
      setErr("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  function handleSave() {
    if (!date) { setErr("Ange datum."); return; }
    const parsed = parseFloat(amount.replace(",", "."));
    if (isNaN(parsed) || parsed <= 0) { setErr("Ange ett giltigt belopp."); return; }
    onSave({
      id: crypto.randomUUID(),
      category,
      date,
      amount: parsed,
      hasReceipt,
      note: note.trim() || undefined,
      manual: true,
    });
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
          maxHeight: "92dvh",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-[#ece6df] rounded-full mx-auto mb-5" />

        <div className="font-extrabold text-[22px] tracking-tight mb-1">Lägg till utlägg</div>
        <div className="text-[13px] text-[#9c7c5c] mb-6">
          Välj typ, datum och belopp.
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

        {/* Date */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">Datum</div>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          style={{
            width: "100%", boxSizing: "border-box", WebkitAppearance: "none",
            padding: "12px 14px", borderRadius: "14px",
            border: "1.5px solid #ece6df", fontSize: "16px", outline: "none",
            background: "#fdf6ee", fontWeight: 600, color: "#2d1717",
            marginBottom: "16px",
          }}
        />

        {/* Amount */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">Belopp</div>
        <div className="relative mb-4">
          <input
            type="number"
            inputMode="decimal"
            placeholder="0"
            min={0}
            step={1}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "12px 48px 12px 14px", borderRadius: "14px",
              border: "1.5px solid #ece6df", fontSize: "16px", outline: "none",
              background: "#fdf6ee", fontWeight: 600, color: "#2d1717",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = "#ff5f00"; e.currentTarget.style.background = "#fff"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "#ece6df"; e.currentTarget.style.background = "#fdf6ee"; }}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[14px] font-bold text-[#9c7c5c] pointer-events-none">
            kr
          </span>
        </div>

        {/* Receipt toggle */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">Kvitto</div>
        <div className="flex gap-2 mb-2">
          <button
            type="button"
            onClick={() => setHasReceipt(false)}
            className={`flex-1 py-2.5 rounded-[14px] text-[13px] font-bold border transition-colors ${
              !hasReceipt
                ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgba(255,95,0,0.45)]"
                : "bg-[#fdf6ee] border-[#ece6df] text-[#2d1717]"
            }`}
          >
            Inget kvitto
          </button>
          <button
            type="button"
            onClick={() => setHasReceipt(true)}
            className={`flex-1 py-2.5 rounded-[14px] text-[13px] font-bold border transition-colors ${
              hasReceipt
                ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgba(255,95,0,0.45)]"
                : "bg-[#fdf6ee] border-[#ece6df] text-[#2d1717]"
            }`}
          >
            🧾 Kvitto finns
          </button>
        </div>
        {hasReceipt && (
          <div className="text-[11px] text-[#9c7c5c] font-medium mb-4 leading-snug">
            Du påminns att bifoga kvittot när du delar rapporten.
          </div>
        )}
        {!hasReceipt && <div className="mb-4" />}

        {/* Note */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">
          Anteckning <span className="normal-case font-medium tracking-normal text-[#9c7c5c]">(valfri)</span>
        </div>
        <textarea
          rows={2}
          placeholder="t.ex. Resa till kundmöte i Göteborg"
          value={note}
          onChange={e => setNote(e.target.value)}
          style={{
            width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: "14px",
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
