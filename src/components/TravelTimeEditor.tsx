// Restid for one day: list, add, edit and delete trips. Standalone (controlled): the
// caller owns the full `travel` array and gets the next array through onChange.
// Mounted in AdjustDaySheet's `travelSlot` once the navigation PR (PR 5) has landed.
import { useState } from "react";
import type { DayConfig } from "../lib/schedule";
import { fmtDuration } from "../lib/days";
import TimeField from "./TimeField";
import {
  isDurationOnly,
  isTravelTime,
  splitTravel,
  travelDurationMin,
  type TravelEntry,
  type TravelRules,
} from "../lib/travel";

type Draft = {
  id: string | null; // null = new
  from: string;
  to: string;
  durationH: string; // duration-only (imported) entries
  durationM: string;
  destination: string;
  note: string;
  imported: boolean;
};

const EMPTY: Draft = {
  id: null,
  from: "",
  to: "",
  durationH: "",
  durationM: "",
  destination: "",
  note: "",
  imported: false,
};

const LABEL = "text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2";

function draftOf(e: TravelEntry): Draft {
  const d = e.durationMin ?? 0;
  return {
    id: e.id,
    from: e.from ?? "",
    to: e.to ?? "",
    durationH: d ? String(Math.floor(d / 60)) : "",
    durationM: d ? String(d % 60) : "",
    destination: e.destination ?? "",
    note: e.note ?? "",
    imported: isDurationOnly(e),
  };
}

function splitLine(e: TravelEntry, cfg: DayConfig, rules: TravelRules): string {
  const s = splitTravel(e, cfg, rules);
  const parts: string[] = [];
  if (s.inScheduleMin > 0) parts.push(`${fmtDuration(s.inScheduleMin)} under arbetstid`);
  if (s.outsideMin > 0) {
    const where =
      rules.outside === "payroll"
        ? "till lön"
        : rules.outside === "flex"
          ? "till flex"
          : "räknas inte";
    const credited = rules.outside === "payroll" ? s.payrollMin : s.flexMin;
    parts.push(
      rules.outside === "none"
        ? `${fmtDuration(s.outsideMin)} utanför arbetstid (${where})`
        : `${fmtDuration(s.outsideMin)} utanför arbetstid (${fmtDuration(credited)} ${where})`,
    );
  }
  return parts.join(" · ") || "0 min";
}

export default function TravelTimeEditor({
  date,
  travel,
  dayConfig,
  rules,
  onChange,
}: {
  date: string;
  travel: TravelEntry[];
  /** Effective schedule of `date` (getEffectiveDayConfig). */
  dayConfig: DayConfig;
  rules: TravelRules;
  onChange: (next: TravelEntry[]) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState("");
  const todays = travel.filter((t) => t.date === date);

  function save() {
    if (!draft) return;
    let times: Pick<TravelEntry, "from" | "to" | "durationMin">;
    if (draft.imported) {
      const mins =
        (parseInt(draft.durationH || "0", 10) || 0) * 60 +
        (parseInt(draft.durationM || "0", 10) || 0);
      if (mins <= 0) return setErr("Ange hur lång restiden var.");
      times = { durationMin: mins };
    } else {
      if (!isTravelTime(draft.from) || !isTravelTime(draft.to)) {
        return setErr("Ange både från- och tilltid.");
      }
      if (draft.from === draft.to) return setErr("Från- och tilltid kan inte vara samma.");
      times = { from: draft.from, to: draft.to };
    }
    const prev = draft.id ? travel.find((t) => t.id === draft.id) : undefined;
    const entry: TravelEntry = {
      ...(prev ?? {}),
      id: prev?.id ?? crypto.randomUUID(),
      date,
      from: undefined,
      to: undefined,
      durationMin: undefined,
      ...times,
      destination: draft.destination.trim() || undefined,
      note: draft.note.trim() || undefined,
      imported: draft.imported ? true : undefined,
    };
    onChange(prev ? travel.map((t) => (t.id === prev.id ? entry : t)) : [...travel, entry]);
    setDraft(null);
    setErr("");
  }

  function remove(id: string) {
    onChange(travel.filter((t) => t.id !== id));
    if (draft?.id === id) setDraft(null);
  }

  return (
    <div data-testid="travel-time-editor">
      <div className={LABEL}>Restid</div>

      {todays.length === 0 && !draft && (
        <div className="text-[13px] text-pc-muted mb-3">Ingen restid registrerad.</div>
      )}

      {todays.map((e) => (
        <div
          key={e.id}
          className="flex items-start gap-3 rounded-[14px] border border-pc-line bg-pc-bg px-3 py-2.5 mb-2"
        >
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold text-pc-ink">
              {isDurationOnly(e) ? fmtDuration(travelDurationMin(e)) : `${e.from}–${e.to}`}
              {e.destination ? ` · ${e.destination}` : ""}
              {e.imported && (
                <span className="ml-2 align-middle rounded-full bg-pc-peach px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-pc-bark">
                  importerad
                </span>
              )}
            </div>
            <div className="text-[12px] text-pc-muted">{splitLine(e, dayConfig, rules)}</div>
            {e.note && <div className="text-[12px] text-pc-muted truncate">{e.note}</div>}
          </div>
          <button
            type="button"
            onClick={() => {
              setDraft(draftOf(e));
              setErr("");
            }}
            className="text-[13px] font-bold text-pc-orange px-2 py-1"
            aria-label="Ändra restid"
          >
            Ändra
          </button>
          <button
            type="button"
            onClick={() => remove(e.id)}
            className="text-[13px] font-bold text-red-600 px-2 py-1"
            aria-label="Ta bort restid"
          >
            Ta bort
          </button>
        </div>
      ))}

      {draft ? (
        <div className="rounded-[14px] border border-pc-line p-3 mb-2">
          {draft.imported ? (
            <>
              <div className={LABEL}>Restid (importerad, saknar klockslag)</div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="timmar"
                  value={draft.durationH}
                  onChange={(e) => setDraft({ ...draft, durationH: e.target.value })}
                  className="pc-input"
                  aria-label="Timmar"
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={59}
                  step={5}
                  placeholder="minuter"
                  value={draft.durationM}
                  onChange={(e) => setDraft({ ...draft, durationM: e.target.value })}
                  className="pc-input"
                  aria-label="Minuter"
                />
              </div>
              <div className="text-[12px] text-pc-muted mb-3">
                Utan klockslag går det inte att se om resan låg inom arbetstid, så den räknas som
                utanför arbetstid. Fyll i från/till för att få en exakt uppdelning.
              </div>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, imported: false })}
                className="text-[13px] font-bold text-pc-orange mb-3"
              >
                Ange klockslag istället
              </button>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <div className={LABEL}>Från</div>
                <TimeField
                  label="Restid från"
                  value={draft.from}
                  onChange={(v) => setDraft({ ...draft, from: v })}
                />
              </div>
              <div>
                <div className={LABEL}>Till</div>
                <TimeField
                  label="Restid till"
                  value={draft.to}
                  onChange={(v) => setDraft({ ...draft, to: v })}
                />
              </div>
            </div>
          )}
          <div className={LABEL}>
            Destination <span className="normal-case font-medium tracking-normal">(valfri)</span>
          </div>
          <input
            type="text"
            value={draft.destination}
            onChange={(e) => setDraft({ ...draft, destination: e.target.value })}
            className="pc-input"
            placeholder="t.ex. Göteborg"
          />
          <div className={LABEL}>
            Anteckning <span className="normal-case font-medium tracking-normal">(valfri)</span>
          </div>
          <input
            type="text"
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            className="pc-input"
          />
          {err && <div className="text-red-600 text-[13px] mb-2 font-semibold">{err}</div>}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setErr("");
              }}
              className="rounded-[14px] border border-pc-line bg-pc-bg py-3 font-bold text-[14px] text-pc-ink"
            >
              Avbryt
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-[14px] bg-pc-orange py-3 font-bold text-[14px] text-white"
            >
              Spara restid
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft({ ...EMPTY });
            setErr("");
          }}
          className="w-full rounded-[14px] border border-pc-line bg-pc-bg py-3 font-bold text-[14px] text-pc-ink"
        >
          + Lägg till restid
        </button>
      )}
    </div>
  );
}
