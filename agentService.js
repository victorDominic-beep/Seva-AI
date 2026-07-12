// agentService.js — Seva AI Agent Layer
// -------------------------------------------------------------------
// Polls CRM for agent replies and routes them back to the user
// Manages handoff state between Seva AI and human agents
// -------------------------------------------------------------------

const { getActiveTicket, sendMessageToCRM, closeTicket } = require("./ticketService");

// Active polling intervals — key: userId, value: interval ID
const activePolls = new Map();

// Conversation history store — key: userId, value: array of messages
const conversationStore = new Map();

// Handoff state — key: userId, value: "seva" | "agent" | "pending"
const handoffState = new Map();

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS) || 3000;
const CRM_BASE_URL  = process.env.CRM_BASE_URL || "https://your-crm-api.com";
const CRM_API_KEY   = process.env.CRM_API_KEY  || "";


// ── Store a message in conversation history ───────────────────────
function storeMessage(userId, role, content) {
  if (!conversationStore.has(userId)) {
    conversationStore.set(userId, []);
  }
  conversationStore.get(userId).push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });
}


// ── Get full conversation history for a user ──────────────────────
function getConversationHistory(userId) {
  return conversationStore.get(userId) || [];
}


// ── Check if user is currently with a human agent ────────────────
function isWithAgent(userId) {
  return handoffState.get(userId) === "agent";
}


// ── Check if handoff is pending ───────────────────────────────────
function isPendingHandoff(userId) {
  return handoffState.get(userId) === "pending";
}


// ── Set handoff state ─────────────────────────────────────────────
function setHandoffState(userId, state) {
  handoffState.set(userId, state);
  console.log(`[Agent] Handoff state for ${userId}: ${state}`);
}


// ── Start polling CRM for agent messages ─────────────────────────
// Called after ticket is created and agent is notified
// Polls every POLL_INTERVAL ms for new messages from agent
function startPolling(userId, onAgentMessage) {
  // Stop any existing poll for this user
  stopPolling(userId);

  console.log(`[Agent] Starting poll for user: ${userId} every ${POLL_INTERVAL}ms`);

  let lastMessageId = null;

  const intervalId = setInterval(async () => {
    try {
      const ticket = getActiveTicket(userId);
      if (!ticket) {
        stopPolling(userId);
        return;
      }

      // ── PLUG IN HERE: your CRM's messages endpoint ─────────────
      const response = await fetch(
        `${CRM_BASE_URL}/api/tickets/${ticket.ticketId}/messages`,
        {
          method:  "GET",
          headers: {
            "Authorization": `Bearer ${CRM_API_KEY}`,
            "Content-Type":  "application/json",
          },
        }
      );

      if (!response.ok) {
        console.error(`[Agent] Poll failed: ${response.status}`);
        return;
      }

      const data     = await response.json();
      // ── PLUG IN HERE: adjust based on your CRM response shape ──
      const messages = data.messages || data.data || [];

      // Filter only agent messages we haven't seen yet
      const agentMessages = messages.filter(msg =>
        msg.sender === "agent" &&
        msg.id !== lastMessageId &&
        (!lastMessageId || msg.id > lastMessageId)
      );

      if (agentMessages.length > 0) {
        // Update last seen message ID
        lastMessageId = agentMessages[agentMessages.length - 1].id;

        // Set handoff state to agent if first agent message
        if (!isWithAgent(userId)) {
          setHandoffState(userId, "agent");
          console.log(`[Agent] Agent has taken over for user: ${userId}`);
        }

        // Deliver each new agent message to the user
        for (const msg of agentMessages) {
          const agentMessage = {
            role:      "agent",
            agentName: msg.agentName || msg.agent?.name || "Support Agent",
            content:   msg.content || msg.message || msg.text,
            timestamp: msg.timestamp || msg.createdAt || new Date().toISOString(),
            ticketId:  ticket.ticketId,
          };

          storeMessage(userId, "agent", agentMessage.content);
          onAgentMessage(userId, agentMessage);
        }
      }

      // Check if ticket was closed by agent
      const ticketStatus = data.ticket?.status || data.status;
      if (ticketStatus === "resolved" || ticketStatus === "closed") {
        console.log(`[Agent] Ticket resolved by agent for user: ${userId}`);
        stopPolling(userId);
        setHandoffState(userId, "seva");
        await closeTicket(userId);
        onAgentMessage(userId, {
          role:      "system",
          content:   "The agent has ended the session. Seva AI is back and ready to help you.",
          timestamp: new Date().toISOString(),
          handoffBack: true,
        });
      }

    } catch (err) {
      console.error(`[Agent] Poll error for user ${userId}:`, err.message);
    }
  }, POLL_INTERVAL);

  activePolls.set(userId, intervalId);
}


// ── Stop polling for a user ───────────────────────────────────────
function stopPolling(userId) {
  const intervalId = activePolls.get(userId);
  if (intervalId) {
    clearInterval(intervalId);
    activePolls.delete(userId);
    console.log(`[Agent] Stopped polling for user: ${userId}`);
  }
}


// ── Handle user message while with agent ─────────────────────────
// Routes user message to CRM instead of Seva AI
async function routeUserMessageToAgent(userId, message) {
  const ticket = getActiveTicket(userId);
  if (!ticket) {
    throw new Error("No active ticket found for user");
  }

  storeMessage(userId, "user", message);
  await sendMessageToCRM(userId, message);

  console.log(`[Agent] User message routed to CRM ticket: ${ticket.ticketId}`);
  return {
    success:  true,
    ticketId: ticket.ticketId,
    status:   "delivered_to_agent",
  };
}


// ── Cancel handoff — user changed their mind ──────────────────────
async function cancelHandoff(userId) {
  stopPolling(userId);
  setHandoffState(userId, "seva");
  await closeTicket(userId);
  console.log(`[Agent] Handoff cancelled for user: ${userId}`);
}


module.exports = {
  storeMessage,
  getConversationHistory,
  isWithAgent,
  isPendingHandoff,
  setHandoffState,
  startPolling,
  stopPolling,
  routeUserMessageToAgent,
  cancelHandoff,
};
