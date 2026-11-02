// Security headers and brute-force limits — pure, so they can be tested without Express.
//
// Part of a higher security standard for the server: these are the app's own
// job, whichever hosting provider runs it.

import crypto from "node:crypto";

/** sha256 CSP sources for every inline <script> in the built index.html. */
export function inlineScriptHashes(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!m[1].trim()) continue;
    out.push(`'sha256-${crypto.createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
  }
  return out;
}

/**
 * Content-Security-Policy for the app. Everything is served from our own origin
 * (fonts are bundled, the only script outside the bundle is the theme boot
 * script, allowed by its hash). Styles need 'unsafe-inline': React writes style
 * attributes and the components carry <style> blocks.
 */
export function buildCsp(scriptHashes = []) {
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Headers set on every response (API and static files). */
export function securityHeaders({ csp, prod }) {
  const h = {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  // HSTS only in production: in development the app runs on plain http://localhost.
  if (prod) h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return h;
}

/**
 * Counts failures per key in a sliding window and blocks the key for `lockMs`
 * once `max` failures are reached. In memory: a restart clears it, which is fine
 * for a single-instance server (see CLAUDE.md, no horizontal scaling).
 */
export function createAttemptLimiter({ max, windowMs, lockMs, now = () => Date.now() }) {
  /** key → { fails: ms[], lockedUntil: ms } */
  const entries = new Map();

  const fresh = (key) => {
    const e = entries.get(key);
    if (!e) return null;
    const t = now();
    e.fails = e.fails.filter((at) => at > t - windowMs);
    if (!e.fails.length && e.lockedUntil <= t) {
      entries.delete(key);
      return null;
    }
    return e;
  };

  return {
    /** { ok: true } or { ok: false, retryAfterSec } */
    check(key) {
      const e = fresh(key);
      if (e && e.lockedUntil > now())
        return { ok: false, retryAfterSec: Math.ceil((e.lockedUntil - now()) / 1000) };
      return { ok: true };
    },
    /** Records a failure; returns true when this one locked the key. */
    fail(key) {
      const e = fresh(key) ?? { fails: [], lockedUntil: 0 };
      e.fails.push(now());
      let locked = false;
      if (e.fails.length >= max) {
        e.lockedUntil = now() + lockMs;
        e.fails = [];
        locked = true;
      }
      entries.set(key, e);
      return locked;
    },
    succeed(key) {
      entries.delete(key);
    },
    /** Drops expired entries (call from a timer). */
    prune() {
      for (const key of [...entries.keys()]) fresh(key);
    },
    size: () => entries.size,
  };
}

export const LOCKED_MESSAGE = "För många misslyckade försök. Vänta en stund och försök igen.";
