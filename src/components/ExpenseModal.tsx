import { useState, useEffect } from "react";
import { todayLocal } from "../lib/dates";

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
  date: string; // "YYYY-MM-DD"
  amount?: number; // SEK — optional for milersättning (km-only entries)
  km?: number; // only for milersattning
  hasReceipt: boolean;
  note?: string;
  manual: true;
};

export const EXPENSE_META: Record<ExpenseCategory, { emoji: string; label: string }> = {
  milersattning: { emoji: "🚗", label: "Milersättning" },
  traktamente: { emoji: "🏨", label: "Traktamente" },
  resetimmar: { emoji: "⏱️", label: "Resetimmar" },
  parkering: { emoji: "🅿️", label: "Parkering" },
  kost: { emoji: "🍽️", label: "Kost" },
  representation: { emoji: "🤝", label: "Representation" },
  ovrigt: { emoji: "📋", label: "Övrigt" },
};

// "resetimmar" is no longer offered: travel time lives in Restid (TravelTimeEditor). The
// category stays in the type and EXPENSE_META so an old expense that could not be migrated
// to a travel entry still renders.
const CATEGORIES = (
  Object.entries(EXPENSE_META) as [ExpenseCategory, { emoji: string; label: string }][]
).filter(([key]) => key !== "resetimmar");

function todayStr() {
  return todayLocal();
}

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
  const [km, setKm] = useState("");
  const [hasReceipt, setHasReceipt] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setCategory("milersattning");
      setDate(todayStr());
      setAmount("");
      setKm("");
      setHasReceipt(false);
      setNote("");
      setErr("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  function handleSave() {
    if (!date) {
      setErr("Ange datum.");
      return;
    }
    const isMileage = category === "milersattning";
    let parsedAmount: number | undefined;
    if (!isMileage) {
      const v = parseFloat(amount.replace(",", "."));
      if (isNaN(v) || v <= 0) {
        setErr("Ange ett giltigt belopp.");
        return;
      }
      parsedAmount = v;
    } else if (amount.trim()) {
      // Allow optional amount for milersättning if the user wants to record one
      const v = parseFloat(amount.replace(",", "."));
      if (!isNaN(v) && v > 0) parsedAmount = v;
    }
    let parsedKm: number | undefined;
    if (isMileage) {
      parsedKm = parseFloat(km.replace(",", "."));
      if (isNaN(parsedKm) || parsedKm <= 0) {
        setErr("Ange antal km.");
        return;
      }
    }
    onSave({
      id: crypto.randomUUID(),
      category,
      date,
      amount: parsedAmount,
      km: parsedKm,
      hasReceipt,
      note: note.trim() || undefined,
      manual: true,
    });
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
          maxHeight: "92dvh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-(--pc-line) rounded-full mx-auto md:hidden mb-5" />

        <div className="font-extrabold text-[22px] tracking-tight mb-1">Lägg till utlägg</div>
        <div className="text-[13px] text-(--pc-taupe) mb-6">Välj typ, datum och belopp.</div>

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

        {/* Date */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-(--pc-taupe) mb-2">
          Datum
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
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
            marginBottom: "16px",
          }}
        />

        {/* km — only for milersattning */}
        {category === "milersattning" && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-(--pc-taupe) mb-2">
              Antal km
            </div>
            <div className="relative mb-4">
              <input
                type="number"
                inputMode="decimal"
                placeholder="0"
                min={0}
                step={1}
                value={km}
                onChange={(e) => setKm(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "12px 48px 12px 14px",
                  borderRadius: "14px",
                  border: "1.5px solid var(--pc-line)",
                  fontSize: "16px",
                  outline: "none",
                  background: "var(--pc-apricot)",
                  fontWeight: 600,
                  color: "var(--pc-ink)",
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
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[14px] font-bold text-(--pc-taupe) pointer-events-none">
                km
              </span>
            </div>
          </>
        )}

        {/* Amount */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-(--pc-taupe) mb-2">
          Belopp
          {category === "milersattning" && (
            <span className="normal-case font-medium tracking-normal text-(--pc-taupe)">
              {" "}
              (valfri — räcker med km)
            </span>
          )}
        </div>
        <div className="relative mb-4">
          <input
            type="number"
            inputMode="decimal"
            placeholder="0"
            min={0}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "12px 48px 12px 14px",
              borderRadius: "14px",
              border: "1.5px solid var(--pc-line)",
              fontSize: "16px",
              outline: "none",
              background: "var(--pc-apricot)",
              fontWeight: 600,
              color: "var(--pc-ink)",
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
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[14px] font-bold text-(--pc-taupe) pointer-events-none">
            kr
          </span>
        </div>

        {/* Receipt toggle */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-(--pc-taupe) mb-2">
          Kvitto
        </div>
        <div className="flex gap-2 mb-2">
          <button
            type="button"
            onClick={() => setHasReceipt(false)}
            className={`flex-1 py-2.5 rounded-[14px] text-[13px] font-bold border transition-colors ${
              !hasReceipt
                ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgb(var(--pc-orange-rgb)/0.45)]"
                : "bg-(--pc-apricot) border-(--pc-line) text-(--pc-ink)"
            }`}
          >
            Inget kvitto
          </button>
          <button
            type="button"
            onClick={() => setHasReceipt(true)}
            className={`flex-1 py-2.5 rounded-[14px] text-[13px] font-bold border transition-colors ${
              hasReceipt
                ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgb(var(--pc-orange-rgb)/0.45)]"
                : "bg-(--pc-apricot) border-(--pc-line) text-(--pc-ink)"
            }`}
          >
            🧾 Kvitto finns
          </button>
        </div>
        {hasReceipt && (
          <div className="text-[11px] text-(--pc-taupe) font-medium mb-4 leading-snug">
            Du påminns att bifoga kvittot när du delar rapporten.
          </div>
        )}
        {!hasReceipt && <div className="mb-4" />}

        {/* Note */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-(--pc-taupe) mb-2">
          Anteckning{" "}
          <span className="normal-case font-medium tracking-normal text-(--pc-taupe)">
            (valfri)
          </span>
        </div>
        <textarea
          rows={2}
          placeholder="t.ex. Resa till kundmöte i Göteborg"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
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
