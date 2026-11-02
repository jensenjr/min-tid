import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RELEASE_NOTES } from "../releaseNotes";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("release notes (Mer → Om appen)", () => {
  it("lead with the current package version", () => {
    const pkg = JSON.parse(read("../../../package.json")) as { version: string };
    expect(RELEASE_NOTES[0].version).toBe(pkg.version);
  });

  it("cover every stable CHANGELOG version from 1.0.0, with the same date", () => {
    const changelog = read("../../../CHANGELOG.md");
    const stable = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] — (\d{4}-\d{2}-\d{2})$/gm)].map(
      (m) => ({ version: m[1], date: m[2] }),
    );
    expect(stable.length).toBeGreaterThan(0);
    expect(RELEASE_NOTES.map((r) => ({ version: r.version, date: r.date }))).toEqual(stable);
  });

  it("keep each version to one–three short lines", () => {
    for (const r of RELEASE_NOTES) {
      expect(r.notes.length).toBeGreaterThanOrEqual(1);
      expect(r.notes.length).toBeLessThanOrEqual(3);
      for (const n of r.notes) expect(n.length).toBeLessThanOrEqual(140);
    }
  });
});
