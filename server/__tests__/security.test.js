import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildCsp,
  createAttemptLimiter,
  inlineScriptHashes,
  securityHeaders,
} from "../security.js";
import { THEME_BOOT_SCRIPT } from "../../src/lib/theme.ts";

describe("inlineScriptHashes", () => {
  it("hashes the theme boot script in index.html and skips src scripts", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const want = `'sha256-${crypto.createHash("sha256").update(THEME_BOOT_SCRIPT).digest("base64")}'`;
    expect(inlineScriptHashes(html)).toEqual([want]);
  });
});

describe("headers", () => {
  it("CSP allows only our origin plus the hashed inline script", () => {
    const csp = buildCsp(["'sha256-abc'"]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'sha256-abc'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/googleapis|unsafe-eval/);
  });

  it("HSTS only in production", () => {
    expect(securityHeaders({ csp: "x", prod: true })["Strict-Transport-Security"]).toMatch(
      /max-age=31536000/,
    );
    expect(securityHeaders({ csp: "x", prod: false })["Strict-Transport-Security"]).toBeUndefined();
    expect(securityHeaders({ csp: "x", prod: false })["X-Frame-Options"]).toBe("DENY");
  });
});

describe("createAttemptLimiter", () => {
  const make = () => {
    let t = 0;
    const lim = createAttemptLimiter({ max: 3, windowMs: 1000, lockMs: 5000, now: () => t });
    return { lim, tick: (ms) => (t += ms) };
  };

  it("locks a key after max failures, for lockMs", () => {
    const { lim, tick } = make();
    expect(lim.fail("a")).toBe(false);
    expect(lim.fail("a")).toBe(false);
    expect(lim.check("a").ok).toBe(true);
    expect(lim.fail("a")).toBe(true);
    expect(lim.check("a")).toEqual({ ok: false, retryAfterSec: 5 });
    expect(lim.check("b").ok).toBe(true);
    tick(5000);
    expect(lim.check("a").ok).toBe(true);
  });

  it("forgets failures outside the window and on success", () => {
    const { lim, tick } = make();
    lim.fail("a");
    lim.fail("a");
    tick(1001);
    lim.fail("a");
    expect(lim.check("a").ok).toBe(true);
    lim.fail("a");
    lim.succeed("a");
    lim.fail("a");
    lim.fail("a");
    expect(lim.check("a").ok).toBe(true);
  });

  it("prune drops expired entries", () => {
    const { lim, tick } = make();
    lim.fail("a");
    tick(2000);
    lim.prune();
    expect(lim.size()).toBe(0);
  });
});
