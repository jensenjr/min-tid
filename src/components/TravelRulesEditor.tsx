// "Restidsregler" (Mer → Restidsregler): how travel outside the scheduled hours counts.
// Controlled and standalone; the caller persists `travelRules`.
import { useState } from "react";
import type { TravelRules } from "../lib/travel";

const LABEL = "text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2";

const OUTSIDE_OPTIONS: { value: TravelRules["outside"]; label: string; hint: string }[] = [
  {
    value: "payroll",
    label: "Till lön",
    hint: "Restid utanför arbetstid rapporteras som timmar till lön.",
  },
  { value: "flex", label: "Till flex", hint: "Restid utanför arbetstid läggs på flexsaldot." },
  {
    value: "none",
    label: "Räknas inte",
    hint: "Restid utanför arbetstid ger varken lön eller flex.",
  },
];

export default function TravelRulesEditor({
  rules,
  onChange,
}: {
  rules: TravelRules;
  onChange: (next: TravelRules) => void;
}) {
  // Text state so "0." / "1," can be typed; the number is committed when it parses.
  const [factorText, setFactorText] = useState(String(rules.factor));
  const active = OUTSIDE_OPTIONS.find((o) => o.value === rules.outside);
  return (
    <div data-testid="travel-rules-editor">
      <div className="text-[13px] text-pc-muted mb-4">
        Restid inom ditt schemalagda arbetspass räknas alltid som arbetad tid. Här väljer du hur
        restid utanför arbetstid räknas.
      </div>

      <div className={LABEL}>Utanför arbetstid</div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        {OUTSIDE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange({ ...rules, outside: o.value })}
            aria-pressed={rules.outside === o.value}
            className={`py-2.5 rounded-[14px] text-[13px] font-bold border transition-colors ${
              rules.outside === o.value
                ? "bg-pc-orange text-white border-pc-orange"
                : "bg-pc-bg border-pc-line text-pc-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="text-[12px] text-pc-muted mb-4">{active?.hint}</div>

      <div className={LABEL}>
        Faktor{" "}
        <span className="normal-case font-medium tracking-normal">(1 = timme för timme)</span>
      </div>
      <input
        type="text"
        inputMode="decimal"
        value={factorText}
        onChange={(e) => {
          setFactorText(e.target.value);
          const v = parseFloat(e.target.value.replace(",", "."));
          if (Number.isFinite(v) && v >= 0) onChange({ ...rules, factor: Math.min(v, 10) });
        }}
        className="pc-input"
        aria-label="Faktor"
      />

      <div className={LABEL}>
        Max per dag{" "}
        <span className="normal-case font-medium tracking-normal">
          (minuter, efter faktor – tom = ingen gräns)
        </span>
      </div>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step={5}
        value={rules.maxPerDayMin ?? ""}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          const next = { ...rules };
          if (Number.isFinite(v) && v > 0) next.maxPerDayMin = v;
          else delete next.maxPerDayMin;
          onChange(next);
        }}
        className="pc-input"
        aria-label="Max per dag i minuter"
      />

      <label className="flex items-center gap-3 mt-1 text-[14px] font-semibold text-pc-ink">
        <input
          type="checkbox"
          checked={rules.excludeNight}
          onChange={(e) => onChange({ ...rules, excludeNight: e.target.checked })}
        />
        Räkna inte restid på natten (22:00–06:00)
      </label>
    </div>
  );
}
