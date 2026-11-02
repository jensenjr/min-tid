import { describe, expect, it } from "vitest";
import { buildReportSheets, buildReportWorkbook, type ExportState } from "../export";
import { buildTravelExport } from "../travelExport";
import { parseWorkbook } from "../parse";
import { applyImportPlan, buildImportPlan, snapshotOf, type ImportableState } from "../plan";
import { readImportUndo, saveImportUndo } from "../undo";
import { getEffectiveDayConfig, migrateSchedules } from "../../schedule";
import { DEFAULT_TRAVEL_RULES, type TravelEntry, type TravelRules } from "../../travel";

const schedules = migrateSchedules({});
const START = "2026-03-02";
const END = "2026-03-13";
const TODAY = "2026-03-13";
const cfgFor = (d: string) => getEffectiveDayConfig(d, schedules, {});
const rules = (over: Partial<TravelRules> = {}): TravelRules => ({
  ...DEFAULT_TRAVEL_RULES,
  ...over,
});
const trips: TravelEntry[] = [
  {
    id: "t1",
    date: "2026-03-11",
    from: "16:00",
    to: "19:00",
    destination: "Göteborg",
    note: "kundmöte",
  },
  { id: "t2", date: "2026-03-10", from: "07:00", to: "08:30" },
];
const state: ExportState = {
  name: "Anna",
  schedules,
  scheduleExceptions: {},
  reportingMode: "schedule",
  trackingStartDate: START,
  sessions: [],
  absences: [],
  expenses: [],
};
const empty = (over: Partial<ImportableState> = {}): ImportableState => ({
  sessions: [],
  absences: [],
  expenses: [],
  confirmedDays: {},
  lockedMonths: {},
  trackingStartDate: undefined,
  flexBaseMinutes: 0,
  flexBaseDate: undefined,
  vacation: undefined,
  travel: [],
  ...over,
});

describe("Restid in the Excel export", () => {
  const te = buildTravelExport(trips, rules(), cfgFor, START, END);
  const sheets = buildReportSheets(state, START, END, {
    today: TODAY,
    now: new Date(`${TODAY}T12:00:00`).getTime(),
    ...te,
  });
  const restid = sheets.find((s) => s.name === "Restid")!;

  it("adds a Restid sheet before Saldon with the agreed columns, sorted by date", () => {
    const names = sheets.map((s) => s.name);
    expect(names.indexOf("Restid")).toBeGreaterThan(names.indexOf("Utlägg"));
    expect(names.indexOf("Restid")).toBeLessThan(names.indexOf("Saldon"));
    expect(restid.rows[0]).toEqual([
      "Datum",
      "Från",
      "Till",
      "Resmål",
      "Inom schema (h)",
      "Utanför schema (h)",
      "Till lön (h)",
      "Till flex (h)",
      "Kommentar",
    ]);
    expect(restid.rows).toHaveLength(3);
    // 03-10 first: 07:00–08:30 = 1 h outside + 0.5 h inside; 03-11: 16–19 = 1 h inside + 2 h outside
    expect(restid.rows[1].slice(4, 8)).toEqual([0.5, 1, 1, 0]);
    expect(restid.rows[2][3]).toBe("Göteborg");
    expect(restid.rows[2].slice(4, 8)).toEqual([1, 2, 2, 0]);
    expect(restid.rows[2][8]).toBe("kundmöte");
  });

  it("puts payroll hours in the summary", () => {
    const rowsOf = sheets[0].rows;
    const get = (label: string) => rowsOf.find((r) => r[0] === label)?.[1];
    expect(get("Restid totalt (h)")).toBe(4.5);
    expect(get("Restid inom schema (h)")).toBe(1.5);
    expect(get("Restid utanför schema (h)")).toBe(3);
    expect(get("Restid till lön (h)")).toBe(3);
    expect(get("Restid till flex (h)")).toBe(0);
  });

  it("makes no sheet or summary line when the period has no trips", () => {
    const none = buildTravelExport(trips, rules(), cfgFor, "2026-02-01", "2026-02-28");
    expect(none.extraSheets).toEqual([]);
    expect(none.extraSummary).toEqual([]);
  });

  it("applies the per-day cap in the summary and says so in Kommentar", () => {
    const capped = buildTravelExport(trips, rules({ maxPerDayMin: 60 }), cfgFor, START, END);
    expect(capped.extraSummary.find((l) => l[0] === "Restid till lön (h)")?.[1]).toBe(2);
    expect(String(capped.extraSheets[0].rows[2][8])).toContain("Maxgräns per dag");
  });

  it("flex-routed trips are shown in the flex column and the summary", () => {
    const f = buildTravelExport(trips, rules({ outside: "flex" }), cfgFor, START, END);
    expect(f.extraSheets[0].rows[2].slice(6, 8)).toEqual([0, 2]);
    expect(f.extraSummary.find((l) => l[0] === "Restid till flex (h)")?.[1]).toBe(3);
  });

  it("keeps an imported duration-only trip (no times) in the sheet", () => {
    const imp: TravelEntry = { id: "i", date: "2026-03-09", durationMin: 90, imported: true };
    const r = buildTravelExport([imp], rules(), cfgFor, START, END).extraSheets[0].rows[1];
    expect(r[1]).toBeNull();
    expect(r[5]).toBe(1.5);
    expect(String(r[8])).toContain("Importerad");
  });
});

describe("Restid round trip: export → import", () => {
  it("a trip written by the export is read back by the importer", async () => {
    const te = buildTravelExport(trips, rules(), cfgFor, START, END);
    const bytes = await buildReportWorkbook(state, START, END, {
      today: TODAY,
      now: new Date(`${TODAY}T12:00:00`).getTime(),
      ...te,
    });
    const parsed = await parseWorkbook(bytes);
    expect(parsed.errors.filter((e) => e.sheet === "Restid")).toEqual([]);
    expect(parsed.travel).toEqual([
      { date: "2026-03-10", from: "07:00", to: "08:30" },
      { date: "2026-03-11", from: "16:00", to: "19:00", destination: "Göteborg", note: "kundmöte" },
    ]);

    // Into an empty app: UI-style entries with fresh ids and the trackingStartDate moved.
    const plan = buildImportPlan(parsed, empty(), TODAY);
    expect(plan.travel).toHaveLength(2);
    const patch = applyImportPlan(plan, empty());
    expect(patch.travel).toHaveLength(2);
    const [a, b] = patch.travel as TravelEntry[];
    expect(a).toMatchObject({ date: "2026-03-10", from: "07:00", to: "08:30" });
    expect(b).toMatchObject({ date: "2026-03-11", destination: "Göteborg", note: "kundmöte" });
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
    expect(a.imported).toBeUndefined();
    expect(plan.trackingStartDate).toBe("2026-03-10");

    // Importing the same file again adds nothing (dedupe on date + Från).
    const again = buildImportPlan(parsed, empty({ travel: patch.travel }), TODAY);
    expect(again.travel).toEqual([]);
    expect(again.duplicates.filter((d) => d.sheet === "Restid")).toHaveLength(2);
    expect(applyImportPlan(again, empty({ travel: patch.travel })).travel).toHaveLength(2);
  });
});

describe("Restid in the import plan and undo", () => {
  it("adds to existing travel, keeps it in the undo snapshot and restores it", async () => {
    const existing: TravelEntry[] = [
      { id: "keep", date: "2026-03-02", from: "10:00", to: "11:00" },
    ];
    const te = buildTravelExport(trips, rules(), cfgFor, START, END);
    const bytes = await buildReportWorkbook(state, START, END, {
      today: TODAY,
      now: new Date(`${TODAY}T12:00:00`).getTime(),
      ...te,
    });
    const st = empty({ travel: existing });
    const patch = applyImportPlan(buildImportPlan(await parseWorkbook(bytes), st, TODAY), st);
    expect(patch.travel).toHaveLength(3);
    expect(patch.travel?.[0]).toEqual(existing[0]);

    const snap = snapshotOf(st);
    expect(snap.travel).toEqual(existing);
    const store = new Map<string, string>();
    const mem = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    expect(saveImportUndo({ v: 1, at: 1, summary: "2 restider", snapshot: snap }, mem)).toBe(true);
    expect(readImportUndo(mem)?.snapshot.travel).toEqual(existing);
  });

  it("a locked month turns the Restid row into an error", async () => {
    const te = buildTravelExport(trips, rules(), cfgFor, START, END);
    const bytes = await buildReportWorkbook(state, START, END, {
      today: TODAY,
      now: new Date(`${TODAY}T12:00:00`).getTime(),
      ...te,
    });
    const st = empty({ lockedMonths: { "2026-03": { at: 1, by: "t" } } });
    const plan = buildImportPlan(await parseWorkbook(bytes), st, TODAY);
    expect(plan.travel).toEqual([]);
    expect(plan.errors.filter((e) => e.sheet === "Restid")).toHaveLength(2);
  });
});
