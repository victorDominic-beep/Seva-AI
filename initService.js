// initService.js — Seva AI v1.0
// -------------------------------------------------------------------
// Handles the initialization flow when user opens the chat panel
// Spec section 3: triggered on chat panel open, not on login
//
// Flow:
//   1. Receive userId from frontend
//   2. Generate JWT
//   3. Fire-and-forget request to backend
//   4. Poll Redis for user data
//   5. Analyze user data
//   6. Generate session (UUID-based)
//   7. Set HTTP-only cookie
//   8. Signal ready to frontend
// -------------------------------------------------------------------

const { getValidJwtToken, createSessionToken } = require("./jwtService");
const { pollRedisForUserData,
        storeSession,
        refreshSessionTTL }                    = require("./redisService");
const { v4: uuidv4 }                           = require("uuid");


// In-memory session store (fallback if Redis not available for sessions)
// For production — use Redis via storeSession()
const activeSessions = new Map();

// Message queue — stores messages sent before session is ready
// Key: userId, Value: array of messages
const messageQueues = new Map();


// ── Initialize a Seva session for a user ─────────────────────────
// Called when user opens the chat panel
async function initializeSession(userId, res) {
  console.log(`\n[Init] Starting initialization for user: ${userId}`);

  try {
    // Step 1: Trigger backend data fetch (fire-and-forget)
    const { triggerBackendDataFetch } = require("./retriever");

    // DEMO MODE — skip fire-and-forget if demo user
    if (userId !== "demo") {
      await triggerBackendDataFetch(userId);
    }

    // Step 2: Poll Redis for user data
    let userData;
    if (userId === "demo") {
      // Demo mode — use local JSON
      const fs   = require("fs");
      const path = require("path");
      const profile      = JSON.parse(fs.readFileSync(path.join(__dirname, "user-profile.json"), "utf-8"));
      const transactions = JSON.parse(fs.readFileSync(path.join(__dirname, "transactions.json"), "utf-8"));
      userData = { ...profile, transactions };
    } else {
      userData = await pollRedisForUserData(userId);
    }

    // Step 3: Generate session
    const { token: sessionToken, sessionId } = createSessionToken(userId, userData.user || {});

    // Step 4: Store session server-side
    const sessionData = {
      sessionId,
      userId,
      createdAt:  Date.now(),
      dataFetched: true,
    };

    await storeSession(sessionId, sessionData);
    activeSessions.set(sessionId, sessionData);

    // Step 5: Set HTTP-only cookie (spec section 7.2)
    const cookieName    = process.env.SESSION_COOKIE_NAME || "seva_session";
    const sessionTTLMs  = (parseInt(process.env.SESSION_TTL_HOURS) || 2) * 60 * 60 * 1000;

    res.cookie(cookieName, sessionToken, {
      httpOnly: true,                                    // not accessible via JS — XSS protection
      secure:   process.env.NODE_ENV === "production",   // HTTPS only in production
      sameSite: process.env.COOKIE_SAMESITE || "Strict", // ← PLUG IN: confirm with frontend team
      maxAge:   sessionTTLMs,
    });

    console.log(`[Init] Session created: ${sessionId} for user: ${userId}`);

    // Step 6: Process any queued messages
    const queued = messageQueues.get(userId) || [];
    messageQueues.delete(userId);

    return {
      success:        true,
      sessionReady:   true,
      sessionId,
      queuedMessages: queued,
      userName:       userData.user?.name || "User",
    };

  } catch (err) {
    console.error(`[Init] Initialization failed for user ${userId}:`, err.message);

    if (err.message.includes("USER_NOT_FOUND")) {
      return { success: false, error: "USER_NOT_FOUND", message: "Could not load your profile. Please try again." };
    }
    if (err.message.includes("AUTH_FAILED")) {
      return { success: false, error: "AUTH_FAILED",    message: "Authentication failed. Please log in again." };
    }
    if (err.message.includes("REDIS_TIMEOUT")) {
      return { success: false, error: "REDIS_TIMEOUT",  message: "Service is taking too long. Please try reopening the chat." };
    }

    return { success: false, error: "INIT_FAILED", message: "AI service unavailable. Please try again." };
  }
}


// ── Queue a message sent before session is ready ──────────────────
// Spec section 3.2 — FIFO ordering required
function queueMessage(userId, message) {
  if (!messageQueues.has(userId)) {
    messageQueues.set(userId, []);
  }
  messageQueues.get(userId).push({
    message,
    queuedAt: Date.now(),
  });
  console.log(`[Queue] Message queued for user ${userId} — queue size: ${messageQueues.get(userId).length}`);
}


// ── Validate a session from the HTTP-only cookie ──────────────────
async function validateSession(req) {
  const cookieName = process.env.SESSION_COOKIE_NAME || "seva_session";
  const cookie     = req.cookies?.[cookieName];

  if (!cookie) {
    return { valid: false, error: "NO_SESSION_COOKIE" };
  }

  const { verifySessionToken } = require("./jwtService");
  const result = verifySessionToken(cookie);

  if (!result.valid) {
    return { valid: false, error: "SESSION_EXPIRED" };
  }

  // Slide session TTL on active request (spec section 7.3)
  const { sessionId } = result.payload;
  await refreshSessionTTL(sessionId).catch(() => {}); // non-blocking

  return { valid: true, payload: result.payload };
}


// ── Invalidate session on logout ──────────────────────────────────
async function invalidateSession(req, res) {
  const cookieName = process.env.SESSION_COOKIE_NAME || "seva_session";
  const cookie     = req.cookies?.[cookieName];

  if (cookie) {
    const { verifySessionToken } = require("./jwtService");
    const result = verifySessionToken(cookie);
    if (result.valid) {
      const { deleteSession } = require("./redisService");
      await deleteSession(result.payload.sessionId).catch(() => {});
      activeSessions.delete(result.payload.sessionId);
    }
  }

  // Clear the cookie
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: process.env.COOKIE_SAMESITE || "Strict",
  });

  console.log(`[Session] Logged out and session invalidated`);
  return { success: true };
}


module.exports = {
  initializeSession,
  validateSession,
  invalidateSession,
  queueMessage,
};
