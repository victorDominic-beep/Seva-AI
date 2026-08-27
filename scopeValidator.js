// scopeValidator.js — Determine if query is within AI scope or needs PDF fallback
// ────────────────────────────────────────────────────────────────────────────────

const FINANCIAL_INTENTS = new Set([
  "SAVE_MORE",
  "ANALYZE_SPENDING",
  "BUDGET_PLAN",
  "INVESTMENT_TIPS",
]);

const STRONG_FINANCIAL_PHRASES = [
  "my budget", "my spending", "my expenses", "my income", "my transactions",
  "my wallet", "my balance", "save more", "saving tips", "budget plan",
  "create a budget", "spending breakdown", "analyze my spending", "analyse my spending",
  "can i afford", "have enough", "put money aside", "financial goal",
];

const FINANCIAL_KEYWORDS = [
  "income", "salary", "wage", "earn", "earning", "paycheck", "spend", "spending",
  "expense", "expenses", "cost", "bill", "charge", "fee", "debit", "withdrawal",
  "shopping", "buy", "purchase", "budget", "save", "savings", "goal", "target",
  "invest", "investment", "stocks", "shares", "portfolio", "returns", "wealth",
  "asset", "assets", "capital", "fund", "bank", "account", "transaction", "transactions",
  "transfer", "deposit", "wallet", "balance", "statement", "payment", "credit",
  "debt", "loan", "interest", "afford",
];

const WEAK_FINANCIAL_KEYWORDS = [
  "money", "cash", "financial", "finance", "plan", "forecast", "surplus", "deficit",
  "trend", "pattern", "tip", "advice", "recommendation", "suggest", "help", "improve",
  "optimize", "optimise", "breakdown", "monthly",
];

const OUT_OF_SCOPE_KEYWORDS = [
  "code", "programming", "debug", "algorithm", "database", "server", "api",
  "function", "variable", "javascript", "python", "java", "disease", "symptom",
  "treatment", "doctor", "medicine", "health", "hospital", "illness", "vaccine",
  "covid", "law", "legal", "court", "lawsuit", "attorney", "contract",
  "jurisdiction", "compliance", "regulation", "recipe", "cooking", "sports", "music",
  "movie", "game", "science", "history", "geography", "politics", "weather",
];

const STRONG_OUT_OF_SCOPE_PHRASES = [
  "write code", "debug code", "build an api", "javascript code", "python code",
  "medical advice", "legal advice", "weather today", "football match", "movie recommendation",
  "song lyrics", "cooking recipe",
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

function normalizeText(query) {
  return String(query || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTokens(query) {
  const normalized = normalizeText(query);
  return normalized ? normalized.split(" ") : [];
}

function hasPhrase(query, phrase) {
  const normalizedQuery = ` ${normalizeText(query)} `;
  const normalizedPhrase = ` ${normalizeText(phrase)} `;
  return normalizedPhrase.trim().length > 0 && normalizedQuery.includes(normalizedPhrase);
}

function matchedPhrases(query, phrases) {
  return phrases.filter(phrase => hasPhrase(query, phrase));
}

function matchedKeywords(query, keywords) {
  const tokens = new Set(getTokens(query));
  return keywords.filter(keyword => {
    const normalized = normalizeText(keyword);
    return normalized.includes(" ") ? hasPhrase(query, normalized) : tokens.has(normalized);
  });
}

// ── Calculate financial relevance score ──────────────────────
function getFinancialRelevanceScore(query, intent = null) {
  if (!query) return 0;

  if (FINANCIAL_INTENTS.has(intent)) return 5;

  const strongFinancialMatches = matchedPhrases(query, STRONG_FINANCIAL_PHRASES);
  const financialMatches = matchedKeywords(query, FINANCIAL_KEYWORDS);
  const weakFinancialMatches = matchedKeywords(query, WEAK_FINANCIAL_KEYWORDS);
  const outOfScopeMatches = matchedKeywords(query, OUT_OF_SCOPE_KEYWORDS);
  const strongOutOfScopeMatches = matchedPhrases(query, STRONG_OUT_OF_SCOPE_PHRASES);

  return (
    strongFinancialMatches.length * 4 +
    financialMatches.length * 2 +
    weakFinancialMatches.length -
    outOfScopeMatches.length * 3 -
    strongOutOfScopeMatches.length * 4
  );
}

// ── Check if query is within financial AI scope ──────────────
function isWithinScope(query, intentOrThreshold = null, threshold = 2) {
  if (!query || query.trim().length < 3) return true;

  const intent = typeof intentOrThreshold === "string" ? intentOrThreshold : null;
  const requiredScore = typeof intentOrThreshold === "number" ? intentOrThreshold : threshold;

  if (intent === "HUMAN_AGENT" || intent === "GREETING") return true;
  if (FINANCIAL_INTENTS.has(intent)) return true;

  if (matchedPhrases(query, HUMAN_AGENT_PHRASES).length > 0) return true;
  if (matchedPhrases(query, GREETING_PHRASES).length > 0) return true;

  return getFinancialRelevanceScore(query, intent) >= requiredScore;
}

// ── Determine if PDF fallback should be attempted ────────────
function shouldUsePDFFallback(query, inScope) {
  if (inScope) return false;
  if (!query || query.trim().length < 5) return false;
  return true;
}

// ── Get scope analysis for debugging ────────────────────────
function analyzeScopeDetailed(query, intent = null) {
  const inScope = isWithinScope(query, intent);
  const financialScore = getFinancialRelevanceScore(query, intent);
  const matchedFinancialPhrases = matchedPhrases(query, STRONG_FINANCIAL_PHRASES);
  const matchedFinancialKeywords = matchedKeywords(query, FINANCIAL_KEYWORDS);
  const matchedWeakFinancialKeywords = matchedKeywords(query, WEAK_FINANCIAL_KEYWORDS);
  const matchedOutOfScopeKeywords = matchedKeywords(query, OUT_OF_SCOPE_KEYWORDS);
  const matchedOutOfScopePhrases = matchedPhrases(query, STRONG_OUT_OF_SCOPE_PHRASES);
  const usePDFFallback = shouldUsePDFFallback(query, inScope);

  return {
    query,
    intent,
    inScope,
    financialScore,
    usePDFFallback,
    matchedFinancialPhrases,
    matchedFinancialKeywords,
    matchedWeakFinancialKeywords,
    matchedOutOfScopeKeywords,
    matchedOutOfScopePhrases,
    matchCount: matchedFinancialPhrases.length + matchedFinancialKeywords.length + matchedWeakFinancialKeywords.length,
    outOfScopeCount: matchedOutOfScopeKeywords.length + matchedOutOfScopePhrases.length,
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