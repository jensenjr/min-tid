import { useEffect, useState } from "react";
import {
  ACCENTS,
  THEME_LABEL,
  readAccent,
  readThemeChoice,
  subscribeAccent,
  subscribeTheme,
  type AccentChoice,
  type ThemeChoice,
} from "./theme";

/** Current light/dark choice and accent, kept in step with other tabs. */
export function useAppearance(): { theme: ThemeChoice; accent: AccentChoice } {
  const [theme, setTheme] = useState<ThemeChoice>(readThemeChoice);
  const [accent, setAcc] = useState<AccentChoice>(readAccent);
  useEffect(() => subscribeTheme(setTheme), []);
  useEffect(() => subscribeAccent(setAcc), []);
  return { theme, accent };
}

export function appearanceSummary(theme: ThemeChoice, accent: AccentChoice): string {
  const a = ACCENTS.find((x) => x.key === accent)?.label ?? "Orange";
  return `${THEME_LABEL[theme]} · ${a}`;
}
