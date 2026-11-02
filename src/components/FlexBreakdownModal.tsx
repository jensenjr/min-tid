import { useEffect, useState } from "react";
import { fmtMin } from "../lib/schedule";
import type { FlexAdjustment } from "../lib/types";
import { IconTrash } from "./ui";

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

/** "7,5" / "7.5" / "7:30" → minutes, or null. */
function parseHours(raw: string): number | null {
  const s = raw.trim();
  const hm = /^(\d{1,4}):([0-5]\d)$/.exec(s);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const n = Number(s.replace(",", "."));
  if (!s || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 60);
}

const fieldCls =
  "w-full box-border px-3.5 py-3 rounded-[14px] border-[1.5px] border-pc-line bg-pc-apricot text-[16px] font-semibold text-pc-ink outline-none focus:border-pc-orange";

export default function FlexBreakdownModal({
  open,
  onClose,
  trackingStartDate,
  weeks,
  total,
  today,
  adjustments,
  isLocked,
  onAddAdjustment,
  onDeleteAdjustment,
}: {
  open: boolean;
  onClose: () => void;
  trackingStartDate: string | undefined;
  weeks: { mondayStr: string; minutes: number }[];
  total: number;
  today: string;
  /** Manual ± changes of the balance, oldest first. */
  adjustments: FlexAdjustment[];
  isLocked: (date: string) => boolean;
  onAddAdjustment: (a: FlexAdjustment) => void;
  onDeleteAdjustment: (a: FlexAdjustment) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [sign, setSign] = useState<-1 | 1>(-1);
  const [hours, setHours] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setFormOpen(false);
      setSign(-1);
      setHours("");
      setDate(today);
      setNote("");
      setErr("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  function save() {
    const min = parseHours(hours);
    if (min === null) return setErr("Ange antal timmar, t.ex. 7,5 eller 7:30.");
    if (!date) return setErr("Ange datum.");
    if (date > today) return setErr("Datumet kan inte ligga framåt i tiden.");
    if (isLocked(date)) return setErr("Månaden är låst. Välj ett annat datum eller lås upp den.");
    onAddAdjustment({
      id: crypto.randomUUID(),
      date,
      minutes: sign * min,
      note: note.trim() || undefined,
      at: Date.now(),
    });
    setFormOpen(false);
    setHours("");
    setNote("");
    setErr("");
  }

  const preview = parseHours(hours);

  const totalSign = total >= 0 ? "+" : "−";
  const totalColor = total > 0 ? "text-green-600" : total < 0 ? "text-red-500" : "text-pc-ink";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-6"
      style={{ background: "var(--pc-overlay)", animation: "pcOverlay 0.25s ease" }}
      onClick={onClose}
    >
      <div
        className="pc-sheet bg-pc-surface w-full max-w-[480px] md:max-w-[560px] rounded-t-[28px] md:rounded-[28px] px-5 pt-6 overflow-y-auto"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
          animation: "pcSheet 0.32s cubic-bezier(0.32,0.72,0,1)",
          maxHeight: "92dvh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-pc-line rounded-full mx-auto md:hidden mb-5" />

        <div className="font-extrabold text-[22px] tracking-tight mb-1">Flexsaldo</div>
        <div className="text-[13px] text-pc-muted mb-5">
          {trackingStartDate ? (
            <>
              Räknar från{" "}
              <span className="font-semibold text-pc-ink">
                {new Date(trackingStartDate + "T12:00:00").toLocaleDateString("sv-SE", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
              .
            </>
          ) : (
            "Flex börjar räknas så fort du stämplar in första gången."
          )}
        </div>

        <div className="bg-pc-apricot rounded-2xl px-4 py-4 mb-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-1">
            Totalt
          </div>
          <div
            className={`text-[34px] font-extrabold tabular-nums tracking-tight leading-none ${totalColor}`}
          >
            {totalSign}
            {fmtMin(Math.abs(total))}
          </div>
        </div>

        {formOpen ? (
          <div className="rounded-2xl border border-pc-line p-4 mb-5">
            <div className="text-[15px] font-extrabold mb-1">Justera saldo</div>
            <div className="text-[12px] text-pc-muted font-medium leading-snug mb-3">
              För flex du fått ut på annat sätt, t.ex. utbetald övertid eller en överenskommelse.
              Justeringen sparas i historiken med datum och anteckning.
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {([-1, 1] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSign(s)}
                  className={`pc-press py-2.5 rounded-[14px] text-[13px] font-bold border transition-colors ${
                    sign === s
                      ? "bg-pc-orange text-white border-pc-orange"
                      : "bg-pc-apricot border-pc-line text-pc-ink"
                  }`}
                >
                  {s === -1 ? "− Dra av" : "+ Lägg till"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <label className="block">
                <span className="block text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-1.5">
                  Timmar
                </span>
                <input
                  inputMode="decimal"
                  placeholder="t.ex. 7,5"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className={fieldCls}
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-1.5">
                  Datum
                </span>
                <input
                  type="date"
                  value={date}
                  max={today}
                  onChange={(e) => setDate(e.target.value)}
                  className={fieldCls}
                  style={{ WebkitAppearance: "none" }}
                />
              </label>
            </div>
            <label className="block mb-3">
              <span className="block text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-1.5">
                Anteckning <span className="normal-case tracking-normal font-medium">(valfri)</span>
              </span>
              <input
                placeholder="t.ex. Övertid utbetald i lön"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={fieldCls}
              />
            </label>
            {preview !== null && (
              <div className="text-[12px] text-pc-muted font-semibold mb-3">
                Nytt saldo:{" "}
                <span className="text-pc-ink font-extrabold tabular-nums">
                  {total + sign * preview >= 0 ? "+" : "−"}
                  {fmtMin(Math.abs(total + sign * preview))}
                </span>
              </div>
            )}
            {err && <div className="text-red-600 text-[13px] mb-3 font-semibold">{err}</div>}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="pc-press py-3 rounded-[14px] bg-pc-bg border border-pc-line font-bold text-[14px] text-pc-ink"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={save}
                className="pc-press py-3 rounded-[14px] bg-pc-orange text-white font-bold text-[14px]"
              >
                Spara
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="pc-press w-full mb-5 py-3 rounded-[14px] bg-pc-surface border border-pc-line font-bold text-[14px] text-pc-ink"
          >
            ± Justera saldo manuellt
          </button>
        )}

        {adjustments.length > 0 && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">
              Manuella justeringar
            </div>
            <div className="mb-5">
              {[...adjustments].reverse().map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 py-2 px-1 border-b border-pc-line last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-pc-ink">
                      {new Date(a.date + "T12:00:00").toLocaleDateString("sv-SE", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </div>
                    {a.note && (
                      <div className="text-[12px] text-pc-muted font-medium truncate">{a.note}</div>
                    )}
                  </div>
                  <div
                    className={`text-[14px] font-extrabold tabular-nums ${a.minutes > 0 ? "text-green-600" : "text-red-500"}`}
                  >
                    {a.minutes > 0 ? "+" : "−"}
                    {fmtMin(Math.abs(a.minutes))}
                  </div>
                  {!isLocked(a.date) && (
                    <button
                      type="button"
                      onClick={() => onDeleteAdjustment(a)}
                      aria-label="Ta bort justeringen"
                      className="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl text-pc-muted hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <IconTrash className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-3">
          Senaste 12 veckorna
        </div>

        {weeks.length === 0 ? (
          <div className="text-[13px] text-pc-muted text-center py-6">
            Inga veckor att visa ännu.
          </div>
        ) : (
          <div className="space-y-1 mb-2">
            {weeks.map((w) => {
              const sign = w.minutes >= 0 ? "+" : "−";
              const color =
                w.minutes > 0 ? "text-green-600" : w.minutes < 0 ? "text-red-500" : "text-pc-muted";
              return (
                <div
                  key={w.mondayStr}
                  className="flex items-center justify-between py-2 px-1 border-b border-pc-line last:border-b-0"
                >
                  <div className="text-[13px] font-semibold text-pc-ink">
                    {weekRangeLabel(w.mondayStr)}
                  </div>
                  <div className={`text-[14px] font-extrabold tabular-nums ${color}`}>
                    {sign}
                    {fmtMin(Math.abs(w.minutes))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            width: "100%",
            padding: "15px",
            borderRadius: "16px",
            background: "var(--pc-orange)",
            color: "white",
            fontWeight: 700,
            fontSize: "15px",
            boxShadow: "0 8px 20px -8px rgb(var(--pc-orange-rgb) / 0.6)",
            marginTop: "12px",
          }}
        >
          Stäng
        </button>
      </div>
    </div>
  );
}
