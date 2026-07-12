// chat.js — Seva AI v4.0 (No CTA buttons for now)

const express                                  = require("express");
const router                                   = express.Router();
const { runSevaPipeline, SUGGESTED_PROMPTS }   = require("./sevaPipeline");
const { initializeSession,
        validateSession,
        invalidateSession }                    = require("./initService");
const { createTicket,
        getActiveTicket,
        closeTicket }                          = require("./ticketService");
const { notifyAgentsNewTicket }                = require("./emailService");
const { startPolling,
        stopPolling,
        isWithAgent,
        isPendingHandoff,
        setHandoffState,
        routeUserMessageToAgent,
        cancelHandoff,
        storeMessage,
        getConversationHistory }               = require("./agentService");


// ── POST /api/chat/init ───────────────────────────────────────────
router.post("/init", async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: "userId is required", code: "MISSING_USER_ID" });
  }

  const initTime = new Date().toISOString();
  const result   = await initializeSession(userId, res);

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
    initTime,
  });
});


// ── POST /api/chat ────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { message, userId, isGreeting, conversationHistory = [] } = req.body;

  const messageSentTime = new Date().toISOString();

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

  const activeUserId = userId || session.payload.userId;

  try {

    if (isWithAgent(activeUserId)) {
      const result = await routeUserMessageToAgent(activeUserId, message.trim());
      return res.json({
        success:        true,
        routedToAgent:  true,
        ticketId:       result.ticketId,
        status:         "delivered_to_agent",
        messageSentTime,
      });
    }

    const query  = isGreeting ? null : message.trim();
    const result = await runSevaPipeline(query, activeUserId, conversationHistory);

    if (result.intent === "HUMAN_AGENT" && result.isHandoff) {
      setHandoffState(activeUserId, "pending");

      const history = conversationHistory.length > 0
        ? conversationHistory
        : getConversationHistory(activeUserId);

      const ticket = await createTicket(activeUserId, "User", history);
      await notifyAgentsNewTicket(ticket, history);

      startPolling(activeUserId, (uid, agentMessage) => {
        storeMessage(uid, agentMessage.role, agentMessage.content);
      });

      return res.json({
        success:        true,
        isHandoff:      true,
        ticketId:       ticket.ticketId,
        messageSentTime,
        data: {
          intent:      "HUMAN_AGENT",
          displayText: result.insight,
          insight:     result.insight,
          meaning:     result.meaning,
          action:      result.action,
        }
      });
    }

    if (message) storeMessage(activeUserId, "user", message.trim());
    if (result.assistantMessage) {
      storeMessage(activeUserId, "assistant", result.assistantMessage.content);
    }

    res.json({
      success: true,
      data: {
        query:            result.query,
        intent:           result.intent,
        isGreeting:       result.isGreeting,
        insight:          result.insight,
        meaning:          result.meaning,
        action:           result.action,
        displayText:      result.displayText,
        suggestedPrompts: result.suggestedPrompts,
        assistantMessage: result.assistantMessage,
        messageSentTime,
        requestTime:      result.requestTime,
        responseTime:     result.responseTime,
        durationMs:       result.durationMs,
      }
    });

  } catch (err) {
    console.error("Pipeline error:", err.message);
    if (err.message.includes("USER_NOT_FOUND"))
      return res.status(404).json({ error: "User not found.",         code: "USER_NOT_FOUND" });
    if (err.message.includes("AUTH_FAILED"))
      return res.status(401).json({ error: "Authentication failed.",  code: "AUTH_FAILED"    });
    if (err.message.includes("REDIS_TIMEOUT"))
      return res.status(503).json({ error: "Service timeout. Retry.",code: "REDIS_TIMEOUT"  });
    res.status(500).json({ error: "Seva AI pipeline failed", details: err.message });
  }
});


router.get("/agent-messages", async (req, res) => {
  const session = await validateSession(req);
  if (!session.valid) {
    return res.status(401).json({ error: "No active session", code: session.error });
  }

  const userId  = session.payload.userId;
  const ticket  = getActiveTicket(userId);
  const history = getConversationHistory(userId);
  const agentMessages = history.filter(m => m.role === "agent" || m.role === "system");

  res.json({
    success:       true,
    isWithAgent:   isWithAgent(userId),
    isPending:     isPendingHandoff(userId),
    ticketId:      ticket?.ticketId || null,
    agentMessages,
  });
});


router.post("/cancel-handoff", async (req, res) => {
  const session = await validateSession(req);
  if (!session.valid) {
    return res.status(401).json({ error: "No active session" });
  }
  const userId = session.payload.userId;
  await cancelHandoff(userId);
  res.json({ success: true, message: "Agent request cancelled. Seva AI is back." });
});


router.post("/logout", async (req, res) => {
  const session = await validateSession(req);
  if (session.valid) {
    stopPolling(session.payload.userId);
  }
  const result = await invalidateSession(req, res);
  res.json(result);
});


router.get("/greeting", async (req, res) => {
  try {
    const result = await runSevaPipeline(null, "demo", []);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get("/demo", async (req, res) => {
  const queries = [
    { message: null,                           isGreeting: true  },
    { message: "How can I save more money?",   isGreeting: false },
    { message: "Analyze my spending",          isGreeting: false },
    { message: "Create a budget plan",         isGreeting: false },
    { message: "Investment tips",              isGreeting: false },
  ];

  const results = [];
  for (const q of queries) {
    try {
      const result = await runSevaPipeline(q.message, "demo", []);
      results.push({
        query:        q.message || "GREETING",
        intent:       result.intent,
        response:     result.displayText,
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
