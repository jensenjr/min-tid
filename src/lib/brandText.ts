// Pure helpers for the configurable product name. No Vite or DOM access, so vite.config.ts and
// tests can import it. The name itself comes from VITE_APP_NAME (see src/lib/brand.ts).

export const DEFAULT_APP_NAME = "min-tid";
export const BRAND_PLACEHOLDER = "__APP_NAME__";

/** A usable product name: trimmed, no markup characters, at most 40 chars; else the default. */
export function resolveAppName(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_APP_NAME;
  const name = raw
    .replace(/[<>"'&\\]/g, "")
    .trim()
    .slice(0, 40);
  return name || DEFAULT_APP_NAME;
}

/** Replaces every __APP_NAME__ placeholder (index.html, manifest.webmanifest). */
export function applyBrand(text: string, name: string): string {
  return text.split(BRAND_PLACEHOLDER).join(name);
}
