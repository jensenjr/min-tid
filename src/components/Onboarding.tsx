import { useState } from "react";
import { ArrowRight, ArrowLeft, Clock, User, Building2 } from "lucide-react";

export interface OnboardingData {
  name: string;
  dailyHours: number;
  department?: string;
}

interface OnboardingProps {
  onComplete: (data: OnboardingData) => void;
  onSkip?: () => void;
}

export default function Onboarding({ onComplete, onSkip }: OnboardingProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [dailyHours, setDailyHours] = useState(8);
  const [department, setDepartment] = useState("");

  const canProceed = step === 1 ? name.trim().length > 0 : dailyHours > 0;

  const handleNext = () => {
    if (step === 1) setStep(2);
    else onComplete({ name: name.trim(), dailyHours, department: department.trim() || undefined });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        background: "linear-gradient(180deg, #fff1cd 0%, #faf6f1 55%, #fdf6ee 100%)",
        fontFamily: "var(--font-display)",
        color: "var(--color-pc-ink)",
      }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-5 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
      >
        <button
          onClick={() => (step === 2 ? setStep(1) : onSkip?.())}
          className="flex h-10 w-10 items-center justify-center rounded-full transition-active hover:bg-black/5"
          style={{ color: "var(--color-pc-bark)" }}
          aria-label={step === 2 ? "Tillbaka" : "Hoppa över"}
        >
          {step === 2 ? <ArrowLeft size={20} /> : <span className="text-sm font-medium">Hoppa över</span>}
        </button>
        <div className="flex gap-1.5">
          {[1, 2].map((s) => (
            <span
              key={s}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{
                width: step === s ? 24 : 8,
                background: step >= s ? "var(--color-pc-orange)" : "rgba(81,43,43,0.18)",
              }}
            />
          ))}
        </div>
        <div className="w-10" />
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col px-6 pt-6" style={{ animation: "pcFade 280ms ease-out" }}>
        {step === 1 ? (
          <>
            <div
              className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{
                background: "linear-gradient(135deg, var(--color-pc-orange), var(--color-pc-tangerine))",
                boxShadow: "0 12px 28px -8px rgba(255,95,0,0.45)",
              }}
            >
              <Clock size={30} color="#fff" strokeWidth={2.4} />
            </div>
            <h1 className="text-[32px] font-bold leading-tight tracking-tight">
              Välkommen!
            </h1>
            <p className="mt-2 text-[15px]" style={{ color: "var(--color-pc-muted)" }}>
              Låt oss börja med ditt namn så kan du stämpla in direkt.
            </p>

            <label className="mt-8 mb-2 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-pc-bark)" }}>
              <User size={14} /> Ditt namn
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="t.ex. Anna Andersson"
              autoFocus
              className="w-full rounded-2xl border-0 bg-white px-5 py-4 text-[17px] outline-none transition-all"
              style={{
                color: "var(--color-pc-ink)",
                boxShadow: "0 1px 0 rgba(81,43,43,0.06), 0 8px 20px -12px rgba(81,43,43,0.18)",
              }}
            />
          </>
        ) : (
          <>
            <div
              className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{
                background: "linear-gradient(135deg, var(--color-pc-orange), var(--color-pc-tangerine))",
                boxShadow: "0 12px 28px -8px rgba(255,95,0,0.45)",
              }}
            >
              <Clock size={30} color="#fff" strokeWidth={2.4} />
            </div>
            <h1 className="text-[32px] font-bold leading-tight tracking-tight">
              Din arbetsdag
            </h1>
            <p className="mt-2 text-[15px]" style={{ color: "var(--color-pc-muted)" }}>
              Hur många timmar är en normal arbetsdag för dig?
            </p>

            {/* Hours stepper */}
            <div className="mt-8 rounded-3xl bg-white p-5" style={{ boxShadow: "0 8px 20px -12px rgba(81,43,43,0.18)" }}>
              <div className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-pc-bark)" }}>
                Norm per dag
              </div>
              <div className="mt-3 flex items-center justify-between">
                <button
                  onClick={() => setDailyHours((h) => Math.max(1, h - 0.5))}
                  className="flex h-12 w-12 items-center justify-center rounded-full text-2xl font-light transition-active active:scale-95"
                  style={{ background: "var(--color-pc-apricot)", color: "var(--color-pc-bark)" }}
                  aria-label="Minska"
                >
                  −
                </button>
                <div className="flex items-baseline gap-1">
                  <span className="text-[44px] font-bold leading-none tabular-nums" style={{ color: "var(--color-pc-orange)" }}>
                    {dailyHours}
                  </span>
                  <span className="text-[18px] font-medium" style={{ color: "var(--color-pc-muted)" }}>
                    h
                  </span>
                </div>
                <button
                  onClick={() => setDailyHours((h) => Math.min(24, h + 0.5))}
                  className="flex h-12 w-12 items-center justify-center rounded-full text-2xl font-light transition-active active:scale-95"
                  style={{ background: "var(--color-pc-apricot)", color: "var(--color-pc-bark)" }}
                  aria-label="Öka"
                >
                  +
                </button>
              </div>
            </div>

            <label className="mt-6 mb-2 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-pc-bark)" }}>
              <Building2 size={14} /> Avdelning <span className="font-normal normal-case tracking-normal" style={{ color: "var(--color-pc-muted)" }}>— valfritt</span>
            </label>
            <input
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="t.ex. Ekonomi"
              className="w-full rounded-2xl border-0 bg-white px-5 py-4 text-[17px] outline-none"
              style={{
                color: "var(--color-pc-ink)",
                boxShadow: "0 1px 0 rgba(81,43,43,0.06), 0 8px 20px -12px rgba(81,43,43,0.18)",
              }}
            />
          </>
        )}
      </div>

      {/* CTA */}
      <div
        className="px-6 pt-4"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
      >
        <button
          onClick={handleNext}
          disabled={!canProceed}
          className="flex h-[60px] w-full items-center justify-center gap-2 rounded-full text-[17px] font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-40"
          style={{
            background: "linear-gradient(135deg, var(--color-pc-orange), var(--color-pc-orange-deep))",
            boxShadow: canProceed ? "0 14px 32px -10px rgba(255,95,0,0.55)" : "none",
          }}
        >
          {step === 1 ? "Fortsätt" : "Kom igång"}
          <ArrowRight size={20} />
        </button>
      </div>
    </div>
  );
}
