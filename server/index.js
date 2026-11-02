import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { createCore, PROTOCOL_HEADER, PROTOCOL_VERSION } from "./core.js";
import { resolveServerConfig } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = resolveServerConfig(process.env, __dirname);
for (const msg of CONFIG.fatal) console.error(`[config] FEL: ${msg}`);
if (CONFIG.fatal.length) process.exit(1);
for (const msg of CONFIG.warnings) console.warn(`[config] VARNING: ${msg}`);

const PORT = CONFIG.port;
const JWT_SECRET = CONFIG.jwtSecret;
const DATA_PATH = CONFIG.dataPath;
const PROD = CONFIG.prod;
const SERVER_VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, "package.json"), "utf8"),
).version;
const BCRYPT_ROUNDS = 12;
const INACTIVE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

// Never log request bodies: they carry auth keys, ciphertext and phone numbers.
// Nothing in this file or core.js prints req.body, and the error handler below
// replaces Express's default one (which would print a JSON parse error, body excerpt
// included).

// ─── JSON store ───────────────────────────────────────────────
// Shape: see "Data model" in CLAUDE.md. Encrypted accounts hold only { v, iv, ct }.

function readStore() {
  let raw;
  try {
    raw = fs.readFileSync(DATA_PATH, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { users: {} };
    throw e;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.users === "object" && parsed.users !== null) return parsed;
  } catch {
    /* fall through */
  }
  // Starting empty would overwrite every account on the next write. Refuse instead.
  console.error(`[store] ${DATA_PATH} is not valid JSON — refusing to start. Restore a backup.`);
  process.exit(1);
}

/** Write to a temp file and rename over the original, so a crash never leaves half a file. */
function writeStore(s) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  const tmp = `${DATA_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s), "utf8");
  fs.renameSync(tmp, DATA_PATH);
}

const store = readStore();

function findEntry(userId) {
  return Object.entries(store.users).find(([, u]) => u.id === userId) ?? null;
}

function upsert(key, rec) {
  store.users[key] = rec;
  writeStore(store);
}

function removeById(userId) {
  const entry = findEntry(userId);
  if (entry) {
    delete store.users[entry[0]];
    writeStore(store);
  }
}

function cleanupInactive() {
  const cutoff = Date.now() - INACTIVE_MS;
  let removed = 0;
  for (const [key, user] of Object.entries(store.users)) {
    const activity = user.lastActivity ?? user.createdAt ?? 0;
    if (activity < cutoff) {
      delete store.users[key];
      removed++;
    }
  }
  if (removed > 0) {
    writeStore(store);
    console.log(`Cleaned up ${removed} inactive account(s).`);
  }
}

// Run cleanup on startup and every 24 hours
cleanupInactive();
setInterval(cleanupInactive, 24 * 60 * 60 * 1000);

const core = createCore({
  store,
  persist: () => writeStore(store),
  hashSecret: (s) => bcrypt.hash(s, BCRYPT_ROUNDS),
  compareSecret: (s, h) => bcrypt.compare(s, h),
  signToken: (userId) => jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" }),
});

// ─── Phone lookup ─────────────────────────────────────────────
function findByPhone(phone) {
  return Object.entries(store.users).find(([, u]) => u.phone === phone) ?? null;
}

// ─── SMS / 46elks ─────────────────────────────────────────────
const ELKS_USERNAME = process.env.ELKS_API_USERNAME;
const ELKS_PASSWORD = process.env.ELKS_API_PASSWORD;
const ELKS_FROM = process.env.ELKS_FROM ?? "MinTid";

function toE164Swedish(raw) {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("46")) return "+" + digits;
  if (digits.startsWith("0")) return "+46" + digits.slice(1);
  return "+" + digits;
}

async function sendSms(phone, message) {
  if (!ELKS_USERNAME || !ELKS_PASSWORD) {
    console.warn(`[sms] 46elks credentials not set — would send to ${phone}: ${message}`);
    return;
  }
  const creds = Buffer.from(`${ELKS_USERNAME}:${ELKS_PASSWORD}`).toString("base64");
  const body = new URLSearchParams({ from: ELKS_FROM, to: phone, message });
  const res = await fetch("https://api.46elks.com/a1/sms", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`46elks ${res.status}: ${txt}`);
  }
}

// ─── OTP store (in-memory) ────────────────────────────────────
// otpStore: phone → { codeHash, expiresAt, userId }
const otpStore = new Map();
// rateLimits: phone → { lastSent: ms, sends: ms[] }
const rateLimits = new Map();

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COOLDOWN = parseInt(process.env.SMS_RESEND_COOLDOWN_SEC ?? "60", 10) * 1000;
const OTP_MAX_HOUR = parseInt(process.env.SMS_MAX_PER_HOUR ?? "3", 10);
const OTP_MAX_DAY = parseInt(process.env.SMS_MAX_PER_DAY ?? "10", 10);

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function checkRateLimit(phone) {
  const now = Date.now();
  const rl = rateLimits.get(phone);
  if (!rl) return { ok: true };
  if (now - rl.lastSent < OTP_COOLDOWN) {
    const wait = Math.ceil((OTP_COOLDOWN - (now - rl.lastSent)) / 1000);
    return { ok: false, reason: `Vänta ${wait} sekunder innan du begär en ny kod.` };
  }
  const h = now - 3600_000,
    d = now - 86400_000;
  if (rl.sends.filter((t) => t > h).length >= OTP_MAX_HOUR)
    return { ok: false, reason: "För många SMS den senaste timmen. Försök igen senare." };
  if (rl.sends.filter((t) => t > d).length >= OTP_MAX_DAY)
    return { ok: false, reason: "För många SMS idag. Försök igen imorgon." };
  return { ok: true };
}

function recordSend(phone) {
  const now = Date.now();
  const rl = rateLimits.get(phone) ?? { lastSent: 0, sends: [] };
  rl.lastSent = now;
  rl.sends.push(now);
  rl.sends = rl.sends.filter((t) => t > now - 86400_000);
  rateLimits.set(phone, rl);
}

function storeOtp(phone, userId) {
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = hashCode(code);
  otpStore.set(phone, { codeHash, expiresAt: Date.now() + OTP_TTL_MS, userId });
  return code;
}

function verifyOtp(phone, userCode) {
  const entry = otpStore.get(phone);
  if (!entry) return { ok: false, reason: "Ingen aktiv kod för det numret. Begär en ny." };
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(phone);
    return { ok: false, reason: "Koden har gått ut. Begär en ny." };
  }
  if (hashCode(userCode) !== entry.codeHash)
    return { ok: false, reason: "Fel kod. Kontrollera och försök igen." };
  const { userId } = entry;
  otpStore.delete(phone);
  return { ok: true, userId };
}

setInterval(
  () => {
    const now = Date.now();
    for (const [phone, e] of otpStore) if (now > e.expiresAt) otpStore.delete(phone);
  },
  15 * 60 * 1000,
);

// ─── App ──────────────────────────────────────────────────────
const app = express();
// Envelopes are base64 (+33 %) of the JSON state, so allow more than the plaintext needed.
app.use(express.json({ limit: "8mb" }));

if (PROD) {
  const dist = path.join(__dirname, "../dist");
  app.use(express.static(dist));
}

/** Express 4 does not catch rejected promises; route them to the error handler. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const send = (res, r) => res.status(r.status).json(r.body);
/** True for clients that encrypt (they send X-Sync-Protocol: 2 on every request). */
const isE2E = (req) => req.get(PROTOCOL_HEADER) === PROTOCOL_VERSION;

// ─── GET /api/auth/salt?username=  →  { salt, encrypted }
// Unauthenticated status for the app's debug panel and for uptime checks. Says whether
// data.json survives a redeploy — never anything about accounts.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, version: SERVER_VERSION, storage: CONFIG.storage });
});

app.get("/api/auth/salt", (req, res) => {
  send(res, core.salt({ username: req.query.username }));
});

// ─── POST /api/auth/register  { username, authKey, salt, recovery }  →  { userId, token, salt }
app.post(
  "/api/auth/register",
  wrap(async (req, res) => {
    send(res, await core.register({ body: req.body, e2e: isE2E(req) }));
  }),
);

// ─── POST /api/auth/login  { username, authKey } (legacy: { username, secret })
//     →  { userId, username, token, state, updatedAt, encrypted, salt? }
app.post(
  "/api/auth/login",
  wrap(async (req, res) => {
    send(res, await core.login({ body: req.body, e2e: isE2E(req) }));
  }),
);

// ─── Auth middleware ──────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Ej autentiserad." });
  try {
    req.userId = jwt.verify(header.slice(7), JWT_SECRET).userId;
    next();
  } catch {
    res.status(401).json({ error: "Ogiltig eller utgången session. Logga in igen." });
  }
}

// ─── GET /api/sync  →  { state, updatedAt, encrypted, salt? }
// updatedAt is the revision marker: the client stores it after every pull/push and
// compares it on the next pull to detect "another device wrote after me".
// Encrypted accounts: the envelope is returned untouched, and only to encrypting clients.
app.get("/api/sync", auth, (req, res) => {
  send(res, core.syncGet({ userId: req.userId, e2e: isE2E(req) }));
});

// ─── PUT /api/sync  { state: { v, iv, ct }, salt }  (legacy: { state })  →  { ok, updatedAt }
app.put("/api/sync", auth, (req, res) => {
  send(res, core.syncPut({ userId: req.userId, e2e: isE2E(req), body: req.body }));
});

// ─── DELETE /api/account  →  { ok }
app.delete("/api/account", auth, (req, res) => {
  removeById(req.userId);
  res.json({ ok: true });
});

// ─── PUT /api/auth/secret  { authKey, salt, state, recovery, baseRev, discardState? }
//     (legacy accounts, old clients: { newSecret })  →  { ok, updatedAt }
// Migration, secret change and post-SMS reset all go through here, atomically.
app.put(
  "/api/auth/secret",
  auth,
  wrap(async (req, res) => {
    send(res, await core.changeSecret({ userId: req.userId, e2e: isE2E(req), body: req.body }));
  }),
);

// ─── POST /api/auth/phone  { phone }  →  { ok }  (requires auth — sends OTP)
app.post(
  "/api/auth/phone",
  auth,
  wrap(async (req, res) => {
    let { phone } = req.body ?? {};
    if (typeof phone !== "string" || !phone.trim())
      return res.status(400).json({ error: "Ange ett mobilnummer." });
    phone = toE164Swedish(phone.trim());
    if (!/^\+\d{8,15}$/.test(phone))
      return res.status(400).json({ error: "Ogiltigt mobilnummer." });
    const rl = checkRateLimit(phone);
    if (!rl.ok) return res.status(429).json({ error: rl.reason });
    const code = storeOtp(phone, req.userId);
    try {
      await sendSms(phone, `Din verifieringskod för min-tid: ${code}`);
      recordSend(phone);
      res.json({ ok: true });
    } catch (e) {
      otpStore.delete(phone);
      console.error("[sms]", e.message);
      res.status(502).json({ error: "Kunde inte skicka SMS. Försök igen." });
    }
  }),
);

// ─── POST /api/auth/phone/verify  { phone, code }  →  { ok }  (requires auth)
app.post("/api/auth/phone/verify", auth, (req, res) => {
  let { phone, code } = req.body ?? {};
  if (typeof phone !== "string" || typeof code !== "string")
    return res.status(400).json({ error: "Ange telefonnummer och kod." });
  phone = toE164Swedish(phone.trim());
  const result = verifyOtp(phone, code.trim());
  if (!result.ok) return res.status(400).json({ error: result.reason });
  if (result.userId !== req.userId)
    return res.status(403).json({ error: "Koden tillhör ett annat konto." });
  const entry = findEntry(req.userId);
  if (!entry) return res.status(404).json({ error: "Användare inte hittad." });
  upsert(entry[0], { ...entry[1], phone, lastActivity: Date.now() });
  res.json({ ok: true });
});

// ─── POST /api/auth/recover/request  { phone }  →  { ok }  (no auth — sends recovery OTP)
app.post(
  "/api/auth/recover/request",
  wrap(async (req, res) => {
    let { phone } = req.body ?? {};
    if (typeof phone !== "string" || !phone.trim())
      return res.status(400).json({ error: "Ange ett mobilnummer." });
    phone = toE164Swedish(phone.trim());
    if (!/^\+\d{8,15}$/.test(phone))
      return res.status(400).json({ error: "Ogiltigt mobilnummer." });
    const rl = checkRateLimit(phone);
    if (!rl.ok) return res.status(429).json({ error: rl.reason });
    const userEntry = findByPhone(phone);
    if (!userEntry) {
      // Deliberately vague — don't reveal registration status
      await new Promise((r) => setTimeout(r, 300));
      return res.json({ ok: true });
    }
    const code = storeOtp(phone, userEntry[1].id);
    try {
      await sendSms(phone, `Din återhämtningskod för min-tid: ${code}`);
      recordSend(phone);
      res.json({ ok: true });
    } catch (e) {
      otpStore.delete(phone);
      console.error("[sms]", e.message);
      res.status(502).json({ error: "Kunde inte skicka SMS. Försök igen." });
    }
  }),
);

// ─── POST /api/auth/recover/confirm  { phone, code }
//     →  { userId, username, token, state, updatedAt, encrypted, salt?, recovery? }
// The SMS code restores the account. For an encrypted account the data stays locked
// until the client unwraps the key with the user's recovery key.
app.post("/api/auth/recover/confirm", (req, res) => {
  let { phone, code } = req.body ?? {};
  if (typeof phone !== "string" || typeof code !== "string")
    return res.status(400).json({ error: "Ange telefonnummer och kod." });
  phone = toE164Swedish(phone.trim());
  const result = verifyOtp(phone, code.trim());
  if (!result.ok) return res.status(400).json({ error: result.reason });
  send(res, core.recoveredSession({ userId: result.userId, e2e: isE2E(req) }));
});

if (PROD) {
  const dist = path.join(__dirname, "../dist");
  app.get("*", (_, res) => res.sendFile(path.join(dist, "index.html")));
}

// Last: replaces Express's default handler, which logs the error (for a malformed JSON
// body that includes an excerpt of the body). Log the route and the error name only.
// Express recognises an error handler by its four parameters, so `_next` must stay.
app.use((err, req, res, _next) => {
  const status = Number.isInteger(err?.status) && err.status >= 400 ? err.status : 500;
  if (status >= 500) console.error(`[api] ${req.method} ${req.path} failed: ${err?.name}`);
  res.status(status).json({
    error:
      status === 413
        ? "För mycket data att synka på en gång."
        : status < 500
          ? "Ogiltig förfrågan."
          : "Serverfel. Försök igen om en stund.",
  });
});

app.listen(PORT, () => {
  console.log(
    `min-tid server v${SERVER_VERSION} :${PORT} (${PROD ? "production" : "development"}) · data ${DATA_PATH} · lagring ${CONFIG.storage}`,
  );
});
