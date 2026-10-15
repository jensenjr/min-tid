import { useState } from "react";
import { type WeekSchedule, MAX_ROTATION_WEEKS } from "../../lib/schedule";
import { WeekScheduleEditor } from "../Onboarding";

// Controlled editor for a rotating schedule: pick 1–8 weeks, edit one week at a time via
// tabs ("Vecka 1…N"), copy week 1 to all. `weeks` may hold more entries than `count`
// (weeks beyond `count` are kept so shortening and lengthening again loses nothing).
export default function RotationEditor({
  weeks,
  count,
  currentWeek,
  onCountChange,
  onWeekChange,
  onCopyFirstToAll,
}: {
  weeks: WeekSchedule[];
  count: number;
  currentWeek: number | null; // 1-based rotation week of "this week", marks the tab
  onCountChange: (n: number) => void;
  onWeekChange: (index: number, week: WeekSchedule) => void;
  onCopyFirstToAll: () => void;
}) {
  const [tab, setTab] = useState(0);
  const active = Math.min(tab, count - 1);

  return (
    <div className="w-full">
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">
        Antal veckor i schemat
      </div>
      <div className="flex flex-wrap gap-1.5 mb-1" role="group" aria-label="Antal veckor">
        {Array.from({ length: MAX_ROTATION_WEEKS }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            onClick={() => onCountChange(n)}
            aria-pressed={n === count}
            className="w-9 h-9 rounded-xl text-[14px] font-extrabold transition-colors"
            style={{
              background: n === count ? "#ff5f00" : "#fdf6ee",
              color: n === count ? "#fff" : "#2d1717",
              border: n === count ? "1.5px solid #ff5f00" : "1.5px solid #ece6df",
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="text-[12px] text-pc-muted mb-4">
        {count === 1
          ? "Samma schema varje vecka."
          : `Schemat upprepas var ${count}:e vecka (vecka 1–${count}).`}
      </div>

      {count > 1 && (
        <>
          <div
            className="flex gap-1.5 overflow-x-auto hide-scroll pb-1 mb-2"
            role="tablist"
            aria-label="Vecka i schemat"
          >
            {Array.from({ length: count }, (_, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === active}
                onClick={() => setTab(i)}
                className="shrink-0 px-3 py-2 rounded-xl text-[13px] font-extrabold whitespace-nowrap transition-colors"
                style={{
                  background: i === active ? "#2d1717" : "#fdf6ee",
                  color: i === active ? "#fff" : "#2d1717",
                  border: i === active ? "1.5px solid #2d1717" : "1.5px solid #ece6df",
                }}
              >
                Vecka {i + 1}
                {currentWeek === i + 1 && (
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full ml-1.5 align-middle"
                    style={{ background: "#ff5f00" }}
                    aria-label="den här veckan"
                  />
                )}
              </button>
            ))}
          </div>
          <button
            onClick={onCopyFirstToAll}
            className="mb-3 px-3 py-2 rounded-[12px] border border-pc-orange text-pc-orange font-bold text-[12px] bg-white active:scale-[0.97] transition-transform"
          >
            Kopiera vecka 1 till alla
          </button>
        </>
      )}

      <WeekScheduleEditor
        key={active}
        schedule={weeks[active]}
        onChange={(w) => onWeekChange(active, w)}
      />
    </div>
  );
}
