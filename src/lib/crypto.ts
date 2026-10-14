// End-to-end encryption for sync — Web Crypto only, no dependencies.
//
//   secret ──PBKDF2-SHA256 (600 000, per-account salt)──► master
//   master ──HKDF "min-tid/v1/auth"──► authKey   32 bytes, sent (base64) to the server,
//                                                  which bcrypts it like a password
//   master ──HKDF "min-tid/v1/enc" ──► encKey    AES-GCM-256, non-extractable, never leaves
//                                                  the device (IndexedDB)
//
// The server only ever sees authKey (from which encKey cannot be computed) and the
// envelope { v: 1, iv, ct }. The recovery key (24 Crockford base32 chars = 120 bits)
// is stretched with HKDF into an AES-KW key that wraps encKey; the server stores the
// wrapped key so that "SMS restores the account, the recovery key restores the data".
//
// Extractability: wrapKey() needs an extractable key, but the encKey we hand out must
// not be. deriveKeys() therefore keeps the HKDF base key (itself non-extractable) in a
// closure: wrapEncKey() derives a short-lived extractable twin of encKey from it, wraps
// it inside Web Crypto and drops it. Raw key bytes never enter JavaScript memory, and
// the stored encKey stays non-extractable.

export const PBKDF2_ITERATIONS = 600_000;
/** Below this a hostile server could make the authKey cheap to brute-force. */
const MIN_ITERATIONS = 1000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
const KEY_BYTES = 32;
const GCM_TAG_BYTES = 16;
export const RECOVERY_KEY_LENGTH = 24;

const INFO_AUTH = "min-tid/v1/auth";
const INFO_ENC = "min-tid/v1/enc";
const INFO_RECOVERY = "min-tid/v1/recovery-kw";
/** Bound into every ciphertext as AES-GCM additional data (domain separation). */
const STATE_AAD = "min-tid/v1/state";

export type Envelope = { v: 1; iv: string; ct: string };

export type CryptoErrorCode =
  | "BAD_SALT"
  | "BAD_ENVELOPE"
  | "DECRYPT_FAILED"
  | "BAD_PLAINTEXT"
  | "BAD_RECOVERY_KEY"
  | "WRONG_RECOVERY_KEY";

const MESSAGES: Record<CryptoErrorCode, string> = {
  BAD_SALT: "Servern skickade ett ogiltigt salt för nyckeln.",
  BAD_ENVELOPE: "Den krypterade datan har fel format.",
  DECRYPT_FAILED:
    "Datan kunde inte låsas upp — fel nyckel, eller så har den ändrats sedan den krypterades.",
  BAD_PLAINTEXT: "Den upplåsta datan har fel format.",
  BAD_RECOVERY_KEY: "Återställningsnyckeln ska vara 24 tecken (siffror och bokstäver).",
  WRONG_RECOVERY_KEY: "Fel återställningsnyckel — kontrollera att du skrivit av den rätt.",
};

export class CryptoError extends Error {
  code: CryptoErrorCode;
  constructor(code: CryptoErrorCode) {
    super(MESSAGES[code]);
    this.name = "CryptoError";
    this.code = code;
  }
}

// Looked up on every call (not captured at import) so tests can spy on it.
const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();

// ─── base64 ───────────────────────────────────────────────────
const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function bytesToBase64(bytes: Uint8Array): string {
  // Chunked: String.fromCharCode(...hugeArray) overflows the call stack.
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Strict standard base64 (with padding). Throws on anything else. */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  if (typeof b64 !== "string" || !B64_RE.test(b64)) throw new TypeError("invalid base64");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function tryBase64(b64: unknown): Uint8Array<ArrayBuffer> | null {
  try {
    return base64ToBytes(b64 as string);
  } catch {
    return null;
  }
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function randomSalt(): string {
  return bytesToBase64(randomBytes(SALT_BYTES));
}

// ─── key derivation ───────────────────────────────────────────
export interface DerivedKeys {
  /** Base64 of 32 bytes. Sent to the server in place of the secret. */
  authKey: string;
  /** AES-GCM-256, non-extractable, encrypt/decrypt. */
  encKey: CryptoKey;
  /** AES-KW-wrap this encKey under a recovery key. Returns base64 (40 bytes). */
  wrapEncKey(recoveryKey: string): Promise<string>;
}

function hkdf(info: string) {
  return { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(info) };
}

const AES_GCM_256 = { name: "AES-GCM", length: 256 } as const;

export async function deriveKeys(
  secret: string,
  saltB64: string,
  opts: { iterations?: number } = {},
): Promise<DerivedKeys> {
  const iterations = opts.iterations ?? PBKDF2_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS) {
    throw new RangeError(`PBKDF2 needs at least ${MIN_ITERATIONS} iterations`);
  }
  const salt = tryBase64(saltB64);
  if (!salt || salt.length !== SALT_BYTES) throw new CryptoError("BAD_SALT");

  // NFC so "å" typed as one code point or as a + ring derives the same key everywhere.
  const pw = await subtle().importKey("raw", enc.encode(secret.normalize("NFC")), "PBKDF2", false, [
    "deriveBits",
  ]);
  const master = await subtle().deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    pw,
    KEY_BYTES * 8,
  );
  const base = await subtle().importKey("raw", master, "HKDF", false, ["deriveBits", "deriveKey"]);

  const authBits = await subtle().deriveBits(hkdf(INFO_AUTH), base, KEY_BYTES * 8);
  const encKey = await subtle().deriveKey(hkdf(INFO_ENC), base, AES_GCM_256, false, [
    "encrypt",
    "decrypt",
  ]);

  return {
    authKey: bytesToBase64(new Uint8Array(authBits)),
    encKey,
    async wrapEncKey(recoveryKey: string) {
      const kek = await recoveryKek(recoveryKey, "wrapKey");
      // Same derivation as encKey, but extractable — exists only for this call.
      const twin = await subtle().deriveKey(hkdf(INFO_ENC), base, AES_GCM_256, true, [
        "encrypt",
        "decrypt",
      ]);
      const wrapped = await subtle().wrapKey("raw", twin, kek, "AES-KW");
      return bytesToBase64(new Uint8Array(wrapped));
    },
  };
}

// ─── state envelope ───────────────────────────────────────────
function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function isEnvelope(x: unknown): x is Envelope {
  if (!isPlainObject(x)) return false;
  const keys = Object.keys(x);
  if (keys.length !== 3 || !("v" in x) || !("iv" in x) || !("ct" in x)) return false;
  if (x.v !== 1) return false;
  const iv = tryBase64(x.iv);
  const ct = tryBase64(x.ct);
  return !!iv && iv.length === IV_BYTES && !!ct && ct.length >= GCM_TAG_BYTES;
}

export async function encryptState(state: object, encKey: CryptoKey): Promise<Envelope> {
  if (!isPlainObject(state)) throw new TypeError("encryptState expects a state object");
  const iv = randomBytes(IV_BYTES); // fresh for every encryption — never reuse with GCM
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(STATE_AAD) },
    encKey,
    enc.encode(JSON.stringify(state)),
  );
  return { v: 1, iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

export async function decryptState<T = Record<string, unknown>>(
  envelope: unknown,
  encKey: CryptoKey,
): Promise<T> {
  if (!isEnvelope(envelope)) throw new CryptoError("BAD_ENVELOPE");
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(envelope.iv),
        additionalData: enc.encode(STATE_AAD),
      },
      encKey,
      base64ToBytes(envelope.ct),
    );
  } catch {
    // GCM authentication failed: wrong key, or iv/ct/tag were altered.
    throw new CryptoError("DECRYPT_FAILED");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
  } catch {
    throw new CryptoError("BAD_PLAINTEXT");
  }
  if (!isPlainObject(parsed)) throw new CryptoError("BAD_PLAINTEXT");
  return parsed as T;
}

// ─── recovery key ─────────────────────────────────────────────
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 15 random bytes → exactly 24 Crockford base32 characters (120 bits). */
export function generateRecoveryKey(): string {
  const bytes = randomBytes((RECOVERY_KEY_LENGTH * 5) / 8);
  let out = "";
  let buf = 0;
  let bits = 0;
  for (const b of bytes) {
    buf = (buf << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(buf >> bits) & 31];
    }
    buf &= (1 << bits) - 1;
  }
  return out;
}

/**
 * Canonical form of a typed recovery key, or null if it can't be one. Forgiving the
 * way Crockford intends: case, spaces and dashes are ignored; I/L read as 1, O as 0.
 */
export function normalizeRecoveryKey(input: string): string | null {
  const s = String(input ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (s.length !== RECOVERY_KEY_LENGTH) return null;
  for (const ch of s) if (!CROCKFORD.includes(ch)) return null;
  return s;
}

/** "ABCD-EFGH-…" for display and print. */
export function formatRecoveryKey(key: string): string {
  return (normalizeRecoveryKey(key) ?? key).match(/.{1,4}/g)!.join("-");
}

function recoveryKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const norm = normalizeRecoveryKey(key);
  if (!norm) throw new CryptoError("BAD_RECOVERY_KEY");
  const out = new Uint8Array((RECOVERY_KEY_LENGTH * 5) / 8);
  let buf = 0;
  let bits = 0;
  let i = 0;
  for (const ch of norm) {
    buf = (buf << 5) | CROCKFORD.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[i++] = (buf >> bits) & 0xff;
    }
    buf &= (1 << bits) - 1;
  }
  return out;
}

/**
 * The recovery key already carries 120 bits of entropy, so HKDF (not a slow KDF) is
 * enough to turn it into a 256-bit AES-KW key.
 */
async function recoveryKek(key: string, usage: "wrapKey" | "unwrapKey"): Promise<CryptoKey> {
  const ikm = await subtle().importKey("raw", recoveryKeyBytes(key), "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(hkdf(INFO_RECOVERY), ikm, { name: "AES-KW", length: 256 }, false, [
    usage,
  ]);
}

/** Recover encKey from the server's wrapped copy. The result is non-extractable. */
export async function unwrapEncKey(wrappedKeyB64: string, recoveryKey: string): Promise<CryptoKey> {
  const kek = await recoveryKek(recoveryKey, "unwrapKey");
  const wrapped = tryBase64(wrappedKeyB64);
  if (!wrapped || wrapped.length !== KEY_BYTES + 8) throw new CryptoError("WRONG_RECOVERY_KEY");
  try {
    return await subtle().unwrapKey("raw", wrapped, kek, "AES-KW", AES_GCM_256, false, [
      "encrypt",
      "decrypt",
    ]);
  } catch {
    // AES-KW's integrity check failed: another recovery key, or a damaged wrap.
    throw new CryptoError("WRONG_RECOVERY_KEY");
  }
}
