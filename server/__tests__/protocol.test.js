// End-to-end: the real client (src/lib/sync.ts) against the real server policy
// (server/core.js), joined by a fake fetch. Each "device" is its own key store, so a
// fresh store is a fresh phone/browser with no IndexedDB contents.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCore } from "../core.js";
import {
  SyncApiError,
  __setSyncTestHooks,
  acknowledgeRecoveryKey,
  getPendingRecoveryKey,
  syncChangeSecret,
  syncDeleteAccount,
  syncLogin,
  syncPull,
  syncPush,
  syncRecoverComplete,
  syncRecoverConfirm,
  syncRecoverUnlock,
  syncRegister,
} from "../../src/lib/sync.ts";
import { createMemoryKeyStore } from "../../src/lib/keyStore.ts";
import {
  decryptState,
  deriveKeys,
  encryptState,
  formatRecoveryKey,
  generateRecoveryKey,
  randomSalt,
  unwrapEncKey,
} from "../../src/lib/crypto.ts";

const ITER = 1000; // production is 600 000 (pinned in crypto.test.ts)

const DATA = {
  name: "Åsa",
  department: "Lager",
  schedule: { mon: { active: true } },
  sessions: [{ id: "s1", start: 1, end: 2, note: "HEMLIG-ANTECKNING" }],
  absences: [{ id: "a1", category: "vab" }],
  expenses: [],
  flexBaseMinutes: 15,
  trackingStartDate: "2026-01-05",
};
const withNote = (note) => ({ ...DATA, sessions: [{ ...DATA.sessions[0], note }] });

// ─── fake server ─────────────────────────────────────────────
let jwtCounter = 0;
const fakeJwt = (userId) =>
  [
    "eyJhbGciOiJub25lIn0",
    Buffer.from(JSON.stringify({ userId, iat: ++jwtCounter })).toString("base64url"),
    "sig",
  ].join(".");
const userIdOf = (token) => {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).userId ?? null;
  } catch {
    return null;
  }
};

function makeServer() {
  const store = { users: {} };
  const core = createCore({
    store,
    persist: () => {},
    hashSecret: async (s) => `h$${s}`,
    compareSecret: async (s, h) => h === `h$${s}`,
    signToken: fakeJwt,
  });
  const phones = new Map();
  const requests = [];
  const hooks = [];
  const drops = new Set();
  const res = (r) =>
    new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });

  const fetchImpl = async (url, init = {}) => {
    const route = `${init.method ?? "GET"} ${new URL(url, "http://min-tid.test").pathname}`;
    const response = await handle(url, init);
    if (drops.delete(route)) throw new TypeError("fetch failed"); // processed, answer lost
    return response;
  };

  const handle = async (url, init) => {
    const method = init.method ?? "GET";
    const u = new URL(url, "http://min-tid.test");
    const headers = new Headers(init.headers);
    const e2e = headers.get("x-sync-protocol") === "2";
    const body = init.body ? JSON.parse(init.body) : undefined;
    const route = `${method} ${u.pathname}`;
    requests.push({ route, e2e, body });
    const hook = hooks.findIndex((h) => h.route === route);
    if (hook >= 0) await hooks.splice(hook, 1)[0].run();
    const auth = headers.get("authorization");
    const userId = auth?.startsWith("Bearer ") ? userIdOf(auth.slice(7)) : null;
    const needAuth = (fn) => (userId ? fn() : { status: 401, body: { error: "Ej autentiserad." } });
    switch (route) {
      case "GET /api/auth/salt":
        return res(core.salt({ username: u.searchParams.get("username") }));
      case "POST /api/auth/register":
        return res(await core.register({ body, e2e }));
      case "POST /api/auth/login":
        return res(await core.login({ body, e2e }));
      case "GET /api/sync":
        return res(needAuth(() => core.syncGet({ userId, e2e })));
      case "PUT /api/sync":
        return res(needAuth(() => core.syncPut({ userId, e2e, body })));
      case "PUT /api/auth/secret":
        return res(
          userId ? await core.changeSecret({ userId, e2e, body }) : { status: 401, body: {} },
        );
      case "DELETE /api/account":
        for (const [k, v] of Object.entries(store.users))
          if (v.id === userId) delete store.users[k];
        return res({ status: 200, body: { ok: true } });
      case "POST /api/auth/recover/confirm": {
        const id = phones.get(body.phone);
        if (!id || body.code !== "123456")
          return res({ status: 400, body: { error: "Fel kod. Kontrollera och försök igen." } });
        return res(core.recoveredSession({ userId: id, e2e }));
      }
      default:
        return res({ status: 404, body: { error: `no route ${route}` } });
    }
  };
  return {
    store,
    core,
    phones,
    requests,
    fetch: vi.fn(fetchImpl),
    /** Run `run` right before the next request to `route` is handled. */
    before: (route, run) => hooks.push({ route, run }),
    /** Handle the next request to `route`, then fail the fetch as if the answer was lost. */
    dropResponse: (route) => drops.add(route),
  };
}

// ─── devices ─────────────────────────────────────────────────
let server;
const devices = {};
function device(name) {
  devices[name] ??= createMemoryKeyStore();
  return devices[name];
}
/** Run a client call as the given device. */
async function on(name, fn) {
  __setSyncTestHooks({ keyStore: device(name), iterations: ITER });
  return fn();
}
function userOf(username) {
  return server.store.users[username.toLowerCase()];
}
async function serverStateWith(recoveryKey, username) {
  const u = userOf(username);
  const key = await unwrapEncKey(u.recovery.wrappedKey, recoveryKey);
  return decryptState(u.state, key);
}

beforeEach(() => {
  server = makeServer();
  vi.stubGlobal("fetch", server.fetch);
  for (const k of Object.keys(devices)) delete devices[k];
});
afterEach(() => {
  vi.unstubAllGlobals();
  __setSyncTestHooks(null);
});

async function setupAccount(username = "anna", secret = "hemlig-kod") {
  const reg = await on("phone", () => syncRegister(username, secret));
  await on("phone", () => syncPush(reg.token, DATA));
  return reg;
}

// ─── tests ───────────────────────────────────────────────────
describe("register → push → pull", () => {
  it("round-trips through the server, which only ever sees ciphertext", async () => {
    const { token, userId, recoveryKey } = await setupAccount();
    const pulled = await on("phone", () => syncPull(token));
    expect(pulled.state).toEqual(DATA);
    expect(pulled.updatedAt).toBe(userOf("anna").stateUpdatedAt);

    const dump = JSON.stringify(server.store);
    for (const leak of ["HEMLIG", "Åsa", "Lager", "vab", "hemlig-kod", recoveryKey]) {
      expect(dump).not.toContain(leak);
    }
    expect(userOf("anna")).toMatchObject({ id: userId, encrypted: true });
    expect(Object.keys(userOf("anna").state).sort()).toEqual(["ct", "iv", "v"]);
    // Nothing secret or plaintext travelled in any request either.
    const wire = JSON.stringify(server.requests);
    for (const leak of ["HEMLIG", "Åsa", "hemlig-kod", recoveryKey])
      expect(wire).not.toContain(leak);
  });

  it("sends the protocol header on every request", async () => {
    await setupAccount();
    expect(server.requests.length).toBeGreaterThan(0);
    expect(server.requests.every((r) => r.e2e)).toBe(true);
  });

  it("offers the recovery key once, and it really unlocks the server copy", async () => {
    const { recoveryKey } = await setupAccount();
    const pending = await on("phone", () => getPendingRecoveryKey());
    expect(pending).toMatchObject({ key: recoveryKey, username: "anna", reason: "created" });
    expect(recoveryKey).toMatch(/^[0-9A-HJKMNP-TV-Z]{24}$/);
    expect(await serverStateWith(recoveryKey, "anna")).toEqual(DATA);

    await on("phone", () => acknowledgeRecoveryKey());
    expect(await on("phone", () => getPendingRecoveryKey())).toBeNull();
  });

  it("logs in on a second device and syncs both ways", async () => {
    const { token: t1 } = await setupAccount();
    const login = await on("laptop", () => syncLogin("ANNA", "hemlig-kod"));
    expect(login.state).toEqual(DATA);
    expect(login.updatedAt).toBe(userOf("anna").stateUpdatedAt);
    // Logging in on another device does not mint a new recovery key.
    expect(await on("laptop", () => getPendingRecoveryKey())).toBeNull();

    const edited = withNote("från laptopen");
    const rev = await on("laptop", () => syncPush(login.token, edited));
    const back = await on("phone", () => syncPull(t1));
    expect(back).toEqual({ state: edited, updatedAt: rev });
  });

  it("keeps an account with no data yet readable (state null)", async () => {
    const { token } = await on("phone", () => syncRegister("anna", "hemlig-kod"));
    expect(await on("phone", () => syncPull(token))).toEqual({ state: null, updatedAt: 0 });
    const login = await on("laptop", () => syncLogin("anna", "hemlig-kod"));
    expect(login.state).toBeNull();
  });
});

describe("failures never leave a half-configured device", () => {
  it("wrong secret → 401, no key stored", async () => {
    await setupAccount();
    const err = await on("laptop", () => syncLogin("anna", "fel-kod")).catch((e) => e);
    expect(err).toBeInstanceOf(SyncApiError);
    expect(err.status).toBe(401);
    expect(await device("laptop").getKey()).toBeNull();
  });

  it("unknown user → the same 401", async () => {
    const err = await on("laptop", () => syncLogin("nobody", "hemlig-kod")).catch((e) => e);
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/Fel användarnamn eller synk-kod/);
  });

  it("taken username → 409, no key or recovery key left behind", async () => {
    await setupAccount();
    await on("phone", () => acknowledgeRecoveryKey());
    const err = await on("laptop", () => syncRegister("Anna", "annan-kod")).catch((e) => e);
    expect(err.status).toBe(409);
    expect(await device("laptop").getKey()).toBeNull();
    expect(await on("laptop", () => getPendingRecoveryKey())).toBeNull();
  });

  it("a lost register answer still shows the recovery key once the device logs in", async () => {
    server.dropResponse("POST /api/auth/register");
    const err = await on("phone", () => syncRegister("anna", "hemlig-kod")).catch((e) => e);
    expect(err).toMatchObject({ status: 0 });
    expect(userOf("anna")).toBeDefined(); // the server did create it
    expect(await on("phone", () => getPendingRecoveryKey())).toBeNull(); // no key yet

    await on("phone", () => syncLogin("anna", "hemlig-kod"));
    const pending = await on("phone", () => getPendingRecoveryKey());
    expect(pending).toMatchObject({ reason: "created" });
    const key = await unwrapEncKey(userOf("anna").recovery.wrappedKey, pending.key);
    expect(key.extractable).toBe(false);
  });

  it("a lost secret-change answer: old key is refused, the new secret brings the new recovery key", async () => {
    const { token } = await setupAccount();
    await on("phone", () => acknowledgeRecoveryKey());
    server.dropResponse("PUT /api/auth/secret");
    await expect(on("phone", () => syncChangeSecret(token, "helt-ny-kod"))).rejects.toMatchObject({
      status: 0,
    });
    // The device still holds the old key, which the server now refuses — nothing is overwritten.
    await expect(on("phone", () => syncPush(token, withNote("x")))).rejects.toMatchObject({
      code: "KEY_CHANGED",
    });
    expect(await on("phone", () => getPendingRecoveryKey())).toBeNull();
    await on("phone", () => syncLogin("anna", "helt-ny-kod"));
    const pending = await on("phone", () => getPendingRecoveryKey());
    expect(pending).toMatchObject({ reason: "rotated" });
    expect(await serverStateWith(pending.key, "anna")).toEqual(DATA);
  });

  it("a refused secret change puts back the recovery key that was still pending", async () => {
    const { token, recoveryKey } = await setupAccount();
    // Another device "writes" before every attempt: first try + 3 retries all conflict.
    for (let i = 0; i < 4; i++) {
      server.before("PUT /api/auth/secret", () => {
        userOf("anna").stateUpdatedAt += 1000;
      });
    }
    await expect(on("phone", () => syncChangeSecret(token, "helt-ny-kod"))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await on("phone", () => getPendingRecoveryKey())).toMatchObject({ key: recoveryKey });
    expect((await on("phone", () => syncPull(token))).state).toEqual(DATA);
  });

  it("rejects a too-short secret before deriving anything", async () => {
    await expect(on("phone", () => syncRegister("anna", "kort"))).rejects.toThrow(/6 tecken/);
    expect(server.requests).toHaveLength(0);
  });
});

describe("token present but no key on this device (synced with a pre-encryption build)", () => {
  it("pull and push fail with a distinct, explainable error and touch nothing", async () => {
    const { token } = await setupAccount();
    const before = structuredClone(userOf("anna"));
    server.requests.length = 0;

    const pullErr = await on("old-phone", () => syncPull(token)).catch((e) => e);
    expect(pullErr).toBeInstanceOf(SyncApiError);
    expect(pullErr).toMatchObject({
      status: 401,
      code: "NO_KEY",
      path: "/api/sync",
      method: "GET",
    });
    expect(pullErr.message).toMatch(/logga in igen/i);

    const pushErr = await on("old-phone", () => syncPush(token, withNote("x"))).catch((e) => e);
    expect(pushErr).toMatchObject({ status: 401, code: "NO_KEY", method: "PUT" });

    expect(server.requests).toHaveLength(0);
    expect(userOf("anna")).toEqual(before);
  });

  it("treats a key that belongs to another account as missing", async () => {
    await setupAccount("anna");
    const bob = await on("phone", () => syncRegister("bob", "bobs-kod"));
    // The phone's key is now Bob's; Anna's token must not encrypt with it.
    const anna = await on("laptop", () => syncLogin("anna", "hemlig-kod"));
    const err = await on("phone", () => syncPush(anna.token, DATA)).catch((e) => e);
    expect(err).toMatchObject({ status: 401, code: "NO_KEY" });
    expect(await on("phone", () => syncPull(bob.token))).toEqual({ state: null, updatedAt: 0 });
  });

  it("refuses to change the secret without a device key", async () => {
    const { token } = await setupAccount();
    const before = structuredClone(userOf("anna"));
    const err = await on("old-phone", () => syncChangeSecret(token, "ny-hemlig-kod")).catch(
      (e) => e,
    );
    expect(err).toMatchObject({ code: "NO_KEY" });
    expect(userOf("anna")).toEqual(before);
  });
});

describe("tampering", () => {
  it("a modified ciphertext on the server surfaces as a 422 decrypt failure", async () => {
    const { token } = await setupAccount();
    const ct = Buffer.from(userOf("anna").state.ct, "base64");
    ct[3] ^= 0xff;
    userOf("anna").state.ct = ct.toString("base64");
    const err = await on("phone", () => syncPull(token)).catch((e) => e);
    expect(err).toMatchObject({ status: 422, code: "DECRYPT_FAILED" });
  });

  it("a login against a damaged cloud copy fails with 422 and stores no key", async () => {
    await setupAccount();
    const ct = Buffer.from(userOf("anna").state.ct, "base64");
    ct[ct.length - 1] ^= 0x01; // GCM tag
    userOf("anna").state.ct = ct.toString("base64");
    await expect(on("laptop", () => syncLogin("anna", "hemlig-kod"))).rejects.toMatchObject({
      status: 422,
      code: "DECRYPT_FAILED",
    });
    expect(await device("laptop").getKey()).toBeNull();
  });

  it("a swapped envelope from another account does not decrypt", async () => {
    const { token } = await setupAccount("anna");
    await on("laptop", async () => {
      const bob = await syncRegister("bob", "bobs-kod");
      await syncPush(bob.token, withNote("bob"));
    });
    userOf("anna").state = userOf("bob").state;
    await expect(on("phone", () => syncPull(token))).rejects.toMatchObject({ status: 422 });
  });

  it("a pull that finds a legacy (plaintext) account refuses to use it", async () => {
    const { token, userId } = await setupAccount();
    const u = userOf("anna");
    u.encrypted = undefined;
    u.state = DATA;
    const err = await on("phone", () => syncPull(token)).catch((e) => e);
    expect(err).toMatchObject({ status: 409, code: "NOT_MIGRATED" });
    expect(userId).toBe(u.id);
  });
});

describe("migrating a legacy account", () => {
  function legacy(over = {}) {
    server.store.users.carl = {
      id: "u-carl",
      username: "Carl",
      secretHash: "h$gammal-kod",
      state: DATA,
      stateUpdatedAt: 500,
      createdAt: 1,
      lastActivity: 1,
      phone: "+46700000001",
      ...over,
    };
  }

  it("logs in with the legacy secret, encrypts, and deletes the plaintext", async () => {
    legacy();
    const r = await on("phone", () => syncLogin("carl", "gammal-kod"));
    expect(r.state).toEqual(DATA);
    expect(r.userId).toBe("u-carl");
    const u = userOf("carl");
    expect(u.encrypted).toBe(true);
    expect(r.updatedAt).toBe(u.stateUpdatedAt);
    expect(u.stateUpdatedAt).toBeGreaterThan(500);
    expect(JSON.stringify(u)).not.toContain("HEMLIG");
    expect(u.secretHash).not.toBe("h$gammal-kod");
    expect(u.phone).toBe("+46700000001");

    const pending = await on("phone", () => getPendingRecoveryKey());
    expect(pending).toMatchObject({ reason: "migrated", username: "Carl" });
    expect(await serverStateWith(pending.key, "carl")).toEqual(DATA);

    // The device can sync right away, and a second device logs in with the same secret.
    expect((await on("phone", () => syncPull(r.token))).state).toEqual(DATA);
    expect((await on("laptop", () => syncLogin("carl", "gammal-kod"))).state).toEqual(DATA);
  });

  it("shuts out pre-encryption clients afterwards with a clear 409", async () => {
    legacy();
    const { token } = await on("phone", () => syncLogin("carl", "gammal-kod"));
    const old = (path, init = {}) =>
      server.fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
    for (const [path, init] of [
      ["/api/sync", {}],
      ["/api/sync", { method: "PUT", body: JSON.stringify({ state: DATA }) }],
      [
        "/api/auth/login",
        { method: "POST", body: JSON.stringify({ username: "carl", secret: "gammal-kod" }) },
      ],
      ["/api/auth/secret", { method: "PUT", body: JSON.stringify({ newSecret: "ny-gammal" }) }],
    ]) {
      const res = await old(path, init);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/uppdatera appen/i);
    }
    expect(userOf("carl").encrypted).toBe(true);
    expect(JSON.stringify(userOf("carl"))).not.toContain("HEMLIG");
  });

  it("encrypts the newest data when an old client pushes during the migration", async () => {
    legacy();
    const newer = withNote("pushad av gammal klient under migreringen");
    server.before("PUT /api/auth/secret", () => {
      server.core.syncPut({ userId: "u-carl", e2e: false, body: { state: newer } });
    });
    const r = await on("phone", () => syncLogin("carl", "gammal-kod"));
    expect(r.state).toEqual(newer);
    const pending = await on("phone", () => getPendingRecoveryKey());
    expect(await serverStateWith(pending.key, "carl")).toEqual(newer);
  });

  it("migrates an account that never stored data", async () => {
    legacy({ state: null, stateUpdatedAt: undefined });
    const r = await on("phone", () => syncLogin("carl", "gammal-kod"));
    expect(r.state).toBeNull();
    expect(userOf("carl")).toMatchObject({ encrypted: true, state: null });
  });

  it("leaves the legacy account untouched when the legacy secret is wrong", async () => {
    legacy();
    const before = structuredClone(userOf("carl"));
    await expect(on("phone", () => syncLogin("carl", "fel"))).rejects.toMatchObject({
      status: 401,
    });
    expect(userOf("carl")).toEqual(before);
    expect(await device("phone").getKey()).toBeNull();
  });

  it("re-runs the login if another device migrated in the meantime", async () => {
    legacy();
    // Device B (its own JS context, so straight to the server) finishes the migration
    // between our salt lookup and our login.
    server.before("POST /api/auth/login", async () => {
      const salt = randomSalt();
      const keys = await deriveKeys("gammal-kod", salt, { iterations: ITER });
      const r = await server.core.changeSecret({
        userId: "u-carl",
        e2e: true,
        body: {
          authKey: keys.authKey,
          salt,
          state: await encryptState(DATA, keys.encKey),
          recovery: { v: 1, wrappedKey: await keys.wrapEncKey(generateRecoveryKey()) },
          baseRev: 500,
        },
      });
      expect(r.status).toBe(200);
    });
    const r = await on("phone", () => syncLogin("carl", "gammal-kod"));
    expect(r.state).toEqual(DATA);
    expect(userOf("carl").encrypted).toBe(true);
    // Device B minted the recovery key here, so this device has none to show.
    expect(await on("phone", () => getPendingRecoveryKey())).toBeNull();
  });
});

describe("changing the secret", () => {
  it("re-encrypts, re-wraps and locks out devices on the old key until they log in again", async () => {
    const { token: t1, recoveryKey: oldRk } = await setupAccount();
    const laptop = await on("laptop", () => syncLogin("anna", "hemlig-kod"));

    await on("phone", () => syncChangeSecret(t1, "helt-ny-kod"));

    // The changing device keeps working with the token it already has.
    expect((await on("phone", () => syncPull(t1))).state).toEqual(DATA);
    await on("phone", () => syncPush(t1, withNote("efter bytet")));

    // The other device can neither read nor overwrite the new ciphertext.
    const pullErr = await on("laptop", () => syncPull(laptop.token)).catch((e) => e);
    expect(pullErr).toMatchObject({ status: 409, code: "KEY_CHANGED" });
    const stateBefore = structuredClone(userOf("anna").state);
    const pushErr = await on("laptop", () =>
      syncPush(laptop.token, withNote("gammal nyckel")),
    ).catch((e) => e);
    expect(pushErr).toMatchObject({ status: 409, code: "KEY_CHANGED" });
    expect(userOf("anna").state).toEqual(stateBefore);

    // Old secret is dead, new one works everywhere.
    await expect(on("laptop", () => syncLogin("anna", "hemlig-kod"))).rejects.toMatchObject({
      status: 401,
    });
    const again = await on("laptop", () => syncLogin("anna", "helt-ny-kod"));
    expect(again.state).toEqual(withNote("efter bytet"));

    // A new recovery key replaces the old one, which no longer unlocks anything.
    const pending = await on("phone", () => getPendingRecoveryKey());
    expect(pending).toMatchObject({ reason: "rotated" });
    expect(pending.key).not.toBe(oldRk);
    await expect(serverStateWith(oldRk, "anna")).rejects.toMatchObject({
      code: "WRONG_RECOVERY_KEY",
    });
    expect(await serverStateWith(pending.key, "anna")).toEqual(withNote("efter bytet"));
  });

  it("keeps a push from another device that lands mid-change", async () => {
    const { token: t1, userId } = await setupAccount();
    const fromLaptop = withNote("från laptopen under bytet");
    // The laptop runs in its own JS context, so its push goes straight to the server.
    const salt = userOf("anna").salt;
    const laptopKeys = await deriveKeys("hemlig-kod", salt, { iterations: ITER });
    const laptopEnvelope = await encryptState(fromLaptop, laptopKeys.encKey);
    server.before("PUT /api/auth/secret", () => {
      const r = server.core.syncPut({ userId, e2e: true, body: { state: laptopEnvelope, salt } });
      expect(r.status).toBe(200);
    });
    await on("phone", () => syncChangeSecret(t1, "helt-ny-kod"));
    expect((await on("phone", () => syncPull(t1))).state).toEqual(fromLaptop);
    // Exactly one retry: the first attempt hit the conflict.
    const changes = server.requests.filter((r) => r.route === "PUT /api/auth/secret");
    expect(changes).toHaveLength(2);
  });

  it("serialises a push started during the change behind it (no spurious KEY_CHANGED)", async () => {
    const { token } = await setupAccount();
    const change = on("phone", () => syncChangeSecret(token, "helt-ny-kod"));
    const push = syncPush(token, withNote("samtidigt"));
    await change;
    await expect(push).resolves.toBeGreaterThan(0);
    expect((await on("phone", () => syncPull(token))).state).toEqual(withNote("samtidigt"));
  });

  it("works for an account that has no data yet", async () => {
    const { token } = await on("phone", () => syncRegister("anna", "hemlig-kod"));
    await on("phone", () => syncChangeSecret(token, "helt-ny-kod"));
    expect((await on("laptop", () => syncLogin("anna", "helt-ny-kod"))).state).toBeNull();
  });
});

describe("SMS recovery", () => {
  async function recoverable() {
    const reg = await setupAccount();
    server.phones.set("+46701234567", reg.userId);
    return reg;
  }

  it("restores the account and, with the recovery key, the data", async () => {
    const { recoveryKey } = await recoverable();
    const session = await on("new-phone", () => syncRecoverConfirm("+46701234567", "123456"));
    expect(session).toMatchObject({
      username: "anna",
      needsRecoveryKey: true,
      hasRecoveryKey: true,
    });
    expect(session.unlocked).toBe(false);

    const wrong = await on("new-phone", () =>
      syncRecoverUnlock(session, generateRecoveryKey()),
    ).catch((e) => e);
    expect(wrong).toMatchObject({ code: "WRONG_RECOVERY_KEY" });
    expect(wrong.message).toMatch(/återställningsnyckel/i);

    await on("new-phone", () =>
      syncRecoverUnlock(session, formatRecoveryKey(recoveryKey).toLowerCase()),
    );
    expect(session.unlocked).toBe(true);
    const done = await on("new-phone", () => syncRecoverComplete(session, "efter-sms-kod"));
    expect(done.state).toEqual(DATA);
    expect(done.username).toBe("anna");

    // New secret works, old one doesn't; the recovering device syncs.
    expect((await on("laptop", () => syncLogin("anna", "efter-sms-kod"))).state).toEqual(DATA);
    await expect(on("laptop2", () => syncLogin("anna", "hemlig-kod"))).rejects.toMatchObject({
      status: 401,
    });
    expect((await on("new-phone", () => syncPull(done.token))).state).toEqual(DATA);
    expect(await on("new-phone", () => getPendingRecoveryKey())).toMatchObject({
      reason: "recovered",
    });
  });

  it("without the recovery key, refuses to silently replace the encrypted data", async () => {
    await recoverable();
    const session = await on("new-phone", () => syncRecoverConfirm("+46701234567", "123456"));
    const before = structuredClone(userOf("anna")); // after confirm, which bumps lastActivity
    const err = await on("new-phone", () => syncRecoverComplete(session, "efter-sms-kod")).catch(
      (e) => e,
    );
    expect(err).toMatchObject({ code: "RECOVERY_KEY_REQUIRED" });
    expect(userOf("anna")).toEqual(before);
    expect(await device("new-phone").getKey()).toBeNull();
  });

  it("can start over without the key when the user explicitly discards the cloud copy", async () => {
    await recoverable();
    const session = await on("new-phone", () => syncRecoverConfirm("+46701234567", "123456"));
    const done = await on("new-phone", () =>
      syncRecoverComplete(session, "efter-sms-kod", { discardCloudData: true }),
    );
    expect(done.state).toBeNull();
    expect(userOf("anna")).toMatchObject({ encrypted: true, state: null });
    // This device seeds the account again, encrypted with the new key.
    await on("new-phone", () => syncPush(done.token, withNote("nystart")));
    expect((await on("laptop", () => syncLogin("anna", "efter-sms-kod"))).state).toEqual(
      withNote("nystart"),
    );
  });

  it("migrates a legacy account recovered by SMS (no recovery key exists yet)", async () => {
    server.store.users.carl = {
      id: "u-carl",
      username: "Carl",
      secretHash: "h$glömd",
      state: DATA,
      stateUpdatedAt: 500,
      createdAt: 1,
      lastActivity: 1,
    };
    server.phones.set("+46700000001", "u-carl");
    const session = await on("phone", () => syncRecoverConfirm("+46700000001", "123456"));
    expect(session).toMatchObject({ needsRecoveryKey: false, hasRecoveryKey: false });
    const done = await on("phone", () => syncRecoverComplete(session, "ny-kod-carl"));
    expect(done.state).toEqual(DATA);
    expect(userOf("carl").encrypted).toBe(true);
    expect(JSON.stringify(userOf("carl"))).not.toContain("HEMLIG");
    expect((await on("laptop", () => syncLogin("carl", "ny-kod-carl"))).state).toEqual(DATA);
  });

  it("needs no recovery key when the encrypted account holds no data", async () => {
    const { userId } = await on("phone", () => syncRegister("anna", "hemlig-kod"));
    server.phones.set("+46701234567", userId);
    const session = await on("new-phone", () => syncRecoverConfirm("+46701234567", "123456"));
    expect(session.needsRecoveryKey).toBe(false);
    const done = await on("new-phone", () => syncRecoverComplete(session, "efter-sms-kod"));
    expect(done.state).toBeNull();
  });

  it("passes on a wrong SMS code as an error", async () => {
    await recoverable();
    await expect(
      on("new-phone", () => syncRecoverConfirm("+46701234567", "000000")),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("account deletion", () => {
  it("forgets the device key and any unacknowledged recovery key", async () => {
    const { token } = await setupAccount();
    await on("phone", () => syncDeleteAccount(token));
    expect(await device("phone").getKey()).toBeNull();
    expect(await on("phone", () => getPendingRecoveryKey())).toBeNull();
    expect(userOf("anna")).toBeUndefined();
  });
});
