import { useState } from "react";
import {
  type DayKey, type WeekSchedule,
  DAY_KEYS, DAY_LABEL_SHORT,
  DEFAULT_SCHEDULE, WORK_PRESETS, LUNCH_PRESETS,
  weeklyNetMin, fmtMin, buildUniformSchedule,
} from "../lib/schedule";

export type OnboardingResult = {
  name: string;
  department?: string;
  schedule: WeekSchedule;
};

type Step = "name" | "type" | "uniform" | "perday" | "dept";

const COMMON_WORK = WORK_PRESETS.filter(p =>
  [360, 420, 450, 465, 480, 510, 540].includes(p.value)
);
const WEEKDAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri"];

// ─── Shared select style ──────────────────────────────────────
const SEL: React.CSSProperties = {
  padding: "8px 10px", borderRadius: "12px", border: "1.5px solid #ece6df",
  fontSize: "13px", fontWeight: 700, color: "#2d1717", background: "#fdf6ee",
  outline: "none", width: "100%", appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239a8a82' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
  backgroundSize: "14px", paddingRight: "28px",
};

// ─── Reusable per-day table ───────────────────────────────────
function PerDayEditor({
  schedule,
  onChange,
}: {
  schedule: WeekSchedule;
  onChange: (s: WeekSchedule) => void;
}) {
  function setDay(key: DayKey, patch: Partial<{ active: boolean; workMinutes: number; lunchMinutes: number }>) {
    onChange({ ...schedule, [key]: { ...schedule[key], ...patch } });
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="grid gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-pc-muted px-1 mb-1"
        style={{ gridTemplateColumns: "56px 1fr 1fr 36px" }}>
        <span>Dag</span>
        <span>Arbetstid</span>
        <span>Lunch</span>
        <span />
      </div>

      {DAY_KEYS.map(key => {
        const cfg = schedule[key];
        return (
          <div key={key}
            className="grid gap-2 items-center"
            style={{ gridTemplateColumns: "56px 1fr 1fr 36px" }}>
            {/* Day label */}
            <span className={`text-[13px] font-bold ${cfg.active ? "text-pc-ink" : "text-pc-muted"}`}>
              {DAY_LABEL_SHORT[key]}
            </span>

            {/* Work time */}
            {cfg.active ? (
              <select
                value={cfg.workMinutes}
                onChange={e => setDay(key, { workMinutes: +e.target.value })}
                style={SEL}
              >
                {WORK_PRESETS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            ) : (
              <div style={{ ...SEL, color: "#c4b0a0", background: "#f5f0ea" }}>—</div>
            )}

            {/* Lunch */}
            {cfg.active ? (
              <select
                value={cfg.lunchMinutes}
                onChange={e => setDay(key, { lunchMinutes: +e.target.value })}
                style={SEL}
              >
                {LUNCH_PRESETS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            ) : (
              <div style={{ ...SEL, color: "#c4b0a0", background: "#f5f0ea" }}>—</div>
            )}

            {/* Toggle */}
            <button
              onClick={() => setDay(key, { active: !cfg.active, lunchMinutes: !cfg.active ? 30 : 0 })}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
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
      <div className="mt-3 bg-pc-peach rounded-2xl px-4 py-3 flex items-center justify-between">
        <span className="text-[12px] font-bold text-pc-orange-deep uppercase tracking-wide">Netto / vecka</span>
        <span className="text-[18px] font-extrabold tabular-nums text-pc-orange-deep">
          {fmtMin(weeklyNetMin(schedule))}
        </span>
      </div>
    </div>
  );
}

// ─── Main Onboarding ──────────────────────────────────────────
export default function Onboarding({ onComplete }: { onComplete: (r: OnboardingResult) => void }) {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [nameErr, setNameErr] = useState("");
  const [department, setDepartment] = useState("");
  const [schedule, setSchedule] = useState<WeekSchedule>(DEFAULT_SCHEDULE);

  // Uniform-mode local state
  const [activeDays, setActiveDays] = useState<Set<DayKey>>(new Set(WEEKDAYS));
  const [uniformWork, setUniformWork] = useState(480);
  const [uniformLunch, setUniformLunch] = useState(30);

  // Weekly norm = work hours only, lunch is not deducted
  const uniformWeekNet = [...activeDays].length * uniformWork;

  function toggleDay(k: DayKey) {
    setActiveDays(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function finish(sched: WeekSchedule) {
    onComplete({
      name: name.trim(),
      department: department.trim() || undefined,
      schedule: sched,
    });
  }

  // ── Step: Name ───────────────────────────────────────────────
  if (step === "name") return (
    <Screen>
      <Logo />
      <h1 className="text-[30px] font-extrabold tracking-tight text-pc-ink mb-2">Välkommen!</h1>
      <p className="text-[15px] text-pc-muted mb-8 leading-relaxed max-w-[300px] text-center">
        Börja med ditt namn — resten kan du ställa in nu eller senare.
      </p>

      <div className="w-full space-y-4">
        <div>
          <Label>Ditt namn <span className="text-pc-orange">*</span></Label>
          <input
            autoFocus
            type="text"
            placeholder="t.ex. Anna Karlsson"
            value={name}
            onChange={e => { setName(e.target.value); setNameErr(""); }}
            onKeyDown={e => { if (e.key === "Enter" && name.trim()) setStep("type"); }}
            className="ob-input"
          />
          {nameErr && <p className="text-red-500 text-[13px] mt-1 font-semibold">{nameErr}</p>}
        </div>

        <button
          onClick={() => {
            if (!name.trim()) { setNameErr("Ange ditt namn för att fortsätta."); return; }
            setStep("type");
          }}
          className="ob-btn-primary w-full"
        >
          Fortsätt →
        </button>
      </div>
    </Screen>
  );

  // ── Step: Schedule type ──────────────────────────────────────
  if (step === "type") return (
    <Screen>
      <StepDots current={1} total={3} />
      <h2 className="text-[24px] font-extrabold tracking-tight text-pc-ink mb-1 text-center">Hur ser din arbetstid ut?</h2>
      <p className="text-[14px] text-pc-muted mb-7 text-center leading-relaxed">
        Välj ett alternativ — du kan ändra detta när som helst.
      </p>

      <div className="w-full space-y-3">
        <TypeCard
          emoji="📅"
          title="Samma tid varje dag"
          desc="Du jobbar lika många timmar varje arbetsdag, t.ex. 8h med 45 min lunch."
          onClick={() => setStep("uniform")}
        />
        <TypeCard
          emoji="🗓️"
          title="Varierar per dag"
          desc="Du har olika arbetstider eller lunch beroende på dag — t.ex. kortare fredag."
          onClick={() => {
            setSchedule(DEFAULT_SCHEDULE);
            setStep("perday");
          }}
        />

        <button onClick={() => setStep("dept")} className="ob-btn-ghost w-full mt-2">
          Hoppa över — ställ in senare
        </button>

        <button onClick={() => setStep("name")} className="ob-btn-ghost w-full text-[13px]">← Tillbaka</button>
      </div>
    </Screen>
  );

  // ── Step: Uniform schedule ───────────────────────────────────
  if (step === "uniform") return (
    <Screen scroll>
      <StepDots current={2} total={3} />
      <h2 className="text-[22px] font-extrabold tracking-tight text-pc-ink mb-1 text-center">Välj ditt schema</h2>
      <p className="text-[13px] text-pc-muted mb-6 text-center">Samma arbetstid för alla valda dagar.</p>

      <div className="w-full space-y-5">
        {/* Day toggles */}
        <div>
          <Label>Vilka dagar jobbar du?</Label>
          <div className="flex gap-1.5 flex-wrap">
            {DAY_KEYS.map(k => (
              <button
                key={k}
                onClick={() => toggleDay(k)}
                className="pc-press py-2 px-3 rounded-[12px] text-[12px] font-bold border transition-colors"
                style={{
                  background: activeDays.has(k) ? "#ff5f00" : "#fdf6ee",
                  color: activeDays.has(k) ? "#fff" : "#9a8a82",
                  border: activeDays.has(k) ? "1.5px solid #ff5f00" : "1.5px solid #ece6df",
                }}
              >
                {DAY_LABEL_SHORT[k]}
              </button>
            ))}
          </div>
        </div>

        {/* Work time */}
        <div>
          <Label>Arbetstid per dag</Label>
          <div className="grid grid-cols-3 gap-2">
            {COMMON_WORK.map(p => (
              <button
                key={p.value}
                onClick={() => setUniformWork(p.value)}
                className="pc-press py-2.5 rounded-[12px] text-[13px] font-bold border transition-colors"
                style={{
                  background: uniformWork === p.value ? "#ff5f00" : "#fdf6ee",
                  color: uniformWork === p.value ? "#fff" : "#9a8a82",
                  border: uniformWork === p.value ? "1.5px solid #ff5f00" : "1.5px solid #ece6df",
                  boxShadow: uniformWork === p.value ? "0 4px 12px -4px rgba(255,95,0,0.45)" : "none",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Custom not in the common list */}
          {!COMMON_WORK.some(p => p.value === uniformWork) && (
            <p className="text-[12px] text-pc-orange font-semibold mt-2">
              Anpassad: {fmtMin(uniformWork)}
            </p>
          )}
          <div className="mt-2">
            <select
              value={uniformWork}
              onChange={e => setUniformWork(+e.target.value)}
              style={{ ...SEL, marginTop: 4 }}
            >
              {WORK_PRESETS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-pc-muted mt-1">Eller välj exakt tid här ↑</p>
          </div>
        </div>

        {/* Lunch */}
        <div>
          <Label>Lunchrast</Label>
          <div className="grid grid-cols-4 gap-2">
            {LUNCH_PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => setUniformLunch(p.value)}
                className="pc-press py-2.5 rounded-[12px] text-[12px] font-bold border transition-colors"
                style={{
                  background: uniformLunch === p.value ? "#ff5f00" : "#fdf6ee",
                  color: uniformLunch === p.value ? "#fff" : "#9a8a82",
                  border: uniformLunch === p.value ? "1.5px solid #ff5f00" : "1.5px solid #ece6df",
                  boxShadow: uniformLunch === p.value ? "0 4px 12px -4px rgba(255,95,0,0.45)" : "none",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Preview — lunch does NOT reduce work target */}
        <div className="bg-pc-peach rounded-2xl px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-pc-orange-deep">Per dag</div>
            <div className="text-[20px] font-extrabold text-pc-orange-deep tabular-nums">{fmtMin(uniformWork)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-bold uppercase tracking-wide text-pc-orange-deep">Per vecka</div>
            <div className="text-[20px] font-extrabold text-pc-orange-deep tabular-nums">{fmtMin(uniformWeekNet)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => setStep("type")} className="ob-btn-ghost">← Tillbaka</button>
          <button
            onClick={() => {
              setSchedule(buildUniformSchedule(activeDays, uniformWork, uniformLunch));
              setStep("dept");
            }}
            className="ob-btn-primary"
            disabled={activeDays.size === 0}
          >
            Spara →
          </button>
        </div>
      </div>
    </Screen>
  );

  // ── Step: Per-day schedule ───────────────────────────────────
  if (step === "perday") return (
    <Screen scroll>
      <StepDots current={2} total={3} />
      <h2 className="text-[22px] font-extrabold tracking-tight text-pc-ink mb-1 text-center">Schema per dag</h2>
      <p className="text-[13px] text-pc-muted mb-6 text-center">Aktivera de dagar du jobbar och sätt tid och lunchrast per dag.</p>

      <div className="w-full space-y-4">
        <PerDayEditor schedule={schedule} onChange={setSchedule} />

        <div className="grid grid-cols-2 gap-3 pt-2">
          <button onClick={() => setStep("type")} className="ob-btn-ghost">← Tillbaka</button>
          <button onClick={() => setStep("dept")} className="ob-btn-primary">Spara →</button>
        </div>
      </div>
    </Screen>
  );

  // ── Step: Department ─────────────────────────────────────────
  if (step === "dept") return (
    <Screen>
      <StepDots current={3} total={3} />
      <h2 className="text-[24px] font-extrabold tracking-tight text-pc-ink mb-1 text-center">Sista steget!</h2>
      <p className="text-[14px] text-pc-muted mb-7 text-center leading-relaxed">
        Avdelning är valfritt — visas i rapporthuvudet.
      </p>

      <div className="w-full space-y-4">
        <div>
          <Label>Avdelning <span className="text-pc-muted font-medium normal-case tracking-normal">(valfri)</span></Label>
          <input
            type="text"
            placeholder="t.ex. Lager, Kontor, Teknik…"
            value={department}
            onChange={e => setDepartment(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") finish(schedule); }}
            className="ob-input"
          />
        </div>

        <button onClick={() => finish(schedule)} className="ob-btn-primary w-full">
          Kom igång! →
        </button>
        <button onClick={() => finish(schedule)} className="ob-btn-ghost w-full">
          Hoppa över
        </button>
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
        className="mx-auto w-full max-w-[480px] flex flex-col flex-1 items-center px-6 pb-10 ob-fade"
        style={{ overflowY: scroll ? "auto" : "hidden", overflowX: "hidden" }}
      >
        <div className="h-[env(safe-area-inset-top,0px)]" />
        <div className="flex flex-col items-center w-full mt-10 flex-1">
          {children}
        </div>
        <div className="h-[env(safe-area-inset-bottom,0px)]" />
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex flex-col items-center mb-6">
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
    <div className="flex gap-1.5 mb-6">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="h-1.5 rounded-full transition-all"
          style={{
            width: i + 1 === current ? 20 : 6,
            background: i + 1 <= current ? "#ff5f00" : "#ece6df",
          }}
        />
      ))}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-pc-muted mb-2">{children}</div>
  );
}

function TypeCard({
  emoji, title, desc, onClick,
}: {
  emoji: string; title: string; desc: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="pc-press w-full text-left bg-white border border-pc-line rounded-[20px] px-5 py-4 flex items-start gap-4 shadow-[0_2px_12px_rgba(81,43,43,0.04)]"
    >
      <span className="text-[28px] leading-none mt-0.5 shrink-0">{emoji}</span>
      <div>
        <div className="font-extrabold text-[15px] text-pc-ink leading-tight mb-1">{title}</div>
        <div className="text-[13px] text-pc-muted leading-snug">{desc}</div>
      </div>
      <svg viewBox="0 0 24 24" className="w-5 h-5 text-pc-muted shrink-0 mt-1 ml-auto" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

export { PerDayEditor };
