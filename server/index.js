import express from "express";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT       = parseInt(process.env.PORT ?? "3001", 10);
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-production";
const DB_PATH    = process.env.DB_PATH ?? path.join(__dirname, "data.db");
const PROD       = process.env.NODE_ENV === "production";
const BCRYPT_ROUNDS = 12;

// ─── Database ─────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT    PRIMARY KEY,
    lookup_key  TEXT    UNIQUE NOT NULL,
    secret_hash TEXT    NOT NULL,
    state       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lookup ON users(lookup_key);
`);

// Derives a stable lookup key from the secret so we don't need a username.
// Using a keyed hash avoids leaking which secrets exist via timing.
function lookupKey(secret) {
  return crypto.createHmac("sha256", "min-tid-lookup").update(secret).digest("hex").slice(0, 32);
}

// ─── App ──────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "4mb" }));

if (PROD) {
  const dist = path.join(__dirname, "../dist");
  app.use(express.static(dist));
}

// ─── Routes ───────────────────────────────────────────────────

// POST /api/auth/register  { secret }  →  { userId, token }
app.post("/api/auth/register", async (req, res) => {
  const { secret } = req.body ?? {};
  if (typeof secret !== "string" || secret.length < 6) {
    return res.status(400).json({ error: "Synk-koden måste vara minst 6 tecken." });
  }

  const key = lookupKey(secret);
  if (db.prepare("SELECT 1 FROM users WHERE lookup_key = ?").get(key)) {
    return res.status(409).json({ error: "Den här synk-koden är redan registrerad. Välj en annan." });
  }

  const secretHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
  const userId     = crypto.randomUUID();
  const now        = Date.now();
  db.prepare(
    "INSERT INTO users (id, lookup_key, secret_hash, state, created_at, updated_at) VALUES (?,?,?,NULL,?,?)"
  ).run(userId, key, secretHash, now, now);

  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ userId, token });
});

// POST /api/auth/login  { secret }  →  { userId, token, state }
app.post("/api/auth/login", async (req, res) => {
  const { secret } = req.body ?? {};
  if (typeof secret !== "string" || !secret) {
    return res.status(400).json({ error: "Ange din synk-kod." });
  }

  const key  = lookupKey(secret);
  const user = db.prepare("SELECT id, secret_hash, state FROM users WHERE lookup_key = ?").get(key);
  if (!user) {
    // Dummy compare to prevent timing-based enumeration
    await bcrypt.compare(secret, "$2a$12$invalidhashpaddingtomatchcost000000000000000000000000000");
    return res.status(401).json({ error: "Ingen användare hittades med den synk-koden." });
  }

  const valid = await bcrypt.compare(secret, user.secret_hash);
  if (!valid) return res.status(401).json({ error: "Felaktig synk-kod." });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
  res.json({
    userId: user.id,
    token,
    state: user.state ? JSON.parse(user.state) : null,
  });
});

// Auth middleware
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Ej autentiserad." });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Ogiltig eller utgången session. Logga in igen." });
  }
}

// GET /api/sync  →  { state }
app.get("/api/sync", auth, (req, res) => {
  const row = db.prepare("SELECT state FROM users WHERE id = ?").get(req.userId);
  if (!row) return res.status(404).json({ error: "Användare inte hittad." });
  res.json({ state: row.state ? JSON.parse(row.state) : null });
});

// PUT /api/sync  { state }  →  { ok }
app.put("/api/sync", auth, (req, res) => {
  const { state } = req.body ?? {};
  if (!state || typeof state !== "object") {
    return res.status(400).json({ error: "Ogiltig data." });
  }
  db.prepare("UPDATE users SET state = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(state), Date.now(), req.userId);
  res.json({ ok: true });
});

// DELETE /api/account  →  { ok }  (lets users delete their account)
app.delete("/api/account", auth, (req, res) => {
  db.prepare("DELETE FROM users WHERE id = ?").run(req.userId);
  res.json({ ok: true });
});

if (PROD) {
  const dist = path.join(__dirname, "../dist");
  app.get("*", (_, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`min-tid server listening on :${PORT} (${PROD ? "production" : "development"})`);
});
