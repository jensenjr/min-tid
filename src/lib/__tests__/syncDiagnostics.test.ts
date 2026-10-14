import { describe, expect, it } from "vitest";
import { explainSyncError, type SyncFailure } from "../syncDiagnostics";

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
