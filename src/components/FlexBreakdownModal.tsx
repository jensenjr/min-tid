import { fmtMin } from "../lib/schedule";

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function weekRangeLabel(mondayStr: string): string {
  const mon = new Date(mondayStr + "T12:00:00");
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  const wn = isoWeek(mon);
  const monFmt = mon.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
  const sunFmt = sun.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
  return `Vecka ${wn} · ${monFmt} – ${sunFmt}`;
}

export default function FlexBreakdownModal({
  open,
  onClose,
  trackingStartDate,
  weeks,
  total,
}: {
  open: boolean;
  onClose: () => void;
  trackingStartDate: string | undefined;
  weeks: { mondayStr: string; minutes: number }[];
  total: number;
}) {
  if (!open) return null;

  const totalSign  = total >= 0 ? "+" : "−";
  const totalColor = total > 0 ? "text-green-600" : total < 0 ? "text-red-500" : "text-pc-ink";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(45,23,23,0.55)", animation: "pcOverlay 0.25s ease" }}
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-[480px] rounded-t-[28px] px-5 pt-6 overflow-y-auto"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
          animation: "pcSheet 0.32s cubic-bezier(0.32,0.72,0,1)",
          maxHeight: "92dvh",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-pc-line rounded-full mx-auto mb-5" />

        <div className="font-extrabold text-[22px] tracking-tight mb-1">Flexsaldo</div>
        <div className="text-[13px] text-pc-muted mb-5">
          {trackingStartDate
            ? <>Räknar från <span className="font-semibold text-pc-ink">{new Date(trackingStartDate + "T12:00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric" })}</span>.</>
            : "Flex börjar räknas så fort du stämplar in första gången."}
        </div>

        <div className="bg-pc-apricot rounded-2xl px-4 py-4 mb-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-1">Totalt</div>
          <div className={`text-[34px] font-extrabold tabular-nums tracking-tight leading-none ${totalColor}`}>
            {totalSign}{fmtMin(Math.abs(total))}
          </div>
        </div>

        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-3">
          Senaste 12 veckorna
        </div>

        {weeks.length === 0 ? (
          <div className="text-[13px] text-pc-muted text-center py-6">
            Inga veckor att visa ännu.
          </div>
        ) : (
          <div className="space-y-1 mb-2">
            {weeks.map(w => {
              const sign  = w.minutes >= 0 ? "+" : "−";
              const color = w.minutes > 0 ? "text-green-600" : w.minutes < 0 ? "text-red-500" : "text-pc-muted";
              return (
                <div key={w.mondayStr} className="flex items-center justify-between py-2 px-1 border-b border-pc-line last:border-b-0">
                  <div className="text-[13px] font-semibold text-pc-ink">
                    {weekRangeLabel(w.mondayStr)}
                  </div>
                  <div className={`text-[14px] font-extrabold tabular-nums ${color}`}>
                    {sign}{fmtMin(Math.abs(w.minutes))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button
          onClick={onClose}
          style={{ width: "100%", padding: "15px", borderRadius: "16px", background: "#ff5f00", color: "white", fontWeight: 700, fontSize: "15px", boxShadow: "0 8px 20px -8px rgba(255,95,0,0.6)", marginTop: "12px" }}
        >
          Stäng
        </button>
      </div>
    </div>
  );
}
