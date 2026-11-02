import { useEffect, useState } from "react";
import { resolveDark, setThemeChoice, systemPrefersDark } from "../lib/theme";
import { useAppearance } from "../lib/useAppearance";

/**
 * Sun/moon button in the header: flips between Ljust and Mörkt (stored like the choice
 * under Mer → Utseende, where "Följ enheten" is still available).
 */
export default function ThemeToggle() {
  const { theme } = useAppearance();
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const dark = resolveDark(theme, systemDark);
  const label = dark ? "Byt till ljust läge" : "Byt till mörkt läge";

  return (
    <button
      type="button"
      onClick={() => setThemeChoice(dark ? "light" : "dark")}
      aria-label={label}
      title={label}
      className="pc-press shrink-0 w-10 h-10 rounded-full bg-pc-surface border border-pc-line text-pc-ink flex items-center justify-center hover:bg-pc-peach transition-colors"
    >
      {dark ? (
        <svg
          viewBox="0 0 24 24"
          className="w-[18px] h-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          className="w-[18px] h-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
