import { useEffect, useState, type ReactNode } from "react";
import type { DayConfig } from "../lib/schedule";
import { type DayEvaluation, fmtDuration, fmtSignedDuration } from "../lib/days";
import { fmtDateLabel } from "../lib/format";
import type { DayAdjustment } from "../lib/types";
import { Label, Sheet } from "./ui";
import TimeField from "./TimeField";

const BREAK_PRESETS = [0, 30, 45, 60];

function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * "Justera dag": tell the app what the day actually was — start, end, rast and a note.
 * Saves a `DayAdjustment`; empty start/end fall back to the schedule (on a day off both
 * are required) and an empty rast follows the lunch rule.
 *
 * `travelSlot` is where the travel-time editor (PR 8) mounts. It renders below the break
 * field and nothing is rendered when it is not given.
 */
export default function AdjustDaySheet({
  open,
  date,
  cfg,
  current,
  hasSessions,
  preview,
  onSave,
  onRemove,
  onClose,
  travelSlot,
}: {
  open: boolean;
  date: string;
  /** The day's effective schedule (rotation, period and exception applied). */
  cfg: DayConfig;
  current?: DayAdjustment;
  /** The day has punched sessions; the adjustment replaces them. */
  hasSessions: boolean;
  /** evaluateDay for this day as if `adj` were saved — drives the live preview. */
  preview: (adj: DayAdjustment) => DayEvaluation;
  onSave: (adj: DayAdjustment) => void;
  onRemove: () => void;
  onClose: () => void;
  travelSlot?: ReactNode;
}) {
  const scheduled = cfg.active;
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [brk, setBrk] = useState(""); // "" = follow the lunch rule
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setStart(current?.start ?? (scheduled ? cfg.startTime : ""));
    setEnd(current?.end ?? (scheduled ? cfg.endTime : ""));
    setBrk(current?.breakMin !== undefined ? String(current.breakMin) : "");
    setNote(current?.note ?? "");
    setErr("");
  }, [open, date]); // eslint-disable-line react-hooks/exhaustive-deps

  function build(): { adj?: DayAdjustment; error?: string } {
    if (!scheduled && (!start || !end)) {
      return { error: "Ange både start och slut — det är en ledig dag enligt schemat." };
    }
    const s = start || cfg.startTime;
    const e = end || cfg.endTime;
    if (hmToMin(e) <= hmToMin(s)) return { error: "Sluttid måste vara efter starttid." };
    let breakMin: number | undefined;
    if (brk.trim() !== "") {
      const n = Number(brk);
      if (!Number.isFinite(n) || n < 0) return { error: "Ange rast i minuter (0 eller mer)." };
      if (n >= hmToMin(e) - hmToMin(s)) return { error: "Rasten måste vara kortare än dagen." };
      breakMin = Math.round(n);
    }
    return {
      adj: {
        date,
        start: start || undefined,
        end: end || undefined,
        ...(breakMin !== undefined ? { breakMin } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
    };
  }

  const built = open ? build() : {};
  const ev = built.adj ? preview(built.adj) : null;

  function handleSave() {
    const r = build();
    if (!r.adj) {
      setErr(r.error ?? "Något gick fel.");
      return;
    }
    onSave(r.adj);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Justera dag"
      subtitle={`${fmtDateLabel(date)} · ${scheduled ? `Schema ${cfg.startTime}–${cfg.endTime}` : "Ledig dag enligt schema"}`}
    >
      {hasSessions && (
        <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-[14px] px-3 py-2 mb-4 font-semibold">
          Dagen har stämplingar. Justeringen ersätter dem i beräkningen.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <Label>Start</Label>
          <TimeField
            label="Start"
            value={start}
            onChange={(v) => {
              setStart(v);
              setErr("");
            }}
          />
        </div>
        <div className="min-w-0">
          <Label>Slut</Label>
          <TimeField
            label="Slut"
            value={end}
            onChange={(v) => {
              setEnd(v);
              setErr("");
            }}
          />
        </div>
      </div>

      <Label>
        Rast <span className="normal-case font-medium tracking-normal">(minuter)</span>
      </Label>
      <div className="grid grid-cols-5 gap-2 mb-2">
        <button
          type="button"
          onClick={() => setBrk("")}
          className={`py-2.5 rounded-[12px] text-[12px] font-bold border transition-colors ${
            brk === ""
              ? "bg-pc-orange text-white border-pc-orange"
              : "bg-pc-bg border-pc-line text-pc-ink"
          }`}
        >
          Auto
        </button>
        {BREAK_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setBrk(String(m));
              setErr("");
            }}
            className={`py-2.5 rounded-[12px] text-[13px] font-bold border transition-colors ${
              brk === String(m)
                ? "bg-pc-orange text-white border-pc-orange"
                : "bg-pc-bg border-pc-line text-pc-ink"
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={brk}
        placeholder={`Auto – ${cfg.lunchMinutes} min lunch om dagen är längre än 5 h`}
        onChange={(e) => {
          setBrk(e.target.value);
          setErr("");
        }}
        className="pc-input"
      />

      <Label>
        Anteckning <span className="normal-case font-medium tracking-normal">(valfri)</span>
      </Label>
      <textarea
        rows={2}
        placeholder="t.ex. Tandläkare på förmiddagen"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="pc-input"
        style={{ resize: "none", fontFamily: "inherit", fontWeight: 500, fontSize: 15 }}
      />

      {travelSlot}

      {ev && (
        <div className="bg-pc-peach rounded-2xl px-4 py-3 mb-4">
          <div className="font-extrabold text-pc-orange-deep text-[17px]">
            {fmtDuration(ev.workedMin)} arbetat
          </div>
          <div className="text-[12px] text-pc-muted mt-0.5">
            Norm {fmtDuration(ev.normMin)} · flex {fmtSignedDuration(ev.flexDelta)}
          </div>
        </div>
      )}

      {(err || built.error) && (
        <div className="text-red-600 text-[13px] mb-3 font-semibold">{err || built.error}</div>
      )}

      {current && (
        <button
          type="button"
          onClick={onRemove}
          className="w-full py-3 mb-3 rounded-[14px] text-[13px] font-bold text-red-600 bg-red-50 border border-red-200"
        >
          Ta bort justeringen
        </button>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onClose}
          className="pc-press py-4 rounded-[16px] bg-pc-bg border border-pc-line font-bold text-[15px] text-pc-ink"
        >
          Avbryt
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="pc-press py-4 rounded-[16px] bg-pc-orange text-white font-bold text-[15px] shadow-[0_8px_20px_-8px_rgba(255,95,0,0.6)]"
        >
          Spara
        </button>
      </div>
    </Sheet>
  );
}
