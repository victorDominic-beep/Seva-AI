// sevaPipeline.js — Seva AI v4.0 (With PDF Fallback)
// ───────────────────────────────────────────────────────────────
// Conversational AI with PDF document fallback for out-of-scope queries

const Groq             = require("groq-sdk");
const { retrieve }     = require("./retriever");
const { buildPrompt }  = require("./promptBuilder");
const { parseResponse} = require("./responseParser");
const { loadAllPDFs }  = require("./pdfService");

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SUGGESTED_PROMPTS = [
  { label: "How can I save more money?", intent: "SAVE_MORE"        },
  { label: "Analyze my spending",        intent: "ANALYZE_SPENDING" },
  { label: "Create a budget plan",       intent: "BUDGET_PLAN"      },
  { label: "Investment tips",            intent: "INVESTMENT_TIPS"  },
];

function enrichFinancialContext(rawContext, context) {
  try {
    const profile = context.profile;
    if (!profile) return rawContext;

    const balance = profile.user?.walletBalance || 0;
    const income = profile.user?.monthlyIncome || 0;
    const savings = profile.user?.savingsBalance || 0;
    const incomeDay = profile.user?.incomeDay || 15;

    const today = new Date();
    const currentDay = today.getDate();
    const daysUntilSalary = incomeDay > currentDay
      ? incomeDay - currentDay
      : (30 - currentDay + incomeDay);

    const dailyBurnRate = balance > 0 && daysUntilSalary > 0
      ? Math.round(balance / daysUntilSalary)
      : 0;

    const savingsRate = income > 0
      ? Math.round((savings / income) * 100)
      : 0;

    const enrichment = `
CALCULATED METRICS (use these in your response):
- Days until next salary: ${daysUntilSalary} days
- Safe daily spend to reach salary: NGN${dailyBurnRate.toLocaleString("en-NG")}
- Savings rate: ${savingsRate}% of monthly income
- Wallet balance: NGN${balance.toLocaleString("en-NG")}
`;
    return rawContext + enrichment;
  } catch {
    return rawContext;
  }
}

// ── Build conversation messages for Groq ──────────────────────────
function buildConversationMessages(systemPrompt, financialContext, conversationHistory, currentMessage) {
  const systemWithContext = `${systemPrompt}

CURRENT USER FINANCIAL CONTEXT:
${financialContext}

You are in an ongoing conversation with this user. Use the financial context above to give personalised answers. Remember what was discussed earlier in the conversation and respond naturally — like a financial advisor having a real conversation, not a chatbot giving isolated answers.

If the user asks a follow-up question, refer back to what was already discussed. Do not repeat yourself unless asked.`;

  const messages = [{ role: "system", content: systemWithContext }];

  const history = (conversationHistory || []).slice(-20);
  for (const msg of history) {
    if (msg.role === "user" || msg.role === "assistant") {
      messages.push({ role: msg.role, content: msg.content || msg.text || "" });
    }
  }

  messages.push({ role: "user", content: currentMessage });
  return messages;
}


async function runSevaPipeline(userQuery, userId, conversationHistory = []) {

  const requestTime = new Date().toISOString();
  const startMs     = Date.now();

  console.log("\n─────────────────────────────────────");
  console.log(`📥 Query: "${userQuery || "GREETING"}" | User: ${userId}`);
  console.log(`💬 History: ${conversationHistory.length} previous messages`);
  console.log(`⏰ Request received at: ${requestTime}`);

  // Step 1: Retrieve financial context
  const context = await retrieve(userQuery, userId);
  console.log(`🔍 Intent: ${context.intent}`);

  const enrichedContext = enrichFinancialContext(context.context, context);

  // Step 2: Handle HUMAN_AGENT separately — no Groq call needed
  if (context.intent === "HUMAN_AGENT") {
    return {
      query:            userQuery,
      intent:           "HUMAN_AGENT",
      userName:         context.userName,
      isGreeting:       false,
      isHandoff:        true,
      insight:          `I understand you'd like to speak with a human agent, ${context.userName}. Let me connect you right away.`,
      meaning:          "A support agent will be with you shortly and can see your conversation history.",
      action:           "Creating your support ticket now...",
      displayText:      `I understand you'd like to speak with a human agent, ${context.userName}. Let me connect you right away.`,
      suggestedPrompts: [],
      requestTime,
      responseTime:     new Date().toISOString(),
      durationMs:       Date.now() - startMs,
    };
  }

  // ★ NEW — Handle OUT_OF_SCOPE queries (no relevant PDF found)
  if (context.intent === "OUT_OF_SCOPE") {
    return {
      query:            userQuery,
      intent:           "OUT_OF_SCOPE",
      userName:         context.userName,
      isGreeting:       false,
      isHandoff:        false,
      insight:          "I'm sorry, that question is outside my scope as a financial AI.",
      meaning:          "I'm specifically designed to help with personal finance topics like budgeting, savings, spending analysis, and investment tips.",
      action:           "Try asking me about your finances, or request to speak with a human agent if you need help with something else.",
      displayText:      "I'm sorry, that question is outside my scope as a financial AI. I'm specifically designed to help with personal finance topics like budgeting, savings, spending analysis, and investment tips.",
      suggestedPrompts: SUGGESTED_PROMPTS,
      requestTime,
      responseTime:     new Date().toISOString(),
      durationMs:       Date.now() - startMs,
    };
  }

  // ★ NEW — Handle PDF_FALLBACK (out of scope but PDF found relevant content)
  if (context.intent === "PDF_FALLBACK" && context.isPDFFallback) {
    console.log(`📄 Using PDF fallback (${context.totalPDFMatches} matches from ${context.pdfSources})`);
    // Build prompt with PDF context
    const { systemPrompt, userMessage } = buildPrompt(userQuery, context);
    
    const messages = buildConversationMessages(
      systemPrompt,
      enrichedContext,
      conversationHistory,
      userMessage
    );

    console.log("🤖 Calling Groq with PDF fallback context...");
    const response = await client.chat.completions.create({
      model:       "openai/gpt-oss-120b",
      max_tokens:  1200,
      temperature: 0.85,
      messages,
    });

    const rawText = response.choices[0].message.content;
    const parsed = parseResponse(rawText, context.pdfSources);

    const responseTime = new Date().toISOString();
    const durationMs   = Date.now() - startMs;

    return {
      query:            userQuery,
      intent:           "PDF_FALLBACK",
      userName:         context.userName,
      isGreeting:       false,
      isHandoff:        false,
      isPDFFallback:    true,
      pdfSources:       context.pdfSources,
      insight:          parsed.insight,
      meaning:          parsed.meaning,
      action:           parsed.action,
      displayText:      parsed.displayText,
      suggestedPrompts: [],
      assistantMessage: {
        role:    "assistant",
        content: rawText,
      },
      requestTime,
      responseTime,
      durationMs,
    };
  }

  // Step 3: Build prompt with financial context
  const { systemPrompt, userMessage } = buildPrompt(userQuery, context);

  // Step 4: Build full conversation messages for Groq
  const messages = buildConversationMessages(
    systemPrompt,
    enrichedContext,
    conversationHistory,
    userMessage
  );

  // Step 5: Call Groq with full conversation history
  console.log("🤖 Calling Groq with conversation history...");
  const response = await client.chat.completions.create({
    model:       "openai/gpt-oss-120b",
    max_tokens:  1200,
    temperature: 0.85,
    messages,
  });

  const rawText = response.choices[0].message.content;

  // Step 6: Parse response (no CTA extraction needed anymore)
  const parsed = parseResponse(rawText);

  const isGreeting = context.intent === "GREETING";

  const responseTime = new Date().toISOString();
  const durationMs   = Date.now() - startMs;

  console.log(`✅ Response generated at: ${responseTime}`);
  console.log(`⚡ Total duration: ${durationMs}ms`);

  return {
    query:            userQuery,
    intent:           context.intent,
    userName:         context.userName,
    isGreeting,
    isHandoff:        false,
    insight:          parsed.insight,
    meaning:          parsed.meaning,
    action:           parsed.action,
    displayText:      parsed.displayText,
    suggestedPrompts: isGreeting ? SUGGESTED_PROMPTS : [],
    // Frontend stores this and sends back next time for conversation memory
    assistantMessage: {
      role:    "assistant",
      content: rawText,
    },
    requestTime,
    responseTime,
    durationMs,
  };
}

// ★ NEW — Initialize PDF service on startup
async function initializePDFService() {
  try {
    console.log("\n📚 Initializing PDF Service...");
    const results = await loadAllPDFs();
    if (results.length > 0) {
      console.log(`✨ PDF Service initialized with ${results.length} document(s)\n`);
    }
  } catch (error) {
    console.error(`⚠️  PDF Service initialization warning: ${error.message}`);
    // Don't crash if PDF loading fails - system can still work without PDFs
  }
}

module.exports = { runSevaPipeline, SUGGESTED_PROMPTS, initializePDFService };
