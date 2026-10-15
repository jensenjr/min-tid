// Swedish display helpers shared by the views. Pure (no React); day keys stay local.
import { isoWeekNumber } from "./dates";

/** "HH:MM" of a timestamp in local time, "--:--" when missing. */
export function fmtTime(ms: number | null | undefined): string {
  if (!ms) return "--:--";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "7h 40min" / "40min" — the compact style of the clock card. */
export function fmtDur(minutes: number): string {
  if (minutes <= 0) return "0h 0min";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

/** "onsdag 3 september" for a day key. */
export function fmtDateLabel(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** "oktober" (lower case) or "oktober 2026" for a "YYYY-MM" month key. */
export function monthName(month: string, withYear = false): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(
    "sv-SE",
    withYear ? { month: "long", year: "numeric" } : { month: "long" },
  );
}

/** "Oktober 2026". */
export function monthTitle(month: string): string {
  const raw = monthName(month, true);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** "Vecka 41  •  7 okt – 13 okt" for a Monday day key. */
export function weekRangeLabel(mondayStr: string): string {
  const mon = new Date(mondayStr + "T12:00:00");
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  const monFmt = mon.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
  const sunFmt = sun.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
  return `Vecka ${isoWeekNumber(mon)}  •  ${monFmt} – ${sunFmt}`;
}

/** Short weekday + date, "ons 3 sep", for dense lists. */
export function fmtDateShort(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("sv-SE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Browser-only: save a text blob as a file. */
export function downloadText(content: string, filename: string, type = "text/csv;charset=utf-8;") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
