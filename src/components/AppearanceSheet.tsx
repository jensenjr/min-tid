import { useAppearance } from "@/lib/useAppearance";
import { ACCENTS, THEME_CHOICES, THEME_LABEL, setAccent, setThemeChoice } from "@/lib/theme";
import { Sheet } from "./ui";

/**
 * Mer → Utseende: light/dark (or follow the device) and Färgtema.
 * Device-local display preferences (src/lib/theme.ts); applied at once.
 */
export default function AppearanceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, accent } = useAppearance();

  return (
    <Sheet open={open} onClose={onClose} title="Utseende" subtitle="Gäller bara den här enheten.">
      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-pc-muted mb-2 px-1">
        Läge
      </div>
      <div
        role="radiogroup"
        aria-label="Läge"
        className="grid grid-cols-3 gap-1 bg-pc-apricot border border-pc-line rounded-[16px] p-1 mb-2"
      >
        {THEME_CHOICES.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={theme === c}
            onClick={() => setThemeChoice(c)}
            className={`pc-press py-2.5 rounded-[12px] text-[13px] font-bold transition-colors ${
              theme === c ? "bg-pc-surface text-pc-ink shadow-sm" : "text-pc-muted"
            }`}
          >
            {THEME_LABEL[c]}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-pc-muted leading-snug mb-5 px-1">
        {theme === "system"
          ? "Appen byter mellan ljust och mörkt när enheten gör det."
          : "Appen ignorerar enhetens inställning."}
      </p>

      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-pc-muted mb-2 px-1">
        Färgtema
      </div>
      <div role="radiogroup" aria-label="Färgtema" className="grid grid-cols-5 gap-2 mb-6">
        {ACCENTS.map((a) => {
          const on = accent === a.key;
          return (
            <button
              key={a.key}
              role="radio"
              aria-checked={on}
              onClick={() => setAccent(a.key)}
              className={`pc-press flex flex-col items-center gap-1.5 py-2.5 rounded-[16px] border transition-colors ${
                on ? "border-pc-ink bg-pc-surface" : "border-pc-line bg-pc-apricot"
              }`}
            >
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[14px] font-extrabold"
                style={{ background: a.swatch }}
                aria-hidden
              >
                {on ? "✓" : ""}
              </span>
              <span className="text-[11px] font-bold text-pc-ink">{a.label}</span>
            </button>
          );
        })}
      </div>

      <button
        onClick={onClose}
        className="pc-press w-full py-3.5 rounded-[16px] bg-pc-orange text-white font-bold text-[14px]"
      >
        Klar
      </button>
    </Sheet>
  );
}
