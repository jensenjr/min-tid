import { useEffect, useState } from "react";
import { EXPENSE_META } from "../components/ExpenseModal";
import { Card, IconTrash, Label, MonthPicker } from "../components/ui";
import { type DayContext, fmtDuration, fmtSignedDuration } from "../lib/days";
import { downloadText, fmtDateLabel } from "../lib/format";
import {
  type ReportPeriod,
  buildCsv,
  buildReport,
  buildShareText,
  monthPeriod,
  rangePeriod,
} from "../lib/report";
import { todayLocal } from "../lib/dates";
import type { ExpenseEntry } from "../lib/types";
import { type ReportSlots, renderSlot } from "./types";

type PeriodType = "month" | "range";

/**
 * Rapport: period, totals, absences, travel time row (slot), vacation line (slot),
 * expenses, and export (text share, CSV, Excel slot). All figures come from
 * `buildReport` (src/lib/report.ts), a fold over evaluateDay — the same numbers the flex
 * card and the calendar use.
 */
export default function Report({
  ctx,
  expenses,
  name,
  slots,
  focusExpenses,
  onAddExpense,
  onDeleteExpense,
}: {
  ctx: DayContext;
  expenses: ExpenseEntry[];
  name: string;
  /** Wave 3 integration slots: travel (PR 8), vacation (PR 7), excelExport (PR 6). */
  slots?: ReportSlots;
  /** Scroll the expenses section into view when the view opens (from "Att åtgärda"). */
  focusExpenses?: boolean;
  onAddExpense: () => void;
  onDeleteExpense: (id: string) => void;
}) {
  const [type, setType] = useState<PeriodType>("month");
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [from, setFrom] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [to, setTo] = useState(() => todayLocal());
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  const period: ReportPeriod =
    type === "month" ? monthPeriod(month.year, month.month) : rangePeriod(from, to);

  const report = buildReport(ctx, period.start, period.end);

  useEffect(() => {
    if (focusExpenses) {
      setTimeout(
        () => document.getElementById("report-expenses")?.scrollIntoView({ block: "start" }),
        60,
      );
    }
  }, [focusExpenses]);

  const periodExpenses = expenses
    .filter((e) => e.date >= period.start && e.date <= period.end)
    .sort((a, b) => b.date.localeCompare(a.date));
  const expenseTotal = periodExpenses.reduce((s, e) => s + (e.amount ?? 0), 0);
  const receipts = periodExpenses.filter((e) => e.hasReceipt);

  const { totals } = report;
  const slotCtx = { ...period, report };
  const travelRow = renderSlot(slots?.travel, slotCtx);
  const vacationRow = renderSlot(slots?.vacation, slotCtx);
  const excelButton = renderSlot(slots?.excelExport, slotCtx);

  function reset() {
    setText("");
    setCopied(false);
  }

  function generate() {
    setText(
      buildShareText(report, {
        name,
        periodLabel: period.label,
        expenses,
        mode: ctx.reportingMode,
      }),
    );
    setCopied(false);
  }

  const csv = () => buildCsv(report);

  async function shareFile() {
    const file = new File([csv()], `tidrapport-${period.fileLabel}.csv`, { type: "text/csv" });
    const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
    if (nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Tidrapport", text: text || undefined });
      } catch {
        /* user cancelled */
      }
    } else {
      downloadText(csv(), `tidrapport-${period.fileLabel}.csv`);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* ignore */
    }
  }

  async function shareText() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Tidrapport", text });
        setCopied(true);
      } catch {
        /* ignore */
      }
    } else {
      await copy();
    }
  }

  const seg = (active: boolean) =>
    `flex-1 py-2.5 rounded-[14px] text-[13px] font-bold border transition-colors ${
      active
        ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgba(255,95,0,0.45)]"
        : "bg-white border-pc-line text-pc-ink"
    }`;
  const outlineBtn =
    "pc-press py-3.5 rounded-[16px] bg-white border border-pc-line text-pc-ink font-bold text-[14px]";

  const byDate: Record<string, ExpenseEntry[]> = {};
  for (const e of periodExpenses) (byDate[e.date] ??= []).push(e);

  return (
    <div className="pc-fade pt-2">
      <h1 className="text-[28px] font-extrabold tracking-tight mb-4">Rapport</h1>

      <Label>Period</Label>
      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={() => {
            setType("month");
            reset();
          }}
          className={seg(type === "month")}
        >
          Månad
        </button>
        <button
          type="button"
          onClick={() => {
            setType("range");
            reset();
          }}
          className={seg(type === "range")}
        >
          Datumintervall
        </button>
      </div>
      {type === "month" ? (
        <div className="mb-4">
          <MonthPicker
            value={month}
            onChange={(m) => {
              setMonth(m);
              reset();
            }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="min-w-0">
            <Label>Från</Label>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (e.target.value > to) setTo(e.target.value);
                reset();
              }}
              className="pc-input"
              style={{ marginBottom: 0 }}
            />
          </div>
          <div className="min-w-0">
            <Label>Till</Label>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => {
                setTo(e.target.value);
                reset();
              }}
              className="pc-input"
              style={{ marginBottom: 0 }}
            />
          </div>
        </div>
      )}

      {/* Totals */}
      <Card>
        <div className="flex items-baseline justify-between mb-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-pc-muted">
            {period.label}
          </div>
          <div className="text-[12px] font-semibold text-pc-muted">
            {totals.workedDays} {totals.workedDays === 1 ? "dag" : "dagar"}
          </div>
        </div>
        <div className="text-[34px] font-extrabold tabular-nums tracking-tight leading-none">
          {fmtDuration(totals.workedMin)}
        </div>
        <div className="text-[13px] text-pc-muted font-semibold mt-1.5">
          Norm {fmtDuration(totals.expectedMin)} · flex{" "}
          <span
            className={
              totals.flexMin > 0
                ? "text-green-600"
                : totals.flexMin < 0
                  ? "text-red-500"
                  : "text-pc-muted"
            }
          >
            {fmtSignedDuration(totals.flexMin)}
          </span>
        </div>
        {totals.unconfirmedDays.length > 0 && (
          <div className="mt-3 text-[12px] font-semibold text-gray-600 bg-gray-100 rounded-[12px] px-3 py-2">
            {totals.unconfirmedDays.length}{" "}
            {totals.unconfirmedDays.length === 1 ? "dag är" : "dagar är"} inte bekräftade och räknas
            enligt schema.
          </div>
        )}
        {totals.missingDays.length > 0 && (
          <div className="mt-3 text-[12px] font-semibold text-red-600 bg-red-50 rounded-[12px] px-3 py-2">
            {totals.missingDays.length}{" "}
            {totals.missingDays.length === 1 ? "dag saknas" : "dagar saknas"} — fyll i{" "}
            {totals.missingDays.length === 1 ? "den" : "dem"} före inlämning.
          </div>
        )}

        {report.absences.length > 0 && (
          <div className="mt-4 pt-4 border-t border-pc-line">
            <Label>Frånvaro</Label>
            <div className="space-y-1.5">
              {report.absences.map((a) => (
                <div key={a.category} className="flex items-center justify-between text-[13px]">
                  <span className="font-semibold">{a.label}</span>
                  <span className="text-pc-muted font-medium tabular-nums">
                    {a.days} {a.days === 1 ? "dag" : "dagar"} · {fmtDuration(a.minutes)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {travelRow && <div className="mt-4 pt-4 border-t border-pc-line">{travelRow}</div>}
        {vacationRow && <div className="mt-4 pt-4 border-t border-pc-line">{vacationRow}</div>}
      </Card>

      {/* Expenses */}
      <div id="report-expenses" className="scroll-mt-2" />
      <Card>
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-pc-muted">
            Utlägg
          </div>
          <div className="text-[13px] font-extrabold tabular-nums">
            {expenseTotal} <span className="text-pc-muted font-bold">kr</span>
          </div>
        </div>
        {periodExpenses.length === 0 ? (
          <div className="text-center text-pc-muted py-4 text-[13px]">Inga utlägg i perioden.</div>
        ) : (
          <div className="space-y-3">
            {Object.keys(byDate)
              .sort((a, b) => b.localeCompare(a))
              .map((date) => (
                <div key={date}>
                  <div className="text-[12px] font-bold text-pc-muted capitalize mb-1">
                    {fmtDateLabel(date)}
                  </div>
                  {byDate[date].map((e) => {
                    const meta = EXPENSE_META[e.category];
                    const amount =
                      [
                        e.km != null ? `${e.km} km` : null,
                        e.amount != null ? `${e.amount} kr` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—";
                    return (
                      <div
                        key={e.id}
                        className="flex items-center gap-3 py-2 border-t border-pc-line first:border-t-0"
                      >
                        <span className="text-[20px] leading-none shrink-0">{meta.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-[14px] flex items-center gap-1.5">
                            {meta.label}
                            {e.hasReceipt && <span title="Kvitto att bifoga">🧾</span>}
                          </div>
                          {e.note && (
                            <div className="text-[12px] text-pc-muted font-medium truncate">
                              {e.note}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 font-extrabold tabular-nums text-[14px]">
                          {amount}
                        </div>
                        <button
                          onClick={() => onDeleteExpense(e.id)}
                          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl text-pc-muted hover:text-red-500 hover:bg-red-50 transition-colors"
                          aria-label="Ta bort utlägg"
                        >
                          <IconTrash />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>
        )}
        {receipts.length > 0 && (
          <div className="mt-3 text-[12px] text-amber-700 font-semibold">
            🧾 {receipts.length} {receipts.length === 1 ? "kvitto" : "kvitton"} att bifoga
          </div>
        )}
        <button
          onClick={onAddExpense}
          className="pc-press w-full mt-4 py-3 rounded-[14px] border border-dashed border-pc-line text-pc-muted text-[13px] font-bold hover:border-pc-orange hover:text-pc-orange transition-colors"
        >
          + Lägg till utlägg
        </button>
      </Card>

      {/* Export */}
      <Card>
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-pc-muted mb-3">
          Exportera
        </div>
        <button
          onClick={generate}
          className="pc-press w-full py-4 rounded-[18px] bg-pc-orange text-white font-bold text-[15px] shadow-[0_8px_20px_-8px_rgba(255,95,0,0.6)]"
        >
          Skapa textrapport
        </button>

        {text && (
          <div className="mt-4">
            <textarea
              readOnly
              value={text}
              className="w-full min-h-[240px] border border-pc-line rounded-[18px] p-4 text-[12px] leading-[1.7] bg-white text-pc-ink resize-none outline-none"
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            />
            <div className="grid grid-cols-2 gap-3 mt-3">
              <button onClick={copy} className={outlineBtn}>
                {copied ? "✓ Kopierat!" : "Kopiera text"}
              </button>
              <button onClick={shareText} className={outlineBtn}>
                Dela text
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mt-3">
          <button
            onClick={() => downloadText(csv(), `tidrapport-${period.fileLabel}.csv`)}
            className={outlineBtn}
          >
            Ladda ner CSV
          </button>
          <button onClick={shareFile} className={outlineBtn}>
            Dela fil
          </button>
        </div>
        {excelButton && <div className="mt-3">{excelButton}</div>}

        {receipts.length > 0 && (
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-[18px] p-4">
            <div className="font-bold text-[14px] text-amber-800 mb-2">⚠️ Kvitton att bifoga</div>
            <div className="space-y-1">
              {receipts.map((e) => (
                <div key={e.id} className="text-[13px] text-amber-700 font-medium">
                  • {EXPENSE_META[e.category].emoji} {EXPENSE_META[e.category].label} — {e.date}
                  {e.amount != null ? ` — ${e.amount} kr` : ""}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
