import { useState } from "react";
import { ABSENCE_META } from "../components/AbsenceModal";
import DaySheet from "../components/DaySheet";
import { StatusChip } from "../components/dayUi";
import { Card, IconLock, Sheet } from "../components/ui";
import type { BulkStatus } from "../lib/bulk";
import { isDayLocked, isMonthLocked, monthReview } from "../lib/confirm";
import {
  type DayContext,
  type DayEvaluation,
  evaluateDay,
  fmtDuration,
  fmtSignedDuration,
  getAbsencesForDate,
} from "../lib/days";
import { fmtDateShort, monthName, monthTitle } from "../lib/format";
import { addDaysStr } from "../lib/schedule";
import { ymdLocal, todayLocal, monthRange } from "../lib/dates";
import type { AbsenceCategory } from "../lib/types";
import type { DayActions } from "./types";

type Mode = "grid" | "list";

/** The quick buttons in the "Välj dagar" bar; everything else is under "Mer…". */
const QUICK_ABSENCES: AbsenceCategory[] = ["sjuk", "vab", "semester", "flex"];

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

/**
 * evaluateDay reads a day before the flex start (or inside an imported opening balance) as
 * "off" but still reports the schedule's hours as workedMin. Nothing was registered there, so
 * the calendar shows no hours and no list row for it (a new user would otherwise see a month
 * of "Ledig · 8 h" before the day they started).
 */
function forCalendar(ev: DayEvaluation): DayEvaluation {
  return ev.status === "off" && ev.workedMin > 0 ? { ...ev, workedMin: 0 } : ev;
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

const dagar = (n: number) => `${n} ${n === 1 ? "dag" : "dagar"}`;

/**
 * Kalender: a month grid coloured by DayStatus (missing = red ring, unconfirmed = grey
 * ring, locked month = lock icon) and a list mode. Tap a day for the sheet with the
 * entries and the "Så räknades dagen" lines.
 *
 * "Välj" switches to selecting: tap several days (in the grid or the list, across
 * months), then set one status on all of them (OK, Sjuk, VAB, Semester, …) through
 * `actions.bulkStatus`. The month can only be locked once every past day has a status,
 * so the review card shows how far the user has come.
 */
export default function Calendar({
  ctx,
  actions,
  initialMonth,
  initialSelect = false,
}: {
  ctx: DayContext;
  actions: DayActions;
  /** "YYYY-MM" to open on (default: the current month). */
  initialMonth?: string;
  /** Open in "Välj dagar" mode (from "Gå igenom månaden"). */
  initialSelect?: boolean;
}) {
  const todayS = ctx.today ?? todayLocal();
  const [ym, setYm] = useState(() => {
    if (initialMonth) {
      const [y, m] = initialMonth.split("-").map(Number);
      return { year: y, month: m - 1 };
    }
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [mode, setMode] = useState<Mode>("grid");
  const [selected, setSelected] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(initialSelect);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [moreOpen, setMoreOpen] = useState(false);
  const { year, month } = ym;
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const locked = isMonthLocked(monthKey, ctx);
  const { first, last } = monthRange(monthKey);
  const started = first <= todayS && !!ctx.trackingStartDate && ctx.trackingStartDate <= last;
  const review = started && !locked ? monthReview(monthKey, ctx) : null;
  const punch = ctx.reportingMode === "punch";

  const cells = monthCells(year, month);
  const evs = new Map<string, DayEvaluation>();
  for (const d of cells) evs.set(d, forCalendar(evaluateDay(d, ctx, { explain: false })));
  const evOf = (d: string) => evs.get(d) ?? forCalendar(evaluateDay(d, ctx, { explain: false }));

  const listDays: string[] = [];
  if (selecting) {
    // Selecting: every day of the month, oldest first, so future days can be planned too.
    for (let d = first; d <= last; d = addDaysStr(d, 1)) listDays.push(d);
  } else {
    for (let d = last < todayS ? last : todayS; d >= first; d = addDaysStr(d, -1)) {
      const ev = evOf(d);
      const hasEntries = ev.normMin > 0 && getAbsencesForDate(ctx.absences, d).length > 0;
      if (ev.status !== "off" || ev.workedMin > 0 || hasEntries) listDays.push(d);
    }
  }

  function shift(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYm({ year: d.getFullYear(), month: d.getMonth() });
  }

  function toggle(d: string) {
    if (isDayLocked(d, ctx)) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  /** Select every unlocked day between the first and the last selected day. */
  function fillPeriod() {
    const sorted = [...picked].sort();
    if (sorted.length < 2) return;
    const next = new Set(picked);
    const end = sorted[sorted.length - 1];
    for (let d = sorted[0], n = 0; d <= end && n < 400; d = addDaysStr(d, 1), n++) {
      if (!isDayLocked(d, ctx)) next.add(d);
    }
    setPicked(next);
  }

  function startSelecting() {
    setSelected(null);
    setSelecting(true);
  }

  function stopSelecting() {
    setSelecting(false);
    setPicked(new Set());
    setMoreOpen(false);
  }

  function apply(status: BulkStatus) {
    actions.bulkStatus([...picked].sort(), status);
    setPicked(new Set());
    setMoreOpen(false);
  }

  function onDayTap(d: string) {
    if (selecting) toggle(d);
    else setSelected(d);
  }

  const n = picked.size;
  const pickedSorted = [...picked].sort();
  const pickedSpan =
    n === 0
      ? ""
      : n === 1
        ? fmtDateShort(pickedSorted[0])
        : `${fmtDateShort(pickedSorted[0])} – ${fmtDateShort(pickedSorted[n - 1])}`;

  return (
    <div className="pc-fade pt-2">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h1 className="text-[28px] font-extrabold tracking-tight">Kalender</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={selecting ? stopSelecting : startSelecting}
            aria-pressed={selecting}
            className={`pc-press px-3.5 py-1.5 rounded-full text-[12px] font-bold border transition-colors ${
              selecting
                ? "bg-pc-orange text-white border-pc-orange"
                : "bg-pc-surface border-pc-line text-pc-ink"
            }`}
          >
            {selecting ? "Klar" : "Välj"}
          </button>
          <div className="flex bg-pc-surface border border-pc-line rounded-full p-0.5">
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
      </div>

      {/* From lg the month gets the main column and the review card / selection bar a
          narrow side column, so the grid is not stretched across the whole width. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-5 lg:items-start">
        <div className="contents lg:block lg:min-w-0">
          {selecting && (
            <div className="text-[13px] text-pc-muted font-medium leading-snug mb-3 -mt-1 lg:hidden">
              Tryck på dagarna du vill markera och välj sedan status. Välj första och sista dagen
              och tryck <span className="font-bold text-pc-ink">Fyll period</span> för en längre
              frånvaro. Låsta dagar går inte att välja.
            </div>
          )}

          <Card className="!p-4">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => shift(-1)}
                className="w-9 h-9 flex items-center justify-center rounded-xl text-pc-muted hover:text-pc-ink hover:bg-pc-peach transition-colors text-[22px] font-bold leading-none"
                aria-label="Föregående månad"
              >
                ‹
              </button>
              <div className="font-extrabold text-[16px] md:text-[18px] flex items-center gap-1.5">
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
                  {["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"].map((d) => (
                    <div
                      key={d}
                      className="text-center text-[10px] md:text-[12px] font-bold text-pc-muted py-1 md:py-1.5"
                    >
                      <span className="md:hidden">{d[0]}</span>
                      <span className="hidden md:inline">{d}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1 md:gap-1.5">
                  {cells.map((dateStr) => {
                    const ev = evs.get(dateStr) as DayEvaluation;
                    const inMonth = dateStr.slice(0, 7) === monthKey;
                    const isToday = dateStr === todayS;
                    const isPicked = picked.has(dateStr);
                    const dayLocked = selecting && isDayLocked(dateStr, ctx);
                    const tappable = inMonth && !dayLocked;
                    const abs = ev.normMin > 0 ? getAbsencesForDate(ctx.absences, dateStr) : [];
                    const dot =
                      inMonth && !isPicked
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
                        onClick={() => tappable && onDayTap(dateStr)}
                        aria-pressed={selecting && inMonth ? isPicked : undefined}
                        aria-label={`${dateStr}${ev.status === "missing" ? ", saknas" : ev.status === "unconfirmed" ? ", ej bekräftad" : ""}${isPicked ? ", vald" : ""}`}
                        className={`pc-cal-cell flex flex-col items-center justify-center rounded-xl md:rounded-2xl py-1.5 relative transition-colors ${
                          !inMonth
                            ? "opacity-25 cursor-default"
                            : dayLocked
                              ? "opacity-40 cursor-not-allowed"
                              : "cursor-pointer"
                        } ${inMonth && !isPicked ? ringClass(ev.status) : ""} ${
                          isPicked
                            ? "bg-pc-orange shadow-[0_4px_12px_-4px_rgb(var(--pc-orange-rgb)/0.55)]"
                            : isToday && inMonth
                              ? "bg-pc-orange/10"
                              : inMonth && (ev.workedMin > 0 || abs.length > 0)
                                ? "bg-pc-apricot"
                                : ""
                        }`}
                      >
                        <span
                          className="text-[12px] md:text-[15px] lg:text-[17px] leading-none"
                          style={{
                            fontWeight: isToday || isPicked ? 800 : 600,
                            color: isPicked
                              ? "#fff"
                              : isToday
                                ? "var(--color-pc-orange, var(--pc-orange))"
                                : !inMonth
                                  ? "var(--pc-taupe)"
                                  : "var(--pc-ink)",
                          }}
                        >
                          {new Date(dateStr + "T12:00:00").getDate()}
                        </span>
                        {showHours && (
                          <span
                            className={`text-[9px] md:text-[11px] lg:text-[12px] font-medium leading-none mt-0.5 md:mt-1 ${isPicked ? "text-white/85" : "text-pc-muted"}`}
                          >
                            {Math.floor(wmin / 60)}h
                            {wmin % 60 > 0 ? String(wmin % 60).padStart(2, "0") : ""}
                          </span>
                        )}
                        {inMonth && abs.length > 0 && ev.workedMin === 0 && (
                          <span className="text-[9px] md:text-[13px] lg:text-[15px] leading-none mt-0.5 md:mt-1">
                            {ABSENCE_META[abs[0].category].emoji}
                          </span>
                        )}
                        {dot && (
                          <span
                            className={`absolute bottom-0.5 md:bottom-1.5 w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${dot}`}
                          />
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
                    {
                      node: <span className="w-2 h-2 rounded-full bg-blue-400" />,
                      label: "Frånvaro",
                    },
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
                  const ev = evOf(d);
                  const abs = ev.normMin > 0 ? getAbsencesForDate(ctx.absences, d) : [];
                  const isPicked = picked.has(d);
                  const dayLocked = selecting && isDayLocked(d, ctx);
                  const quiet = selecting && ev.status === "off" && ev.workedMin === 0;
                  return (
                    <button
                      key={d}
                      onClick={() => !dayLocked && onDayTap(d)}
                      aria-pressed={selecting ? isPicked : undefined}
                      className={`w-full flex items-center gap-2 px-1 py-2.5 border-t border-pc-line first:border-t-0 text-left ${
                        dayLocked ? "opacity-40 cursor-not-allowed" : quiet ? "opacity-60" : ""
                      }`}
                    >
                      {selecting && (
                        <span
                          className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center text-[11px] font-extrabold ${
                            isPicked
                              ? "bg-pc-orange border-pc-orange text-white"
                              : "border-pc-line-strong text-transparent"
                          }`}
                          aria-hidden
                        >
                          ✓
                        </span>
                      )}
                      <span className="w-[88px] shrink-0 text-[13px] font-bold capitalize">
                        {fmtDateShort(d)}
                      </span>
                      <span className="flex-1 min-w-0 flex items-center gap-1.5">
                        {!quiet && <StatusChip status={ev.status} />}
                        {quiet && (
                          <span className="text-[12px] text-pc-muted font-semibold">Ledig</span>
                        )}
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
        </div>

        <div className="contents lg:sticky lg:top-2 lg:flex lg:flex-col">
          {locked ? (
            <div className="rounded-[20px] bg-amber-50 border border-amber-200 p-4 mb-4">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-800">
                <IconLock className="w-4 h-4 shrink-0" />
                {monthTitle(monthKey)} är bekräftad och låst.
              </div>
              <button
                onClick={() => actions.unlockMonth(monthKey)}
                className="pc-press w-full mt-3 py-2.5 rounded-[14px] bg-pc-surface border border-amber-200 text-amber-800 font-bold text-[13px]"
              >
                Lås upp månaden
              </button>
            </div>
          ) : (
            review && (
              <Card className="!p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <div className="text-[14px] font-extrabold">
                    Genomgång av {monthName(monthKey)}
                  </div>
                  <div className="text-[13px] font-extrabold tabular-nums">
                    {review.reviewed} av {review.total}
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-pc-line overflow-hidden mb-2.5">
                  <div
                    className="h-full rounded-full bg-green-500 transition-[width]"
                    style={{
                      width: `${review.total === 0 ? 100 : Math.round((review.reviewed / review.total) * 100)}%`,
                    }}
                  />
                </div>
                <div className="text-[12px] text-pc-muted font-medium leading-snug">
                  {review.open.length > 0
                    ? `${dagar(review.open.length)} ${punch ? "saknas" : review.open.length === 1 ? "är inte genomgången" : "är inte genomgångna"}. Markera ${review.open.length === 1 ? "den" : "dem"} innan du låser månaden.`
                    : review.total === 0
                      ? "Inga dagar att gå igenom ännu."
                      : "Alla dagar hittills är genomgångna. Du kan bekräfta och låsa månaden."}
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <button
                    onClick={selecting ? stopSelecting : startSelecting}
                    className="pc-press py-3 rounded-[14px] bg-pc-surface border border-pc-line font-bold text-[13px] text-pc-ink"
                  >
                    {selecting ? "Klar" : "Välj dagar"}
                  </button>
                  <button
                    onClick={() => actions.confirmMonth(monthKey)}
                    disabled={review.open.length > 0}
                    className="pc-press py-3 rounded-[14px] bg-pc-orange text-white font-bold text-[13px] disabled:opacity-40"
                  >
                    Bekräfta {monthName(monthKey)}
                  </button>
                </div>
              </Card>
            )
          )}

          {selecting && (
            <div className="sticky bottom-0 z-10 pb-3 pt-1 lg:static lg:order-first lg:pt-0">
              <div className="bg-pc-surface border border-pc-line rounded-[22px] p-3 shadow-[0_10px_30px_-10px_rgba(45,23,23,0.35)]">
                <div className="flex items-center justify-between gap-2 mb-2.5 min-h-[20px]">
                  <div className="min-w-0">
                    <div className="text-[13px] font-extrabold">
                      {n === 0 ? "Inga dagar valda" : `${dagar(n)} valda`}
                    </div>
                    {n > 0 ? (
                      <div className="text-[11px] text-pc-muted font-semibold truncate first-letter:uppercase">
                        {pickedSpan}
                      </div>
                    ) : (
                      // From lg the hint above the month moves here, so the grid keeps its height.
                      <div className="hidden lg:block text-[11px] text-pc-muted font-medium leading-snug mt-0.5">
                        Tryck på dagar i kalendern. Välj första och sista dagen och tryck Fyll
                        period för en längre frånvaro.
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3 shrink-0">
                    {n >= 2 && (
                      <button onClick={fillPeriod} className="text-[12px] font-bold text-pc-orange">
                        Fyll period
                      </button>
                    )}
                    {n > 0 && (
                      <button
                        onClick={() => setPicked(new Set())}
                        className="text-[12px] font-bold text-pc-muted"
                      >
                        Avmarkera
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 min-[480px]:grid-cols-6 lg:grid-cols-3 gap-1.5">
                  <BulkButton
                    emoji="✓"
                    label="OK"
                    disabled={n === 0}
                    onClick={() => apply({ kind: "ok" })}
                  />
                  {QUICK_ABSENCES.map((c) => (
                    <BulkButton
                      key={c}
                      emoji={ABSENCE_META[c].emoji}
                      label={ABSENCE_META[c].label}
                      disabled={n === 0}
                      onClick={() => apply({ kind: "absence", category: c })}
                    />
                  ))}
                  <BulkButton
                    emoji="⋯"
                    label="Mer"
                    disabled={n === 0}
                    onClick={() => setMoreOpen(true)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Sheet
        open={moreOpen && n > 0}
        onClose={() => setMoreOpen(false)}
        title={`Sätt status på ${dagar(n)}`}
        subtitle="Statusen ersätter frånvaro och bekräftelser på dagarna. Inlagd tid och justeringar ändras inte. Lediga dagar mellan valda dagar blir en sammanhängande period."
      >
        <button
          onClick={() => apply({ kind: "ok" })}
          className="pc-press w-full mb-3 py-3 rounded-[14px] bg-green-50 border border-green-200 text-green-700 font-bold text-[14px]"
        >
          ✓ OK – arbetat enligt schema
        </button>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {(Object.keys(ABSENCE_META) as AbsenceCategory[]).map((c) => (
            <button
              key={c}
              onClick={() => apply({ kind: "absence", category: c })}
              className="pc-press py-2.5 px-2 rounded-[14px] text-[12px] font-bold border bg-pc-apricot border-pc-line text-pc-ink flex flex-col items-center gap-1"
            >
              <span className="text-[18px] leading-none">{ABSENCE_META[c].emoji}</span>
              <span className="leading-tight text-center">{ABSENCE_META[c].label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => apply({ kind: "clear" })}
          className="pc-press w-full py-3 rounded-[14px] bg-pc-surface border border-pc-line text-red-500 font-bold text-[14px]"
        >
          Ta bort status
        </button>
      </Sheet>

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

function BulkButton({
  emoji,
  label,
  disabled,
  onClick,
}: {
  emoji: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="pc-press py-2 rounded-[14px] border bg-pc-apricot border-pc-line text-pc-ink flex flex-col items-center gap-0.5 disabled:opacity-40"
    >
      <span className="text-[16px] leading-none font-extrabold">{emoji}</span>
      <span className="text-[10px] min-[400px]:text-[11px] font-bold leading-tight max-w-full truncate px-0.5">
        {label}
      </span>
    </button>
  );
}
