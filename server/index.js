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

if (PROD) {
  const dist = path.join(__dirname, "../dist");
  app.get("*", (_, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`min-tid server :${PORT} (${PROD ? "production" : "development"})`);
});
