import { describe, expect, it } from "vitest";
import { formatHm, isCompleteTyped, parseHm, parseTyped, snapHm, snapValue } from "../timeField";

describe("timeField helpers", () => {
  it("parses and formats HH:MM", () => {
    expect(parseHm("08:05")).toEqual({ h: 8, m: 5 });
    expect(parseHm("24:00")).toBeNull();
    expect(parseHm("8:05")).toBeNull();
    expect(parseHm(undefined)).toBeNull();
    expect(formatHm(7, 0)).toBe("07:00");
  });

  it("snaps to 5 minutes with carry, never past 23:55", () => {
    expect(snapHm(16, 43)).toBe("16:45");
    expect(snapHm(16, 42)).toBe("16:40");
    expect(snapHm(16, 58)).toBe("17:00");
    expect(snapHm(23, 58)).toBe("23:55");
    expect(snapValue("08:03")).toBe("08:05");
    expect(snapValue("nope")).toBeNull();
  });

  it("reads typed times exactly, in the common shapes", () => {
    expect(parseTyped("1645")).toBe("16:45");
    expect(parseTyped("16:45")).toBe("16:45");
    expect(parseTyped("16.45")).toBe("16:45");
    expect(parseTyped("16,45")).toBe("16:45");
    expect(parseTyped("16 45")).toBe("16:45");
    expect(parseTyped("945")).toBe("09:45");
    expect(parseTyped("9")).toBe("09:00");
    expect(parseTyped("16")).toBe("16:00");
    expect(parseTyped("16:3")).toBe("16:30");
    expect(parseTyped("0800")).toBe("08:00");
    expect(parseTyped(" 1647 ")).toBe("16:47");
    expect(parseTyped("08:03")).toBe("08:03");
  });

  it("returns empty for empty input and null for nonsense", () => {
    expect(parseTyped("")).toBe("");
    expect(parseTyped("   ")).toBe("");
    expect(parseTyped("2460")).toBeNull();
    expect(parseTyped("25")).toBeNull();
    expect(parseTyped("12345")).toBeNull();
    expect(parseTyped("ab")).toBeNull();
  });

  it("knows when typing names a full time", () => {
    expect(isCompleteTyped("16")).toBe(false);
    expect(isCompleteTyped("164")).toBe(true);
    expect(isCompleteTyped("1645")).toBe(true);
    expect(isCompleteTyped("16:4")).toBe(false);
    expect(isCompleteTyped("16:45")).toBe(true);
  });
});
