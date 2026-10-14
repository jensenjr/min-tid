import { useState } from "react";
import { ABSENCE_META } from "../components/AbsenceModal";
import DaySheet from "../components/DaySheet";
import { StatusChip } from "../components/dayUi";
import { Card, IconLock } from "../components/ui";
import { isMonthLocked } from "../lib/confirm";
import {
  type DayContext,
  type DayEvaluation,
  evaluateDay,
  fmtDuration,
  fmtSignedDuration,
  getAbsencesForDate,
} from "../lib/days";
import { fmtDateShort, monthTitle } from "../lib/format";
import { addDaysStr } from "../lib/schedule";
import { ymdLocal, todayLocal, monthRange } from "../lib/dates";
import type { DayActions } from "./types";

type Mode = "grid" | "list";

/** Monday-first grid cells (local day keys) covering a month. */
function monthCells(year: number, month: number): string[] {
  const first = new Date(year, month, 1);
  const dow = first.getDay();
  const cur = new Date(first);
  cur.setDate(cur.getDate() - (dow === 0 ? 6 : dow - 1));
  const cells: string[] = [];
  do {
    cells.push(ymdLocal(cur));
    cur.setDate(cur.getDate() + 1);
  } while (cells.length < 35 || cur.getMonth() === month);
  while (cells.length % 7 !== 0) {
    cells.push(ymdLocal(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return cells;
}

/** The ring a day gets: red = missing (punch), grey = unconfirmed (schedule). */
function ringClass(status: DayEvaluation["status"]): string {
  if (status === "missing") return "ring-2 ring-red-400";
  if (status === "unconfirmed") return "ring-2 ring-gray-300";
  return "";
}

function dotClass(ev: DayEvaluation, hasFlexAbsence: boolean): string {
  switch (ev.status) {
    case "reported":
      return "bg-green-500";
    case "partial":
      return "bg-amber-400";
    case "absent":
      return hasFlexAbsence ? "bg-pc-orange" : "bg-blue-400";
    case "ongoing":
      return "bg-pc-orange";
    default:
      return "";
  }
}

/**
 * Kalender: a month grid coloured by DayStatus (missing = red ring, unconfirmed = grey
 * ring, locked month = lock icon) and a list mode. Tap a day for the sheet with the
 * entries and the "Så räknades dagen" lines.
 */
export default function Calendar({ ctx, actions }: { ctx: DayContext; actions: DayActions }) {
  const todayS = ctx.today ?? todayLocal();
  const [ym, setYm] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [mode, setMode] = useState<Mode>("grid");
  const [selected, setSelected] = useState<string | null>(null);
  const { year, month } = ym;
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const locked = isMonthLocked(monthKey, ctx);
  const { first, last } = monthRange(monthKey);
  const started = first <= todayS && !!ctx.trackingStartDate && ctx.trackingStartDate <= last;

  const cells = monthCells(year, month);
  const evs = new Map<string, DayEvaluation>();
  for (const d of cells) evs.set(d, evaluateDay(d, ctx, { explain: false }));

  const listDays: string[] = [];
  for (let d = last < todayS ? last : todayS; d >= first; d = addDaysStr(d, -1)) {
    const ev = evs.get(d) ?? evaluateDay(d, ctx, { explain: false });
    const hasEntries = ev.normMin > 0 && getAbsencesForDate(ctx.absences, d).length > 0;
    if (ev.status !== "off" || ev.workedMin > 0 || hasEntries) listDays.push(d);
  }

  function shift(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYm({ year: d.getFullYear(), month: d.getMonth() });
  }

  return (
    <div className="pc-fade pt-2">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-[28px] font-extrabold tracking-tight">Kalender</h1>
        <div className="flex bg-white border border-pc-line rounded-full p-0.5">
          {(["grid", "list"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 rounded-full text-[12px] font-bold transition-colors ${mode === m ? "bg-pc-orange text-white" : "text-pc-muted"}`}
            >
              {m === "grid" ? "Månad" : "Lista"}
            </button>
          ))}
        </div>
      </div>

      <Card className="!p-4">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => shift(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-pc-muted hover:text-pc-ink hover:bg-pc-peach transition-colors text-[22px] font-bold leading-none"
            aria-label="Föregående månad"
          >
            ‹
          </button>
          <div className="font-extrabold text-[16px] flex items-center gap-1.5">
            {monthTitle(monthKey)}
            {locked && (
              <span className="text-amber-600" title="Månaden är låst">
                <IconLock className="w-4 h-4" />
              </span>
            )}
          </div>
          <button
            onClick={() => shift(1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-pc-muted hover:text-pc-ink hover:bg-pc-peach transition-colors text-[22px] font-bold leading-none"
            aria-label="Nästa månad"
          >
            ›
          </button>
        </div>

        {mode === "grid" ? (
          <>
            <div className="grid grid-cols-7 mb-1">
              {["M", "T", "O", "T", "F", "L", "S"].map((d, i) => (
                <div key={i} className="text-center text-[10px] font-bold text-pc-muted py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((dateStr) => {
                const ev = evs.get(dateStr) as DayEvaluation;
                const inMonth = dateStr.slice(0, 7) === monthKey;
                const isToday = dateStr === todayS;
                const abs = ev.normMin > 0 ? getAbsencesForDate(ctx.absences, dateStr) : [];
                const dot = inMonth
                  ? dotClass(
                      ev,
                      abs.some((a) => a.category === "flex"),
                    )
                  : "";
                const showHours =
                  inMonth &&
                  ev.workedMin > 0 &&
                  ev.status !== "unconfirmed" &&
                  ev.status !== "ongoing";
                const wmin = ev.workedMin;
                return (
                  <button
                    key={dateStr}
                    type="button"
                    onClick={() => inMonth && setSelected(dateStr)}
                    aria-label={`${dateStr}${ev.status === "missing" ? ", saknas" : ev.status === "unconfirmed" ? ", ej bekräftad" : ""}`}
                    className={`flex flex-col items-center justify-center rounded-xl py-1.5 relative min-h-[44px] transition-colors ${
                      !inMonth ? "opacity-25 cursor-default" : "cursor-pointer"
                    } ${inMonth ? ringClass(ev.status) : ""} ${
                      isToday && inMonth
                        ? "bg-pc-orange/10"
                        : inMonth && (ev.workedMin > 0 || abs.length > 0)
                          ? "bg-pc-apricot"
                          : ""
                    }`}
                  >
                    <span
                      className="text-[12px] leading-none"
                      style={{
                        fontWeight: isToday ? 800 : 600,
                        color: isToday
                          ? "var(--color-pc-orange, #ff5f00)"
                          : !inMonth
                            ? "#9c7c5c"
                            : "#2d1717",
                      }}
                    >
                      {new Date(dateStr + "T12:00:00").getDate()}
                    </span>
                    {showHours && (
                      <span
                        className="text-pc-muted font-medium leading-none mt-0.5"
                        style={{ fontSize: "9px" }}
                      >
                        {Math.floor(wmin / 60)}h
                        {wmin % 60 > 0 ? String(wmin % 60).padStart(2, "0") : ""}
                      </span>
                    )}
                    {inMonth && abs.length > 0 && ev.workedMin === 0 && (
                      <span className="leading-none mt-0.5" style={{ fontSize: "9px" }}>
                        {ABSENCE_META[abs[0].category].emoji}
                      </span>
                    )}
                    {dot && (
                      <span className={`absolute bottom-0.5 w-1.5 h-1.5 rounded-full ${dot}`} />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 pt-3 border-t border-pc-line">
              {[
                {
                  node: <span className="w-2 h-2 rounded-full bg-green-500" />,
                  label: "Registrerad",
                },
                { node: <span className="w-2 h-2 rounded-full bg-blue-400" />, label: "Frånvaro" },
                {
                  node: <span className="w-3 h-3 rounded-[4px] ring-2 ring-red-400" />,
                  label: "Saknas",
                },
                {
                  node: <span className="w-3 h-3 rounded-[4px] ring-2 ring-gray-300" />,
                  label: "Ej bekräftad",
                },
                {
                  node: (
                    <span className="text-amber-500">
                      <IconLock className="w-3 h-3" />
                    </span>
                  ),
                  label: "Låst månad",
                },
              ].map(({ node, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  {node}
                  <span className="text-pc-muted font-semibold" style={{ fontSize: "10px" }}>
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : listDays.length === 0 ? (
          <div className="text-center text-pc-muted py-12 text-[14px]">
            <div className="text-4xl mb-3 opacity-40">📋</div>
            Inga dagar att visa i {monthTitle(monthKey).toLowerCase()}.
          </div>
        ) : (
          <div className="-mx-1">
            {listDays.map((d) => {
              const ev = evs.get(d) ?? evaluateDay(d, ctx, { explain: false });
              const abs = ev.normMin > 0 ? getAbsencesForDate(ctx.absences, d) : [];
              return (
                <button
                  key={d}
                  onClick={() => setSelected(d)}
                  className="w-full flex items-center gap-2 px-1 py-2.5 border-t border-pc-line first:border-t-0 text-left"
                >
                  <span className="w-[88px] shrink-0 text-[13px] font-bold capitalize">
                    {fmtDateShort(d)}
                  </span>
                  <span className="flex-1 min-w-0 flex items-center gap-1.5">
                    <StatusChip status={ev.status} />
                    {abs.length > 0 && (
                      <span className="text-[13px]">{ABSENCE_META[abs[0].category].emoji}</span>
                    )}
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[13px] font-extrabold tabular-nums">
                      {ev.workedMin > 0 ? fmtDuration(ev.workedMin) : "–"}
                    </span>
                    {ev.flexDelta !== 0 && (
                      <span
                        className={`block text-[10px] font-bold tabular-nums ${ev.flexDelta > 0 ? "text-green-600" : "text-red-500"}`}
                      >
                        {fmtSignedDuration(ev.flexDelta)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {locked ? (
        <div className="rounded-[20px] bg-amber-50 border border-amber-200 p-4 mb-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-800">
            <IconLock className="w-4 h-4 shrink-0" />
            {monthTitle(monthKey)} är bekräftad och låst.
          </div>
          <button
            onClick={() => actions.unlockMonth(monthKey)}
            className="pc-press w-full mt-3 py-2.5 rounded-[14px] bg-white border border-amber-200 text-amber-800 font-bold text-[13px]"
          >
            Lås upp månaden
          </button>
        </div>
      ) : (
        started && (
          <button
            onClick={() => actions.confirmMonth(monthKey)}
            className="pc-press w-full mb-4 py-3.5 rounded-[18px] bg-white border border-pc-line font-bold text-[14px] text-pc-ink"
          >
            Bekräfta {monthTitle(monthKey).split(" ")[0].toLowerCase()}
          </button>
        )
      )}

      <DaySheet
        date={selected}
        ctx={ctx}
        actions={{
          ...actions,
          // Opening another sheet from the day sheet replaces it.
          adjust: (d) => {
            setSelected(null);
            actions.adjust(d);
          },
          absence: (d) => {
            setSelected(null);
            actions.absence(d);
          },
          addTime: (d) => {
            setSelected(null);
            actions.addTime(d);
          },
          editSession: (s) => {
            setSelected(null);
            actions.editSession(s);
          },
          editException: (d) => {
            setSelected(null);
            actions.editException(d);
          },
          unlockMonth: (m) => {
            setSelected(null);
            actions.unlockMonth(m);
          },
        }}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
