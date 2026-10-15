import { describe, expect, it } from "vitest";
import {
  buildSyncReportMailto,
  buildSyncReportText,
  explainSyncError,
  type SyncFailure,
} from "../syncDiagnostics";

const failure = (status: number, message = "x"): SyncFailure => ({
  at: 0,
  status,
  path: "/api/sync",
  method: "GET",
  message,
  online: true,
});

describe("explainSyncError — encrypted sync", () => {
  it("401 (expired session or no key on this device) asks to log in again, data stays", () => {
    const e = explainSyncError(failure(401));
    expect(e.relogin).toBe(true);
    expect(e.networkBlocked).toBe(false);
    expect(e.headline).toMatch(/logga in igen/i);
    expect(e.fixes.join(" ")).toMatch(/Logga in igen/);
    expect(e.fixes.join(" ")).toMatch(/lokala data ligger kvar/i);
  });

  it("409 means the sync code was changed on another device", () => {
    const e = explainSyncError(failure(409));
    expect(e.relogin).toBe(true);
    expect(e.headline).toMatch(/synk-koden har bytts/i);
    expect(e.fixes.join(" ")).toMatch(/nya synk-koden/i);
  });

  it("422 means the cloud copy could not be decrypted", () => {
    const e = explainSyncError(failure(422));
    expect(e.relogin).toBe(true);
    expect(e.headline).toMatch(/låsas upp/i);
  });

  it("does not offer a re-login for network, server or deploy failures", () => {
    for (const s of [0, 403, 405, 500, 502])
      expect(explainSyncError(failure(s)).relogin).toBe(false);
    expect(explainSyncError(failure(403)).networkBlocked).toBe(true);
    expect(explainSyncError({ ...failure(401), online: false }).relogin).toBe(false);
    expect(explainSyncError(null).relogin).toBe(false);
  });
});

describe("explainSyncError — account missing on the server", () => {
  it("404 says the account is gone and offers to set sync up again, data stays", () => {
    const e = explainSyncError(failure(404, "Användare inte hittad."));
    expect(e.recreate).toBe(true);
    expect(e.relogin).toBe(false);
    expect(e.networkBlocked).toBe(false);
    expect(e.headline).toMatch(/finns inte på servern/i);
    expect(e.fixes.join(" ")).toMatch(/Aktivera synk igen/);
    expect(e.cause).toMatch(/finns kvar/);
  });

  it("other statuses never offer to recreate the account", () => {
    for (const s of [0, 401, 403, 405, 409, 422, 500])
      expect(explainSyncError(failure(s)).recreate ?? false).toBe(false);
  });
});

describe("buildSyncReportText", () => {
  const base = {
    failure: failure(404, "Användare inte hittad."),
    log: [failure(404, "Användare inte hittad."), failure(404, "Användare inte hittad.")],
    username: "krut123",
    version: "1.0.0",
    lastSyncedAt: null,
    pendingChanges: true,
  };

  it("contains the failure, the interpretation and the earlier errors with their messages", () => {
    const t = buildSyncReportText(base);
    expect(t).toMatch(/HTTP 404 \(GET \/api\/sync\)/);
    expect(t).toMatch(/Förklaring:\s+Ditt synk-konto finns inte på servern/);
    expect(t).toMatch(/Tidigare fel:\n.*HTTP 404\s+GET \/api\/sync\s+Användare inte hittad\./);
    expect(t).not.toMatch(/Server:/); // debug block only with debug context
  });

  it("adds the debug block when given, without any token or key material", () => {
    const t = buildSyncReportText({
      ...base,
      debug: {
        server: "https://example.test/api",
        syncStatus: "error",
        syncRev: null,
        tokenPresent: true,
        tokenExpiresAt: Date.UTC(2026, 10, 1),
        keyPresent: true,
        keyMatchesToken: false,
        keyId: "abcd1234",
      },
    });
    expect(t).toMatch(/Server:\s+https:\/\/example\.test\/api/);
    expect(t).toMatch(/Inloggning:\s+finns, giltig till/);
    expect(t).toMatch(/Nyckel på enh\.: ja \(id abcd1234, TILLHÖR ANNAT KONTO\)/);
    expect(t).not.toMatch(/eyJ/); // no JWT
  });

  it("mailto carries the same text", () => {
    const href = buildSyncReportMailto(base);
    expect(decodeURIComponent(href.split("&body=")[1])).toBe(buildSyncReportText(base));
  });
});
