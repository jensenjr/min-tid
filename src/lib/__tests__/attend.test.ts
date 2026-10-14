import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE, getEffectiveDayConfig } from "../schedule";
import type { DayContext } from "../days";
import { buildAttend, buildMonthPrompt, lateThresholdMs } from "../attend";
import { confirmMonth } from "../confirm";
import type { ExpenseEntry } from "../types";
import { at, session } from "./helpers";

const START = "2026-10-01";

function ctx(today: string, over: Partial<DayContext> = {}): DayContext {
  return {
    sessions: [],
    absences: [],
    schedule: DEFAULT_SCHEDULE,
    exceptions: {},
    reportingMode: "schedule",
    trackingStartDate: START,
    today,
    now: at(today, "18:00"),
    ...over,
  };
}

const cfgFor = (d: string) => getEffectiveDayConfig(d, DEFAULT_SCHEDULE, {});

function expense(date: string, hasReceipt: boolean): ExpenseEntry {
  return {
    id: `e-${date}-${hasReceipt}`,
    category: "parkering",
    date,
    hasReceipt,
    amount: 50,
    manual: true,
  };
}

function attend(c: DayContext, expenses: ExpenseEntry[] = []) {
  return buildAttend({
    ctx: c,
    expenses,
    cfgFor,
    today: c.today as string,
    now: c.now as number,
  });
}

describe("buildAttend — days", () => {
  it("schedule mode lists unconfirmed days newest first (today after the shift counts)", () => {
    const r = attend(ctx("2026-10-07"));
    expect(r.dayKind).toBe("schedule");
    expect(r.days).toEqual(["2026-10-07", "2026-10-06", "2026-10-05", "2026-10-02", "2026-10-01"]);
  });

  it("punch mode lists missing days, not unconfirmed ones", () => {
    const r = attend(
      ctx("2026-10-07", {
        reportingMode: "punch",
        sessions: [session("2026-10-05", "08:00", "17:00")],
      }),
    );
    expect(r.dayKind).toBe("punch");
    expect(r.days).toEqual(["2026-10-07", "2026-10-06", "2026-10-02", "2026-10-01"]);
  });

  it("a confirmed day and a weekend are not listed", () => {
    const r = attend(ctx("2026-10-07", { confirmedDays: { "2026-10-06": true } }));
    expect(r.days).not.toContain("2026-10-06");
    expect(r.days).not.toContain("2026-10-03");
    expect(r.days).not.toContain("2026-10-04");
  });

  it("is empty before tracking starts and for a user with nothing to do", () => {
    const r = attend(ctx("2026-10-07", { trackingStartDate: undefined }));
    expect(r.days).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("copes with dozens of missing days (the caller groups them)", () => {
    const r = attend(
      ctx("2026-10-28", {
        reportingMode: "punch",
        trackingStartDate: "2026-08-03",
        sessions: [session("2026-08-03", "08:00", "17:00")],
      }),
    );
    expect(r.days.length).toBeGreaterThan(40);
    expect(r.days[0]).toBe("2026-10-28");
  });
});

describe("buildAttend — receipts and long sessions", () => {
  it("lists receipts to attach from unlocked months, newest first", () => {
    const e = [
      expense("2026-10-02", true),
      expense("2026-10-05", true),
      expense("2026-10-06", false),
      expense("2026-09-10", true),
    ];
    const locked = { "2026-09": { at: 1, by: "x" } };
    const r = attend(ctx("2026-10-07", { lockedMonths: locked }), e);
    expect(r.receipts.map((x) => x.date)).toEqual(["2026-10-05", "2026-10-02"]);
  });

  it("stops listing receipts older than the lookback", () => {
    const r = attend(ctx("2026-10-07"), [expense("2026-06-01", true)]);
    expect(r.receipts).toEqual([]);
  });

  it("flags an open session that ran far past the shift", () => {
    const open = session("2026-10-06", "08:00", null);
    const r = attend(ctx("2026-10-07", { sessions: [open] }));
    expect(r.longSessions).toHaveLength(1);
    expect(r.longSessions[0].session.id).toBe(open.id);
    expect(r.longSessions[0].elapsedMin).toBeGreaterThan(24 * 60);
  });

  it("does not flag a normal open session today", () => {
    const open = session("2026-10-07", "08:00", null);
    const r = attend(ctx("2026-10-07", { sessions: [open], now: at("2026-10-07", "12:00") }));
    expect(r.longSessions).toEqual([]);
  });

  it("lateThresholdMs is the shift + 4 h with a 10 h floor", () => {
    expect(lateThresholdMs(cfgFor("2026-10-06"))).toBe(13 * 3600_000); // 9 h shift + 4 h
    expect(lateThresholdMs(cfgFor("2026-10-04"))).toBe(10 * 3600_000); // day off → floor
  });
});

describe("buildMonthPrompt — from the 25th", () => {
  it("is absent before the 25th and present from it", () => {
    expect(buildMonthPrompt(ctx("2026-10-24"), "2026-10-24")).toBeNull();
    const p = buildMonthPrompt(ctx("2026-10-25"), "2026-10-25");
    expect(p?.month).toBe("2026-10");
    expect(p?.ready).toBe(true);
    expect(p?.unconfirmedCount).toBeGreaterThan(0);
  });

  it("is not ready while punch-mode days are missing", () => {
    const c = ctx("2026-10-26", { reportingMode: "punch" });
    const p = buildMonthPrompt(c, "2026-10-26");
    expect(p?.ready).toBe(false);
    expect(p?.missingDays.length).toBeGreaterThan(0);
  });

  it("disappears once the month is locked, and for a user without a start date", () => {
    const c = ctx("2026-10-27");
    const res = confirmMonth("2026-10", c, { at: 1, by: "Anna" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const locked = ctx("2026-10-27", {
      confirmedDays: res.confirmedDays,
      lockedMonths: res.lockedMonths,
    });
    expect(buildMonthPrompt(locked, "2026-10-27")).toBeNull();
    expect(
      buildMonthPrompt(ctx("2026-10-27", { trackingStartDate: undefined }), "2026-10-27"),
    ).toBe(null);
  });

  it("counts as one attention item in the total", () => {
    const r = attend(ctx("2026-10-26", { confirmedDays: {} }));
    expect(r.monthPrompt).not.toBeNull();
    expect(r.total).toBe(r.days.length + 1);
  });
});
