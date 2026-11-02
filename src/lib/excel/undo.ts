// "Ångra senaste import": the pre-import snapshot lives in localStorage on this device only
// (never synced, never part of punchclock_v2). One snapshot — the next import replaces it.
// Undo restores the snapshot, which also reverts anything edited after the import; the UI
// says so before the user confirms.
import type { ImportPatch } from "./plan";

export const IMPORT_UNDO_KEY = "punchclock_import_undo";

export type ImportUndo = {
  v: 1;
  at: number; // ms
  summary: string; // "12 pass, 1 frånvaro" — shown on the undo button
  snapshot: ImportPatch;
};

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Returns false when the snapshot could not be stored (quota, private mode). */
export function saveImportUndo(undo: ImportUndo, store: Store | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(IMPORT_UNDO_KEY, JSON.stringify(undo));
    return store.getItem(IMPORT_UNDO_KEY) !== null;
  } catch {
    return false;
  }
}

export function readImportUndo(store: Store | null = defaultStore()): ImportUndo | null {
  if (!store) return null;
  try {
    const raw = store.getItem(IMPORT_UNDO_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as Partial<ImportUndo>;
    const s = u.snapshot;
    if (
      !u ||
      u.v !== 1 ||
      typeof u.at !== "number" ||
      !s ||
      !Array.isArray(s.sessions) ||
      !Array.isArray(s.absences) ||
      !Array.isArray(s.expenses) ||
      typeof s.flexBaseMinutes !== "number"
    ) {
      return null;
    }
    return {
      v: 1,
      at: u.at,
      summary: typeof u.summary === "string" ? u.summary : "",
      snapshot: {
        sessions: s.sessions,
        absences: s.absences,
        expenses: s.expenses,
        confirmedDays:
          s.confirmedDays && typeof s.confirmedDays === "object" ? s.confirmedDays : {},
        trackingStartDate:
          typeof s.trackingStartDate === "string" ? s.trackingStartDate : undefined,
        flexBaseMinutes: s.flexBaseMinutes,
        flexBaseDate: typeof s.flexBaseDate === "string" ? s.flexBaseDate : undefined,
        vacation: s.vacation && typeof s.vacation === "object" ? s.vacation : undefined,
        travel: Array.isArray(s.travel) ? s.travel : undefined,
      },
    };
  } catch {
    return null;
  }
}

export function clearImportUndo(store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(IMPORT_UNDO_KEY);
  } catch {
    /* ignore */
  }
}
