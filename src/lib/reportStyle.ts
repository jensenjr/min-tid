/**
 * Report style: "Stämplare" (punch in and out, exact minutes) or "Justerare"
 * (the schedule is your time; confirm the day and adjust only what differs).
 *
 * Stored as `AppState.reportingMode` ("punch" | "schedule"), chosen in onboarding
 * and in Mer → "Hur du rapporterar". It only decides what the Idag page puts
 * first — the big button — and which unregistered days count as missing vs.
 * unconfirmed. Both styles can always do both things, and flex is calculated the
 * same way (evaluateDay never looks at the style beyond missing/unconfirmed).
 */
import type { ReportingMode } from "./types";

export const REPORT_STYLES: {
  key: ReportingMode;
  role: string;
  title: string;
  text: string;
  icon: string;
}[] = [
  {
    key: "punch",
    role: "Stämplare",
    title: "Stämpla in och ut",
    text: "Du checkar in och ut och appen räknar exakta minuter. Startsidan har en stor in/ut-knapp.",
    icon: "⏱️",
  },
  {
    key: "schedule",
    role: "Justerare",
    title: "Följ schemat",
    text: "Schemat är din tid. Du bekräftar dagen och anger bara avvikelser. Startsidan har en stor Enligt schema-knapp.",
    icon: "📋",
  },
];

export function reportStyle(mode: ReportingMode) {
  return REPORT_STYLES.find((s) => s.key === mode) ?? REPORT_STYLES[0];
}

/** "Stämplare · stor in/ut-knapp" — the subtitle of the Mer row. */
export function reportStyleSummary(mode: ReportingMode): string {
  return mode === "punch"
    ? "Stämplare · stor in/ut-knapp"
    : "Justerare · följer schemat, justerar vid behov";
}

export type TodayLayoutInput = {
  mode: ReportingMode;
  /** A session is running right now. */
  checkedIn: boolean;
  /** The day has a scheduled norm (> 0). */
  scheduled: boolean;
  /** Anything registered today: sessions, an adjustment or an absence. */
  registered: boolean;
  /** "Enligt schema" was pressed for today. */
  confirmed: boolean;
};

export type TodayLayout = {
  /** What gets the big button: the punch clock or "Enligt schema". */
  primary: "clock" | "schedule";
  /** Justerare: a smaller "Checka in" next to "Enligt schema". */
  secondaryPunch: boolean;
  /** Stämplare: a smaller "Inga avvikelser – enligt schema" under the clock. */
  secondaryOk: boolean;
  /** Stämplare who already pressed it: a "Bekräftad enligt schema · Ångra" line instead. */
  okDone: boolean;
};

/**
 * What the Idag page shows first. A running session always puts the clock first
 * (for a Justerare too), so checking out is never hidden.
 */
export function todayLayout(i: TodayLayoutInput): TodayLayout {
  const primary = i.checkedIn || i.mode === "punch" ? "clock" : "schedule";
  const clockIdle = primary === "clock" && !i.checkedIn;
  return {
    primary,
    secondaryPunch: primary === "schedule",
    secondaryOk: clockIdle && i.scheduled && !i.registered && !i.confirmed,
    okDone: clockIdle && i.confirmed && !i.registered,
  };
}
