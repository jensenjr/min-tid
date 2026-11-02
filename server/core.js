// Account + sync policy for the min-tid backend, free of express / bcryptjs /
// jsonwebtoken so root vitest can import it without server/node_modules. index.js
// injects the password hasher, the token signer and the JSON store.
//
// Invariants this file exists to protect:
//   • An encrypted account only ever stores { v: 1, iv, ct } (or null) — never plaintext.
//   • A legacy (plaintext) account never stores an envelope: a pre-encryption client
//     would read it as its state and wipe the user's data.
//   • A pre-encryption client never receives ciphertext and never overwrites it; it gets
//     a 409 that tells the user to update the app.
//   • An envelope made with a superseded key (the account's salt changed) is refused.
//   • Nothing here logs. Request bodies hold secrets and ciphertext.
//   • No await sits between reading a record and writing it back, so a concurrent
//     request can never be overwritten by a stale copy.
import { randomBytes as nodeRandomBytes, randomUUID as nodeRandomUUID } from "node:crypto";

/** Header a protocol-2 (encrypting) client sends on every request. */
export const PROTOCOL_HEADER = "x-sync-protocol";
export const PROTOCOL_VERSION = "2";

export const SALT_BYTES = 16;
export const AUTH_KEY_BYTES = 32;
export const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
export const WRAPPED_KEY_BYTES = 40; // AES-KW of a 32-byte key

// bcrypt of nothing in particular, so unknown usernames cost as much as known ones.
const DUMMY_HASH = "$2a$12$invalidhashpaddingtomatchcost000000000000000000000000000";

export const MESSAGES = {
  needsUpdate:
    "Synken är nu krypterad och kräver en nyare version av min-tid. Uppdatera appen (stäng den helt och öppna den igen) och logga sedan in på nytt. Dina data på enheten finns kvar.",
  keyChanged:
    "Synk-koden har bytts på en annan enhet. Logga in igen med den nya synk-koden — dina data på enheten finns kvar.",
  notMigrated:
    "Kontot är inte krypterat ännu. Logga in igen med din synk-kod så aktiveras krypterad synk.",
  useAuthKey: "Kontot har just krypterats. Försök logga in igen.",
  conflict: "Datan ändrades på en annan enhet samtidigt. Försök igen.",
  badCredentials: "Fel användarnamn eller synk-kod.",
  badUsername: "Användarnamnet måste vara 3–20 tecken (a–z, 0–9, _ eller -).",
  invalidUsername: "Ange ett giltigt användarnamn.",
  missingSecret: "Ange din synk-kod.",
  badRequest: "Ogiltig förfrågan.",
  badEnvelope: "Ogiltig krypterad data.",
  stateRequired: "Den krypterade datan saknas — inget har ändrats.",
  badState: "Ogiltig data.",
  userNotFound: "Användare inte hittad.",
  accountNotFound: "Kontot hittades inte.",
  shortSecret: "Den nya synk-koden måste vara minst 6 tecken.",
};

const taken = (username) => `Användarnamnet "${username}" är redan taget. Välj ett annat.`;

// ─── validation ───────────────────────────────────────────────
const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Decoded length of a strict, padded base64 string; -1 if it isn't one. */
export function b64Length(s) {
  if (typeof s !== "string" || !B64_RE.test(s)) return -1;
  return Buffer.from(s, "base64").length;
}

const isB64Bytes = (s, n) => b64Length(s) === n;

export function isValidUsername(u) {
  return typeof u === "string" && /^[a-zA-Z0-9_-]{3,20}$/.test(u);
}

const isPlainObject = (x) => typeof x === "object" && x !== null && !Array.isArray(x);

/** Exactly { v: 1, iv: 12 bytes, ct: ≥ 16 bytes } — no other keys. */
export function isEnvelope(x) {
  if (!isPlainObject(x)) return false;
  const keys = Object.keys(x);
  if (keys.length !== 3 || !("v" in x) || !("iv" in x) || !("ct" in x)) return false;
  return x.v === 1 && isB64Bytes(x.iv, IV_BYTES) && b64Length(x.ct) >= GCM_TAG_BYTES;
}

function isRecovery(x) {
  return isPlainObject(x) && x.v === 1 && isB64Bytes(x.wrappedKey, WRAPPED_KEY_BYTES);
}

const isRev = (n) => Number.isSafeInteger(n) && n >= 0;

// ─── core ─────────────────────────────────────────────────────
export function createCore({
  store,
  persist,
  hashSecret,
  compareSecret,
  signToken,
  now = Date.now,
  randomBytes = nodeRandomBytes,
  randomUUID = nodeRandomUUID,
}) {
  const ok = (body) => ({ status: 200, body });
  const fail = (status, error, code) => ({ status, body: code ? { error, code } : { error } });
  const needsUpdate = () => fail(409, MESSAGES.needsUpdate, "NEEDS_UPDATE");

  const byName = (username) => store.users[String(username).toLowerCase()] ?? null;
  const byId = (userId) => Object.values(store.users).find((u) => u.id === userId) ?? null;

  /** Strictly increasing revision, even for two writes in the same millisecond. */
  const nextRev = (u) => Math.max(now(), (u.stateUpdatedAt ?? 0) + 1);

  function session(u) {
    return {
      userId: u.id,
      username: u.username,
      token: signToken(u.id),
      state: u.state ?? null,
      updatedAt: u.stateUpdatedAt ?? 0,
      encrypted: !!u.encrypted,
      ...(u.encrypted ? { salt: u.salt } : {}),
    };
  }

  // GET /api/auth/salt?username=
  // Encrypted account → its salt. Unknown name → a fresh random salt (register commits
  // it), flagged encrypted so it looks like any other account. Legacy account → a fresh
  // salt for the migration, flagged encrypted: false.
  function salt({ username }) {
    if (!isValidUsername(username)) return fail(400, MESSAGES.invalidUsername);
    const u = byName(username);
    if (u?.encrypted) return ok({ salt: u.salt, encrypted: true });
    return ok({ salt: randomBytes(SALT_BYTES).toString("base64"), encrypted: !u });
  }

  // POST /api/auth/register  { username, authKey, salt, recovery: { v, wrappedKey } }
  async function register({ body }) {
    const b = isPlainObject(body) ? body : {};
    if (b.authKey === undefined && b.secret !== undefined) return needsUpdate();
    const { username, authKey, salt: accountSalt, recovery } = b;
    if (!isValidUsername(username)) return fail(400, MESSAGES.badUsername);
    if (
      !isB64Bytes(authKey, AUTH_KEY_BYTES) ||
      !isB64Bytes(accountSalt, SALT_BYTES) ||
      !isRecovery(recovery)
    ) {
      return fail(400, MESSAGES.badRequest);
    }
    if (byName(username)) return fail(409, taken(username));
    const secretHash = await hashSecret(authKey);
    // Re-check: another registration of the same name may have finished meanwhile.
    if (byName(username)) return fail(409, taken(username));
    const t = now();
    const user = {
      id: randomUUID(),
      username,
      secretHash,
      encrypted: true,
      salt: accountSalt,
      state: null,
      stateUpdatedAt: 0,
      recovery: { v: 1, wrappedKey: recovery.wrappedKey, updatedAt: t },
      createdAt: t,
      lastActivity: t,
    };
    store.users[username.toLowerCase()] = user;
    persist();
    return ok({ userId: user.id, token: signToken(user.id), salt: accountSalt });
  }

  // POST /api/auth/login  { username, authKey }  (legacy accounts: { username, secret })
  async function login({ body, e2e }) {
    const b = isPlainObject(body) ? body : {};
    const { username } = b;
    if (!isValidUsername(username)) return fail(400, MESSAGES.invalidUsername);
    const usesAuthKey = b.authKey !== undefined;
    const candidate = usesAuthKey ? b.authKey : b.secret;
    if (typeof candidate !== "string" || !candidate) return fail(400, MESSAGES.missingSecret);

    const user = byName(username);
    if (!user) {
      await compareSecret(candidate, DUMMY_HASH);
      return fail(401, MESSAGES.badCredentials);
    }
    if (user.encrypted && !usesAuthKey) {
      // An old client must not get ciphertext; a new one raced a migration and retries.
      return e2e ? fail(409, MESSAGES.useAuthKey, "USE_AUTH_KEY") : needsUpdate();
    }
    const valid = await compareSecret(candidate, user.secretHash);
    if (!valid || (usesAuthKey && !user.encrypted)) return fail(401, MESSAGES.badCredentials);

    // Re-read after the await and touch only lastActivity, so a push that landed while
    // bcrypt ran is not reverted by a stale copy.
    const fresh = byName(username);
    if (!fresh || fresh.id !== user.id) return fail(401, MESSAGES.badCredentials);
    fresh.lastActivity = now();
    persist();
    return ok(session(fresh));
  }

  // GET /api/sync
  function syncGet({ userId, e2e }) {
    const u = byId(userId);
    if (!u) return fail(404, MESSAGES.userNotFound);
    if (u.encrypted) {
      if (!e2e) return needsUpdate();
      return ok({
        state: u.state ?? null,
        updatedAt: u.stateUpdatedAt ?? 0,
        encrypted: true,
        salt: u.salt,
      });
    }
    return ok({ state: u.state ?? null, updatedAt: u.stateUpdatedAt ?? 0, encrypted: false });
  }

  // PUT /api/sync  encrypted: { state: { v, iv, ct }, salt }   legacy: { state }
  function syncPut({ userId, e2e, body }) {
    const u = byId(userId);
    if (!u) return fail(404, MESSAGES.userNotFound);
    const b = isPlainObject(body) ? body : {};
    const { state } = b;
    if (u.encrypted) {
      if (!e2e) return needsUpdate();
      if (!isEnvelope(state)) return fail(400, MESSAGES.badEnvelope, "BAD_ENVELOPE");
      if (b.salt !== u.salt) return fail(409, MESSAGES.keyChanged, "KEY_CHANGED");
    } else {
      // Nothing from an encrypting client — and no envelope from anyone — may land in a
      // plaintext account: an old client would adopt it as its state.
      if (e2e || isEnvelope(state)) return fail(409, MESSAGES.notMigrated, "NOT_MIGRATED");
      if (!isPlainObject(state)) return fail(400, MESSAGES.badState);
    }
    const rev = nextRev(u);
    u.state = state;
    u.stateUpdatedAt = rev;
    u.lastActivity = now();
    persist();
    return ok({ ok: true, updatedAt: rev });
  }

  // PUT /api/auth/secret
  //   encrypting client: { authKey, salt, state: envelope | null, recovery, baseRev, discardState? }
  //     → migration (legacy account), secret change, or reset after SMS recovery. One
  //       atomic write: hash, salt, envelope and recovery wrap change together, and the
  //       plaintext state is gone.
  //   pre-encryption client: { newSecret } → legacy accounts only.
  async function changeSecret({ userId, body }) {
    const u0 = byId(userId);
    if (!u0) return fail(404, MESSAGES.userNotFound);
    const b = isPlainObject(body) ? body : {};

    if (b.authKey === undefined) {
      if (u0.encrypted) return needsUpdate();
      if (typeof b.newSecret !== "string" || b.newSecret.length < 6) {
        return fail(400, MESSAGES.shortSecret);
      }
      const secretHash = await hashSecret(b.newSecret);
      const u = byId(userId);
      if (!u) return fail(404, MESSAGES.userNotFound);
      if (u.encrypted) return needsUpdate(); // migrated while we hashed
      u.secretHash = secretHash;
      u.lastActivity = now();
      persist();
      return ok({ ok: true });
    }

    const { authKey, salt: newSalt, state, recovery, baseRev, discardState } = b;
    if (
      !isB64Bytes(authKey, AUTH_KEY_BYTES) ||
      !isB64Bytes(newSalt, SALT_BYTES) ||
      !isRecovery(recovery) ||
      !isRev(baseRev)
    ) {
      return fail(400, MESSAGES.badRequest);
    }
    if (state !== null && !isEnvelope(state))
      return fail(400, MESSAGES.badEnvelope, "BAD_ENVELOPE");

    const secretHash = await hashSecret(authKey);

    // Synchronous from here on: no request can interleave between the checks and the write.
    const u = byId(userId);
    if (!u) return fail(404, MESSAGES.userNotFound);
    if ((u.stateUpdatedAt ?? 0) !== baseRev) return fail(409, MESSAGES.conflict, "CONFLICT");
    if (state === null && u.state != null && discardState !== true) {
      return fail(400, MESSAGES.stateRequired, "STATE_REQUIRED");
    }
    const rev = nextRev(u);
    u.secretHash = secretHash;
    u.encrypted = true;
    u.salt = newSalt;
    u.state = state; // replaces (deletes) any plaintext
    u.stateUpdatedAt = rev;
    u.recovery = { v: 1, wrappedKey: recovery.wrappedKey, updatedAt: rev };
    u.lastActivity = now();
    persist();
    return ok({ ok: true, updatedAt: rev });
  }

  // Response for POST /api/auth/recover/confirm, after index.js has verified the SMS code.
  function recoveredSession({ userId, e2e }) {
    const u = byId(userId);
    if (!u) return fail(404, MESSAGES.accountNotFound);
    if (u.encrypted && !e2e) return needsUpdate();
    u.lastActivity = now();
    persist();
    return ok({ ...session(u), ...(u.encrypted ? { recovery: u.recovery ?? null } : {}) });
  }

  return { salt, register, login, syncGet, syncPut, changeSecret, recoveredSession };
}
