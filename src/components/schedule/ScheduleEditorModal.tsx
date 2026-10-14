import { useEffect, useRef, useState } from "react";
import {
  type SchedulePeriod,
  type WeekSchedule,
  MAX_ROTATION_WEEKS,
  addDaysStr,
  appendPeriod,
  fmtMin,
  mod,
  mondayOfStr,
  periodFor,
  rotationWeekIndex,
  weeklyNetMin,
  weeksBetween,
} from "../../lib/schedule";
import { ymdLocal } from "../../lib/dates";
import type { ReportingMode } from "../../lib/types";
import RotationEditor from "./RotationEditor";

const MODE_OPTIONS: { key: ReportingMode; title: string; text: string }[] = [
  {
    key: "schedule",
    title: "Enligt schema",
    text: "Schemat är din tid. Du anger bara det som avviker.",
  },
  {
    key: "punch",
    title: "Stämpla",
    text: "Du stämplar in och ut. Schemat är normen att jämföra mot.",
  },
];

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">
      {children}
    </div>
  );
}

// "Planera dagar" bottom sheet. Saving appends a new schedule period (valid from the
// chosen date) instead of overwriting, so earlier days keep the norm they had.
export default function ScheduleEditorModal({
  open,
  schedules,
  reportingMode,
  onClose,
  onSave,
}: {
  open: boolean;
  schedules: SchedulePeriod[];
  reportingMode?: ReportingMode;
  onClose: () => void;
  onSave: (schedules: SchedulePeriod[], reportingMode?: ReportingMode) => void;
}) {
  const [validFrom, setValidFrom] = useState(() => ymdLocal(new Date()));
  const [weeks, setWeeks] = useState<WeekSchedule[]>(
    () => periodFor(schedules, ymdLocal(new Date())).rotation.weeks,
  );
  const [count, setCount] = useState(weeks.length);
  const [startWeekChoice, setStartWeekChoice] = useState<number | null>(null);
  const [modeChoice, setModeChoice] = useState<ReportingMode | null>(null);

  // Reset the draft whenever the sheet opens (the instance stays mounted while closed).
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) {
      const today = ymdLocal(new Date());
      const base = periodFor(schedules, today).rotation.weeks;
      setValidFrom(today);
      setWeeks([...base]);
      setCount(base.length);
      setStartWeekChoice(null);
      setModeChoice(null);
    }
    prevOpen.current = open;
  }, [open, schedules]);

  if (!open) return null;

  const today = ymdLocal(new Date());
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(validFrom);
  const visible = weeks.slice(0, count);

  // Which rotation week the week containing `validFrom` is. Default keeps the existing
  // rhythm when the length is unchanged, otherwise starts the new rotation at week 1.
  const basePeriod = dateValid ? periodFor(schedules, validFrom) : periodFor(schedules, today);
  const defaultStartWeek =
    dateValid && count === basePeriod.rotation.weeks.length
      ? rotationWeekIndex(basePeriod, validFrom) + 1
      : 1;
  const startWeek = Math.min(startWeekChoice ?? defaultStartWeek, count);
  const anchorMonday = dateValid
    ? addDaysStr(mondayOfStr(validFrom), -(startWeek - 1) * 7)
    : mondayOfStr(today);

  const thisWeek =
    dateValid && validFrom <= today
      ? mod(weeksBetween(anchorMonday, mondayOfStr(today)), count) + 1
      : null;

  const normMin = visible.reduce((sum, w) => sum + weeklyNetMin(w), 0) / visible.length;
  const replaces = dateValid && schedules.some((p) => p.validFrom === validFrom);
  const shownMode: ReportingMode = modeChoice ?? reportingMode ?? "punch";

  function changeCount(n: number) {
    setWeeks((prev) => {
      const next = [...prev];
      while (next.length < n) next.push(next[0]);
      return next;
    });
    setCount(n);
    setStartWeekChoice(null);
  }

  function handleSave() {
    if (!dateValid) return;
    const period: SchedulePeriod = {
      validFrom,
      anchorMonday,
      rotation: { weeks: visible },
    };
    onSave(appendPeriod(schedules, period), modeChoice ?? undefined);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center pc-overlay"
      style={{ background: "rgba(45,23,23,0.55)" }}
      onClick={onClose}
    >
      <div
        className="pc-sheet bg-white w-full max-w-[480px] rounded-t-[28px] px-5 pt-6 overflow-y-auto"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
          maxHeight: "92dvh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-pc-line rounded-full mx-auto mb-5" />
        <div className="font-extrabold text-[22px] tracking-tight mb-1">Planera dagar</div>
        <div className="text-[13px] text-pc-muted mb-5">
          Ange arbetstider och lunch per dag. Norm/vecka{count > 1 ? " (snitt)" : ""}:{" "}
          <span className="font-bold text-pc-orange-deep">{fmtMin(Math.round(normMin))}</span>
        </div>

        <Label>Gäller från</Label>
        <input
          type="date"
          value={validFrom}
          onChange={(e) => {
            setValidFrom(e.target.value);
            setStartWeekChoice(null);
          }}
          className="pc-input"
          style={{ marginBottom: 6 }}
        />
        <div className="text-[12px] text-pc-muted mb-5">
          {replaces
            ? "Ersätter schemat som redan börjar gälla det här datumet. Äldre perioder behålls."
            : "Tidigare dagar behåller sitt nuvarande schema."}
        </div>

        <RotationEditor
          weeks={weeks}
          count={count}
          currentWeek={thisWeek}
          onCountChange={changeCount}
          onWeekChange={(i, w) => setWeeks((prev) => prev.map((x, j) => (j === i ? w : x)))}
          onCopyFirstToAll={() => setWeeks((prev) => prev.map(() => prev[0]))}
        />

        {count > 1 && (
          <div className="mt-4 bg-pc-apricot rounded-[18px] px-4 py-3 border border-pc-line">
            {thisWeek !== null && (
              <div className="text-[14px] font-extrabold text-pc-ink mb-2">
                Den här veckan är vecka {thisWeek} av {count}
              </div>
            )}
            <label className="flex items-center justify-between gap-3 text-[12px] font-bold text-pc-muted">
              <span>Veckan som innehåller startdatumet är</span>
              <select
                value={startWeek}
                onChange={(e) => setStartWeekChoice(Number(e.target.value))}
                className="shrink-0 rounded-[10px] border border-pc-line bg-white px-2 py-1.5 text-[14px] font-bold text-pc-ink"
              >
                {Array.from({ length: Math.min(count, MAX_ROTATION_WEEKS) }, (_, i) => (
                  <option key={i} value={i + 1}>
                    Vecka {i + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="mt-6">
          <Label>Hur ska dagarna registreras?</Label>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Registrering">
            {MODE_OPTIONS.map((o) => {
              const on = shownMode === o.key;
              return (
                <button
                  key={o.key}
                  role="radio"
                  aria-checked={on}
                  onClick={() => setModeChoice(o.key)}
                  className="text-left rounded-[16px] px-3 py-3 transition-colors"
                  style={{
                    background: on ? "#fff3ec" : "#fdf6ee",
                    border: on ? "1.5px solid #ff5f00" : "1.5px solid #ece6df",
                  }}
                >
                  <div
                    className="text-[14px] font-extrabold mb-1"
                    style={{ color: on ? "#ff5f00" : "#2d1717" }}
                  >
                    {o.title}
                  </div>
                  <div className="text-[11px] leading-snug text-pc-muted">{o.text}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-6">
          <button
            onClick={onClose}
            style={{
              padding: "15px",
              borderRadius: "16px",
              background: "#fdf6ee",
              border: "1.5px solid #ece6df",
              fontWeight: 700,
              fontSize: "15px",
              color: "#2d1717",
            }}
          >
            Avbryt
          </button>
          <button
            onClick={handleSave}
            disabled={!dateValid}
            style={{
              padding: "15px",
              borderRadius: "16px",
              background: "#ff5f00",
              color: "white",
              fontWeight: 700,
              fontSize: "15px",
              boxShadow: "0 8px 20px -8px rgba(255,95,0,0.6)",
              opacity: dateValid ? 1 : 0.5,
            }}
          >
            Spara
          </button>
        </div>
      </div>
    </div>
  );
}
