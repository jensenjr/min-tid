// Sync API client — all communication with the min-tid backend.
//
// Sync is end-to-end encrypted. Callers keep the same functions and signatures as
// before; key derivation, encryption and decryption all happen in here:
//
//   syncRegister / syncLogin  fetch the account salt, derive { authKey, encKey } from
//                             the secret (crypto.ts), send only authKey, keep encKey in
//                             IndexedDB (keyStore.ts) and return decrypted state.
//                             A legacy (plaintext) account is migrated on its first login.
//   syncPush / syncPull       encrypt / decrypt with the device key.
//   syncChangeSecret          re-encrypts the cloud copy under the new secret and mints a
//                             new recovery key (the old one stops working).
//   syncRecover*              SMS restores the account; the recovery key restores the data.
//
// The server sees the username, the bcrypt hash of authKey, the salt, timestamps, the
// wrapped recovery key and { v: 1, iv, ct }. Never the secret, the key or the data.

import {
  decryptState,
  deriveKeys,
  encryptState,
  generateRecoveryKey,
  randomSalt,
  unwrapEncKey,
  CryptoError,
  type DerivedKeys,
} from "./crypto";
import {
  createDefaultKeyStore,
  type DeviceKey,
  type KeyStore,
  type PendingRecoveryKey,
  type RecoveryKeyReason,
} from "./keyStore";

export type { PendingRecoveryKey, RecoveryKeyReason } from "./keyStore";

export interface SyncState {
  name: string;
  department?: string;
  schedule: unknown; // legacy single week — week 1 of the current schedule period
  schedules?: unknown; // SchedulePeriod[] (rotating schedule periods)
  reportingMode?: unknown; // "schedule" | "punch"
  sessions: unknown[];
  absences: unknown[];
  expenses: unknown[];
  flexBaseMinutes: number;
  flexBaseDate?: string; // the flex balance is at the END of this day (Excel import)
  vacation?: unknown; // VacationSettings (incl. the imported opening balance)
  trackingStartDate?: string;
  scheduleExceptions?: unknown;
  autoLunchThresholdMin?: unknown; // minutes; one session longer than this gets the schedule lunch
  confirmedDays?: unknown; // Record<YYYY-MM-DD, true>
  lockedMonths?: unknown; // Record<YYYY-MM, { at, by }>
  dayAdjustments?: unknown; // Record<YYYY-MM-DD, DayAdjustment>
  auditLog?: unknown; // { at, action, month }[]
}

// Base URL — empty string in dev (Vite proxies /api → localhost:3001)
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

/** Sent on every request so the server can tell this client from pre-encryption builds. */
export const SYNC_PROTOCOL_HEADER = "X-Sync-Protocol";
export const SYNC_PROTOCOL_VERSION = "2";

const MIN_SECRET_LENGTH = 6;
const MAX_CONFLICT_RETRIES = 3;

/**
 * A failed sync call, with enough context for the diagnostics panel and the
 * felanmälan. `status === 0` means the request never got a response at all —
 * offline, DNS, TLS, or a network that swallows it (captive portal, filter).
 *
 * Encryption adds three statuses that never come from a proxy (see syncDiagnostics):
 *   401 + code NO_KEY          this device has a token but no key → log in again
 *   409 + code KEY_CHANGED     the secret was changed on another device → log in again
 *   422 + code DECRYPT_FAILED  the cloud copy doesn't decrypt with this device's key
 */
export class SyncApiError extends Error {
  status: number;
  path: string;
  method: string;
  /** Machine-readable reason from the server or this client (e.g. "KEY_CHANGED"). */
  code?: string;
  constructor(message: string, status: number, path: string, method: string, code?: string) {
    super(message);
    this.name = "SyncApiError";
    this.status = status;
    this.path = path;
    this.method = method;
    this.code = code;
  }
}

const noKey = (method: string, path = "/api/sync") =>
  new SyncApiError(
    "Den här enheten saknar nyckeln till den krypterade synken. Logga in igen med ditt användarnamn och din synk-kod — dina data på enheten finns kvar.",
    401,
    path,
    method,
    "NO_KEY",
  );
const keyChanged = (method: string, path = "/api/sync") =>
  new SyncApiError(
    "Synk-koden har bytts på en annan enhet. Logga in igen med den nya synk-koden — dina data på enheten finns kvar.",
    409,
    path,
    method,
    "KEY_CHANGED",
  );
const notMigrated = (method: string, path = "/api/sync") =>
  new SyncApiError(
    "Kontot är inte krypterat ännu. Logga in igen med din synk-kod så aktiveras krypterad synk.",
    409,
    path,
    method,
    "NOT_MIGRATED",
  );
const decryptFailed = (method: string, path: string) =>
  new SyncApiError(
    "Molnkopian kunde inte låsas upp med nyckeln på den här enheten. Logga in igen — kvarstår det, skicka felloggen.",
    422,
    path,
    method,
    "DECRYPT_FAILED",
  );
const recoveryKeyRequired = () =>
  new SyncApiError(
    "Molnets data är krypterad och kan bara låsas upp med återställningsnyckeln. Ange den, eller välj att börja om utan molnets data.",
    409,
    "/api/auth/secret",
    "PUT",
    "RECOVERY_KEY_REQUIRED",
  );
const changedDuringRecovery = () =>
  new SyncApiError(
    "Kontot ändrades från en annan enhet medan du återställde det. Börja om återställningen.",
    409,
    "/api/auth/secret",
    "PUT",
    "CONFLICT",
  );

// ─── device state (swappable in tests) ────────────────────────
let keyStore: KeyStore = createDefaultKeyStore();
let kdfIterations: number | undefined;

/**
 * Test-only: swap the key store (one per simulated device) and lower the PBKDF2 cost.
 * Pass null to restore the defaults. Production never calls this.
 */
export function __setSyncTestHooks(hooks: { keyStore?: KeyStore; iterations?: number } | null) {
  keyStore = hooks?.keyStore ?? createDefaultKeyStore();
  kdfIterations = hooks?.iterations;
}

const kdfOpts = () => (kdfIterations ? { iterations: kdfIterations } : {});

// Every operation that reads or replaces the device key runs one at a time, so a push
// can never encrypt with a key that a concurrent secret change is about to retire.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(() => fn());
  queue = run.catch(() => undefined);
  return run;
}

function assertSecret(secret: string) {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`Synk-koden måste vara minst ${MIN_SECRET_LENGTH} tecken.`);
  }
}

// ─── transport ────────────────────────────────────────────────
async function call<T>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [SYNC_PROTOCOL_HEADER]: SYNC_PROTOCOL_VERSION,
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch {
    // fetch only rejects when the request never completed.
    const online = typeof navigator === "undefined" || navigator.onLine !== false;
    throw new SyncApiError(
      online ? "Ingen kontakt med servern (blockerad eller otillgänglig)." : "Enheten är offline.",
      0,
      path,
      method,
    );
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    throw new SyncApiError(body.error ?? `HTTP ${res.status}`, res.status, path, method, body.code);
  }
  return body as T;
}

type SaltResponse = { salt: string; encrypted: boolean };
type SessionResponse = {
  userId: string;
  username?: string;
  token: string;
  state: unknown;
  updatedAt: number;
  encrypted?: boolean;
  salt?: string;
};
type ServerState = { state: unknown; updatedAt: number; encrypted?: boolean; salt?: string };

const saltFor = (username: string) =>
  call<SaltResponse>("GET", `/api/auth/salt?username=${encodeURIComponent(username)}`);

const fetchServerState = (token: string) => call<ServerState>("GET", "/api/sync", { token });

/** userId claim of our JWT (no verification — only used to match the stored key). */
function tokenUserId(token: string): string | null {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const id = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="))).userId;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/** The key this device holds for the token's account, or a NO_KEY error. */
async function deviceKeyFor(token: string, method: string, path?: string): Promise<DeviceKey> {
  const key = await keyStore.getKey();
  const uid = tokenUserId(token);
  if (!key || (uid !== null && uid !== key.userId)) throw noKey(method, path);
  return key;
}

async function decryptOrThrow(
  envelope: unknown,
  key: CryptoKey,
  method: string,
  path: string,
): Promise<SyncState> {
  try {
    return await decryptState<SyncState>(envelope, key);
  } catch (e) {
    if (e instanceof CryptoError) throw decryptFailed(method, path);
    throw e;
  }
}

/** No answer, or a server error: the write may or may not have happened. */
const outcomeUnknown = (e: unknown) =>
  e instanceof SyncApiError && (e.status === 0 || e.status >= 500);

// ─── recovery-key prompt plumbing ─────────────────────────────
const pendingListeners = new Set<() => void>();
const notifyPending = () => pendingListeners.forEach((l) => l());

/** Subscribe to "a recovery key is waiting to be shown / was acknowledged". */
export function onPendingRecoveryKeyChange(listener: () => void): () => void {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
}

/** The recovery key still to be shown, if it belongs to this device's current key. */
export async function getPendingRecoveryKey(): Promise<PendingRecoveryKey | null> {
  const [pending, key] = await Promise.all([keyStore.getPending(), keyStore.getKey()]);
  return pending && key && pending.salt === key.salt ? pending : null;
}

/** The user has saved the recovery key: forget it on this device for good. */
export async function acknowledgeRecoveryKey(): Promise<void> {
  await keyStore.setPending(null);
  notifyPending();
}

/** Forget this device's key (e.g. "Koppla från här"). The account is untouched. */
export function syncForgetDeviceKey(): Promise<void> {
  return serial(async () => {
    await keyStore.clear();
    notifyPending();
  });
}

/**
 * Make `keys` the account's key: re-encrypt the current cloud state under it, wrap it
 * with a fresh recovery key, and swap hash + salt + envelope + recovery wrap in one
 * atomic PUT /api/auth/secret. If another device wrote in between, the server answers
 * CONFLICT; `reload` re-reads (and decrypts) the newer state and we try again.
 */
async function commitNewKey(o: {
  token: string;
  userId: string;
  username: string;
  keys: DerivedKeys;
  salt: string;
  reason: RecoveryKeyReason;
  current: { state: SyncState | null; updatedAt: number };
  reload: () => Promise<{ state: SyncState | null; updatedAt: number }>;
  discardState?: boolean;
}): Promise<{ state: SyncState | null; updatedAt: number }> {
  const recoveryKey = generateRecoveryKey();
  const wrappedKey = await o.keys.wrapEncKey(recoveryKey);
  // Stored before the request: if the response is lost the key is still shown once this
  // device logs in with the new key (getPendingRecoveryKey matches on salt).
  const previousPending = await keyStore.getPending();
  await keyStore.setPending({
    key: recoveryKey,
    salt: o.salt,
    username: o.username,
    reason: o.reason,
  });

  let cur = o.current;
  for (let attempt = 0; ; attempt++) {
    const state =
      cur.state && !o.discardState ? await encryptState(cur.state, o.keys.encKey) : null;
    try {
      const r = await call<{ ok: boolean; updatedAt: number }>("PUT", "/api/auth/secret", {
        token: o.token,
        body: {
          authKey: o.keys.authKey,
          salt: o.salt,
          state,
          recovery: { v: 1, wrappedKey },
          baseRev: cur.updatedAt,
          ...(o.discardState ? { discardState: true } : {}),
        },
      });
      await keyStore.setKey({
        userId: o.userId,
        username: o.username,
        salt: o.salt,
        encKey: o.keys.encKey,
      });
      notifyPending();
      return { state: o.discardState ? null : cur.state, updatedAt: r.updatedAt ?? 0 };
    } catch (e) {
      let failure: unknown = e;
      if (e instanceof SyncApiError && e.code === "CONFLICT" && attempt < MAX_CONFLICT_RETRIES) {
        try {
          cur = await o.reload();
          continue;
        } catch (reloadError) {
          failure = reloadError;
        }
      }
      // The account certainly still has its old key: put back whatever was pending.
      if (!outcomeUnknown(failure)) await keyStore.setPending(previousPending);
      throw failure;
    }
  }
}

// ─── account ──────────────────────────────────────────────────
export function syncRegister(
  username: string,
  secret: string,
): Promise<{ userId: string; token: string; recoveryKey: string }> {
  assertSecret(secret);
  return serial(async () => {
    const { salt } = await saltFor(username);
    const keys = await deriveKeys(secret, salt, kdfOpts());
    const recoveryKey = generateRecoveryKey();
    const wrappedKey = await keys.wrapEncKey(recoveryKey);
    const previousPending = await keyStore.getPending();
    await keyStore.setPending({ key: recoveryKey, salt, username, reason: "created" });
    let res: { userId: string; token: string; salt?: string };
    try {
      res = await call("POST", "/api/auth/register", {
        body: { username, authKey: keys.authKey, salt, recovery: { v: 1, wrappedKey } },
      });
    } catch (e) {
      if (!outcomeUnknown(e)) await keyStore.setPending(previousPending);
      throw e;
    }
    await keyStore.setKey({ userId: res.userId, username, salt, encKey: keys.encKey });
    notifyPending();
    return { userId: res.userId, token: res.token, recoveryKey };
  });
}

class RestartLogin extends Error {}

export function syncLogin(
  username: string,
  secret: string,
): Promise<{ userId: string; token: string; state: SyncState | null; updatedAt: number }> {
  return serial(() => loginFlow(username, secret, 0));
}

async function loginFlow(
  username: string,
  secret: string,
  attempt: number,
): Promise<{ userId: string; token: string; state: SyncState | null; updatedAt: number }> {
  const s = await saltFor(username);

  if (s.encrypted) {
    const keys = await deriveKeys(secret, s.salt, kdfOpts());
    const res = await call<SessionResponse>("POST", "/api/auth/login", {
      body: { username, authKey: keys.authKey },
    });
    const state =
      res.state == null
        ? null
        : await decryptOrThrow(res.state, keys.encKey, "POST", "/api/auth/login");
    await keyStore.setKey({
      userId: res.userId,
      username: res.username ?? username,
      salt: s.salt,
      encKey: keys.encKey,
    });
    const pending = await keyStore.getPending();
    if (pending && pending.salt !== s.salt) await keyStore.setPending(null);
    notifyPending();
    return { userId: res.userId, token: res.token, state, updatedAt: res.updatedAt ?? 0 };
  }

  // Legacy account: authenticate with the raw secret one last time, then migrate.
  let res: SessionResponse;
  try {
    res = await call<SessionResponse>("POST", "/api/auth/login", { body: { username, secret } });
  } catch (e) {
    // Another device finished the migration between our salt lookup and the login.
    if (e instanceof SyncApiError && e.code === "USE_AUTH_KEY" && attempt < 2) {
      return loginFlow(username, secret, attempt + 1);
    }
    throw e;
  }
  const keys = await deriveKeys(secret, s.salt, kdfOpts());
  try {
    const done = await commitNewKey({
      token: res.token,
      userId: res.userId,
      username: res.username ?? username,
      keys,
      salt: s.salt,
      reason: "migrated",
      current: { state: (res.state as SyncState | null) ?? null, updatedAt: res.updatedAt ?? 0 },
      reload: async () => {
        const r = await fetchServerState(res.token);
        if (r.encrypted) throw new RestartLogin();
        return { state: (r.state as SyncState | null) ?? null, updatedAt: r.updatedAt ?? 0 };
      },
    });
    return { userId: res.userId, token: res.token, ...done };
  } catch (e) {
    if (e instanceof RestartLogin && attempt < 2) return loginFlow(username, secret, attempt + 1);
    throw e;
  }
}

// ─── state ────────────────────────────────────────────────────
/** Push the full state blob, encrypted. Returns the server's new revision marker. */
export function syncPush(token: string, state: SyncState): Promise<number> {
  return serial(async () => {
    const key = await deviceKeyFor(token, "PUT");
    const envelope = await encryptState(state, key.encKey);
    const { updatedAt } = await call<{ ok: boolean; updatedAt: number }>("PUT", "/api/sync", {
      token,
      body: { state: envelope, salt: key.salt },
    });
    return updatedAt ?? 0;
  });
}

/** Fetch and decrypt the stored state plus its revision marker (0 when nothing is stored yet). */
export function syncPull(token: string): Promise<{ state: SyncState | null; updatedAt: number }> {
  return serial(async () => {
    const key = await deviceKeyFor(token, "GET");
    const r = await fetchServerState(token);
    if (!r.encrypted) throw notMigrated("GET");
    if (r.salt !== key.salt) throw keyChanged("GET");
    const state =
      r.state == null ? null : await decryptOrThrow(r.state, key.encKey, "GET", "/api/sync");
    return { state, updatedAt: r.updatedAt ?? 0 };
  });
}

export function syncDeleteAccount(token: string): Promise<void> {
  return serial(async () => {
    try {
      await call("DELETE", "/api/account", { token });
    } finally {
      // The caller disconnects this device either way; the key is of no further use.
      await keyStore.clear();
      notifyPending();
    }
  });
}

/**
 * Change the sync secret. The encryption key is derived from the secret, so this
 * re-encrypts the cloud copy under the new key and replaces the recovery key (the new
 * one is offered through the recovery-key prompt). Other devices get KEY_CHANGED until
 * they log in with the new secret.
 */
export function syncChangeSecret(token: string, newSecret: string): Promise<void> {
  assertSecret(newSecret);
  return serial(async () => {
    const key = await deviceKeyFor(token, "PUT", "/api/auth/secret");
    const read = async () => {
      const r = await fetchServerState(token);
      if (!r.encrypted) throw notMigrated("GET");
      if (r.salt !== key.salt) throw keyChanged("GET");
      const state =
        r.state == null ? null : await decryptOrThrow(r.state, key.encKey, "GET", "/api/sync");
      return { state, updatedAt: r.updatedAt ?? 0 };
    };
    const current = await read();
    const salt = randomSalt();
    const keys = await deriveKeys(newSecret, salt, kdfOpts());
    await commitNewKey({
      token,
      userId: key.userId,
      username: key.username,
      keys,
      salt,
      reason: "rotated",
      current,
      reload: read,
    });
  });
}

// ─── phone ────────────────────────────────────────────────────
export async function syncSendPhoneCode(token: string, phone: string): Promise<void> {
  await call("POST", "/api/auth/phone", { token, body: { phone } });
}

export async function syncVerifyPhone(token: string, phone: string, code: string): Promise<void> {
  await call("POST", "/api/auth/phone/verify", { token, body: { phone, code } });
}

export async function syncRecoverRequest(phone: string): Promise<void> {
  await call("POST", "/api/auth/recover/request", { body: { phone } });
}

// ─── SMS recovery ─────────────────────────────────────────────
/**
 * A verified SMS code gives back the account (a token), not the data: an encrypted
 * cloud copy only opens with the recovery key. Finish with syncRecoverComplete, which
 * always sets a new secret (the old one is presumably forgotten).
 */
export interface RecoverySession {
  readonly username: string;
  readonly userId: string;
  readonly token: string;
  /** Encrypted data exists in the cloud: it can only be kept with the recovery key. */
  readonly needsRecoveryKey: boolean;
  /** The server holds a wrapped key (false for accounts that were never encrypted). */
  readonly hasRecoveryKey: boolean;
  /** syncRecoverUnlock succeeded. */
  unlocked: boolean;
}

type RecoveryInternals = {
  encrypted: boolean;
  salt?: string;
  state: unknown;
  updatedAt: number;
  wrappedKey: string | null;
  oldKey?: CryptoKey;
  plaintext?: SyncState;
};
// Ciphertext, plaintext and keys stay out of the session object (which lives in React state).
const recoveryInternals = new WeakMap<RecoverySession, RecoveryInternals>();

function internalsOf(session: RecoverySession): RecoveryInternals {
  const i = recoveryInternals.get(session);
  if (!i) throw new Error("Okänd återställningssession. Börja om.");
  return i;
}

export async function syncRecoverConfirm(phone: string, code: string): Promise<RecoverySession> {
  const r = await call<
    SessionResponse & { username: string; recovery?: { wrappedKey?: string } | null }
  >("POST", "/api/auth/recover/confirm", { body: { phone, code } });
  const encrypted = !!r.encrypted;
  const session: RecoverySession = {
    username: r.username,
    userId: r.userId,
    token: r.token,
    needsRecoveryKey: encrypted && r.state != null,
    hasRecoveryKey: !!r.recovery?.wrappedKey,
    unlocked: false,
  };
  recoveryInternals.set(session, {
    encrypted,
    salt: r.salt,
    state: r.state ?? null,
    updatedAt: r.updatedAt ?? 0,
    wrappedKey: r.recovery?.wrappedKey ?? null,
  });
  return session;
}

/** Unwrap the old key with the recovery key and decrypt the cloud copy (in memory only). */
export async function syncRecoverUnlock(
  session: RecoverySession,
  recoveryKey: string,
): Promise<void> {
  const i = internalsOf(session);
  if (!session.needsRecoveryKey) {
    session.unlocked = true;
    return;
  }
  if (!i.wrappedKey) {
    throw new Error(
      "Kontot har ingen återställningsnyckel sparad, så molnets data kan inte låsas upp.",
    );
  }
  const oldKey = await unwrapEncKey(i.wrappedKey, recoveryKey); // CryptoError on a wrong key
  i.plaintext = await decryptState<SyncState>(i.state, oldKey);
  i.oldKey = oldKey;
  session.unlocked = true;
}

/**
 * Set a new secret and re-key the account. Keeps the cloud data when it is unlocked
 * (or plaintext / empty); otherwise refuses — unless the user explicitly chose to
 * discard the undecryptable cloud copy, in which case this device seeds it afresh.
 */
export function syncRecoverComplete(
  session: RecoverySession,
  newSecret: string,
  opts: { discardCloudData?: boolean } = {},
): Promise<{
  token: string;
  username: string;
  userId: string;
  state: SyncState | null;
  updatedAt: number;
}> {
  assertSecret(newSecret);
  return serial(async () => {
    const i = internalsOf(session);
    const discard = i.encrypted && !!opts.discardCloudData;
    let current: { state: SyncState | null; updatedAt: number };
    let reload: () => Promise<{ state: SyncState | null; updatedAt: number }>;

    if (!i.encrypted) {
      // Never-encrypted account: its plaintext is migrated under the new secret.
      current = { state: (i.state as SyncState | null) ?? null, updatedAt: i.updatedAt };
      reload = async () => {
        const r = await fetchServerState(session.token);
        if (r.encrypted) throw changedDuringRecovery();
        return { state: (r.state as SyncState | null) ?? null, updatedAt: r.updatedAt ?? 0 };
      };
    } else if (i.state == null || discard) {
      current = { state: null, updatedAt: i.updatedAt };
      reload = async () => {
        const r = await fetchServerState(session.token);
        if (r.state != null && !discard) throw recoveryKeyRequired();
        return { state: null, updatedAt: r.updatedAt ?? 0 };
      };
    } else if (i.oldKey && i.plaintext) {
      const oldKey = i.oldKey;
      current = { state: i.plaintext, updatedAt: i.updatedAt };
      reload = async () => {
        const r = await fetchServerState(session.token);
        if (!r.encrypted || r.salt !== i.salt) throw changedDuringRecovery();
        const state =
          r.state == null ? null : await decryptOrThrow(r.state, oldKey, "GET", "/api/sync");
        return { state, updatedAt: r.updatedAt ?? 0 };
      };
    } else {
      throw recoveryKeyRequired();
    }

    const salt = randomSalt();
    const keys = await deriveKeys(newSecret, salt, kdfOpts());
    const done = await commitNewKey({
      token: session.token,
      userId: session.userId,
      username: session.username,
      keys,
      salt,
      reason: "recovered",
      current,
      reload,
      discardState: discard,
    });
    return {
      token: session.token,
      username: session.username,
      userId: session.userId,
      ...done,
    };
  });
}

export const SYNC_TOKEN_KEY = "sync_token";
/** Last server revision this device has seen (pushed or pulled). */
export const SYNC_REV_KEY = "sync_rev";
/** "1" while this device holds local changes that have not reached the server. */
export const SYNC_DIRTY_KEY = "sync_dirty";
export const SYNC_USERNAME_KEY = "sync_username";
export const SYNC_PHONE_KEY = "sync_phone";
