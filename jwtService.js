// jwtService.js — Seva AI v4.0
require("dotenv").config();

const jwt = require("jsonwebtoken");

const SECRET  = process.env.JWT_SECRET;
const SEVA_ID = process.env.SEVA_AI_ID;

// In-memory token cache
let cachedToken    = null;
let cachedTokenExp = null;

// ── Matches dev's exact function ──────────────────────────────────
// Dev's function: createJwtToken(payload) => jwt.sign(payload, SECRET, { expiresIn:"1d", algorithm:"HS256", audience:"SEVAAI" })
// We call it with: { role: "seva", userId: SEVA_ID }
function createJwtToken(payload) {
  console.log(SECRET);
  const token = jwt.sign(payload, SECRET, {
    expiresIn: "1d",
    algorithm: "HS256",
    audience:  "SEVAAI",
  });
  return token;
}

// ── Get valid token — caches and auto-refreshes ───────────────────
function getValidJwtToken() {
  const now = Math.floor(Date.now() / 1000);

  // Check if cached token is still valid (more than 20% TTL remaining)
  if (cachedToken && cachedTokenExp) {
    const totalTTL     = 86400; // 1 day in seconds
    const remaining    = cachedTokenExp - now;
    const remainingPct = remaining / totalTTL;

    if (remainingPct > 0.2) {
      return cachedToken;
    }
    console.log(`[JWT] Refreshing — ${Math.round(remainingPct * 100)}% TTL remaining`);
  }

  // Generate new token with exact payload dev uses
  const payload = {
    role:   "seva",
    userId: SEVA_ID,
  };

  const token    = createJwtToken(payload);
  const decoded  = jwt.decode(token);
  cachedToken    = token;
  cachedTokenExp = decoded.exp;

  console.log(`[JWT] Token generated — expires in 1d`);
  return token;
}

// ── Verify JWT ────────────────────────────────────────────────────
function verifyJwtToken(token) {
  try {
    const decoded = jwt.verify(token, SECRET, {
      algorithms: ["HS256"],
      audience:   "SEVAAI",
    });
    return { valid: true, payload: decoded };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ── Session token ─────────────────────────────────────────────────
function createSessionToken(userId, userData) {
  const { v4: uuidv4 } = require("uuid");
  const sessionId = uuidv4();

  const token = createJwtToken({
    sessionId,
    userId,
    name:      userData?.name || "User",
    createdAt: Date.now(),
  });

  return { token, sessionId };
}

// ── Verify session token ──────────────────────────────────────────
function verifySessionToken(token) {
  try {
    const decoded = jwt.verify(token, SECRET, {
      algorithms: ["HS256"],
      audience:   "SEVAAI",
    });
    return { valid: true, payload: decoded };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

module.exports = {
  createJwtToken,
  getValidJwtToken,
  verifyJwtToken,
  createSessionToken,
  verifySessionToken,
};