// sevaPipeline.js — Seva AI (Updated with timestamps)

const Groq = require("groq-sdk");
const { retrieve }     = require("./retriever");
const { buildPrompt }  = require("./promptBuilder");
const { parseResponse} = require("./responseParser");

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const SUGGESTED_PROMPTS = [
  { label: "How can I save more money?", intent: "SAVE_MORE"        },
  { label: "Analyze my spending",        intent: "ANALYZE_SPENDING" },
  { label: "Create a budget plan",       intent: "BUDGET_PLAN"      },
  { label: "Investment tips",            intent: "INVESTMENT_TIPS"  },
];

const CTA_MAP = {
  "SAVE_NOW":     { label: "Save Now",          action: "SAVE_NOW",     color: "green" },
  "SET_BUDGET":   { label: "Set Budget",        action: "SET_BUDGET",   color: "green" },
  "ANALYZE_MORE": { label: "Analyze More",      action: "ANALYZE_MORE", color: "gray"  },
  "CREATE_GOAL":  { label: "Create Goal",       action: "CREATE_GOAL",  color: "green" },
  "INVEST_NOW":   { label: "Invest Now",        action: "INVEST_NOW",   color: "green" },
  "AUTO_LOCK":    { label: "Auto-Lock Savings", action: "AUTO_LOCK",    color: "green" },
  "VIEW_PLAN":    { label: "View Plan",         action: "VIEW_PLAN",    color: "gray"  },
};

async function runSevaPipeline(userQuery, userId) {
  // ── Timestamp: when request was received ────────────────────────
  const requestTime = new Date().toISOString();
  const startMs     = Date.now();

  console.log("\n─────────────────────────────────────");
  console.log(`📥 Query: "${userQuery || "GREETING"}" | User: ${userId}`);
  console.log(`⏰ Request received at: ${requestTime}`);

  // Step 1: Retrieve
  const context = await retrieve(userQuery, userId);
  console.log(`🔍 Intent: ${context.intent}`);

  // Step 2: Build prompt
  const { systemPrompt, userMessage } = buildPrompt(userQuery, context);

  // Step 3: Call Groq
  console.log("🤖 Calling Groq...");
  const response = await client.chat.completions.create({
    model: "llama-3.1-8b-instant",
    max_tokens: 600,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userMessage  }
    ]
  });

  const rawText = response.choices[0].message.content;

  // Step 4: Parse
  const parsed = parseResponse(rawText);

  // Step 5: Extract CTAs
  const buttonsMatch = rawText.match(/BUTTONS[:\s]+(.*?)$/si);
  const buttonText   = buttonsMatch ? buttonsMatch[1].toUpperCase() : "";
  const ctas = Object.entries(CTA_MAP)
    .filter(([key]) => buttonText.includes(key))
    .map(([, val]) => ({ ...val, params: {} }));

  const isGreeting = context.intent === "GREETING";

  // ── Timestamp: when response was generated ───────────────────────
  const responseTime = new Date().toISOString();
  const durationMs   = Date.now() - startMs;

  console.log(`✅ Response generated at: ${responseTime}`);
  console.log(`⚡ Total duration: ${durationMs}ms`);

  return {
    query:            userQuery,
    intent:           context.intent,
    isGreeting,
    insight:          parsed.insight,
    meaning:          parsed.meaning,
    action:           parsed.action,
    ctas,
    displayText:      parsed.displayText,
    suggestedPrompts: isGreeting ? SUGGESTED_PROMPTS : [],
    sessionToken:     context.sessionToken || null,
    // ── Timestamps ─────────────────────────────────────────────────
    requestTime,    // when user sent the message
    responseTime,   // when AI finished generating
    durationMs,     // how long it took in milliseconds
  };
}

module.exports = { runSevaPipeline, SUGGESTED_PROMPTS };