import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT       = parseInt(process.env.PORT ?? "3001", 10);
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-production";
const DATA_PATH  = process.env.DATA_PATH ?? path.join(__dirname, "data.json");
const PROD       = process.env.NODE_ENV === "production";
const BCRYPT_ROUNDS = 12;
const INACTIVE_MS   = 60 * 24 * 60 * 60 * 1000; // 60 days

// ─── JSON store ───────────────────────────────────────────────
// Shape: { users: { [username_lower]: { id, username, secretHash, state, createdAt, lastActivity } } }

function readStore() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, "utf8")); }
  catch { return { users: {} }; }
}

function writeStore(s) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(s), "utf8");
}

let store = readStore();

function findByUsername(username) { return store.users[username.toLowerCase()] ?? null; }

function findEntry(userId) {
  return Object.entries(store.users).find(([, u]) => u.id === userId) ?? null;
}

function upsert(key, rec) { store.users[key] = rec; writeStore(store); }

function removeById(userId) {
  const entry = findEntry(userId);
  if (entry) { delete store.users[entry[0]]; writeStore(store); }
}

function cleanupInactive() {
  const cutoff = Date.now() - INACTIVE_MS;
  let removed = 0;
  for (const [key, user] of Object.entries(store.users)) {
    const activity = user.lastActivity ?? user.createdAt ?? 0;
    if (activity < cutoff) { delete store.users[key]; removed++; }
  }
  if (removed > 0) { writeStore(store); console.log(`Cleaned up ${removed} inactive account(s).`); }
}

// Run cleanup on startup and every 24 hours
cleanupInactive();
setInterval(cleanupInactive, 24 * 60 * 60 * 1000);

// ─── Phone lookup ─────────────────────────────────────────────
function findByPhone(phone) {
  return Object.entries(store.users).find(([, u]) => u.phone === phone) ?? null;
}

// ─── SMS / 46elks ─────────────────────────────────────────────
const ELKS_USERNAME = process.env.ELKS_API_USERNAME;
const ELKS_PASSWORD = process.env.ELKS_API_PASSWORD;
const ELKS_FROM     = process.env.ELKS_FROM ?? "MinTid";

function toE164Swedish(raw) {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("46")) return "+" + digits;
  if (digits.startsWith("0"))  return "+46" + digits.slice(1);
  return "+" + digits;
}

async function sendSms(phone, message) {
  if (!ELKS_USERNAME || !ELKS_PASSWORD) {
    console.warn(`[sms] 46elks credentials not set — would send to ${phone}: ${message}`);
    return;
  }
  const creds = Buffer.from(`${ELKS_USERNAME}:${ELKS_PASSWORD}`).toString("base64");
  const body  = new URLSearchParams({ from: ELKS_FROM, to: phone, message });
  const res   = await fetch("https://api.46elks.com/a1/sms", {
    method:  "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`46elks ${res.status}: ${txt}`);
  }
}

// ─── OTP store (in-memory) ────────────────────────────────────
// otpStore: phone → { codeHash, expiresAt, userId }
const otpStore    = new Map();
// rateLimits: phone → { lastSent: ms, sends: ms[] }
const rateLimits  = new Map();

const OTP_TTL_MS    = 10 * 60 * 1000;
const OTP_COOLDOWN  = parseInt(process.env.SMS_RESEND_COOLDOWN_SEC ?? "60", 10) * 1000;
const OTP_MAX_HOUR  = parseInt(process.env.SMS_MAX_PER_HOUR ?? "3", 10);
const OTP_MAX_DAY   = parseInt(process.env.SMS_MAX_PER_DAY  ?? "10", 10);

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function checkRateLimit(phone) {
  const now = Date.now();
  const rl  = rateLimits.get(phone);
  if (!rl) return { ok: true };
  if (now - rl.lastSent < OTP_COOLDOWN) {
    const wait = Math.ceil((OTP_COOLDOWN - (now - rl.lastSent)) / 1000);
    return { ok: false, reason: `Vänta ${wait} sekunder innan du begär en ny kod.` };
  }
  const h = now - 3600_000, d = now - 86400_000;
  if (rl.sends.filter(t => t > h).length >= OTP_MAX_HOUR) return { ok: false, reason: "För många SMS den senaste timmen. Försök igen senare." };
  if (rl.sends.filter(t => t > d).length >= OTP_MAX_DAY)  return { ok: false, reason: "För många SMS idag. Försök igen imorgon." };
  return { ok: true };
}

function recordSend(phone) {
  const now = Date.now();
  const rl  = rateLimits.get(phone) ?? { lastSent: 0, sends: [] };
  rl.lastSent = now;
  rl.sends.push(now);
  rl.sends = rl.sends.filter(t => t > now - 86400_000);
  rateLimits.set(phone, rl);
}

function storeOtp(phone, userId) {
  const code     = String(crypto.randomInt(100000, 1000000));
  const codeHash = hashCode(code);
  otpStore.set(phone, { codeHash, expiresAt: Date.now() + OTP_TTL_MS, userId });
  return code;
}

function verifyOtp(phone, userCode) {
  const entry = otpStore.get(phone);
  if (!entry)                        return { ok: false, reason: "Ingen aktiv kod för det numret. Begär en ny." };
  if (Date.now() > entry.expiresAt)  { otpStore.delete(phone); return { ok: false, reason: "Koden har gått ut. Begär en ny." }; }
  if (hashCode(userCode) !== entry.codeHash) return { ok: false, reason: "Fel kod. Kontrollera och försök igen." };
  const { userId } = entry;
  otpStore.delete(phone);
  return { ok: true, userId };
}

setInterval(() => {
  const now = Date.now();
  for (const [phone, e] of otpStore) if (now > e.expiresAt) otpStore.delete(phone);
}, 15 * 60 * 1000);

// ─── Username validation ──────────────────────────────────────
function isValidUsername(u) {
  return typeof u === "string" && /^[a-zA-Z0-9_-]{3,20}$/.test(u);
}

// ─── App ──────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "4mb" }));

if (PROD) {
  const dist = path.join(__dirname, "../dist");
  app.use(express.static(dist));
}

// ─── POST /api/auth/register  { username, secret }  →  { userId, token }
app.post("/api/auth/register", async (req, res) => {
  const { username, secret } = req.body ?? {};
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: "Användarnamnet måste vara 3–20 tecken (a–z, 0–9, _ eller -)." });
  }
  if (typeof secret !== "string" || secret.length < 6) {
    return res.status(400).json({ error: "Synk-koden måste vara minst 6 tecken." });
  }
  const key = username.toLowerCase();
  if (findByUsername(key)) {
    return res.status(409).json({ error: `Användarnamnet "${username}" är redan taget. Välj ett annat.` });
  }
  const secretHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
  const userId = crypto.randomUUID();
  const now = Date.now();
  upsert(key, { id: userId, username, secretHash, state: null, createdAt: now, lastActivity: now });
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ userId, token });
});

// ─── POST /api/auth/login  { username, secret }  →  { userId, token, state }
app.post("/api/auth/login", async (req, res) => {
  const { username, secret } = req.body ?? {};
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: "Ange ett giltigt användarnamn." });
  }
  if (typeof secret !== "string" || !secret) {
    return res.status(400).json({ error: "Ange din synk-kod." });
  }
  const user = findByUsername(username);
  if (!user) {
    await bcrypt.compare(secret, "$2a$12$invalidhashpaddingtomatchcost000000000000000000000000000");
    return res.status(401).json({ error: "Fel användarnamn eller synk-kod." });
  }
  const valid = await bcrypt.compare(secret, user.secretHash);
  if (!valid) return res.status(401).json({ error: "Fel användarnamn eller synk-kod." });
  // Update lastActivity on login
  const key = username.toLowerCase();
  upsert(key, { ...user, lastActivity: Date.now() });
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ userId: user.id, token, state: user.state ?? null });
});

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

// ─── GET /api/sync  →  { state }
app.get("/api/sync", auth, (req, res) => {
  const entry = findEntry(req.userId);
  if (!entry) return res.status(404).json({ error: "Användare inte hittad." });
  res.json({ state: entry[1].state ?? null });
});

// ─── PUT /api/sync  { state }  →  { ok }
app.put("/api/sync", auth, (req, res) => {
  const { state } = req.body ?? {};
  if (!state || typeof state !== "object") return res.status(400).json({ error: "Ogiltig data." });
  const entry = findEntry(req.userId);
  if (!entry) return res.status(404).json({ error: "Användare inte hittad." });
  upsert(entry[0], { ...entry[1], state, lastActivity: Date.now() });
  res.json({ ok: true });
});

// ─── DELETE /api/account  →  { ok }
app.delete("/api/account", auth, (req, res) => {
  removeById(req.userId);
  res.json({ ok: true });
});

// ─── PUT /api/auth/secret  { newSecret }  →  { ok }
app.put("/api/auth/secret", auth, async (req, res) => {
  const { newSecret } = req.body ?? {};
  if (typeof newSecret !== "string" || newSecret.length < 6) {
    return res.status(400).json({ error: "Den nya synk-koden måste vara minst 6 tecken." });
  }
  const entry = findEntry(req.userId);
  if (!entry) return res.status(404).json({ error: "Användare inte hittad." });
  const secretHash = await bcrypt.hash(newSecret, BCRYPT_ROUNDS);
  upsert(entry[0], { ...entry[1], secretHash, lastActivity: Date.now() });
  res.json({ ok: true });
});

// ─── POST /api/auth/phone  { phone }  →  { ok }  (requires auth — sends OTP)
app.post("/api/auth/phone", auth, async (req, res) => {
  let { phone } = req.body ?? {};
  if (typeof phone !== "string" || !phone.trim()) return res.status(400).json({ error: "Ange ett mobilnummer." });
  phone = toE164Swedish(phone.trim());
  if (!/^\+\d{8,15}$/.test(phone)) return res.status(400).json({ error: "Ogiltigt mobilnummer." });
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
});

// ─── POST /api/auth/phone/verify  { phone, code }  →  { ok }  (requires auth)
app.post("/api/auth/phone/verify", auth, async (req, res) => {
  let { phone, code } = req.body ?? {};
  if (typeof phone !== "string" || typeof code !== "string") return res.status(400).json({ error: "Ange telefonnummer och kod." });
  phone = toE164Swedish(phone.trim());
  const result = verifyOtp(phone, code.trim());
  if (!result.ok) return res.status(400).json({ error: result.reason });
  if (result.userId !== req.userId) return res.status(403).json({ error: "Koden tillhör ett annat konto." });
  const entry = findEntry(req.userId);
  if (!entry) return res.status(404).json({ error: "Användare inte hittad." });
  upsert(entry[0], { ...entry[1], phone, lastActivity: Date.now() });
  res.json({ ok: true });
});

// ─── POST /api/auth/recover/request  { phone }  →  { ok }  (no auth — sends recovery OTP)
app.post("/api/auth/recover/request", async (req, res) => {
  let { phone } = req.body ?? {};
  if (typeof phone !== "string" || !phone.trim()) return res.status(400).json({ error: "Ange ett mobilnummer." });
  phone = toE164Swedish(phone.trim());
  if (!/^\+\d{8,15}$/.test(phone)) return res.status(400).json({ error: "Ogiltigt mobilnummer." });
  const rl = checkRateLimit(phone);
  if (!rl.ok) return res.status(429).json({ error: rl.reason });
  const userEntry = findByPhone(phone);
  if (!userEntry) {
    // Deliberately vague — don't reveal registration status
    await new Promise(r => setTimeout(r, 300));
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
});

// ─── POST /api/auth/recover/confirm  { phone, code }  →  { username, token, state }
app.post("/api/auth/recover/confirm", async (req, res) => {
  let { phone, code } = req.body ?? {};
  if (typeof phone !== "string" || typeof code !== "string") return res.status(400).json({ error: "Ange telefonnummer och kod." });
  phone = toE164Swedish(phone.trim());
  const result = verifyOtp(phone, code.trim());
  if (!result.ok) return res.status(400).json({ error: result.reason });
  const entry = findEntry(result.userId);
  if (!entry) return res.status(404).json({ error: "Kontot hittades inte." });
  const user = entry[1];
  upsert(entry[0], { ...user, lastActivity: Date.now() });
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ username: user.username, token, state: user.state ?? null });
});

if (PROD) {
  const dist = path.join(__dirname, "../dist");
  app.get("*", (_, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`min-tid server :${PORT} (${PROD ? "production" : "development"})`);
});
