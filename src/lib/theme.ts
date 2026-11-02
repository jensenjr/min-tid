/**
 * Light / dark theme. Ported from Bytefest-app (theme-script.tsx +
 * theme-toggle.tsx), without Next or i18n.
 *
 * The choice is device-local: localStorage["min-tid-theme"] = "system" |
 * "light" | "dark". Missing or unknown = "system", which follows the device's
 * prefers-color-scheme live (a phone switching to night mode switches the app).
 * The `dark` class on <html> drives every colour token in styles.css.
 *
 * index.html runs THEME_BOOT_SCRIPT inline in <head>, before first paint, so
 * the page never flashes the wrong theme; `startThemeSync()` (main.tsx) keeps
 * following the device afterwards. Never synced, and harmless in demo mode: it
 * is a display preference, not data.
 */
export type ThemeChoice = "system" | "light" | "dark";
/** Färgtema: the accent family (data-accent on <html>, styles.css). */
export type AccentChoice = "orange" | "hav" | "skog" | "ljung" | "hallon";

export const THEME_STORAGE_KEY = "min-tid-theme";
export const THEME_CHOICES: ThemeChoice[] = ["system", "light", "dark"];
export const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "Följ enheten",
  light: "Ljust",
  dark: "Mörkt",
};

export const ACCENT_STORAGE_KEY = "min-tid-accent";
export const ACCENTS: { key: AccentChoice; label: string; swatch: string }[] = [
  { key: "orange", label: "Orange", swatch: "#ff5f00" },
  { key: "hav", label: "Hav", swatch: "#2563eb" },
  { key: "skog", label: "Skog", swatch: "#059669" },
  { key: "ljung", label: "Ljung", swatch: "#7c3aed" },
  { key: "hallon", label: "Hallon", swatch: "#db2777" },
];

export function parseAccent(raw: unknown): AccentChoice {
  return ACCENTS.some((a) => a.key === raw) ? (raw as AccentChoice) : "orange";
}

/** Browser-chrome colour per resolved theme (meta theme-color). */
const CHROME = { light: "#faf6f1", dark: "#17110e" } as const;

export function parseThemeChoice(raw: unknown): ThemeChoice {
  return raw === "light" || raw === "dark" ? raw : "system";
}

/** Whether a choice renders dark, given the device preference. */
export function resolveDark(choice: ThemeChoice, systemDark: boolean): boolean {
  return choice === "dark" || (choice === "system" && systemDark);
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

export function readThemeChoice(): ThemeChoice {
  try {
    return parseThemeChoice(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice = readThemeChoice()): void {
  if (typeof document === "undefined") return;
  const dark = resolveDark(choice, systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? CHROME.dark : CHROME.light);
}

export function readAccent(): AccentChoice {
  try {
    return parseAccent(localStorage.getItem(ACCENT_STORAGE_KEY));
  } catch {
    return "orange";
  }
}

export function applyAccent(accent: AccentChoice = readAccent()): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (accent === "orange") el.removeAttribute("data-accent");
  else el.setAttribute("data-accent", accent);
}

const listeners = new Set<(c: ThemeChoice) => void>();
const accentListeners = new Set<(a: AccentChoice) => void>();

export function setAccent(accent: AccentChoice): void {
  try {
    if (accent === "orange") localStorage.removeItem(ACCENT_STORAGE_KEY);
    else localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  } catch {
    /* private mode */
  }
  applyAccent(accent);
  accentListeners.forEach((l) => l(accent));
}

export function subscribeAccent(l: (a: AccentChoice) => void): () => void {
  accentListeners.add(l);
  return () => accentListeners.delete(l);
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  applyTheme(choice);
  listeners.forEach((l) => l(choice));
}

export function subscribeTheme(l: (c: ThemeChoice) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * Follow the device while the choice is "system", and another tab's choice.
 * Call once at startup.
 */
export function startThemeSync(): void {
  if (typeof window === "undefined") return;
  applyTheme();
  applyAccent();
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (readThemeChoice() === "system") applyTheme("system");
  });
  window.addEventListener("storage", (e) => {
    if (e.key === ACCENT_STORAGE_KEY) {
      const a = readAccent();
      applyAccent(a);
      accentListeners.forEach((l) => l(a));
      return;
    }
    if (e.key !== THEME_STORAGE_KEY) return;
    const c = readThemeChoice();
    applyTheme(c);
    listeners.forEach((l) => l(c));
  });
}

/**
 * Inline <head> script (index.html carries a copy; a test keeps them equal).
 * Dark only when chosen or when the device prefers it; light if anything fails.
 * Also sets data-accent (a stored value other than a known accent is ignored).
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');var d=s==='dark'||(s!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',d?'${CHROME.dark}':'${CHROME.light}');var a=localStorage.getItem('${ACCENT_STORAGE_KEY}');if(${JSON.stringify(ACCENTS.filter((x) => x.key !== "orange").map((x) => x.key)).replace(/"/g, "'")}.indexOf(a)>=0)document.documentElement.setAttribute('data-accent',a);}catch(e){}})();`;
