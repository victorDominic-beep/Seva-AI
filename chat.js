// chat.js — Seva AI v4.0 (Updated with timestamps)

const express                              = require("express");
const router                               = express.Router();
const { runSevaPipeline, SUGGESTED_PROMPTS } = require("./sevaPipeline");
const { initializeSession,
        validateSession,
        invalidateSession,
        queueMessage }                     = require("./initService");


// ── POST /api/chat/init ───────────────────────────────────────────
router.post("/init", async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "userId is required", code: "MISSING_USER_ID" });
  }

  // Timestamp when init was triggered
  const initTime = new Date().toISOString();

  const result = await initializeSession(userId, res);

  if (!result.success) {
    const statusMap = {
      "USER_NOT_FOUND": 404,
      "AUTH_FAILED":    401,
      "REDIS_TIMEOUT":  503,
      "INIT_FAILED":    500,
    };
    return res.status(statusMap[result.error] || 500).json(result);
  }

  res.json({
    success:          true,
    sessionReady:     true,
    userName:         result.userName,
    queuedMessages:   result.queuedMessages,
    suggestedPrompts: SUGGESTED_PROMPTS,
    initTime,         // when the session was initialized
  });
});


// ── POST /api/chat ────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { message, userId, isGreeting } = req.body;

  // Timestamp when message was received by server
  const messageSentTime = new Date().toISOString();

  // Validate session from HTTP-only cookie
  const session = await validateSession(req);
  if (!session.valid) {
    return res.status(401).json({
      error: session.error === "NO_SESSION_COOKIE"
        ? "No active session. Please open the chat panel first."
        : "Session expired. Please log in again.",
      code: session.error,
    });
  }

  if (!isGreeting && (!message || message.trim() === "")) {
    return res.status(400).json({ error: "message is required", code: "MISSING_MESSAGE" });
  }

  try {
    const query  = isGreeting ? null : message.trim();
    const result = await runSevaPipeline(query, userId || session.payload.userId);

    res.json({
      success: true,
      data: {
        query:            result.query,
        intent:           result.intent,
        isGreeting:       result.isGreeting,
        insight:          result.insight,
        meaning:          result.meaning,
        action:           result.action,
        ctas:             result.ctas,
        displayText:      result.displayText,
        suggestedPrompts: result.suggestedPrompts,
        // ── Timestamps ───────────────────────────────────────────
        messageSentTime,          // when user's message hit the server
        requestTime:  result.requestTime,   // when pipeline started
        responseTime: result.responseTime,  // when AI finished
        durationMs:   result.durationMs,    // total time in ms
      }
    });

  } catch (err) {
    console.error("Pipeline error:", err.message);

    if (err.message.includes("USER_NOT_FOUND")) {
      return res.status(404).json({ error: "User not found.",         code: "USER_NOT_FOUND" });
    }
    if (err.message.includes("AUTH_FAILED")) {
      return res.status(401).json({ error: "Authentication failed.",  code: "AUTH_FAILED"    });
    }
    if (err.message.includes("REDIS_TIMEOUT")) {
      return res.status(503).json({ error: "Service timeout. Retry.",code: "REDIS_TIMEOUT"  });
    }

    res.status(500).json({ error: "Seva AI pipeline failed", details: err.message });
  }
});


// ── POST /api/chat/logout ─────────────────────────────────────────
router.post("/logout", async (req, res) => {
  const result = await invalidateSession(req, res);
  res.json(result);
});


// ── GET /api/chat/greeting ────────────────────────────────────────
router.get("/greeting", async (req, res) => {
  try {
    const result = await runSevaPipeline(null, "demo");
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── GET /api/chat/demo ────────────────────────────────────────────
router.get("/demo", async (req, res) => {
  const queries = [
    { message: null,                         isGreeting: true  },
    { message: "How can I save more money?", isGreeting: false },
    { message: "Analyze my spending",        isGreeting: false },
    { message: "Create a budget plan",       isGreeting: false },
    { message: "Investment tips",            isGreeting: false },
  ];

  const results = [];
  for (const q of queries) {
    try {
      const result = await runSevaPipeline(q.message, "demo");
      results.push({
        query:        q.message || "GREETING",
        intent:       result.intent,
        response:     result.displayText,
        ctas:         result.ctas,
        requestTime:  result.requestTime,
        responseTime: result.responseTime,
        durationMs:   result.durationMs,
      });
    } catch (err) {
      results.push({ query: q.message, error: err.message });
    }
  }

  res.json({ success: true, demo: results });
});


module.exports = router;