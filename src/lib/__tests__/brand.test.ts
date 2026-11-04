import { describe, it, expect } from "vitest";
import { applyBrand, resolveAppName, DEFAULT_APP_NAME } from "../brandText";
import { readFileSync } from "node:fs";

describe("brand", () => {
  it("defaults to min-tid", () => {
    expect(resolveAppName(undefined)).toBe(DEFAULT_APP_NAME);
    expect(resolveAppName("")).toBe("min-tid");
    expect(resolveAppName("   ")).toBe("min-tid");
  });
  it("uses a custom name and strips markup characters", () => {
    expect(resolveAppName("Timsam")).toBe("Timsam");
    expect(resolveAppName(' <b>Tim"sam</b> ')).toBe("bTimsam/b");
    expect(resolveAppName("x".repeat(80))).toHaveLength(40);
  });
  it("replaces every placeholder", () => {
    expect(applyBrand("__APP_NAME__ – __APP_NAME__", "Timsam")).toBe("Timsam – Timsam");
  });
  it("index.html and the manifest carry the placeholder, not a fixed name", () => {
    for (const f of ["index.html", "public/manifest.webmanifest"]) {
      const s = readFileSync(f, "utf8");
      expect(s).toContain("__APP_NAME__");
      expect(s).not.toMatch(/min-tid(?!-(theme|accent))/);
    }
  });
});
