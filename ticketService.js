// ticketService.js — Seva AI Agent Layer
// -------------------------------------------------------------------
// Creates support tickets in the CRM when user requests a human agent
// Stores active tickets in memory (upgrade to Redis for production)
// -------------------------------------------------------------------

const { getValidJwtToken } = require("./jwtService");

// ═══════════════════════════════════════════════════════════════
// PLUG IN HERE — CRM details from the CRM team
// ═══════════════════════════════════════════════════════════════
const CRM_BASE_URL = process.env.CRM_BASE_URL || "https://your-crm-api.com";
const CRM_API_KEY  = process.env.CRM_API_KEY  || "";

// In-memory store for active tickets
// Key: userId, Value: ticket object
const activeTickets = new Map();


// ── Create a new support ticket in the CRM ────────────────────────
async function createTicket(userId, userName, conversationHistory) {
  console.log(`[Ticket] Creating ticket for user: ${userId}`);

  const ticketPayload = {
    userId,
    userName,
    source:    "seva_ai",
    priority:  "normal",
    subject:   `User ${userName} requesting human agent`,
    status:    "open",
    createdAt: new Date().toISOString(),
    // Send last 10 messages as context for the agent
    conversationHistory: conversationHistory.slice(-10).map(msg => ({
      role:      msg.role,
      content:   msg.content,
      timestamp: msg.timestamp,
    })),
  };

  // ── PLUG IN HERE: replace with your CRM's actual endpoint ──────
  const response = await fetch(`${CRM_BASE_URL}/api/tickets`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${CRM_API_KEY}`,
      "X-Source":      "seva-ai",
    },
    body: JSON.stringify(ticketPayload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`CRM_ERROR: Failed to create ticket — ${response.status} ${body}`);
  }

  const ticket = await response.json();

  // Store ticket locally
  const ticketData = {
    ticketId:    ticket.id || ticket.ticketId || ticket._id,
    userId,
    userName,
    status:      "open",
    createdAt:   new Date().toISOString(),
    agentId:     null,
    agentName:   null,
    lastPolledAt: null,
  };

  activeTickets.set(userId, ticketData);
  console.log(`[Ticket] Created ticket: ${ticketData.ticketId} for user: ${userId}`);

  return ticketData;
}


// ── Get active ticket for a user ──────────────────────────────────
function getActiveTicket(userId) {
  return activeTickets.get(userId) || null;
}


// ── Update ticket status ──────────────────────────────────────────
async function updateTicketStatus(userId, status) {
  const ticket = activeTickets.get(userId);
  if (!ticket) return null;

  ticket.status = status;
  activeTickets.set(userId, ticket);

  // Notify CRM of status change
  try {
    await fetch(`${CRM_BASE_URL}/api/tickets/${ticket.ticketId}`, {
      method:  "PATCH",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${CRM_API_KEY}`,
      },
      body: JSON.stringify({ status }),
    });
  } catch (err) {
    console.error("[Ticket] Failed to update status in CRM:", err.message);
  }

  return ticket;
}


// ── Close ticket and hand back to Seva ────────────────────────────
async function closeTicket(userId) {
  const ticket = activeTickets.get(userId);
  if (!ticket) return null;

  await updateTicketStatus(userId, "resolved");
  activeTickets.delete(userId);

  console.log(`[Ticket] Closed ticket: ${ticket.ticketId} for user: ${userId}`);
  return ticket;
}


// ── Send a user message to the CRM ticket ────────────────────────
async function sendMessageToCRM(userId, message) {
  const ticket = activeTickets.get(userId);
  if (!ticket) throw new Error("No active ticket for user");

  // ── PLUG IN HERE: your CRM's message endpoint ──────────────────
  await fetch(`${CRM_BASE_URL}/api/tickets/${ticket.ticketId}/messages`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${CRM_API_KEY}`,
    },
    body: JSON.stringify({
      sender:    "user",
      userId,
      content:   message,
      timestamp: new Date().toISOString(),
    }),
  });
}


module.exports = {
  createTicket,
  getActiveTicket,
  updateTicketStatus,
  closeTicket,
  sendMessageToCRM,
  activeTickets,
};
