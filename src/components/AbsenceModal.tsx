import { useState } from "react";
import { ArrowLeft, X, Calendar as CalendarIcon } from "lucide-react";

export type AbsenceCategoryId =
  | "sjuk"
  | "vab"
  | "semester"
  | "foraldraledig"
  | "friskvard"
  | "tjansteledig"
  | "obetald"
  | "overtid"
  | "flex";

export interface AbsenceCategory {
  id: AbsenceCategoryId;
  label: string;
  emoji: string;
  tint: string;
}

const CATEGORIES: AbsenceCategory[] = [
  { id: "sjuk", label: "Sjuk", emoji: "🤒", tint: "#ffe4e1" },
  { id: "vab", label: "VAB", emoji: "👶", tint: "#fff1cd" },
  { id: "semester", label: "Semester", emoji: "✈️", tint: "#dff0ff" },
  { id: "foraldraledig", label: "Föräldraledig", emoji: "👪", tint: "#fde4f0" },
  { id: "friskvard", label: "Friskvård", emoji: "💪", tint: "#e3f5e1" },
  { id: "tjansteledig", label: "Tjänsteledig", emoji: "📋", tint: "#ece6df" },
  { id: "obetald", label: "Obetald ledighet", emoji: "🌙", tint: "#e8e3f5" },
  { id: "overtid", label: "Betald övertid", emoji: "⏰", tint: "#ffe6cc" },
  { id: "flex", label: "Flex", emoji: "🔄", tint: "#fdf6ee" },
];

export interface AbsenceEntry {
  category: AbsenceCategoryId;
  startDate: string;
  endDate: string;
  note?: string;
}

interface AbsenceModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (entry: AbsenceEntry) => void;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function AbsenceModal({ open, onClose, onSave }: AbsenceModalProps) {
  const [picked, setPicked] = useState<AbsenceCategory | null>(null);
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [isRange, setIsRange] = useState(false);
  const [note, setNote] = useState("");

  if (!open) return null;

  const reset = () => {
    setPicked(null);
    setStartDate(todayISO());
    setEndDate(todayISO());
    setIsRange(false);
    setNote("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSave = () => {
    if (!picked) return;
    onSave({
      category: picked.id,
      startDate,
      endDate: isRange ? endDate : startDate,
      note: note.trim() || undefined,
    });
    reset();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(45,23,23,0.45)", animation: "pcOverlay 200ms ease-out" }}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] overflow-hidden rounded-t-[28px] bg-white"
        style={{
          fontFamily: "var(--font-display)",
          color: "var(--color-pc-ink)",
          animation: "pcSheet 280ms cubic-bezier(0.32, 0.72, 0, 1)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
          maxHeight: "90vh",
        }}
      >
        {/* Grabber */}
        <div className="flex justify-center pt-3 pb-1">
          <span className="h-1.5 w-10 rounded-full" style={{ background: "var(--color-pc-line)" }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 pt-2">
          {picked ? (
            <button
              onClick={() => setPicked(null)}
              className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{ background: "var(--color-pc-apricot)", color: "var(--color-pc-bark)" }}
              aria-label="Tillbaka"
            >
              <ArrowLeft size={18} />
            </button>
          ) : (
            <div className="w-9" />
          )}
          <h2 className="text-[17px] font-semibold">
            {picked ? picked.label : "Frånvaro & avvikelse"}
          </h2>
          <button
            onClick={handleClose}
            className="flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: "var(--color-pc-apricot)", color: "var(--color-pc-bark)" }}
            aria-label="Stäng"
          >
            <X size={18} />
          </button>
        </div>

        {!picked ? (
          /* Category grid */
          <div className="overflow-y-auto px-5 pb-4 pt-2">
            <p className="mb-4 text-[14px]" style={{ color: "var(--color-pc-muted)" }}>
              Välj typ av frånvaro eller avvikelse att registrera.
            </p>
            <div className="grid grid-cols-3 gap-3">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setPicked(c)}
                  className="flex flex-col items-center justify-center gap-2 rounded-2xl p-3 text-center transition-all active:scale-95"
                  style={{
                    background: "var(--color-pc-bg)",
                    minHeight: 96,
                    boxShadow: "inset 0 0 0 1px var(--color-pc-line)",
                  }}
                >
                  <span
                    className="flex h-12 w-12 items-center justify-center rounded-full text-[26px]"
                    style={{ background: c.tint }}
                  >
                    {c.emoji}
                  </span>
                  <span className="text-[12px] font-medium leading-tight" style={{ color: "var(--color-pc-ink)" }}>
                    {c.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Detail form */
          <div className="overflow-y-auto px-5 pb-4 pt-2" style={{ animation: "pcFade 220ms ease-out" }}>
            {/* Selected chip */}
            <div
              className="mb-5 flex items-center gap-3 rounded-2xl p-3"
              style={{ background: picked.tint }}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[22px]">
                {picked.emoji}
              </span>
              <div className="flex-1">
                <div className="text-[15px] font-semibold">{picked.label}</div>
                <div className="text-[12px]" style={{ color: "var(--color-pc-bark)" }}>
                  Registrera period nedan
                </div>
              </div>
            </div>

            {/* Range toggle */}
            <div
              className="mb-3 flex rounded-full p-1"
              style={{ background: "var(--color-pc-apricot)" }}
            >
              {[
                { id: false, label: "En dag" },
                { id: true, label: "Period" },
              ].map((opt) => (
                <button
                  key={String(opt.id)}
                  onClick={() => setIsRange(opt.id)}
                  className="flex-1 rounded-full py-2 text-[14px] font-semibold transition-all"
                  style={{
                    background: isRange === opt.id ? "white" : "transparent",
                    color: isRange === opt.id ? "var(--color-pc-ink)" : "var(--color-pc-muted)",
                    boxShadow: isRange === opt.id ? "0 2px 8px -2px rgba(81,43,43,0.15)" : "none",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Dates */}
            <div className={`grid gap-3 ${isRange ? "grid-cols-2" : "grid-cols-1"}`}>
              <DateField
                label={isRange ? "Från" : "Datum"}
                value={startDate}
                onChange={setStartDate}
              />
              {isRange && (
                <DateField label="Till" value={endDate} onChange={setEndDate} />
              )}
            </div>

            {/* Note */}
            <label className="mb-2 mt-4 block text-[13px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-pc-bark)" }}>
              Anteckning <span className="font-normal normal-case tracking-normal" style={{ color: "var(--color-pc-muted)" }}>— valfritt</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="t.ex. läkarbesök kl 10"
              rows={2}
              className="w-full resize-none rounded-2xl border-0 px-4 py-3 text-[15px] outline-none"
              style={{
                background: "var(--color-pc-bg)",
                color: "var(--color-pc-ink)",
                boxShadow: "inset 0 0 0 1px var(--color-pc-line)",
              }}
            />

            {/* Save */}
            <button
              onClick={handleSave}
              className="mt-5 flex h-[56px] w-full items-center justify-center rounded-full text-[16px] font-semibold text-white transition-all active:scale-[0.98]"
              style={{
                background: "linear-gradient(135deg, var(--color-pc-orange), var(--color-pc-orange-deep))",
                boxShadow: "0 12px 28px -10px rgba(255,95,0,0.5)",
              }}
            >
              Spara {picked.label.toLowerCase()}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label
      className="flex flex-col rounded-2xl px-4 py-3"
      style={{
        background: "var(--color-pc-bg)",
        boxShadow: "inset 0 0 0 1px var(--color-pc-line)",
      }}
    >
      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-pc-bark)" }}>
        <CalendarIcon size={12} /> {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-[16px] font-medium outline-none"
        style={{ color: "var(--color-pc-ink)" }}
      />
    </label>
  );
}
