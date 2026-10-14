import { useState } from "react";
import type { AttendSummary } from "../lib/attend";
import { fmtDateShort, fmtDur, monthName } from "../lib/format";
import type { DayActions } from "../views/types";
import { Card } from "./ui";

/** How many days are shown before "Visa alla (N)". */
export const ATTEND_VISIBLE_DAYS = 5;

const quickBtn =
  "pc-press flex-1 py-2 rounded-[12px] border border-pc-line bg-pc-bg text-[12px] font-bold text-pc-ink";

/**
 * "Att åtgärda": days that are missing (punch) or unconfirmed (schedule), receipts to
 * attach, long open sessions, and from the 25th the "Bekräfta <månad>" prompt. What goes
 * in the list is decided by `buildAttend` (src/lib/attend.ts); this only renders it.
 */
export default function AttendCard({
  summary,
  actions,
  onFixLongSession,
  onShowReceipts,
}: {
  summary: AttendSummary;
  actions: DayActions;
  /** Open the "Välj sluttid" sheet for the running session. */
  onFixLongSession: () => void;
  /** Jump to the receipts (Rapport → Utlägg). */
  onShowReceipts: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const { days, receipts, longSessions, monthPrompt } = summary;

  if (summary.total === 0) {
    return (
      <Card className="!p-4">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-green-50 text-green-600 flex items-center justify-center text-[16px] font-extrabold">
            ✓
          </span>
          <div>
            <div className="text-[14px] font-extrabold">Allt är åtgärdat</div>
            <div className="text-[12px] text-pc-muted font-medium">
              Inga dagar eller kvitton väntar på dig.
            </div>
          </div>
        </div>
      </Card>
    );
  }

  const visible = showAll ? days : days.slice(0, ATTEND_VISIBLE_DAYS);
  const dayTitle =
    summary.dayKind === "punch"
      ? days.length === 1
        ? "1 dag saknas"
        : `${days.length} dagar saknas`
      : days.length === 1
        ? "1 dag att bekräfta"
        : `${days.length} dagar att bekräfta`;
  const dayHint =
    summary.dayKind === "punch"
      ? "Ingen registrering. Dagen påverkar inte flexen förrän du fyller i den."
      : "Räknas som arbetad enligt schema tills du bekräftar eller justerar.";

  return (
    <Card>
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-pc-muted">
          Att åtgärda
        </div>
        <div className="text-[12px] font-bold text-pc-orange-deep">{summary.total}</div>
      </div>

      <div className="space-y-3">
        {monthPrompt && (
          <div className="rounded-[18px] bg-pc-peach p-4">
            <div className="text-[15px] font-extrabold">
              Bekräfta {monthName(monthPrompt.month)}
            </div>
            <div className="text-[12px] text-pc-muted font-medium mt-0.5 leading-snug">
              {monthPrompt.ready
                ? `Månaden bekräftas och låses${monthPrompt.unconfirmedCount > 0 ? `. ${monthPrompt.unconfirmedCount} ej bekräftade dagar räknas enligt schema.` : "."}`
                : `${monthPrompt.missingDays.length} ${monthPrompt.missingDays.length === 1 ? "dag saknas" : "dagar saknas"} — fyll i ${monthPrompt.missingDays.length === 1 ? "den" : "dem"} först.`}
            </div>
            <button
              onClick={() => actions.confirmMonth(monthPrompt.month)}
              disabled={!monthPrompt.ready}
              className="pc-press w-full mt-3 py-3 rounded-[14px] bg-pc-orange text-white font-bold text-[14px] disabled:opacity-40"
            >
              Bekräfta {monthName(monthPrompt.month)}
            </button>
          </div>
        )}

        {longSessions.map(({ session, elapsedMin }) => (
          <div key={session.id} className="rounded-[18px] bg-amber-50 border border-amber-200 p-4">
            <div className="text-[13px] font-bold text-amber-800 leading-snug">
              ⏰ Långt pass ({fmtDur(elapsedMin)}). Glömde du checka ut?
            </div>
            <button
              onClick={onFixLongSession}
              className="pc-press w-full mt-3 py-2.5 rounded-[14px] bg-amber-500 text-white font-bold text-[13px]"
            >
              Välj sluttid
            </button>
          </div>
        ))}

        {days.length > 0 && (
          <div>
            <div className="text-[14px] font-extrabold">{dayTitle}</div>
            <div className="text-[12px] text-pc-muted font-medium mb-2 leading-snug">{dayHint}</div>
            <div className="rounded-[18px] border border-pc-line overflow-hidden">
              {visible.map((d) => (
                <div key={d} className="px-3 py-3 border-t border-pc-line first:border-t-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${summary.dayKind === "punch" ? "bg-red-400" : "bg-gray-300"}`}
                    />
                    <span className="text-[13px] font-bold capitalize">{fmtDateShort(d)}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => actions.enligtSchema(d)} className={quickBtn}>
                      Enligt schema
                    </button>
                    <button onClick={() => actions.adjust(d)} className={quickBtn}>
                      Justera
                    </button>
                    <button onClick={() => actions.absence(d)} className={quickBtn}>
                      Frånvaro
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {days.length > ATTEND_VISIBLE_DAYS && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className="w-full mt-2 py-2 text-[13px] font-bold text-pc-orange"
              >
                {showAll ? "Visa färre" : `Visa alla (${days.length})`}
              </button>
            )}
          </div>
        )}

        {receipts.length > 0 && (
          <div className="rounded-[18px] bg-amber-50 border border-amber-200 p-4">
            <div className="text-[13px] font-bold text-amber-800 leading-snug">
              🧾 {receipts.length} {receipts.length === 1 ? "kvitto" : "kvitton"} att bifoga
            </div>
            <div className="text-[12px] text-amber-700 font-medium mt-0.5">
              Bifoga kvittona när du skickar in rapporten.
            </div>
            <button
              onClick={onShowReceipts}
              className="pc-press w-full mt-3 py-2.5 rounded-[14px] bg-white border border-amber-200 text-amber-800 font-bold text-[13px]"
            >
              Visa utlägg
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}
