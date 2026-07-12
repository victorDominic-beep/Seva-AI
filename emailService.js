// emailService.js — Seva AI Agent Layer
// -------------------------------------------------------------------
// Sends email notifications to agents when a new ticket is created
// Uses Nodemailer with SMTP (works with Gmail, Outlook, any SMTP)
// -------------------------------------------------------------------

const nodemailer = require("nodemailer");

// ═══════════════════════════════════════════════════════════════
// PLUG IN HERE — email config from your .env file
// ═══════════════════════════════════════════════════════════════
function createTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || "smtp.gmail.com",
    port:   parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ── Get agent emails from .env ────────────────────────────────────
// Add as many agents as needed: AGENT_EMAIL_1, AGENT_EMAIL_2 etc
function getAgentEmails() {
  const emails = [];
  let i = 1;
  while (process.env[`AGENT_EMAIL_${i}`]) {
    emails.push(process.env[`AGENT_EMAIL_${i}`]);
    i++;
  }
  return emails;
}


// ── Send new ticket notification to all agents ────────────────────
async function notifyAgentsNewTicket(ticket, conversationHistory) {
  const agentEmails = getAgentEmails();
  if (agentEmails.length === 0) {
    console.warn("[Email] No agent emails configured — skipping notification");
    return;
  }

  const transporter = createTransporter();
  const crmUrl      = process.env.CRM_BASE_URL || "your-crm-url.com";

  // Build conversation summary for email
  const lastMessages = conversationHistory.slice(-5).map(msg =>
    `${msg.role === "user" ? "User" : "Seva"}: ${msg.content}`
  ).join("\n");

  const emailBody = `
A user has requested to speak with a human agent on Seva AI.

TICKET DETAILS
──────────────
Ticket ID:   ${ticket.ticketId}
User:        ${ticket.userName}
User ID:     ${ticket.userId}
Created At:  ${ticket.createdAt}
Status:      Open — awaiting agent

RECENT CONVERSATION
───────────────────
${lastMessages}

ACTION REQUIRED
───────────────
Please log in to the CRM to view the full conversation and take over from Seva AI.

CRM Link: ${crmUrl}/tickets/${ticket.ticketId}

─────────────────────────────
Seva AI — Automated Notification
Do not reply to this email.
  `.trim();

  const mailOptions = {
    from:    `"Seva AI" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to:      agentEmails.join(", "),
    subject: `[New Ticket #${ticket.ticketId}] ${ticket.userName} is requesting an agent`,
    text:    emailBody,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1D9E75; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="color: white; margin: 0;">🎫 New Support Ticket</h2>
          <p style="color: #E8F5E9; margin: 5px 0 0;">A user is requesting a human agent</p>
        </div>
        <div style="background: #f9f9f9; padding: 20px; border: 1px solid #eee;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; color: #666; width: 120px;">Ticket ID</td><td style="padding: 8px; font-weight: bold;">${ticket.ticketId}</td></tr>
            <tr style="background: #fff;"><td style="padding: 8px; color: #666;">User</td><td style="padding: 8px; font-weight: bold;">${ticket.userName}</td></tr>
            <tr><td style="padding: 8px; color: #666;">Created At</td><td style="padding: 8px;">${ticket.createdAt}</td></tr>
            <tr style="background: #fff;"><td style="padding: 8px; color: #666;">Status</td><td style="padding: 8px;"><span style="background: #FFF3E0; color: #E65100; padding: 2px 8px; border-radius: 4px; font-size: 13px;">Open</span></td></tr>
          </table>
        </div>
        <div style="background: #fff; padding: 20px; border: 1px solid #eee; border-top: none;">
          <h3 style="color: #344767; margin-top: 0;">Recent Conversation</h3>
          <div style="background: #f5f5f5; padding: 12px; border-radius: 6px; font-size: 14px; line-height: 1.6;">
            ${lastMessages.split('\n').map(line => `<p style="margin: 4px 0;">${line}</p>`).join('')}
          </div>
        </div>
        <div style="padding: 20px; text-align: center;">
          <a href="${crmUrl}/tickets/${ticket.ticketId}" 
             style="background: #1D9E75; color: white; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">
            View Ticket in CRM →
          </a>
        </div>
        <div style="padding: 12px 20px; background: #f5f5f5; border-radius: 0 0 8px 8px; text-align: center;">
          <p style="color: #999; font-size: 12px; margin: 0;">Seva AI — Automated Notification. Do not reply to this email.</p>
        </div>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[Email] Notification sent to ${agentEmails.length} agent(s) — ${info.messageId}`);
    return true;
  } catch (err) {
    console.error("[Email] Failed to send notification:", err.message);
    return false;
  }
}


// ── Send ticket resolved notification ────────────────────────────
async function notifyTicketResolved(ticket, agentName) {
  const agentEmails = getAgentEmails();
  if (agentEmails.length === 0) return;

  const transporter = createTransporter();

  await transporter.sendMail({
    from:    `"Seva AI" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to:      agentEmails.join(", "),
    subject: `[Resolved #${ticket.ticketId}] Ticket closed by ${agentName}`,
    text:    `Ticket #${ticket.ticketId} for user ${ticket.userName} has been resolved by ${agentName}. Seva AI has resumed the conversation.`,
  });
}


module.exports = {
  notifyAgentsNewTicket,
  notifyTicketResolved,
  getAgentEmails,
};
