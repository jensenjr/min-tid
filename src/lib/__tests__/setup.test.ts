import { describe, expect, it } from "vitest";

describe("test environment", () => {
  it("runs in Europe/Stockholm so local day keys match the app", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Europe/Stockholm");
    // 2026-03-29 is the spring DST switch: local midnight is still 23:00 UTC the day before.
    expect(new Date(2026, 2, 29).toISOString()).toBe("2026-03-28T23:00:00.000Z");
  });
});
