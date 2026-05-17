import { useState } from "react";
import {
  type WeekSchedule, type DayKey,
  DAY_KEYS, DAY_LABEL_SHORT, DAY_LABEL_LONG,
  WORK_PRESETS, LUNCH_PRESETS,
  weeklyNetMin, fmtMin,
} from "../lib/schedule";
import { PerDayEditor } from "./Onboarding";

export type SettingsResult = {
  name: string;
  department?: string;
  schedule: WeekSchedule;
};

const SEL: React.CSSProperties = {
  padding: "8px 10px", borderRadius: "12px", border: "1.5px solid #ece6df",
  fontSize: "13px", fontWeight: 700, color: "#2d1717", background: "#fdf6ee",
  outline: "none", width: "100%", appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239a8a82' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
  backgroundSize: "14px", paddingRight: "28px",
};

export default function SettingsModal({
  open,
  initialName,
  initialDepartment,
  initialSchedule,
  onClose,
  onSave,
}: {
  open: boolean;
  initialName: string;
  initialDepartment?: string;
  initialSchedule: WeekSchedule;
  onClose: () => void;
  onSave: (r: SettingsResult) => void;
}) {
  const [name, setName] = useState(initialName);
  const [department, setDepartment] = useState(initialDepartment ?? "");
  const [schedule, setSchedule] = useState<WeekSchedule>(initialSchedule);
  const [nameErr, setNameErr] = useState("");

  // "Set same for all active days" quick-fill
  const [bulkWork, setBulkWork] = useState(480);
  const [bulkLunch, setBulkLunch] = useState(45);

  if (!open) return null;

  function applyBulk() {
    const next = { ...schedule };
    for (const k of DAY_KEYS) {
      if (next[k].active) {
        next[k] = { ...next[k], workMinutes: bulkWork, lunchMinutes: bulkLunch };
      }
    }
    setSchedule(next);
  }

  function handleSave() {
    if (!name.trim()) { setNameErr("Namn krävs."); return; }
    onSave({
      name: name.trim(),
      department: department.trim() || undefined,
      schedule,
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
        {/* Handle */}
        <div className="w-10 h-1 bg-pc-line rounded-full mx-auto mb-5" />

        <div className="font-extrabold text-[22px] tracking-tight mb-1">Inställningar</div>
        <div className="text-[13px] text-pc-muted mb-6">Ändra namn, avdelning och arbetsschema.</div>

        {/* Name */}
        <SLabel>Namn <span className="text-pc-orange">*</span></SLabel>
        <input
          type="text"
          value={name}
          onChange={e => { setName(e.target.value); setNameErr(""); }}
          className="s-input"
          style={INPUT}
          placeholder="Ditt namn"
        />
        {nameErr && <p className="text-red-500 text-[13px] mb-3 font-semibold">{nameErr}</p>}

        {/* Department */}
        <SLabel>Avdelning <span className="text-pc-muted font-medium normal-case tracking-normal">(valfri)</span></SLabel>
        <input
          type="text"
          value={department}
          onChange={e => setDepartment(e.target.value)}
          className="s-input"
          style={INPUT}
          placeholder="t.ex. Lager, Kontor…"
        />

        {/* Schedule */}
        <div className="border-t border-pc-line pt-5 mt-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-extrabold text-[16px] text-pc-ink">Arbetsschema</div>
              <div className="text-[12px] text-pc-muted mt-0.5">
                Netto/vecka: <span className="font-bold text-pc-orange-deep">{fmtMin(weeklyNetMin(schedule))}</span>
              </div>
            </div>
          </div>

          <PerDayEditor schedule={schedule} onChange={setSchedule} />

          {/* Bulk fill */}
          <div className="mt-4 bg-pc-apricot rounded-[18px] p-4 border border-pc-line">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-3">
              Sätt samma för alla aktiva dagar
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <div className="text-[10px] font-bold text-pc-muted mb-1 uppercase tracking-wide">Arbetstid</div>
                <select value={bulkWork} onChange={e => setBulkWork(+e.target.value)} style={SEL}>
                  {WORK_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <div className="text-[10px] font-bold text-pc-muted mb-1 uppercase tracking-wide">Lunch</div>
                <select value={bulkLunch} onChange={e => setBulkLunch(+e.target.value)} style={SEL}>
                  {LUNCH_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>
            <button
              onClick={applyBulk}
              className="w-full py-2.5 rounded-[14px] border border-pc-orange text-pc-orange font-bold text-[13px] bg-white active:scale-[0.98] transition-transform"
            >
              Tillämpa på alla aktiva dagar
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3 mt-6">
          <button
            onClick={onClose}
            style={{ padding: "15px", borderRadius: "16px", background: "#fdf6ee", border: "1.5px solid #ece6df", fontWeight: 700, fontSize: "15px", color: "#2d1717" }}
          >
            Avbryt
          </button>
          <button
            onClick={handleSave}
            style={{ padding: "15px", borderRadius: "16px", background: "#ff5f00", color: "white", fontWeight: 700, fontSize: "15px", boxShadow: "0 8px 20px -8px rgba(255,95,0,0.6)" }}
          >
            Spara
          </button>
        </div>
      </div>
    </div>
  );
}

function SLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">{children}</div>;
}

const INPUT: React.CSSProperties = {
  width: "100%", padding: "13px 16px", borderRadius: "14px",
  border: "1.5px solid #ece6df", fontSize: "15px", outline: "none",
  background: "#fdf6ee", fontWeight: 600, color: "#2d1717",
  marginBottom: "16px", boxSizing: "border-box",
};
