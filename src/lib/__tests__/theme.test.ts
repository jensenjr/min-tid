import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCENTS, THEME_BOOT_SCRIPT, parseAccent, parseThemeChoice, resolveDark } from "../theme";

describe("theme", () => {
  it("index.html carries the same pre-paint script as theme.ts", () => {
    const html = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");
    expect(html).toContain(`<script>${THEME_BOOT_SCRIPT}</script>`);
  });

  it("follows the device unless a mode is chosen", () => {
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
    expect(resolveDark("light", true)).toBe(false);
    expect(resolveDark("dark", false)).toBe(true);
  });

  it("falls back to system / orange on junk", () => {
    expect(parseThemeChoice(null)).toBe("system");
    expect(parseThemeChoice("blå")).toBe("system");
    expect(parseThemeChoice("dark")).toBe("dark");
    expect(parseAccent(null)).toBe("orange");
    expect(parseAccent("neon")).toBe("orange");
    expect(parseAccent("skog")).toBe("skog");
  });

  it("every accent has CSS for both light and dark", () => {
    const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    for (const a of ACCENTS.filter((x) => x.key !== "orange")) {
      expect(css).toContain(`:root[data-accent="${a.key}"] {`);
      expect(css).toContain(`:root.dark[data-accent="${a.key}"] {`);
    }
  });
});
