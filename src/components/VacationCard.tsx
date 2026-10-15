import { useState } from "react";
import type { VacationSettings } from "../lib/types";
import {
  type VacationState,
  balanceWarning,
  fmtDays,
  resolveVacation,
  vacationBalance,
  vacationLine,
} from "../lib/vacation";

// "Semester: 17 av 25 dagar kvar" with an optional settings panel. All maths is in
// src/lib/vacation.ts; this component only shows it and edits VacationSettings.
export default function VacationCard({
  state,
  today,
  onChange,
  compact = false,
  bare = false,
}: {
  state: VacationState;
  today: string;
  onChange: (v: VacationSettings) => void;
  compact?: boolean; // one line only, no settings (for the Report slot)
  bare?: boolean; // no card chrome (inside a sheet)
}) {
  const [open, setOpen] = useState(false);
  const v = resolveVacation(state.vacation);
  const b = vacationBalance(state, today);
  const warning = balanceWarning(b);
  const line = vacationLine(b);

  if (compact) {
    return (
      <div className="text-[13px] font-semibold text-pc-muted">
        <div>{line}</div>
        {warning && <div className="text-red-500">{warning}</div>}
      </div>
    );
  }

  function num(s: string): number | null {
    const n = Number(s.replace(",", "."));
    return s.trim() !== "" && Number.isFinite(n) ? n : null;
  }

  function setOpening(patch: Partial<NonNullable<VacationSettings["opening"]>>) {
    const cur = v.opening ?? { asOf: today, daysLeft: b.left, savedDays: 0 };
    onChange({ ...v, opening: { ...cur, ...patch } });
  }

  const inputCls =
    "w-full rounded-xl border border-pc-line bg-pc-bg px-3 py-2 text-[14px] font-semibold text-pc-ink";

  return (
    <section
      className={
        bare
          ? ""
          : "bg-white rounded-[24px] p-5 mb-3 shadow-[0_2px_12px_rgba(81,43,43,0.04)] border border-pc-line"
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold tracking-tight">{line}</div>
          <div className="text-[12px] text-pc-muted mt-0.5">
            Semesterår {b.yearStart} – {b.yearEnd}
            {b.planned > 0 && ` · varav ${fmtDays(b.planned)} planerade`}
          </div>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="pc-press shrink-0 text-[13px] font-bold text-pc-orange"
          aria-expanded={open}
        >
          {open ? "Stäng" : "Ändra"}
        </button>
      </div>

      {warning && <div className="mt-3 text-[13px] font-semibold text-red-500">{warning}</div>}

      {open && (
        <div className="mt-4 pt-4 border-t border-pc-line space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] font-semibold text-pc-muted">
              Semesterdagar per år
              <input
                className={inputCls}
                inputMode="decimal"
                defaultValue={fmtDays(v.daysPerYear)}
                onBlur={(e) => {
                  const n = num(e.target.value);
                  if (n !== null && n >= 0) onChange({ ...v, daysPerYear: n });
                }}
              />
            </label>
            <label className="block text-[12px] font-semibold text-pc-muted">
              Semesterår börjar (MM-DD)
              <input
                className={inputCls}
                defaultValue={v.yearStart}
                onBlur={(e) => {
                  // resolveVacation falls back to the default for an invalid value.
                  const next = resolveVacation({ ...v, yearStart: e.target.value.trim() });
                  onChange(next);
                  e.target.value = next.yearStart;
                }}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-[13px] font-semibold">
            <input
              type="checkbox"
              checked={v.allowHalfDays}
              onChange={(e) => onChange({ ...v, allowHalfDays: e.target.checked })}
            />
            Tillåt halva semesterdagar
          </label>
          <div className="text-[12px] text-pc-muted -mt-1">
            {v.allowHalfDays
              ? "Semester med färre timmar än en hel dag räknas som en halv dag (avrundat till närmaste halvdag)."
              : "Semester med färre timmar än en hel dag räknas ändå som en hel semesterdag."}{" "}
            Helger, helgdagar och lediga rotationsdagar drar inga dagar.
          </div>

          <div className="text-[12px] font-bold text-pc-ink pt-1">Ingående saldo (valfritt)</div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-[12px] font-semibold text-pc-muted">
              Per datum
              <input
                type="date"
                className={inputCls}
                value={v.opening?.asOf ?? ""}
                onChange={(e) => e.target.value && setOpening({ asOf: e.target.value })}
              />
            </label>
            <label className="block text-[12px] font-semibold text-pc-muted">
              Dagar kvar
              <input
                className={inputCls}
                inputMode="decimal"
                defaultValue={v.opening ? fmtDays(v.opening.daysLeft) : ""}
                key={`l${v.opening?.daysLeft ?? "-"}`}
                onBlur={(e) => {
                  const n = num(e.target.value);
                  if (n !== null) setOpening({ daysLeft: n });
                }}
              />
            </label>
            <label className="block text-[12px] font-semibold text-pc-muted">
              Sparade
              <input
                className={inputCls}
                inputMode="decimal"
                defaultValue={v.opening ? fmtDays(v.opening.savedDays) : ""}
                key={`s${v.opening?.savedDays ?? "-"}`}
                onBlur={(e) => {
                  const n = num(e.target.value);
                  if (n !== null && n >= 0) setOpening({ savedDays: n });
                }}
              />
            </label>
          </div>
          {v.opening && (
            <button
              onClick={() => onChange({ ...v, opening: undefined })}
              className="pc-press text-[12px] font-bold text-pc-muted"
            >
              Ta bort ingående saldo
            </button>
          )}
        </div>
      )}
    </section>
  );
}
