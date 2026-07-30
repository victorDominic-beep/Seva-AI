// retriever.js — Seva AI v4.0 (Updated with HUMAN_AGENT intent & PDF fallback)
// ──────────────────────────────────────────────────────────────────────────
// Now includes PDF search for out-of-scope queries

const { getValidJwtToken }             = require("./jwtService");
const { pollRedisForUserData,
        getUserDataFromRedis }          = require("./redisService");
const { searchPDFs, isContentRelevant } = require("./pdfService");
const { isWithinScope, shouldUsePDFFallback } = require("./scopeValidator");
const fs   = require("fs");
const path = require("path");

const APP_BASE_URL       = process.env.APP_BASE_URL || "https://your-app-api.com";
const TRANSACTIONS_PATH  = "sevaai/users";
const VALID_FILTERS      = ["lastWeek", "month", "lastMonth", "3Months", "6Months", "1Year", "custom"];
const DEFAULT_FILTER     = process.env.DEFAULT_FILTER || "6Months";

function readDemoJSON(filename) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, filename), "utf-8"));
}
function formatNaira(amount) {
  return `NGN${Math.abs(amount).toLocaleString("en-NG")}`;
}
function daysAgo(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function buildQueryString(filter = DEFAULT_FILTER, startDate = null, endDate = null) {
  if (!VALID_FILTERS.includes(filter)) throw new Error(`INVALID_FILTER: "${filter}"`);
  if (filter === "custom") {
    if (!startDate || !endDate) throw new Error("MISSING_DATES: filter=custom requires both startDate and endDate");
    const startMs = Date.parse(startDate);
    const endMs   = Date.parse(endDate);
    if (isNaN(startMs)) throw new Error(`INVALID_DATE: startDate "${startDate}"`);
    if (isNaN(endMs))   throw new Error(`INVALID_DATE: endDate "${endDate}"`);
    if (startMs >= endMs) throw new Error("INVALID_DATE_RANGE: startDate must be before endDate");
    return `?filter=custom&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
  }
  return `?filter=${filter}`;
}

async function triggerBackendDataFetch(userId, filter = DEFAULT_FILTER, startDate = null, endDate = null, retryCount = 0) {
  const token    = getValidJwtToken();
  const queryStr = buildQueryString(filter, startDate, endDate);
  const url      = `${APP_BASE_URL}${TRANSACTIONS_PATH}/${userId}/transactions${queryStr}`;
  console.log(`[Backend] Fire-and-forget → ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
  });

  const responseBody = await response.text();
  console.log(`[Backend Response] Status: ${response.status}, Body: ${responseBody}`);

  if (response.status === 401 && retryCount === 0) {
    console.warn("[Backend] 401 — retrying once");
    return triggerBackendDataFetch(userId, filter, startDate, endDate, 1);
  }
  if (response.status === 401 && retryCount > 0) throw new Error("AUTH_FAILED: JWT rejected after retry");
  if (response.status === 404) throw new Error("USER_NOT_FOUND: userId not in database");
  if (response.status >= 500)  throw new Error(`BACKEND_ERROR: Server returned ${response.status}`);

  console.log("[Backend] Request accepted — writing to Redis");
  return true;
}

async function fetchUserData(userId, filter, startDate, endDate) {
  const isDemoMode = !userId || userId === "demo";
  if (isDemoMode) {
    console.log("   [DEMO MODE] Loading local JSON data...");
    const profile      = readDemoJSON("user-profile.json");
    const transactions = readDemoJSON("transactions.json");
    return { profile, transactions };
  }

  console.log(`[Retriever] Fetching data for user: ${userId}`);
  const cached = await getUserDataFromRedis(userId);
  if (cached) {
    console.log(`[Retriever] Using cached Redis data for user: ${userId}`);
    return mapUserData(cached);
  }
  await triggerBackendDataFetch(userId, filter, startDate, endDate);
  const rawData = await pollRedisForUserData(userId);
  return mapUserData(rawData);
}

function mapUserData(data) {
  const mappedProfile = {
    user: {
      id:             data.user?.id             || "",
      name:           data.user?.name           || "User",
      monthlyIncome:  data.user?.monthlyIncome  || data.user?.monthly_income  || 0,
      incomeDay:      data.user?.incomeDay      || data.user?.income_day      || 1,
      walletBalance:  data.user?.walletBalance  || data.user?.wallet_balance  || 0,
      savingsBalance: data.user?.savingsBalance || data.user?.savings_balance || 0,
    },
    budgets:          data.budgets             || {},
    spendingPatterns: data.spendingPatterns    || {},
    goals:            data.goals               || [],
  };
  const mappedTransactions = (data.transactions || []).map(t => ({
    id:          t.id,
    date:        t.date,
    amount:      t.amount,
    category:    t.category,
    description: t.description || t.narration || "",
    type:        t.type || (t.amount < 0 ? "debit" : "credit"),
  }));
  return { profile: mappedProfile, transactions: mappedTransactions };
}

// ── Intent detection ─────────────────────────────────────────────
// ★ NEW: HUMAN_AGENT intent added
function detectIntent(query) {
  if (!query) return "GREETING";
  const q = query.toLowerCase();

  // ★ NEW — detect human agent request FIRST before other intents
  if (q.match(/human|agent|real person|speak to someone|talk to someone|talk to a person|customer service|support agent|live agent|representative/))
    return "HUMAN_AGENT";

  if (q.match(/save more|how.*save|saving tips|savings|put money aside/))            return "SAVE_MORE";
  if (q.match(/analyz|analyse|spending|where.*money|breakdown|spent|broke|no money/)) return "ANALYZE_SPENDING";
  if (q.match(/budget plan|create.*budget|help.*plan|plan.*month|monthly/))          return "BUDGET_PLAN";
  if (q.match(/invest|investment|stocks|shares|portfolio|returns|grow.*money/))      return "INVESTMENT_TIPS";
  if (q.match(/afford|can i spend|have enough/))                                     return "ANALYZE_SPENDING";
  if (q.match(/goal|target|reach/))                                                  return "SAVE_MORE";
  return "GENERAL";
}

function getGreetingContext(profile) {
  const name = profile?.user?.name || "there";
  return { intent: "GREETING", context: `USER: ${name}. ACTION: User just opened Seva chat. Send a warm welcome greeting introducing yourself as Seva, their AI personal finance assistant.` };
}
function getSaveMoreContext(profile) {
  const u = profile.user;
  const rate = u.monthlyIncome ? Math.round((u.savingsBalance / u.monthlyIncome) * 100) : 0;
  return { intent: "SAVE_MORE", context: `USER: ${u.name}. INTENT: SAVE_MORE. Monthly income: ${formatNaira(u.monthlyIncome)}. Current savings: ${formatNaira(u.savingsBalance)}. Savings rate: ${rate}% of income. Target: ${formatNaira(profile.goals?.[0]?.target || 200000)}. Wallet balance: ${formatNaira(u.walletBalance)}. Income day: ${u.incomeDay}th.` };
}
function getAnalyzeContext(transactions, profile) {
  const u      = profile.user;
  const last10 = transactions.filter(t => daysAgo(t.date) <= 10 && (t.type === "debit" || t.amount < 0));
  const byCat  = {};
  last10.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + Math.abs(t.amount); });
  const total     = Object.values(byCat).reduce((a, b) => a + b, 0) || 1;
  const top       = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0] || ["None", 0];
  const foodOver  = (byCat["Food"] || 0) > (profile.budgets?.Food || 30000);
  const breakdown = Object.entries(byCat).map(([c, a]) => `${c}: ${formatNaira(a)} (${Math.round((a / total) * 100)}%)`).join(", ");
  return { intent: "ANALYZE_SPENDING", context: `USER: ${u.name}. INTENT: ANALYZE_SPENDING. Total spent last 10 days: ${formatNaira(total)}. Breakdown: ${breakdown}. Top: ${top[0]} at ${formatNaira(top[1])}. Food over budget: ${foodOver ? "YES" : "No"}.` };
}
function getBudgetContext(profile) {
  const u = profile.user;
  const income = u.monthlyIncome, bills = 60000, savings = Math.round(income * 0.25);
  const lines = Object.entries(profile.budgets || {}).map(([c, a]) => `${c}: ${formatNaira(a)}`).join(", ");
  return { intent: "BUDGET_PLAN", context: `USER: ${u.name}. INTENT: BUDGET_PLAN. Monthly income: ${formatNaira(income)}. Bills: ${formatNaira(bills)}. Savings (25%): ${formatNaira(savings)}. Flexible: ${formatNaira(income - bills - savings)}. Budgets: ${lines || "none set"}. Balance: ${formatNaira(u.walletBalance)}.` };
}
function getInvestmentContext(profile) {
  const u = profile.user;
  return { intent: "INVESTMENT_TIPS", context: `USER: ${u.name}. INTENT: INVESTMENT_TIPS. Monthly income: ${formatNaira(u.monthlyIncome)}. Savings: ${formatNaira(u.savingsBalance)}. User asking about Nigerian investment options. Provide 3 practical options with brief explanations.` };
}

// ★ NEW — Human agent context (no AI call needed for this)
function getHumanAgentContext(profile) {
  const name = profile?.user?.name || "User";
  return {
    intent:  "HUMAN_AGENT",
    context: `USER: ${name}. ACTION: User has requested to speak with a human agent. Do not give financial advice. Acknowledge the request warmly and let them know they are being connected to an agent.`,
  };
}

// ★ NEW — PDF Fallback context (query is out of scope but found in PDF)
function getPDFFallbackContext(query, pdfSearchResults, profile) {
  const name = profile?.user?.name || "User";
  const pdfSources = pdfSearchResults.results.map(r => r.source).filter((v, i, a) => a.indexOf(v) === i).join(", ");
  
  const pdfContext = pdfSearchResults.results
    .map((result, idx) => `[PDF ${idx + 1}] ${result.content}...`)
    .join("\n\n");

  return {
    intent: "PDF_FALLBACK",
    isPDFFallback: true,
    context: `USER: ${name}. QUERY OUT OF SCOPE - Using PDF fallback. Query: "${query}". Relevant PDF content found in: ${pdfSources}.\n\nPDF CONTENT:\n${pdfContext}`,
    pdfSources,
    totalPDFMatches: pdfSearchResults.totalMatches,
  };
}

// ★ NEW — Check scope and attempt PDF fallback
async function checkScopeAndPDF(query) {
  const inScope = isWithinScope(query);
  
  if (!inScope && shouldUsePDFFallback(query, inScope)) {
    console.log(`📄 Query out of scope, searching PDFs...`);
    const pdfSearchResults = searchPDFs(query, 3);
    
    if (isContentRelevant(query, pdfSearchResults, -1)) {
      console.log(`✅ Found relevant PDF content (${pdfSearchResults.totalMatches} matches)`);
      return {
        inScope: false,
        usePDFFallback: true,
        pdfResults: pdfSearchResults,
      };
    } else {
      console.log(`❌ No relevant PDF content found`);
      return {
        inScope: false,
        usePDFFallback: false,
        pdfResults: null,
      };
    }
  }

  return {
    inScope,
    usePDFFallback: false,
    pdfResults: null,
  };
}

async function retrieve(query, userId, filter, startDate, endDate) {
  const { profile, transactions } = await fetchUserData(userId, filter, startDate, endDate);
  
      const intent = detectIntent(query);

if (intent === "HUMAN_AGENT") {
    console.log("🙋 Human agent requested");

    const result = getHumanAgentContext(profile);
    result.userName = profile.user.name;
    result.userEmail = profile.user.email || "";
result.userPhone = profile.user.phone || "";

    return result;
}

  // Always search PDF first
  console.log(`📄 Searching PDF for: "${query}"`);
  const pdfSearchResults = searchPDFs(query, 3);
  console.log(`   [Result] Found: ${pdfSearchResults.found}, Matches: ${pdfSearchResults.totalMatches}`);
  
  // If PDF has any relevant content, use it
  if (pdfSearchResults.found && pdfSearchResults.results.length > 0) {
    console.log(`✅ Using PDF fallback`);
    const result = getPDFFallbackContext(query, pdfSearchResults, profile);
    result.userName = profile.user.name;
    return result;
  }
  
  // Otherwise, use normal financial AI
  console.log(`❌ No PDF match, using financial AI`);
  let result;

  switch (intent) {
    case "GREETING":      result = getGreetingContext(profile);              break;
    case "SAVE_MORE":     result = getSaveMoreContext(profile);              break;
    case "ANALYZE_SPENDING": result = getAnalyzeContext(transactions, profile); break;
    case "BUDGET_PLAN":   result = getBudgetContext(profile);               break;
    case "INVESTMENT_TIPS": result = getInvestmentContext(profile);          break;
    case "HUMAN_AGENT":   result = getHumanAgentContext(profile);           break;
    default:              result = getBudgetContext(profile);               break;
  }

  result.userName = profile.user.name;
  result.intent   = intent;
  return result;
}

module.exports = { retrieve, detectIntent, triggerBackendDataFetch, buildQueryString };
