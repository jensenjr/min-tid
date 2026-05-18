import { useState } from "react";
import {
  type DayKey, type DayConfig, type WeekSchedule,
  DAY_KEYS, DAY_LABEL_SHORT,
  DEFAULT_SCHEDULE,
  shiftMinutes, netDayMin, weeklyNetMin, fmtMin,
} from "../lib/schedule";

export type OnboardingResult = {
  name: string;
  department?: string;
  schedule: WeekSchedule;
};

type Step = "info" | "choice" | "schedule";

// ─── TimePicker — hour or minute select snapping to 5-min ─────
function TimePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [hStr, mStr] = value.split(":");
  const h = parseInt(hStr) || 0;
  const m = Math.round((parseInt(mStr) || 0) / 5) * 5 % 60;

  const sel: React.CSSProperties = {
    padding: "5px 0",
    borderRadius: "10px",
    border: "1.5px solid #ece6df",
    fontSize: "15px",
    fontWeight: 700,
    color: disabled ? "#c4b0a0" : "#2d1717",
    background: disabled ? "#f5f0ea" : "#fdf6ee",
    outline: "none",
    appearance: "none",
    textAlign: "center",
    width: "42px",
    cursor: disabled ? "default" : "pointer",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1px" }}>
      <select
        value={h}
        onChange={e => onChange(`${String(+e.target.value).padStart(2,"0")}:${String(m).padStart(2,"0")}`)}
        disabled={disabled}
        style={sel}
      >
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={i}>{String(i).padStart(2, "0")}</option>
        ))}
      </select>
      <span style={{ fontWeight: 800, fontSize: "16px", color: disabled ? "#c4b0a0" : "#2d1717", userSelect: "none", padding: "0 1px" }}>:</span>
      <select
        value={m}
        onChange={e => onChange(`${String(h).padStart(2,"0")}:${String(+e.target.value).padStart(2,"0")}`)}
        disabled={disabled}
        style={sel}
      >
        {Array.from({ length: 12 }, (_, i) => i * 5).map(min => (
          <option key={min} value={min}>{String(min).padStart(2, "0")}</option>
        ))}
      </select>
    </div>
  );
}

// ─── LunchPicker — compact minutes select (0–90, 5-min steps) ─
function LunchPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(+e.target.value)}
      disabled={disabled}
      style={{
        padding: "5px 0",
        borderRadius: "10px",
        border: "1.5px solid #ece6df",
        fontSize: "15px",
        fontWeight: 700,
        color: disabled ? "#c4b0a0" : "#9a6a3a",
        background: disabled ? "#f5f0ea" : "#fff3ec",
        outline: "none",
        appearance: "none",
        textAlign: "center",
        width: "40px",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {Array.from({ length: 19 }, (_, i) => i * 5).map(min => (
        <option key={min} value={min}>{String(min).padStart(2, "0")}</option>
      ))}
    </select>
  );
}

// ─── WeekScheduleEditor — shared by Onboarding + SettingsModal ─
export function WeekScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: WeekSchedule;
  onChange: (s: WeekSchedule) => void;
}) {
  const [bulkStart, setBulkStart] = useState("08:00");
  const [bulkEnd, setBulkEnd] = useState("17:00");
  const [bulkLunch, setBulkLunch] = useState(60);

  function setDay(key: DayKey, patch: Partial<DayConfig>) {
    onChange({ ...schedule, [key]: { ...schedule[key], ...patch } });
  }

  function applyBulk() {
    const next = { ...schedule };
    for (const k of DAY_KEYS) {
      if (next[k].active) {
        next[k] = { ...next[k], startTime: bulkStart, endTime: bulkEnd, lunchMinutes: bulkLunch };
      }
    }
    onChange(next);
  }

  return (
    <div className="w-full space-y-2">
      {/* Quick-fill */}
      <div className="bg-pc-apricot rounded-[18px] px-4 py-3 border border-pc-line mb-1">
        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">
          Fyll alla aktiva dagar
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <TimePicker value={bulkStart} onChange={setBulkStart} />
          <span className="text-[13px] font-bold text-pc-muted">→</span>
          <TimePicker value={bulkEnd} onChange={setBulkEnd} />
          <LunchPicker value={bulkLunch} onChange={setBulkLunch} />
          <button
            onClick={applyBulk}
            className="ml-auto shrink-0 px-3 py-1.5 rounded-[10px] border border-pc-orange text-pc-orange font-bold text-[12px] bg-white active:scale-[0.97] transition-transform"
          >
            Tillämpa
          </button>
        </div>
      </div>

      {/* Day rows */}
      {DAY_KEYS.map(key => {
        const cfg = schedule[key];
        const isWeekend = key === "sat" || key === "sun";
        const net = netDayMin(cfg);

        return (
          <div
            key={key}
            className="flex items-center gap-1.5 bg-white rounded-[16px] px-3 py-2.5 border border-pc-line transition-opacity"
            style={{ opacity: cfg.active ? 1 : 0.45 }}
          >
            {/* Day label */}
            <span
              className="text-[13px] font-extrabold shrink-0"
              style={{ width: 28, color: isWeekend ? "#c4a882" : "#2d1717" }}
            >
              {DAY_LABEL_SHORT[key]}
            </span>

            {/* Time pickers */}
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <TimePicker
                value={cfg.startTime}
                onChange={v => setDay(key, { startTime: v })}
                disabled={!cfg.active}
              />
              <span className="text-[11px] text-pc-muted font-bold shrink-0">→</span>
              <TimePicker
                value={cfg.endTime}
                onChange={v => setDay(key, { endTime: v })}
                disabled={!cfg.active}
              />
            </div>

            {/* Lunch minutes */}
            <LunchPicker
              value={cfg.lunchMinutes}
              onChange={v => setDay(key, { lunchMinutes: v })}
              disabled={!cfg.active}
            />

            {/* Net duration */}
            <span
              className="text-[12px] font-bold tabular-nums shrink-0"
              style={{ width: 38, textAlign: "right", color: cfg.active ? "#9a6a3a" : "#c4b0a0" }}
            >
              {cfg.active ? fmtMin(net) : "—"}
            </span>

            {/* Toggle */}
            <button
              onClick={() => setDay(key, { active: !cfg.active })}
              className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-colors"
              style={{ background: cfg.active ? "#ff5f00" : "#f0e8df" }}
              aria-label={cfg.active ? "Inaktivera" : "Aktivera"}
            >
              {cfg.active
                ? <svg viewBox="0 0 24 24" className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                : <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="#c4b0a0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              }
            </button>
          </div>
        );
      })}

      {/* Weekly total */}
      <div className="mt-1 bg-pc-peach rounded-2xl px-4 py-3 flex items-center justify-between">
        <span className="text-[12px] font-bold text-pc-orange-deep uppercase tracking-wide">Netto / vecka</span>
        <span className="text-[20px] font-extrabold tabular-nums text-pc-orange-deep">
          {fmtMin(weeklyNetMin(schedule))}
        </span>
      </div>
    </div>
  );
}

// ─── Main Onboarding ──────────────────────────────────────────
export default function Onboarding({ onComplete }: { onComplete: (r: OnboardingResult) => void }) {
  const [step, setStep] = useState<Step>("info");
  const [name, setName] = useState("");
  const [nameErr, setNameErr] = useState("");
  const [department, setDepartment] = useState("");
  const [schedule, setSchedule] = useState<WeekSchedule>(DEFAULT_SCHEDULE);

  function finish(sched: WeekSchedule) {
    onComplete({ name: name.trim(), department: department.trim() || undefined, schedule: sched });
  }

  // ── Step: Name + role ────────────────────────────────────────
  if (step === "info") return (
    <Screen>
      <Logo />
      <h1 className="text-[28px] font-extrabold tracking-tight text-pc-ink mb-2">Välkommen!</h1>
      <p className="text-[14px] text-pc-muted mb-7 leading-relaxed text-center max-w-[300px]">
        Fyll i ditt namn för att komma igång. Roll är valfritt.
      </p>

      <div className="w-full space-y-3">
        <div>
          <Label>Namn <span className="text-pc-orange">*</span></Label>
          <input
            autoFocus
            type="text"
            placeholder="t.ex. Anna Karlsson"
            value={name}
            onChange={e => { setName(e.target.value); setNameErr(""); }}
            onKeyDown={e => { if (e.key === "Enter" && name.trim()) setStep("choice"); }}
            className="ob-input"
          />
          {nameErr && <p className="text-red-500 text-[13px] mt-1 font-semibold">{nameErr}</p>}
        </div>

        <div>
          <Label>Roll / avdelning <span className="text-pc-muted font-medium normal-case tracking-normal">(valfri)</span></Label>
          <input
            type="text"
            placeholder="t.ex. Lager, Kontor, Teknik…"
            value={department}
            onChange={e => setDepartment(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && name.trim()) setStep("choice"); }}
            className="ob-input"
          />
        </div>

        <button
          onClick={() => {
            if (!name.trim()) { setNameErr("Ange ditt namn för att fortsätta."); return; }
            setStep("choice");
          }}
          className="ob-btn-primary w-full"
        >
          Fortsätt →
        </button>
      </div>
    </Screen>
  );

  // ── Step: Set schedule or skip ───────────────────────────────
  if (step === "choice") return (
    <Screen>
      <StepDots current={1} total={2} />
      <h2 className="text-[24px] font-extrabold tracking-tight text-pc-ink mb-1 text-center">
        Vill du sätta ditt schema?
      </h2>
      <p className="text-[13px] text-pc-muted mb-7 text-center leading-relaxed">
        Du kan alltid ändra det senare via inställningarna.
      </p>

      <div className="w-full space-y-3">
        <button
          onClick={() => setStep("schedule")}
          className="pc-press w-full text-left bg-white border border-pc-line rounded-[20px] px-5 py-4 flex items-start gap-4 shadow-[0_2px_12px_rgba(81,43,43,0.04)]"
        >
          <span className="text-[26px] leading-none mt-0.5 shrink-0">🗓️</span>
          <div className="flex-1">
            <div className="font-extrabold text-[15px] text-pc-ink leading-tight mb-0.5">Anpassa schema</div>
            <div className="text-[12px] text-pc-muted leading-snug">Sätt arbetstider och lunch per dag.</div>
          </div>
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-pc-muted shrink-0 mt-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>

        <button
          onClick={() => finish(DEFAULT_SCHEDULE)}
          className="pc-press w-full text-left bg-white border border-pc-line rounded-[20px] px-5 py-4 flex items-start gap-4 shadow-[0_2px_12px_rgba(81,43,43,0.04)]"
        >
          <span className="text-[26px] leading-none mt-0.5 shrink-0">⚡</span>
          <div className="flex-1">
            <div className="font-extrabold text-[15px] text-pc-ink leading-tight mb-0.5">Hoppa över</div>
            <div className="text-[12px] text-pc-muted leading-snug">Mån–Fre 08:00–17:00 med 1h lunch (8h/dag, 40h/vecka).</div>
          </div>
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-pc-muted shrink-0 mt-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>

        <button onClick={() => setStep("info")} className="ob-btn-ghost w-full">← Tillbaka</button>
      </div>
    </Screen>
  );

  // ── Step: Schedule editor ────────────────────────────────────
  if (step === "schedule") return (
    <Screen scroll>
      <StepDots current={2} total={2} />
      <h2 className="text-[22px] font-extrabold tracking-tight text-pc-ink mb-1 text-center">
        Din arbetsvecka
      </h2>
      <p className="text-[12px] text-pc-muted mb-5 text-center">
        Starttid, sluttid och lunchrast per dag.
      </p>

      <WeekScheduleEditor schedule={schedule} onChange={setSchedule} />

      <div className="grid grid-cols-2 gap-3 pt-4 w-full">
        <button onClick={() => setStep("choice")} className="ob-btn-ghost">← Tillbaka</button>
        <button onClick={() => finish(schedule)} className="ob-btn-primary">Kom igång →</button>
      </div>
    </Screen>
  );

  return null;
}

// ─── Sub-components ───────────────────────────────────────────
function Screen({ children, scroll = false }: { children: React.ReactNode; scroll?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-pc-bg flex flex-col">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        .ob-fade { animation: obFade 0.4s cubic-bezier(0.16,1,0.3,1); }
        @keyframes obFade { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        .pc-press:active { transform: scale(0.96); }
        .pc-press { transition: transform 0.15s; }
        .ob-input {
          width:100%; padding:14px 16px; border-radius:16px;
          border:1.5px solid #ece6df; font-size:16px; outline:none;
          background:#fdf6ee; font-weight:600; color:#2d1717;
          box-sizing:border-box;
        }
        .ob-input:focus { border-color:#ff5f00; background:#fff; }
        .ob-btn-primary {
          padding:15px 24px; border-radius:18px; background:#ff5f00;
          color:white; font-weight:800; font-size:16px;
          box-shadow:0 8px 24px -8px rgba(255,95,0,0.55);
          transition:transform 0.15s;
        }
        .ob-btn-primary:active { transform:scale(0.97); }
        .ob-btn-primary:disabled { background:#f0e8df; color:#c4a882; box-shadow:none; }
        .ob-btn-ghost {
          padding:12px 24px; border-radius:16px; background:transparent;
          color:#9a8a82; font-weight:600; font-size:14px;
          transition:transform 0.15s;
        }
        .ob-btn-ghost:active { transform:scale(0.97); }
      `}</style>
      <div
        className="mx-auto w-full max-w-[480px] flex flex-col flex-1 items-center px-5 pb-10 ob-fade"
        style={{ overflowY: scroll ? "auto" : "hidden", overflowX: "hidden" }}
      >
        <div className="h-[env(safe-area-inset-top,0px)]" />
        <div className="flex flex-col items-center w-full mt-8 flex-1">
          {children}
        </div>
        <div className="h-[env(safe-area-inset-bottom,0px)]" />
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex flex-col items-center mb-5">
      <div className="w-16 h-16 rounded-3xl bg-pc-orange flex items-center justify-center shadow-[0_8px_28px_rgba(255,95,0,0.38)] mb-4">
        <svg viewBox="0 0 24 24" className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
        </svg>
      </div>
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-pc-muted">Tidrapport</div>
    </div>
  );
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1.5 mb-5">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="h-1.5 rounded-full transition-all" style={{
          width: i + 1 === current ? 20 : 6,
          background: i + 1 <= current ? "#ff5f00" : "#ece6df",
        }} />
      ))}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-pc-muted mb-2">{children}</div>;
}
