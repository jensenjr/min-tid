import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  PICKER_HOURS,
  PICKER_MINUTES,
  formatHm,
  parseHm,
  withHour,
  withMinute,
} from "../lib/timeField";

// The app's own time picker: a field that opens a sheet with an hour grid and a 5-minute
// grid. Used instead of <input type="time"> so iOS/Android never show their minute wheels
// (1-minute steps) and every time is picked in 5-minute steps.
//
// The sheet is portalled to <body> so it stacks above the bottom sheet the field lives in
// (and isn't trapped by that sheet's transform/overflow).

export default function TimeField({
  value,
  onChange,
  label = "Välj tid",
  placeholder = "--:--",
  clearable = false,
  disabled = false,
  defaultHour = 8,
  className = "pc-input",
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Sheet title, also the field's accessible name. */
  label?: string;
  placeholder?: string;
  /** Show "Rensa" in the sheet (for optional times). */
  clearable?: boolean;
  disabled?: boolean;
  /** Hour suggested when the field is empty. */
  defaultHour?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const openSheet = () => {
    if (disabled) return;
    const cur = parseHm(value);
    // Show what's stored; an off-grid minute (e.g. a punch at 08:03) is kept until the
    // user picks a minute.
    setDraft(cur ? formatHm(cur.h, cur.m) : "");
    setOpen(true);
  };

  const cur = parseHm(draft);
  const selectedMinute = cur && cur.m % 5 === 0 ? cur.m : null;

  const cell = (selected: boolean): string =>
    `pc-press h-11 rounded-[12px] text-[15px] font-bold tabular-nums ${
      selected ? "bg-pc-orange text-white" : "bg-pc-bg text-pc-ink"
    }`;

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        disabled={disabled}
        aria-label={value ? `${label}: ${value}` : label}
        className={`${className} text-left tabular-nums`}
        style={{
          cursor: disabled ? "default" : "pointer",
          color: value ? undefined : "#a8968a",
          ...style,
        }}
      >
        {value || placeholder}
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 flex items-end justify-center pc-overlay"
            style={{ background: "rgba(45,23,23,0.55)", zIndex: 80 }}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          >
            <div
              role="dialog"
              aria-label={label}
              className="pc-sheet bg-white w-full max-w-[480px] rounded-t-[28px] px-5 pt-6"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 bg-pc-line rounded-full mx-auto mb-4" />
              <div className="flex items-baseline justify-between mb-4">
                <div className="font-extrabold text-[18px] tracking-tight text-pc-ink">{label}</div>
                <div className="font-extrabold text-[30px] tracking-tight text-pc-orange tabular-nums">
                  {draft || "--:--"}
                </div>
              </div>

              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">
                Timme
              </div>
              <div className="grid grid-cols-6 gap-1.5 mb-4">
                {PICKER_HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={cell(cur?.h === h)}
                    onClick={() => setDraft(withHour(draft, h))}
                  >
                    {String(h).padStart(2, "0")}
                  </button>
                ))}
              </div>

              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">
                Minut
              </div>
              <div className="grid grid-cols-6 gap-1.5 mb-5">
                {PICKER_MINUTES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={cell(selectedMinute === m)}
                    onClick={() => setDraft(withMinute(draft, m, defaultHour))}
                  >
                    {String(m).padStart(2, "0")}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                {clearable && (
                  <button
                    type="button"
                    className="pc-press flex-1 py-3.5 rounded-[16px] bg-pc-bg text-pc-muted font-bold text-[15px]"
                    onClick={() => {
                      onChange("");
                      setOpen(false);
                    }}
                  >
                    Rensa
                  </button>
                )}
                <button
                  type="button"
                  className="pc-press flex-1 py-3.5 rounded-[16px] bg-pc-orange text-white font-bold text-[15px] disabled:opacity-40"
                  disabled={!cur}
                  onClick={() => {
                    if (cur) onChange(formatHm(cur.h, cur.m));
                    setOpen(false);
                  }}
                >
                  Klar
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
