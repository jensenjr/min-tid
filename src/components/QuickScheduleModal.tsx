import { useState, useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────
type NewSession = { id: string; checkIn: number; checkOut: number; manual: true };

// ─── Helpers ─────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0, 10); }

function getWeekMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function getWeekDays(mondayStr: string): string[] {
  const days: string[] = [];
  const mon = new Date(mondayStr + "T12:00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function addMinutesToTime(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + Math.round(minutes);
  const endH = Math.floor(total / 60) % 24;
  const endM = total % 60;
  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
}

function fmtDur(minutes: number) {
  if (minutes <= 0) return "0h 0min";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function applyLunch(rawMin: number) {
  return rawMin > 5 * 60 ? rawMin - 45 : rawMin;
}

const DAY_LABELS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

// ─── Component ────────────────────────────────────────────────
export default function QuickScheduleModal({
  open,
  onClose,
  onSave,
  normHours,
  existingSessions,
  existingAbsences,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (sessions: NewSession[]) => void;
  normHours: number;
  existingSessions: { checkIn: number }[];
  existingAbsences: { startDate: string; endDate: string }[];
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [startTime, setStartTime] = useState("08:00");

  if (!open) return null;

  const baseMon = getWeekMonday(new Date());
  const displayMon = new Date(baseMon);
  displayMon.setDate(displayMon.getDate() + weekOffset * 7);
  const mondayStr = displayMon.toISOString().slice(0, 10);
  const weekDays = getWeekDays(mondayStr);
  const weekNum = isoWeekNumber(displayMon);

  const rawMin = normHours * 60;
  const endTime = addMinutesToTime(startTime, rawMin);
  const netMin = applyLunch(rawMin);
  const hasLunch = rawMin > 5 * 60;
  const today = todayStr();

  // Build sets for quick lookup
  const sessionDates = useMemo(() => {
    const s = new Set<string>();
    for (const sess of existingSessions)
      s.add(new Date(sess.checkIn).toISOString().slice(0, 10));
    return s;
  }, [existingSessions]);

  const absenceDates = useMemo(() => {
    const s = new Set<string>();
    for (const a of existingAbsences) {
      const cur = new Date(a.startDate + "T12:00:00");
      const end = new Date(a.endDate + "T12:00:00");
      while (cur <= end) {
        s.add(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 1);
      }
    }
    return s;
  }, [existingAbsences]);

  function toggleDay(date: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  }

  function selectWorkdays() {
    setSelected(new Set(weekDays.slice(0, 5)));
  }

  function handleSave() {
    if (selected.size === 0) return;
    const newSessions: NewSession[] = [];
    for (const date of [...selected].sort()) {
      const checkIn = new Date(`${date}T${startTime}`).getTime();
      const checkOut = new Date(`${date}T${endTime}`).getTime();
      if (checkOut > checkIn) {
        newSessions.push({ id: crypto.randomUUID(), checkIn, checkOut, manual: true });
      }
    }
    onSave(newSessions);
    setSelected(new Set());
  }

  // Range label for header
  const firstDay = new Date(mondayStr + "T12:00:00");
  const lastDay = new Date(weekDays[6] + "T12:00:00");
  const rangeLabel = `${firstDay.toLocaleDateString("sv-SE", { day: "numeric", month: "short" })} – ${lastDay.toLocaleDateString("sv-SE", { day: "numeric", month: "short" })}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(45,23,23,0.55)", animation: "pcOverlay 0.25s ease" }}
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-[480px] rounded-t-[28px] px-5 pt-6"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
          animation: "pcSheet 0.32s cubic-bezier(0.32,0.72,0,1)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-[#ece6df] rounded-full mx-auto mb-5" />

        {/* Title */}
        <div className="font-extrabold text-[22px] tracking-tight mb-0.5">Planera dagar</div>
        <div className="text-[13px] text-[#9c7c5c] mb-5">
          Välj en eller flera dagar — ett helt arbetspass läggs till automatiskt.
        </div>

        {/* Week navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setWeekOffset(o => o - 1)}
            className="w-9 h-9 rounded-full bg-[#fdf6ee] border border-[#ece6df] flex items-center justify-center text-[#9c7c5c] active:scale-95 transition-transform"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="text-center">
            <div className="font-extrabold text-[15px] text-[#2d1717]">Vecka {weekNum}</div>
            <div className="text-[12px] text-[#9c7c5c] font-medium">{rangeLabel}</div>
          </div>
          <button
            onClick={() => setWeekOffset(o => o + 1)}
            className="w-9 h-9 rounded-full bg-[#fdf6ee] border border-[#ece6df] flex items-center justify-center text-[#9c7c5c] active:scale-95 transition-transform"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAY_LABELS.map((lbl, i) => (
            <div key={lbl} className={`text-center text-[10px] font-bold uppercase tracking-wide mb-1 ${i >= 5 ? "text-[#c4a882]" : "text-[#9c7c5c]"}`}>
              {lbl}
            </div>
          ))}
          {weekDays.map((date, i) => {
            const isToday = date === today;
            const isSel = selected.has(date);
            const hasSess = sessionDates.has(date);
            const hasAbs = absenceDates.has(date);
            const isWeekend = i >= 5;

            return (
              <div key={date} className="flex flex-col items-center gap-1">
                <button
                  onClick={() => toggleDay(date)}
                  className="w-full aspect-square rounded-2xl flex items-center justify-center font-extrabold text-[15px] transition-all active:scale-90"
                  style={{
                    background: isSel
                      ? "#ff5f00"
                      : isToday
                      ? "#fff3ec"
                      : isWeekend
                      ? "#faf7f4"
                      : "#fdf6ee",
                    color: isSel ? "#fff" : isWeekend ? "#c4a882" : "#2d1717",
                    border: isToday && !isSel ? "2px solid #ff5f00" : "2px solid transparent",
                    boxShadow: isSel ? "0 4px 12px -4px rgba(255,95,0,0.45)" : "none",
                  }}
                >
                  {new Date(date + "T12:00:00").getDate()}
                </button>
                {/* Indicators */}
                <div className="flex gap-0.5 h-2 items-center">
                  {hasSess && (
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: isSel ? "#ff5f00" : "#ff5f00", opacity: isSel ? 0.5 : 1 }} />
                  )}
                  {hasAbs && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#e8c4a0]" />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick select all weekdays */}
        <button
          onClick={selectWorkdays}
          className="w-full mt-2 mb-4 py-2 rounded-[12px] border border-dashed border-[#ece6df] text-[#9c7c5c] text-[12px] font-semibold active:scale-[0.98] transition-transform hover:border-[#ff5f00] hover:text-[#ff5f00]"
        >
          Välj alla vardagar
        </button>

        {/* Divider */}
        <div className="h-px bg-[#ece6df] mb-4" />

        {/* Time settings */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-1.5">Starttid</div>
            <input
              type="time"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: "12px",
                border: "1.5px solid #ece6df", fontSize: "15px", outline: "none",
                background: "#fdf6ee", fontWeight: 700, color: "#2d1717",
                boxSizing: "border-box",
              }}
              onFocus={e => { e.currentTarget.style.borderColor = "#ff5f00"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "#ece6df"; }}
            />
          </div>
          <div className="flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-1.5">Sluttid</div>
            <div
              style={{
                width: "100%", padding: "10px 12px", borderRadius: "12px",
                border: "1.5px solid #ece6df", fontSize: "15px",
                background: "#f5f0ea", fontWeight: 700, color: "#9c7c5c",
                boxSizing: "border-box",
              }}
            >
              {endTime}
            </div>
          </div>
        </div>

        {/* Duration preview */}
        <div className="flex items-center gap-2 bg-[#fff3ec] rounded-[14px] px-4 py-3 mb-5">
          <div className="flex-1">
            <div className="text-[13px] font-bold text-[#ff5f00]">
              {fmtDur(rawMin)} per dag
            </div>
            <div className="text-[12px] text-[#9c7c5c] mt-0.5">
              Netto: {fmtDur(netMin)}{hasLunch ? " (lunch -45min)" : ""}
            </div>
          </div>
          {selected.size > 0 && (
            <div className="text-right">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#9c7c5c]">Totalt</div>
              <div className="text-[15px] font-extrabold text-[#2d1717]">{fmtDur(netMin * selected.size)}</div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex gap-4 mb-4 px-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#ff5f00]" />
            <span className="text-[11px] text-[#9c7c5c] font-medium">Har pass</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#e8c4a0]" />
            <span className="text-[11px] text-[#9c7c5c] font-medium">Avvikelse</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded-lg border-2 border-[#ff5f00] bg-[#fff3ec] inline-block" />
            <span className="text-[11px] text-[#9c7c5c] font-medium">Idag</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onClose}
            style={{
              padding: "15px", borderRadius: "16px", background: "#fdf6ee",
              border: "1.5px solid #ece6df", fontWeight: 700, fontSize: "15px",
              color: "#2d1717",
            }}
          >
            Avbryt
          </button>
          <button
            onClick={handleSave}
            disabled={selected.size === 0}
            style={{
              padding: "15px", borderRadius: "16px",
              background: selected.size > 0 ? "#ff5f00" : "#f0e8df",
              color: selected.size > 0 ? "white" : "#c4a882",
              fontWeight: 700, fontSize: "15px",
              boxShadow: selected.size > 0 ? "0 8px 20px -8px rgba(255,95,0,0.6)" : "none",
              transition: "all 0.2s",
            }}
          >
            {selected.size === 0
              ? "Välj dagar"
              : `Lägg till ${selected.size} dag${selected.size > 1 ? "ar" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
