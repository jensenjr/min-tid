import { describe, expect, it } from "vitest";
import {
  IMPORT_UNDO_KEY,
  type ImportUndo,
  clearImportUndo,
  readImportUndo,
  saveImportUndo,
} from "../undo";

function fakeStore(opts: { failWrites?: boolean } = {}) {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.failWrites) throw new DOMException("full", "QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
  };
}

const undo: ImportUndo = {
  v: 1,
  at: 1_700_000_000_000,
  summary: "4 pass",
  snapshot: {
    sessions: [{ id: "s", checkIn: 1, checkOut: 2, manual: true }],
    absences: [],
    expenses: [],
    confirmedDays: { "2026-03-02": true },
    trackingStartDate: "2026-01-05",
    flexBaseMinutes: 60,
    flexBaseDate: undefined,
    vacation: undefined,
  },
};

describe("import undo snapshot", () => {
  it("round-trips through the device-local key", () => {
    const store = fakeStore();
    expect(saveImportUndo(undo, store)).toBe(true);
    expect(store.m.has("punchclock_import_undo")).toBe(true);
    expect(IMPORT_UNDO_KEY).toBe("punchclock_import_undo");
    expect(readImportUndo(store)).toEqual(undo);
  });

  it("a second import replaces the first snapshot", () => {
    const store = fakeStore();
    saveImportUndo(undo, store);
    saveImportUndo({ ...undo, summary: "andra" }, store);
    expect(readImportUndo(store)?.summary).toBe("andra");
  });

  it("reports a failed write, so the import can be refused", () => {
    expect(saveImportUndo(undo, fakeStore({ failWrites: true }))).toBe(false);
    expect(saveImportUndo(undo, null)).toBe(false);
  });

  it("ignores corrupt or foreign data", () => {
    const store = fakeStore();
    store.m.set(IMPORT_UNDO_KEY, "{not json");
    expect(readImportUndo(store)).toBeNull();
    store.m.set(IMPORT_UNDO_KEY, JSON.stringify({ v: 2 }));
    expect(readImportUndo(store)).toBeNull();
    store.m.set(IMPORT_UNDO_KEY, JSON.stringify({ v: 1, at: 1, snapshot: { sessions: 3 } }));
    expect(readImportUndo(store)).toBeNull();
  });

  it("clear removes it", () => {
    const store = fakeStore();
    saveImportUndo(undo, store);
    clearImportUndo(store);
    expect(readImportUndo(store)).toBeNull();
  });
});
