// The pieces PunchClock mounts into the wave-3 slots (see "navigation and slots" in
// CLAUDE.md): the "Restidsregler" row for Mer, and the "Restid" row for Rapport.
import { useState } from "react";
import { fmtDuration } from "../lib/days";
import type { ReportTotals } from "../lib/report";
import type { TravelRules } from "../lib/types";
import { MoreRow, Sheet, Label } from "./ui";
import TravelRulesEditor from "./TravelRulesEditor";

const OUTSIDE_LABEL: Record<TravelRules["outside"], string> = {
  payroll: "utanför arbetstid till lön",
  flex: "utanför arbetstid till flex",
  none: "utanför arbetstid räknas inte",
};

/** Mer → "Restidsregler": a row that opens the rules in a bottom sheet. */
export function TravelRulesRow({
  rules,
  onChange,
}: {
  rules: TravelRules;
  onChange: (next: TravelRules) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <MoreRow
        icon="🧳"
        title="Restidsregler"
        subtitle={`Restid ${OUTSIDE_LABEL[rules.outside]}`}
        onClick={() => setOpen(true)}
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Restidsregler"
        subtitle="Ändringen gäller alla dagar, även tidigare."
      >
        <TravelRulesEditor rules={rules} onChange={onChange} />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="pc-press w-full mt-5 py-3.5 rounded-[16px] bg-pc-bg border border-pc-line font-bold text-[14px] text-pc-ink"
        >
          Klar
        </button>
      </Sheet>
    </>
  );
}

/**
 * Rapport → "Restid": total, inside the schedule (already part of the worked time),
 * outside, and the payroll hours on their own line. `travel` is `report.totals.travel`,
 * the same numbers the flex card folds. Renders nothing when there is no travel.
 */
export function TravelReportRow({ travel }: { travel: ReportTotals["travel"] }) {
  if (travel.totalMin <= 0) return null;
  const line = (label: string, value: string, strong = false) => (
    <div className="flex items-center justify-between text-[13px]">
      <span className={strong ? "font-bold" : "font-semibold"}>{label}</span>
      <span
        className={`tabular-nums ${strong ? "font-extrabold text-pc-ink" : "font-medium text-pc-muted"}`}
      >
        {value}
      </span>
    </div>
  );
  return (
    <div data-testid="travel-report-row">
      <Label>Restid</Label>
      <div className="space-y-1.5">
        {line("Totalt", fmtDuration(travel.totalMin))}
        {line("Inom schemat (ingår i arbetstiden)", fmtDuration(travel.inScheduleMin))}
        {line("Utanför schemat", fmtDuration(travel.outsideMin))}
        {line("Till lön", fmtDuration(travel.payrollMin), true)}
        {travel.flexMin > 0 && line("Till flex", fmtDuration(travel.flexMin))}
      </div>
    </div>
  );
}
