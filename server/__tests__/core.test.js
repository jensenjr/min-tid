import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCore, isEnvelope, MESSAGES } from "../core.js";

// Fake bcrypt / jwt: the policy under test is the server's, not the libraries'.
const hashSecret = async (s) => `h$${s}`;
const compareSecret = vi.fn(async (s, h) => h === `h$${s}`);
const signToken = (userId) => `tok-${userId}`;

const b64 = (n, fill = 7) => Buffer.alloc(n, fill).toString("base64");
const AUTH = b64(32, 1);
const AUTH2 = b64(32, 2);
const SALT = b64(16, 3);
const SALT2 = b64(16, 4);
const RECOVERY = { v: 1, wrappedKey: b64(40, 5) };
const ENV = { v: 1, iv: b64(12, 6), ct: b64(64, 8) };
const ENV2 = { v: 1, iv: b64(12, 9), ct: b64(80, 10) };
const PLAIN = { name: "Åsa", sessions: [{ id: "s1", note: "HEMLIG" }], absences: [], expenses: [] };

let store;
let persist;
let clock;
let core;

function setup() {
  store = { users: {} };
  persist = vi.fn();
  clock = 1_000_000;
  core = createCore({ store, persist, hashSecret, compareSecret, signToken, now: () => clock });
}

function legacyUser(over = {}) {
  store.users.carl = {
    id: "u-carl",
    username: "Carl",
    secretHash: "h$gammal-kod",
    state: PLAIN,
    stateUpdatedAt: 500,
    createdAt: 1,
    lastActivity: 1,
    ...over,
  };
  return store.users.carl;
}

async function registered(username = "anna") {
  const r = await core.register({
    body: { username, authKey: AUTH, salt: SALT, recovery: RECOVERY },
    e2e: true,
  });
  expect(r.status).toBe(200);
  return { ...r.body, user: store.users[username] };
}

beforeEach(setup);
afterEach(() => vi.restoreAllMocks());

describe("isEnvelope", () => {
  it("accepts exactly { v: 1, iv (12 bytes), ct (>= 16 bytes) }", () => {
    expect(isEnvelope(ENV)).toBe(true);
    expect(isEnvelope({ ...ENV, v: 2 })).toBe(false);
    expect(isEnvelope({ ...ENV, extra: true })).toBe(false);
    expect(isEnvelope({ v: 1, iv: ENV.iv })).toBe(false);
    expect(isEnvelope({ ...ENV, iv: b64(16) })).toBe(false);
    expect(isEnvelope({ ...ENV, ct: b64(8) })).toBe(false);
    expect(isEnvelope({ ...ENV, ct: "ä!" })).toBe(false);
    expect(isEnvelope({ ...ENV, iv: ENV.iv.slice(1) })).toBe(false);
    expect(isEnvelope(PLAIN)).toBe(false);
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope([ENV])).toBe(false);
  });
});

describe("GET /api/auth/salt", () => {
  it("returns the stored salt of an encrypted account", async () => {
    await registered();
    expect(core.salt({ username: "ANNA" })).toEqual({
      status: 200,
      body: { salt: SALT, encrypted: true },
    });
  });

  it("mints a fresh random salt for an unused username and looks like an encrypted account", () => {
    const a = core.salt({ username: "nobody" });
    const b = core.salt({ username: "nobody" });
    expect(a.status).toBe(200);
    expect(a.body.encrypted).toBe(true);
    expect(Buffer.from(a.body.salt, "base64")).toHaveLength(16);
    expect(a.body.salt).not.toBe(b.body.salt);
    expect(store.users).toEqual({}); // a salt request never creates anything
  });

  it("tells a client that a legacy account must be migrated", () => {
    legacyUser();
    const r = core.salt({ username: "carl" });
    expect(r.body.encrypted).toBe(false);
    expect(Buffer.from(r.body.salt, "base64")).toHaveLength(16);
    expect(store.users.carl.salt).toBeUndefined(); // only committed by the migration
  });

  it("rejects an invalid username", () => {
    expect(core.salt({ username: "a" }).status).toBe(400);
    expect(core.salt({ username: undefined }).status).toBe(400);
  });
});

describe("POST /api/auth/register", () => {
  it("creates an encrypted account that holds no plaintext and no raw secret", async () => {
    const { userId, token, salt, user } = await registered();
    expect(token).toBe(`tok-${userId}`);
    expect(salt).toBe(SALT);
    expect(user).toMatchObject({
      id: userId,
      username: "anna",
      encrypted: true,
      salt: SALT,
      state: null,
      secretHash: `h$${AUTH}`,
      recovery: { v: 1, wrappedKey: RECOVERY.wrappedKey },
    });
    expect(persist).toHaveBeenCalled();
  });

  it("answers a pre-encryption client (raw secret) with 409 telling it to update", async () => {
    const r = await core.register({ body: { username: "olle", secret: "hemlig" }, e2e: false });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("NEEDS_UPDATE");
    expect(r.body.error).toMatch(/uppdatera/i);
    expect(store.users).toEqual({});
  });

  it("validates authKey, salt and the wrapped recovery key", async () => {
    const good = { username: "anna", authKey: AUTH, salt: SALT, recovery: RECOVERY };
    for (const body of [
      { ...good, authKey: b64(16) },
      { ...good, authKey: 42 },
      { ...good, salt: b64(8) },
      { ...good, salt: undefined },
      { ...good, recovery: undefined },
      { ...good, recovery: { v: 1, wrappedKey: b64(32) } },
      { ...good, username: "x" },
    ]) {
      expect((await core.register({ body, e2e: true })).status).toBe(400);
    }
    expect(store.users).toEqual({});
  });

  it("refuses a taken username case-insensitively", async () => {
    await registered();
    const r = await core.register({
      body: { username: "ANNA", authKey: AUTH2, salt: SALT2, recovery: RECOVERY },
      e2e: true,
    });
    expect(r.status).toBe(409);
    expect(store.users.anna.secretHash).toBe(`h$${AUTH}`);
  });

  it("does not let two concurrent registrations of one name overwrite each other", async () => {
    const body = (authKey) => ({ username: "anna", authKey, salt: SALT, recovery: RECOVERY });
    const [a, b] = await Promise.all([
      core.register({ body: body(AUTH), e2e: true }),
      core.register({ body: body(AUTH2), e2e: true }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? a : b;
    expect(store.users.anna.id).toBe(winner.body.userId);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in an encrypted account with authKey and returns the envelope untouched", async () => {
    const { userId, user } = await registered();
    user.state = ENV;
    user.stateUpdatedAt = 777;
    clock = 2_000_000;
    const r = await core.login({ body: { username: "Anna", authKey: AUTH }, e2e: true });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      userId,
      username: "anna",
      token: `tok-${userId}`,
      state: ENV,
      updatedAt: 777,
      encrypted: true,
      salt: SALT,
    });
    expect(store.users.anna.lastActivity).toBe(2_000_000);
  });

  it("gives the same ambiguous 401 for a wrong key and an unknown user (and still pays bcrypt)", async () => {
    await registered();
    const wrong = await core.login({ body: { username: "anna", authKey: AUTH2 }, e2e: true });
    compareSecret.mockClear();
    const unknown = await core.login({ body: { username: "nobody", authKey: AUTH }, e2e: true });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe(wrong.body.error);
    expect(compareSecret).toHaveBeenCalledTimes(1);
  });

  it("tells an old client (raw secret) on an encrypted account to update", async () => {
    await registered();
    const r = await core.login({ body: { username: "anna", secret: "hemlig" }, e2e: false });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("NEEDS_UPDATE");
    expect(r.body.error).toBe(MESSAGES.needsUpdate);
    expect(r.body.state).toBeUndefined();
  });

  it("tells a new client that sent a raw secret to an encrypted account to use authKey", async () => {
    await registered();
    const r = await core.login({ body: { username: "anna", secret: "hemlig" }, e2e: true });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("USE_AUTH_KEY");
  });

  it("keeps legacy accounts working for old clients (plaintext as before)", async () => {
    legacyUser();
    const r = await core.login({ body: { username: "carl", secret: "gammal-kod" }, e2e: false });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      userId: "u-carl",
      state: PLAIN,
      updatedAt: 500,
      encrypted: false,
    });
    const bad = await core.login({ body: { username: "carl", secret: "fel" }, e2e: false });
    expect(bad.status).toBe(401);
  });

  it("never accepts authKey against a legacy account", async () => {
    legacyUser();
    const r = await core.login({ body: { username: "carl", authKey: AUTH }, e2e: true });
    expect(r.status).toBe(401);
  });

  it("does not write back a stale copy when a push lands during the bcrypt wait", async () => {
    const { userId, user } = await registered();
    user.state = ENV;
    let release;
    compareSecret.mockImplementationOnce(
      (s, h) => new Promise((res) => (release = () => res(h === `h$${s}`))),
    );
    const pending = core.login({ body: { username: "anna", authKey: AUTH }, e2e: true });
    clock = 3_000_000;
    const put = core.syncPut({ userId, e2e: true, body: { state: ENV2, salt: SALT } });
    expect(put.status).toBe(200);
    release();
    expect((await pending).status).toBe(200);
    expect(store.users.anna.state).toEqual(ENV2);
    expect(store.users.anna.stateUpdatedAt).toBe(put.body.updatedAt);
  });

  it("rejects bodies without a username or credential", async () => {
    expect((await core.login({ body: {}, e2e: true })).status).toBe(400);
    expect((await core.login({ body: { username: "anna" }, e2e: true })).status).toBe(400);
    expect((await core.login({ body: undefined, e2e: true })).status).toBe(400);
  });
});

describe("GET /api/sync", () => {
  it("returns the envelope and salt to a new client", async () => {
    const { userId, user } = await registered();
    user.state = ENV;
    user.stateUpdatedAt = 9;
    const r = core.syncGet({ userId, e2e: true });
    expect(r).toEqual({
      status: 200,
      body: { state: ENV, updatedAt: 9, encrypted: true, salt: SALT },
    });
    expect(r.body.state).toBe(user.state); // untouched, not re-serialised
  });

  it("answers an old client on an encrypted account with 409 instead of ciphertext", async () => {
    const { userId, user } = await registered();
    user.state = ENV;
    const r = core.syncGet({ userId, e2e: false });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("NEEDS_UPDATE");
    expect(r.body.state).toBeUndefined();
  });

  it("serves legacy plaintext as before, flagged encrypted: false", () => {
    legacyUser();
    expect(core.syncGet({ userId: "u-carl", e2e: false }).body).toEqual({
      state: PLAIN,
      updatedAt: 500,
      encrypted: false,
    });
    expect(core.syncGet({ userId: "u-carl", e2e: true }).body.encrypted).toBe(false);
  });

  it("404s for a deleted account", () => {
    expect(core.syncGet({ userId: "gone", e2e: true }).status).toBe(404);
  });
});

describe("PUT /api/sync", () => {
  it("stores an envelope with the current salt and bumps the revision", async () => {
    const { userId } = await registered();
    clock = 5_000;
    const r = core.syncPut({ userId, e2e: true, body: { state: ENV, salt: SALT } });
    expect(r).toEqual({ status: 200, body: { ok: true, updatedAt: 5_000 } });
    expect(store.users.anna.state).toEqual(ENV);
    expect(store.users.anna.stateUpdatedAt).toBe(5_000);
  });

  it("never hands out the same revision twice, even within one millisecond", async () => {
    const { userId } = await registered();
    const a = core.syncPut({ userId, e2e: true, body: { state: ENV, salt: SALT } });
    const b = core.syncPut({ userId, e2e: true, body: { state: ENV2, salt: SALT } });
    expect(b.body.updatedAt).toBeGreaterThan(a.body.updatedAt);
  });

  it("rejects plaintext on an encrypted account (old client) with 409 and keeps the ciphertext", async () => {
    const { userId, user } = await registered();
    user.state = ENV;
    const r = core.syncPut({ userId, e2e: false, body: { state: PLAIN } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("NEEDS_UPDATE");
    expect(r.body.error).toMatch(/uppdatera/i);
    expect(store.users.anna.state).toEqual(ENV);
  });

  it("rejects an envelope sent without the protocol header", async () => {
    const { userId } = await registered();
    const r = core.syncPut({ userId, e2e: false, body: { state: ENV, salt: SALT } });
    expect(r.status).toBe(409);
    expect(store.users.anna.state).toBeNull();
  });

  it("rejects a malformed envelope from a new client", async () => {
    const { userId } = await registered();
    for (const state of [PLAIN, { ...ENV, v: 2 }, { ...ENV, extra: 1 }, null, "x"]) {
      const r = core.syncPut({ userId, e2e: true, body: { state, salt: SALT } });
      expect(r.status).toBe(400);
    }
    expect(store.users.anna.state).toBeNull();
  });

  it("rejects an envelope made with a superseded key (salt) with KEY_CHANGED", async () => {
    const { userId } = await registered();
    const r = core.syncPut({ userId, e2e: true, body: { state: ENV, salt: SALT2 } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("KEY_CHANGED");
    expect(store.users.anna.state).toBeNull();
  });

  it("keeps plaintext pushes working on a legacy account (old client)", () => {
    legacyUser();
    const next = { ...PLAIN, name: "Carl" };
    const r = core.syncPut({ userId: "u-carl", e2e: false, body: { state: next } });
    expect(r.status).toBe(200);
    expect(store.users.carl.state).toEqual(next);
  });

  it("never stores an envelope on a legacy account (old clients would read it as data)", () => {
    legacyUser();
    for (const e2e of [true, false]) {
      const r = core.syncPut({ userId: "u-carl", e2e, body: { state: ENV, salt: SALT } });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("NOT_MIGRATED");
    }
    const plainFromNewClient = core.syncPut({
      userId: "u-carl",
      e2e: true,
      body: { state: PLAIN },
    });
    expect(plainFromNewClient.status).toBe(409);
    expect(store.users.carl.state).toEqual(PLAIN);
  });
});

describe("PUT /api/auth/secret — migration, secret change and recovery", () => {
  const migrateBody = (over = {}) => ({
    authKey: AUTH,
    salt: SALT,
    state: ENV,
    recovery: RECOVERY,
    baseRev: 500,
    ...over,
  });

  it("migrates a legacy account atomically: new hash, salt, envelope, plaintext gone", async () => {
    legacyUser({ phone: "+46701234567" });
    clock = 9_000;
    const r = await core.changeSecret({ userId: "u-carl", e2e: true, body: migrateBody() });
    expect(r).toEqual({ status: 200, body: { ok: true, updatedAt: 9_000 } });
    const u = store.users.carl;
    expect(u).toMatchObject({
      encrypted: true,
      salt: SALT,
      state: ENV,
      secretHash: `h$${AUTH}`,
      stateUpdatedAt: 9_000,
      recovery: { v: 1, wrappedKey: RECOVERY.wrappedKey },
      phone: "+46701234567",
    });
    expect(JSON.stringify(store)).not.toContain("HEMLIG");
    // The old secret no longer works; the derived key does.
    expect(
      (await core.login({ body: { username: "carl", secret: "gammal-kod" }, e2e: false })).status,
    ).toBe(409);
    expect(
      (await core.login({ body: { username: "carl", authKey: AUTH }, e2e: true })).status,
    ).toBe(200);
  });

  it("refuses a migration based on an outdated revision and changes nothing", async () => {
    legacyUser();
    const before = structuredClone(store.users.carl);
    const r = await core.changeSecret({
      userId: "u-carl",
      e2e: true,
      body: migrateBody({ baseRev: 499 }),
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("CONFLICT");
    expect(store.users.carl).toEqual(before);
  });

  it("detects a push that lands while the new hash is being computed", async () => {
    legacyUser();
    const pending = core.changeSecret({ userId: "u-carl", e2e: true, body: migrateBody() });
    // An old client pushes while bcrypt runs.
    core.syncPut({ userId: "u-carl", e2e: false, body: { state: { ...PLAIN, name: "nyare" } } });
    const r = await pending;
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("CONFLICT");
    expect(store.users.carl.encrypted).toBeUndefined();
    expect(store.users.carl.state.name).toBe("nyare");
  });

  it("refuses to drop existing data unless the client explicitly discards it", async () => {
    legacyUser();
    const r = await core.changeSecret({
      userId: "u-carl",
      e2e: true,
      body: migrateBody({ state: null }),
    });
    expect(r.status).toBe(400);
    expect(store.users.carl.state).toEqual(PLAIN);

    const ok = await core.changeSecret({
      userId: "u-carl",
      e2e: true,
      body: migrateBody({ state: null, discardState: true }),
    });
    expect(ok.status).toBe(200);
    expect(store.users.carl.state).toBeNull();
    expect(store.users.carl.encrypted).toBe(true);
  });

  it("migrates an account that never stored any state", async () => {
    legacyUser({ state: null, stateUpdatedAt: undefined });
    const r = await core.changeSecret({
      userId: "u-carl",
      e2e: true,
      body: migrateBody({ state: null, baseRev: 0 }),
    });
    expect(r.status).toBe(200);
    expect(store.users.carl).toMatchObject({ encrypted: true, state: null, salt: SALT });
  });

  it("rotates salt, hash, envelope and recovery wrap on a secret change", async () => {
    const { userId, user } = await registered();
    user.state = ENV;
    user.stateUpdatedAt = 10;
    const recovery2 = { v: 1, wrappedKey: b64(40, 11) };
    const r = await core.changeSecret({
      userId,
      e2e: true,
      body: { authKey: AUTH2, salt: SALT2, state: ENV2, recovery: recovery2, baseRev: 10 },
    });
    expect(r.status).toBe(200);
    expect(store.users.anna).toMatchObject({
      salt: SALT2,
      state: ENV2,
      secretHash: `h$${AUTH2}`,
      recovery: { wrappedKey: recovery2.wrappedKey },
    });
    // A device still on the old key can neither push nor log in with it.
    expect(core.syncPut({ userId, e2e: true, body: { state: ENV, salt: SALT } }).body.code).toBe(
      "KEY_CHANGED",
    );
    expect(
      (await core.login({ body: { username: "anna", authKey: AUTH }, e2e: true })).status,
    ).toBe(401);
  });

  it("answers an old client changing the secret of an encrypted account with 409", async () => {
    const { userId } = await registered();
    const r = await core.changeSecret({ userId, e2e: false, body: { newSecret: "ny-hemlig" } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("NEEDS_UPDATE");
    expect(store.users.anna.secretHash).toBe(`h$${AUTH}`);
  });

  it("keeps the old secret-change flow for legacy accounts", async () => {
    legacyUser();
    const r = await core.changeSecret({
      userId: "u-carl",
      e2e: false,
      body: { newSecret: "ny-hemlig" },
    });
    expect(r.status).toBe(200);
    expect(store.users.carl.secretHash).toBe("h$ny-hemlig");
    expect(store.users.carl.state).toEqual(PLAIN);
    const short = await core.changeSecret({
      userId: "u-carl",
      e2e: false,
      body: { newSecret: "kort" },
    });
    expect(short.status).toBe(400);
  });

  it("validates every field before touching anything", async () => {
    legacyUser();
    const before = structuredClone(store.users.carl);
    for (const over of [
      { authKey: b64(31) },
      { salt: "kort" },
      { recovery: null },
      { state: PLAIN },
      { state: { ...ENV, v: 9 } },
      { baseRev: "500" },
      { baseRev: -1 },
    ]) {
      const r = await core.changeSecret({ userId: "u-carl", e2e: true, body: migrateBody(over) });
      expect(r.status).toBe(400);
    }
    expect(store.users.carl).toEqual(before);
  });
});

describe("recovered session (after a verified SMS code)", () => {
  it("hands a new client the envelope, salt and wrapped key of an encrypted account", async () => {
    const { userId, user } = await registered();
    user.state = ENV;
    user.stateUpdatedAt = 42;
    const r = core.recoveredSession({ userId, e2e: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      userId,
      username: "anna",
      token: `tok-${userId}`,
      state: ENV,
      updatedAt: 42,
      encrypted: true,
      salt: SALT,
      recovery: { v: 1, wrappedKey: RECOVERY.wrappedKey },
    });
  });

  it("answers an old client recovering an encrypted account with 409 (it would wipe its data)", async () => {
    const { userId, user } = await registered();
    user.state = ENV;
    const r = core.recoveredSession({ userId, e2e: false });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("NEEDS_UPDATE");
    expect(r.body.token).toBeUndefined();
  });

  it("keeps legacy recovery working for old clients", () => {
    legacyUser();
    const r = core.recoveredSession({ userId: "u-carl", e2e: false });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ username: "Carl", state: PLAIN, encrypted: false });
  });
});

describe("logging", () => {
  it("never logs request bodies, secrets or ciphertext", async () => {
    const spies = ["log", "info", "warn", "error", "debug"].map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    legacyUser();
    await core.login({ body: { username: "carl", secret: "gammal-kod" }, e2e: true });
    await core.changeSecret({
      userId: "u-carl",
      e2e: true,
      body: { authKey: AUTH, salt: SALT, state: ENV, recovery: RECOVERY, baseRev: 500 },
    });
    core.syncPut({ userId: "u-carl", e2e: true, body: { state: ENV2, salt: SALT } });
    core.syncPut({ userId: "u-carl", e2e: false, body: { state: PLAIN } });
    core.syncGet({ userId: "u-carl", e2e: true });
    await core.register({ body: { username: "olle", secret: "hemlig-olle" }, e2e: false });
    await core.login({ body: { username: "carl", authKey: AUTH2 }, e2e: true });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
