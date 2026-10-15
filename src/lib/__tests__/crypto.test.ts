import { describe, expect, it, vi } from "vitest";
import {
  PBKDF2_ITERATIONS,
  CryptoError,
  base64ToBytes,
  bytesToBase64,
  decryptState,
  deriveKeys,
  encryptState,
  formatRecoveryKey,
  generateRecoveryKey,
  isEnvelope,
  normalizeRecoveryKey,
  randomSalt,
  unwrapEncKey,
} from "../crypto";

// 600 000 PBKDF2 rounds is the production cost; everything except the one test that
// pins the default runs with a cheap count so the suite stays fast.
const FAST = { iterations: 1000 };
const SALT = bytesToBase64(new Uint8Array(16).map((_, i) => i + 1));
const OTHER_SALT = bytesToBase64(new Uint8Array(16).map((_, i) => 200 - i));

const STATE = {
  name: "Åsa Öberg",
  department: "Lager",
  schedule: { mon: { active: true, startTime: "08:00", endTime: "17:00", lunchMinutes: 60 } },
  sessions: [{ id: "s1", start: 1767254400000, end: 1767283200000, note: "HEMLIG anteckning 🔒" }],
  absences: [],
  expenses: [{ id: "e1", amount: 125.5 }],
  flexBaseMinutes: -30,
  trackingStartDate: "2026-01-01",
};

const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CROCKFORD = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{24}$/;

function flipByte(b64: string, index: number): string {
  const bytes = base64ToBytes(b64);
  bytes[index] ^= 0x01;
  return bytesToBase64(bytes);
}

describe("deriveKeys", () => {
  it("uses PBKDF2-SHA256 with 600 000 iterations by default", async () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    const spy = vi.spyOn(globalThis.crypto.subtle, "deriveBits");
    try {
      await deriveKeys("en lång hemlig fras", SALT);
      const pbkdf2 = spy.mock.calls
        .map((c) => c[0] as Pbkdf2Params)
        .find((alg) => alg.name === "PBKDF2");
      expect(pbkdf2).toBeDefined();
      expect(pbkdf2!.iterations).toBe(600_000);
      expect(pbkdf2!.hash).toBe("SHA-256");
    } finally {
      spy.mockRestore();
    }
  });

  it("is deterministic for the same secret and salt", async () => {
    const a = await deriveKeys("hemlig-kod", SALT, FAST);
    const b = await deriveKeys("hemlig-kod", SALT, FAST);
    expect(a.authKey).toBe(b.authKey);
    // …and the two encKeys are interchangeable.
    const env = await encryptState(STATE, a.encKey);
    expect(await decryptState(env, b.encKey)).toEqual(STATE);
  });

  it("returns a 32-byte base64 authKey that differs per secret and per salt", async () => {
    const a = await deriveKeys("hemlig-kod", SALT, FAST);
    const b = await deriveKeys("hemlig-koD", SALT, FAST);
    const c = await deriveKeys("hemlig-kod", OTHER_SALT, FAST);
    expect(a.authKey).toMatch(B64);
    expect(base64ToBytes(a.authKey)).toHaveLength(32);
    expect(new Set([a.authKey, b.authKey, c.authKey]).size).toBe(3);
    // The transport credential never equals the secret itself.
    expect(a.authKey).not.toContain("hemlig");
  });

  it("gives a non-extractable AES-GCM-256 encKey", async () => {
    const { encKey } = await deriveKeys("hemlig-kod", SALT, FAST);
    expect(encKey.extractable).toBe(false);
    expect(encKey.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect([...encKey.usages].sort()).toEqual(["decrypt", "encrypt"]);
    await expect(globalThis.crypto.subtle.exportKey("raw", encKey)).rejects.toThrow();
  });

  it("separates authKey and encKey (the server's credential cannot decrypt)", async () => {
    const { authKey, encKey } = await deriveKeys("hemlig-kod", SALT, FAST);
    const env = await encryptState(STATE, encKey);
    const asKey = await globalThis.crypto.subtle.importKey(
      "raw",
      base64ToBytes(authKey),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    await expect(decryptState(env, asKey)).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
  });

  it("normalises the secret to NFC so å typed two ways derives the same keys", async () => {
    const composed = "så hemligt"; // å as one code point
    const decomposed = "så hemligt"; // a + combining ring
    expect(composed).not.toBe(decomposed);
    const a = await deriveKeys(composed, SALT, FAST);
    const b = await deriveKeys(decomposed, SALT, FAST);
    expect(a.authKey).toBe(b.authKey);
  });

  it("rejects a salt that is not 16 bytes of base64", async () => {
    await expect(deriveKeys("hemlig-kod", "", FAST)).rejects.toMatchObject({ code: "BAD_SALT" });
    await expect(deriveKeys("hemlig-kod", "inte base64!", FAST)).rejects.toMatchObject({
      code: "BAD_SALT",
    });
    await expect(
      deriveKeys("hemlig-kod", bytesToBase64(new Uint8Array(8)), FAST),
    ).rejects.toMatchObject({ code: "BAD_SALT" });
  });

  it("refuses an iteration count below the floor (a server cannot downgrade the KDF)", async () => {
    await expect(deriveKeys("hemlig-kod", SALT, { iterations: 0 })).rejects.toThrow();
    await expect(deriveKeys("hemlig-kod", SALT, { iterations: 1.5 })).rejects.toThrow();
  });
});

describe("encryptState / decryptState", () => {
  it("round-trips the full state, including non-ASCII text", async () => {
    const { encKey } = await deriveKeys("hemlig-kod", SALT, FAST);
    const env = await encryptState(STATE, encKey);
    expect(await decryptState(env, encKey)).toEqual(STATE);
  });

  it("produces exactly { v: 1, iv, ct } with a 12-byte IV and no plaintext", async () => {
    const { encKey } = await deriveKeys("hemlig-kod", SALT, FAST);
    const env = await encryptState(STATE, encKey);
    expect(Object.keys(env).sort()).toEqual(["ct", "iv", "v"]);
    expect(env.v).toBe(1);
    expect(env.iv).toMatch(B64);
    expect(env.ct).toMatch(B64);
    expect(base64ToBytes(env.iv)).toHaveLength(12);
    expect(isEnvelope(env)).toBe(true);
    const wire = JSON.stringify(env);
    for (const leak of ["HEMLIG", "Åsa", "Lager", "sessions", "08:00"]) {
      expect(wire).not.toContain(leak);
    }
  });

  it("uses a fresh IV for every encryption of the same state", async () => {
    const { encKey } = await deriveKeys("hemlig-kod", SALT, FAST);
    const envs = await Promise.all([1, 2, 3, 4, 5].map(() => encryptState(STATE, encKey)));
    expect(new Set(envs.map((e) => e.iv)).size).toBe(5);
    expect(new Set(envs.map((e) => e.ct)).size).toBe(5);
  });

  it("round-trips a large state (no call-stack limits in base64)", async () => {
    const { encKey } = await deriveKeys("hemlig-kod", SALT, FAST);
    const big = {
      ...STATE,
      sessions: Array.from({ length: 20000 }, (_, i) => ({
        id: `s${i}`,
        start: 1767254400000 + i * 86400000,
        end: 1767283200000 + i * 86400000,
        note: "anteckning ".repeat(3),
      })),
    };
    const env = await encryptState(big, encKey);
    expect(base64ToBytes(env.ct).length).toBeGreaterThan(1_000_000);
    expect(await decryptState(env, encKey)).toEqual(big);
  });

  it("fails with a clear error under the wrong key (wrong secret)", async () => {
    const right = await deriveKeys("hemlig-kod", SALT, FAST);
    const wrong = await deriveKeys("fel-kod", SALT, FAST);
    const env = await encryptState(STATE, right.encKey);
    const err = await decryptState(env, wrong.encKey).catch((e) => e);
    expect(err).toBeInstanceOf(CryptoError);
    expect(err.code).toBe("DECRYPT_FAILED");
    expect(err.message).toMatch(/fel nyckel/i);
  });

  it("fails under the right secret but the wrong salt", async () => {
    const right = await deriveKeys("hemlig-kod", SALT, FAST);
    const wrong = await deriveKeys("hemlig-kod", OTHER_SALT, FAST);
    const env = await encryptState(STATE, right.encKey);
    await expect(decryptState(env, wrong.encKey)).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
  });

  it("detects a tampered ciphertext (first, middle and tag bytes)", async () => {
    const { encKey } = await deriveKeys("hemlig-kod", SALT, FAST);
    const env = await encryptState(STATE, encKey);
    const len = base64ToBytes(env.ct).length;
    for (const i of [0, Math.floor(len / 2), len - 1]) {
      await expect(decryptState({ ...env, ct: flipByte(env.ct, i) }, encKey)).rejects.toMatchObject(
        { code: "DECRYPT_FAILED" },
      );
    }
  });

  it("detects a tampered IV", async () => {
    const { encKey } = await deriveKeys("hemlig-kod", SALT, FAST);
    const env = await encryptState(STATE, encKey);
    await expect(decryptState({ ...env, iv: flipByte(env.iv, 0) }, encKey)).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
  });

  it("detects a truncated ciphertext and an IV/ct swap between two envelopes", async () => {
    const { encKey } = await deriveKeys("hemlig-kod", SALT, FAST);
    const a = await encryptState(STATE, encKey);
    const b = await encryptState({ ...STATE, name: "Annan" }, encKey);
    const truncated = bytesToBase64(base64ToBytes(a.ct).slice(0, -1));
    await expect(decryptState({ ...a, ct: truncated }, encKey)).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
    await expect(decryptState({ ...a, iv: b.iv }, encKey)).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
  });

  it("rejects malformed envelopes before touching the key", async () => {
    const { encKey } = await deriveKeys("hemlig-kod", SALT, FAST);
    const env = await encryptState(STATE, encKey);
    const bad: unknown[] = [
      null,
      "string",
      [],
      STATE, // a plaintext state is not an envelope
      { ...env, v: 2 },
      { iv: env.iv, ct: env.ct },
      { v: 1, iv: env.iv },
      { ...env, iv: bytesToBase64(new Uint8Array(16)) }, // IV must be 12 bytes
      { ...env, ct: "!!!" },
      { ...env, ct: bytesToBase64(new Uint8Array(8)) }, // shorter than the GCM tag
      { ...env, extra: 1 },
    ];
    for (const b of bad) {
      expect(isEnvelope(b)).toBe(false);
      await expect(decryptState(b, encKey)).rejects.toMatchObject({ code: "BAD_ENVELOPE" });
    }
  });

  it("rejects decrypted data that is not a state object", async () => {
    const { encKey } = await deriveKeys("hemlig-kod", SALT, FAST);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const forge = async (text: string) => {
      const ct = await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("min-tid/v1/state") },
        encKey,
        new TextEncoder().encode(text),
      );
      return { v: 1, iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
    };
    for (const text of ["[1,2]", "null", '"text"', "42", "{not json"]) {
      await expect(decryptState(await forge(text), encKey)).rejects.toMatchObject({
        code: "BAD_PLAINTEXT",
      });
    }
  });

  it("refuses to encrypt something that is not a state object", async () => {
    const { encKey } = await deriveKeys("hemlig-kod", SALT, FAST);
    for (const v of [null, [], "x", 1]) {
      await expect(encryptState(v as unknown as object, encKey)).rejects.toThrow();
    }
  });
});

describe("recovery key", () => {
  it("is 24 Crockford base32 characters and random", () => {
    const keys = Array.from({ length: 50 }, () => generateRecoveryKey());
    for (const k of keys) expect(k).toMatch(CROCKFORD);
    expect(new Set(keys).size).toBe(50);
  });

  it("formats in groups of four and parses back, forgiving case, spaces and look-alikes", () => {
    const key = generateRecoveryKey();
    const pretty = formatRecoveryKey(key);
    expect(pretty).toMatch(/^([0-9A-Z]{4}-){5}[0-9A-Z]{4}$/);
    expect(normalizeRecoveryKey(pretty)).toBe(key);
    expect(normalizeRecoveryKey(` ${pretty.toLowerCase().replace(/-/g, " ")} `)).toBe(key);
    // Crockford: I and L read as 1, O reads as 0.
    expect(normalizeRecoveryKey("ILO0-0000-0000-0000-0000-0000")).toBe("110000000000000000000000");
  });

  it("rejects keys of the wrong length or with characters outside the alphabet", () => {
    expect(normalizeRecoveryKey("")).toBeNull();
    expect(normalizeRecoveryKey("ABCD")).toBeNull();
    expect(normalizeRecoveryKey("0".repeat(25))).toBeNull();
    expect(normalizeRecoveryKey("U" + "0".repeat(23))).toBeNull(); // U is not Crockford
    expect(normalizeRecoveryKey("Å" + "0".repeat(23))).toBeNull();
  });

  it("wraps encKey (AES-KW) so the recovery key alone can unlock the data", async () => {
    const keys = await deriveKeys("hemlig-kod", SALT, FAST);
    const rk = generateRecoveryKey();
    const wrapped = await keys.wrapEncKey(rk);
    expect(wrapped).toMatch(B64);
    expect(base64ToBytes(wrapped)).toHaveLength(40); // 32-byte key + 8-byte KW integrity block

    const env = await encryptState(STATE, keys.encKey);
    const recovered = await unwrapEncKey(wrapped, formatRecoveryKey(rk).toLowerCase());
    expect(recovered.extractable).toBe(false);
    expect(await decryptState(env, recovered)).toEqual(STATE);
    // …and data encrypted with the unwrapped key opens with the derived one.
    expect(await decryptState(await encryptState(STATE, recovered), keys.encKey)).toEqual(STATE);
  });

  it("keeps the stored encKey non-extractable even after wrapping", async () => {
    const keys = await deriveKeys("hemlig-kod", SALT, FAST);
    await keys.wrapEncKey(generateRecoveryKey());
    expect(keys.encKey.extractable).toBe(false);
  });

  it("fails clearly on the wrong recovery key, a malformed one, or a tampered wrap", async () => {
    const keys = await deriveKeys("hemlig-kod", SALT, FAST);
    const rk = generateRecoveryKey();
    const wrapped = await keys.wrapEncKey(rk);

    const wrong = await unwrapEncKey(wrapped, generateRecoveryKey()).catch((e) => e);
    expect(wrong).toBeInstanceOf(CryptoError);
    expect(wrong.code).toBe("WRONG_RECOVERY_KEY");
    expect(wrong.message).toMatch(/återställningsnyckel/i);

    await expect(unwrapEncKey(wrapped, "ABC")).rejects.toMatchObject({ code: "BAD_RECOVERY_KEY" });
    await expect(unwrapEncKey(flipByte(wrapped, 5), rk)).rejects.toMatchObject({
      code: "WRONG_RECOVERY_KEY",
    });
    await expect(unwrapEncKey("inte base64", rk)).rejects.toMatchObject({
      code: "WRONG_RECOVERY_KEY",
    });
  });
});

describe("helpers", () => {
  it("randomSalt gives 16 fresh bytes", () => {
    const a = randomSalt();
    expect(base64ToBytes(a)).toHaveLength(16);
    expect(a).not.toBe(randomSalt());
  });

  it("base64 round-trips every byte value and rejects junk", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(base64ToBytes(bytesToBase64(all))).toEqual(all);
    expect(() => base64ToBytes("a")).toThrow();
    expect(() => base64ToBytes("ab$=")).toThrow();
  });
});
