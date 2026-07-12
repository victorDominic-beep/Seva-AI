// scopeValidator.js — Determine if query is within AI scope or needs PDF fallback
// ────────────────────────────────────────────────────────────────────────────────

// ── Financial AI Scope Keywords ──────────────────────────────
const FINANCIAL_KEYWORDS = [
  // Income & Earnings
  "income", "salary", "wage", "earn", "payment", "earning", "paycheck",
  
  // Spending & Expenses
  "spend", "expense", "cost", "price", "bill", "charge", "fee", "money", "cash",
  "debit", "withdrawal", "shopping", "buy", "purchase", "budget",
  
  // Savings & Goals
  "save", "savings", "goal", "target", "invest", "investment", "return",
  "portfolio", "wealth", "assets", "capital", "fund",
  
  // Banking & Transactions
  "bank", "account", "transaction", "transfer", "deposit", "wallet",
  "balance", "statement", "payment", "credit", "debit",
  
  // Finance & Budgeting
  "financial", "finance", "budget", "plan", "forecast", "surplus", "deficit",
  "income", "debt", "loan", "credit score", "interest",
  
  // Advice & Analysis
  "analyze", "analyse", "breakdown", "trend", "pattern", "tip", "advice",
  "recommendation", "suggest", "help", "improve", "optimize",
];

const OUT_OF_SCOPE_KEYWORDS = [
  // Technical topics
  "code", "programming", "debug", "algorithm", "database", "server",
  "api", "function", "variable", "javascript", "python", "java",
  
  // Health topics
  "disease", "symptom", "treatment", "doctor", "medicine", "health",
  "hospital", "illness", "vaccine", "covid",
  
  // Legal topics
  "law", "legal", "court", "lawsuit", "attorney", "contract",
  "jurisdiction", "compliance", "regulation",
  
  // Other domains
  "recipe", "cooking", "sports", "music", "movie", "game",
  "science", "history", "geography", "politics", "weather",
];

// ── Greetings & Small Talk ───────────────────────────────────
const GREETING_PHRASES = [
  "hi", "hello", "hey", "how are you", "what's up", "greetings",
  "good morning", "good afternoon", "good evening", "good night",
  "sup", "yo", "howdy", "hiya",
];

const HUMAN_AGENT_PHRASES = [
  "human", "agent", "real person", "speak to someone", "talk to someone",
  "customer service", "support", "live agent", "representative",
];

// ── Calculate financial relevance score ──────────────────────
function getFinancialRelevanceScore(query) {
  if (!query) return 0;

  const q = query.toLowerCase();
  let score = 0;

  // Count financial keywords
  FINANCIAL_KEYWORDS.forEach(keyword => {
    if (q.includes(keyword)) score += 1;
  });

  // Reduce score for out-of-scope keywords
  OUT_OF_SCOPE_KEYWORDS.forEach(keyword => {
    if (q.includes(keyword)) score -= 2;
  });

  return Math.max(score, 0);
}

// ── Check if query is within financial AI scope ──────────────
function isWithinScope(query, threshold = 0) {
  // Empty query or greeting
  if (!query || query.trim().length < 3) return true;

  // Human agent requests stay in scope (handled by retriever)
  const q = query.toLowerCase();
  if (HUMAN_AGENT_PHRASES.some(phrase => q.includes(phrase))) return true;

  // Greetings are in scope
  if (GREETING_PHRASES.some(phrase => q.includes(phrase))) return true;

  // Calculate relevance
  const relevanceScore = getFinancialRelevanceScore(query);

  // In scope if has positive relevance or multiple financial keywords
  return relevanceScore >= threshold;
}

// ── Determine if PDF fallback should be attempted ────────────
function shouldUsePDFFallback(query, inScope) {
  // If query is in scope, don't use PDF fallback
  if (inScope) return false;

  // If query is short, might be unclear - try PDF
  if (!query || query.trim().length < 5) return false;

  // Use PDF fallback for out-of-scope queries
  return true;
}

// ── Get scope analysis for debugging ────────────────────────
function analyzeScopeDetailed(query) {
  const q = query.toLowerCase();
  const financialScore = getFinancialRelevanceScore(query);
  const inScope = isWithinScope(query);

  const matchedFinancialKeywords = FINANCIAL_KEYWORDS.filter(k => q.includes(k));
  const matchedOutOfScopeKeywords = OUT_OF_SCOPE_KEYWORDS.filter(k => q.includes(k));
  const usePDFFallback = shouldUsePDFFallback(query, inScope);

  return {
    query,
    inScope,
    financialScore,
    usePDFFallback,
    matchedFinancialKeywords,
    matchedOutOfScopeKeywords,
    matchCount: matchedFinancialKeywords.length,
    outOfScopeCount: matchedOutOfScopeKeywords.length,
  };
}

module.exports = {
  isWithinScope,
  shouldUsePDFFallback,
  getFinancialRelevanceScore,
  analyzeScopeDetailed,
  FINANCIAL_KEYWORDS,
  OUT_OF_SCOPE_KEYWORDS,
};
