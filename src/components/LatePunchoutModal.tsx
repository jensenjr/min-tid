import { useState, useEffect } from "react";

type Session = { id: string; checkIn: number; checkOut: number | null; manual: boolean; note?: string };

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtDur(minutes: number): string {
  if (minutes <= 0) return "0h 0min";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

// "YYYY-MM-DDTHH:mm" in local time (datetime-local input format)
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): number {
  // datetime-local has no timezone — interpret as local time.
  const [date, time] = value.split("T");
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
}

export default function LatePunchoutModal({
  activeSession,
  todaysTargetMin,
  onCancel,
  onSave,
}: {
  activeSession: Session;
  todaysTargetMin: number;
  onCancel: () => void;
  onSave: (endTime: number) => void;
}) {
  // Default to start + today's net target (the common "normal end time" guess).
  // Falls back to "now" if target is 0 (non-workday or schedule inactive).
  const defaultEnd = todaysTargetMin > 0
    ? activeSession.checkIn + todaysTargetMin * 60_000
    : Date.now();

  const [customEnd, setCustomEnd] = useState(toLocalInput(defaultEnd));
  const [showPicker, setShowPicker] = useState(false);
  const [, setTick] = useState(0);

  // Keep "now" labels fresh while the modal sits open
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const nowMs = Date.now();
  const elapsedMin = (nowMs - activeSession.checkIn) / 60_000;

  const customEndMs = fromLocalInput(customEnd);
  const customNet = (customEndMs - activeSession.checkIn) / 60_000;
  const customEndBeforeStart = customEndMs <= activeSession.checkIn;
  const customEndInFuture    = customEndMs > nowMs;
  const customValid = !customEndBeforeStart && !customEndInFuture;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(45,23,23,0.55)", animation: "pcOverlay 0.25s ease" }}
      onClick={onCancel}
    >
      <div
        className="bg-white w-full max-w-[480px] rounded-t-[28px] px-6 pt-6"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
          animation: "pcSheet 0.32s cubic-bezier(0.32,0.72,0,1)",
          maxHeight: "92dvh",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-pc-line rounded-full mx-auto mb-5" />

        <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mb-4 mx-auto">
          <svg viewBox="0 0 24 24" className="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
        </div>

        <div className="text-center mb-5">
          <div className="font-extrabold text-[20px] tracking-tight mb-2">Långt pass — välj sluttid</div>
          <div className="text-[14px] text-pc-muted leading-relaxed">
            Du har varit instämplad i <span className="font-bold text-pc-ink">{fmtDur(elapsedMin)}</span>.
            Glömde du stämpla ut?
          </div>
        </div>

        {!showPicker ? (
          <>
            <button
              onClick={() => onSave(nowMs)}
              className="pc-press w-full mb-3 py-4 rounded-[16px] bg-pc-orange text-white font-bold text-[15px]"
              style={{ boxShadow: "0 8px 20px -8px rgba(255,95,0,0.6)" }}
            >
              Stämpla ut nu (kl. {fmtTime(nowMs)})
            </button>
            <button
              onClick={() => setShowPicker(true)}
              className="pc-press w-full mb-3 py-4 rounded-[16px] bg-white border border-pc-line font-bold text-[15px] text-pc-ink"
            >
              Sätt annan sluttid
            </button>
            <button
              onClick={onCancel}
              className="pc-press w-full py-3 rounded-[16px] bg-transparent font-semibold text-[14px] text-pc-muted"
            >
              Avbryt
            </button>
          </>
        ) : (
          <>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">Sluttid</div>
            <input
              type="datetime-local"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              style={{
                width: "100%", boxSizing: "border-box", padding: "13px 16px",
                borderRadius: "14px", border: "1.5px solid #ece6df",
                fontSize: "16px", outline: "none", background: "#fdf6ee",
                fontWeight: 600, color: "#2d1717", marginBottom: "10px",
              }}
            />

            <div className="bg-pc-apricot rounded-2xl px-4 py-3 mb-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-1">Passlängd</div>
              <div className={`text-[20px] font-extrabold tabular-nums tracking-tight ${customValid ? "text-pc-orange-deep" : "text-red-500"}`}>
                {customValid ? fmtDur(customNet) : "—"}
              </div>
            </div>

            {customEndBeforeStart && (
              <div className="text-red-500 text-[13px] mb-3 font-semibold">Sluttiden måste vara efter starttiden.</div>
            )}
            {customEndInFuture && (
              <div className="text-red-500 text-[13px] mb-3 font-semibold">Sluttiden kan inte vara i framtiden.</div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowPicker(false)}
                className="pc-press py-4 rounded-[16px] bg-pc-bg border border-pc-line font-bold text-[15px] text-pc-ink"
              >
                Tillbaka
              </button>
              <button
                onClick={() => customValid && onSave(customEndMs)}
                disabled={!customValid}
                className="pc-press py-4 rounded-[16px] font-bold text-[15px]"
                style={{
                  background: customValid ? "#ff5f00" : "#f0e8df",
                  color: customValid ? "white" : "#c4a882",
                  boxShadow: customValid ? "0 8px 20px -8px rgba(255,95,0,0.6)" : "none",
                }}
              >
                Spara
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
