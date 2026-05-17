import { useState } from "react";

type OnboardingData = { name: string; normHours: number; department?: string };

const NORM_PRESETS = [
  { label: "6h", value: 6 },
  { label: "7h 30min", value: 7.5 },
  { label: "7h 45min", value: 7.75 },
  { label: "8h", value: 8 },
];

export default function Onboarding({
  onComplete,
  onSkip,
}: {
  onComplete: (data: OnboardingData) => void;
  onSkip: () => void;
}) {
  const [name, setName] = useState("");
  const [normHours, setNormHours] = useState<number>(8);
  const [customNorm, setCustomNorm] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [department, setDepartment] = useState("");
  const [nameErr, setNameErr] = useState("");

  function handleComplete() {
    const trimmed = name.trim();
    if (!trimmed) { setNameErr("Ange ditt namn för att fortsätta."); return; }
    const hours = useCustom ? parseFloat(customNorm) || 8 : normHours;
    onComplete({ name: trimmed, normHours: hours, department: department.trim() || undefined });
  }

  return (
    <div className="fixed inset-0 z-50 bg-pc-bg flex flex-col">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        .ob-fade { animation: obFade 0.5s cubic-bezier(0.16,1,0.3,1); }
        @keyframes obFade { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        .pc-press:active { transform: scale(0.96); }
        .pc-press { transition: transform 0.15s; }
        .pc-input-ob {
          width: 100%; padding: 14px 16px; border-radius: 16px;
          border: 1.5px solid #ece6df; font-size: 16px; outline: none;
          background: #fdf6ee; font-weight: 600; color: #2d1717;
        }
        .pc-input-ob:focus { border-color: #ff5f00; background: #fff; }
      `}</style>

      <div className="mx-auto w-full max-w-[480px] flex flex-col flex-1 px-6 pb-10 overflow-y-auto">
        <div className="h-[env(safe-area-inset-top,0px)]" />

        {/* Logo */}
        <div className="mt-12 mb-8 ob-fade flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-3xl bg-pc-orange flex items-center justify-center shadow-[0_8px_28px_rgba(255,95,0,0.38)] mb-5">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
            </svg>
          </div>
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-pc-muted mb-2">Tidrapport</div>
          <h1 className="text-[30px] font-extrabold tracking-tight leading-tight text-pc-ink">
            Välkommen!
          </h1>
          <p className="text-[15px] text-pc-muted mt-2 leading-relaxed max-w-[300px]">
            Ställ in grunduppgifterna så är du redo att börja stämpla.
          </p>
        </div>

        {/* Form */}
        <div className="ob-fade space-y-6">

          {/* Name */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-pc-muted mb-2">
              Ditt namn <span className="text-pc-orange">*</span>
            </div>
            <input
              autoFocus
              type="text"
              placeholder="t.ex. Anna Karlsson"
              value={name}
              onChange={e => { setName(e.target.value); setNameErr(""); }}
              onKeyDown={e => { if (e.key === "Enter") handleComplete(); }}
              className="pc-input-ob"
            />
            {nameErr && <div className="text-red-500 text-[13px] mt-1 font-semibold">{nameErr}</div>}
          </div>

          {/* Norm hours */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-pc-muted mb-1">
              Normtid per dag
            </div>
            <div className="text-[12px] text-pc-muted mb-3">Används för att räkna om till veckornorm (normtid × 5).</div>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {NORM_PRESETS.map(p => (
                <button
                  key={p.value}
                  onClick={() => { setNormHours(p.value); setUseCustom(false); }}
                  className={`pc-press py-3 rounded-[14px] text-[13px] font-bold border transition-colors ${
                    !useCustom && normHours === p.value
                      ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgba(255,95,0,0.5)]"
                      : "bg-white border-pc-line text-pc-muted"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setUseCustom(v => !v)}
              className={`pc-press text-[13px] font-semibold px-4 py-2.5 rounded-[12px] border transition-colors ${
                useCustom ? "bg-pc-orange/10 border-pc-orange text-pc-orange" : "bg-white border-pc-line text-pc-muted"
              }`}
            >
              Annat…
            </button>
            {useCustom && (
              <div className="mt-3">
                <input
                  type="number"
                  min="1"
                  max="24"
                  step="0.25"
                  placeholder="t.ex. 7.6"
                  value={customNorm}
                  onChange={e => setCustomNorm(e.target.value)}
                  className="pc-input-ob"
                  style={{ marginBottom: 0 }}
                />
                <div className="text-[12px] text-pc-muted mt-1">Timmar per dag (decimaltal)</div>
              </div>
            )}
          </div>

          {/* Department (optional) */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-pc-muted mb-2">
              Avdelning <span className="text-pc-muted font-medium normal-case tracking-normal">(valfri)</span>
            </div>
            <input
              type="text"
              placeholder="t.ex. Lager, Kontor, Teknik…"
              value={department}
              onChange={e => setDepartment(e.target.value)}
              className="pc-input-ob"
              style={{ marginBottom: 0 }}
            />
          </div>

          {/* CTA */}
          <div className="pt-2">
            <button
              onClick={handleComplete}
              className="pc-press w-full py-4 rounded-[20px] bg-pc-orange text-white font-extrabold text-[17px] shadow-[0_8px_24px_-8px_rgba(255,95,0,0.6)]"
            >
              Kom igång →
            </button>
            <button
              onClick={onSkip}
              className="pc-press w-full mt-3 py-3 text-pc-muted font-semibold text-[14px]"
            >
              Hoppa över
            </button>
          </div>
        </div>

        <div className="h-[env(safe-area-inset-bottom,0px)]" />
      </div>
    </div>
  );
}
