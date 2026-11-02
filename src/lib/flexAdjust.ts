// Manual flex adjustments ("Justera saldo" in the flex sheet): a dated ± amount with a
// note, for flex that was taken out some other way (paid overtime, a deal with the
// manager, a correction). Not tied to the schedule or to a day's hours: computeFlex adds
// the ones inside its range (never future ones), buildReport lists them, and the flex
// sheet shows them as their own history. Pure.
import { isYmd } from "./dates";
import type { FlexAdjustment } from "./types";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Oldest first; same day by creation time. */
function byDate(a: FlexAdjustment, b: FlexAdjustment): number {
  return a.date.localeCompare(b.date) || a.at - b.at;
}

/** Validate stored or synced adjustments (untrusted). */
export function parseFlexAdjustments(raw: unknown): FlexAdjustment[] {
  if (!Array.isArray(raw)) return [];
  const out: FlexAdjustment[] = [];
  for (const e of raw) {
    if (!isPlainObject(e)) continue;
    if (typeof e.id !== "string" || !e.id || !isYmd(e.date)) continue;
    if (typeof e.minutes !== "number" || !Number.isFinite(e.minutes) || e.minutes === 0) continue;
    const adj: FlexAdjustment = {
      id: e.id,
      date: e.date,
      minutes: Math.round(e.minutes),
      at: typeof e.at === "number" && Number.isFinite(e.at) ? e.at : 0,
    };
    if (typeof e.note === "string" && e.note.trim()) adj.note = e.note.trim();
    out.push(adj);
  }
  return out.sort(byDate);
}

/** Dirty-device sync merge: union by id, the local copy wins. */
export function mergeFlexAdjustments(server: unknown, local: unknown): FlexAdjustment[] {
  const byId = new Map<string, FlexAdjustment>();
  for (const e of parseFlexAdjustments(server)) byId.set(e.id, e);
  for (const e of parseFlexAdjustments(local)) byId.set(e.id, e);
  return [...byId.values()].sort(byDate);
}

/** The adjustments dated inside [from, to] (inclusive; open ends allowed). */
export function flexAdjustmentsIn(
  list: FlexAdjustment[] | undefined,
  from?: string,
  to?: string,
): FlexAdjustment[] {
  return (list ?? []).filter((a) => (!from || a.date >= from) && (!to || a.date <= to));
}

export function sumFlexAdjustments(
  list: FlexAdjustment[] | undefined,
  from?: string,
  to?: string,
): number {
  return flexAdjustmentsIn(list, from, to).reduce((s, a) => s + a.minutes, 0);
}
