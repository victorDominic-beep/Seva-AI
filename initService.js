// initService.js — Seva AI v1.0
// -------------------------------------------------------------------
// Handles initialization when user opens the chat panel
//
// Flow:
//   1. Receive userId
//   2. Fetch user data directly from backend
//   3. Generate session
//   4. Store session in Redis
//   5. Set HTTP-only cookie
//   6. Signal ready to frontend
// -------------------------------------------------------------------

const { createSessionToken } = require("./jwtService");
const { fetchUserData } = require("./retriever");
const {
  storeSession,
  getSession,
  refreshSessionTTL,
} = require("./redisService");

// In-memory session store
const activeSessions = new Map();

// Message queue
const messageQueues = new Map();


// ── Initialize a Seva session ─────────────────────────────────────
async function initializeSession(userId, res) {
  console.log(`\n[Init] Starting initialization for user: ${userId}`);

  try {
    // Step 1: Fetch user data directly from backend
    const userData = await fetchUserData(userId);

    // Step 2: Generate session
    const {
      token: sessionToken,
      sessionId,
    } = createSessionToken(
      userId,
      userData.profile?.user || {}
    );

    // Step 3: Store session server-side
    const sessionData = {
      sessionId,
      userId,
      createdAt: Date.now(),
      dataFetched: true,
    };

    await storeSession(sessionId, sessionData);
    activeSessions.set(sessionId, sessionData);

    // Step 4: Set HTTP-only cookie
    const cookieName =
      process.env.SESSION_COOKIE_NAME || "seva_session";

    const sessionTTLMs =
      (parseInt(process.env.SESSION_TTL_HOURS) || 2) *
      60 *
      60 *
      1000;

    res.cookie(cookieName, sessionToken, {
      httpOnly: true,
      secure:
        process.env.NODE_ENV === "production",
      sameSite:
        process.env.COOKIE_SAMESITE || "Strict",
      maxAge: sessionTTLMs,
    });

    console.log(
      `[Init] Session created: ${sessionId} for user: ${userId}`
    );

    // Step 5: Process queued messages
    const queued =
      messageQueues.get(userId) || [];

    messageQueues.delete(userId);

    return {
      success: true,
      sessionReady: true,
      sessionId,
      queuedMessages: queued,
      userName:
        userData.profile?.user?.name || "User",
    };

  } catch (err) {
    console.error(
      `[Init] Initialization failed for user ${userId}:`,
      err.message
    );

    if (err.message.includes("USER_NOT_FOUND")) {
      return {
        success: false,
        error: "USER_NOT_FOUND",
        message:
          "Could not load your profile. Please try again.",
      };
    }

    if (err.message.includes("AUTH_FAILED")) {
      return {
        success: false,
        error: "AUTH_FAILED",
        message:
          "Authentication failed. Please log in again.",
      };
    }

    return {
      success: false,
      error: "INIT_FAILED",
      message:
        "AI service unavailable. Please try again.",
    };
  }
}


// ── Queue a message sent before session is ready ──────────────────
function queueMessage(userId, message) {
  if (!messageQueues.has(userId)) {
    messageQueues.set(userId, []);
  }

  messageQueues.get(userId).push({
    message,
    queuedAt: Date.now(),
  });

  console.log(
    `[Queue] Message queued for user ${userId} — queue size: ${messageQueues.get(userId).length}`
  );
}


// ── Validate session ──────────────────────────────────────────────
async function validateSession(req) {
  const cookieName =
    process.env.SESSION_COOKIE_NAME || "seva_session";

  const cookie =
    req.cookies?.[cookieName];

  if (!cookie) {
    return {
      valid: false,
      error: "NO_SESSION_COOKIE",
    };
  }

  const { verifySessionToken } =
    require("./jwtService");

  const result =
    verifySessionToken(cookie);

  if (!result.valid) {
    return {
      valid: false,
      error: "SESSION_EXPIRED",
    };
  }

  const { sessionId } =
    result.payload;

  const storedSession =
    await getSession(sessionId).catch(() => null);

  if (!storedSession) {
    return {
      valid: false,
      error: "SESSION_NOT_FOUND",
    };
  }

  await refreshSessionTTL(
    sessionId
  ).catch(() => {});

  return {
    valid: true,
    payload: result.payload,
  };
}


// ── Invalidate session on logout ──────────────────────────────────
async function invalidateSession(req, res) {
  const cookieName =
    process.env.SESSION_COOKIE_NAME || "seva_session";

  const cookie =
    req.cookies?.[cookieName];

  if (cookie) {
    const {
      verifySessionToken,
    } = require("./jwtService");

    const result =
      verifySessionToken(cookie);

    if (result.valid) {
      const {
        deleteSession,
      } = require("./redisService");

      await deleteSession(
        result.payload.sessionId
      ).catch(() => {});

      activeSessions.delete(
        result.payload.sessionId
      );
    }
  }

  res.clearCookie(cookieName, {
    httpOnly: true,
    secure:
      process.env.NODE_ENV === "production",
    sameSite:
      process.env.COOKIE_SAMESITE || "Strict",
  });

  console.log(
    `[Session] Logged out and session invalidated`
  );

  return {
    success: true,
  };
}


module.exports = {
  initializeSession,
  validateSession,
  invalidateSession,
  queueMessage,
};