// retriever.js — Seva AI v1.0
// -------------------------------------------------------------------
// WHAT IS DONE:
//   - Fire-and-forget pattern: calls backend, doesn't wait for data
//   - Reads user data from Redis (key: seva:user:{userId}:profile)
//   - Uses polling with backoff to wait for Redis data
//   - Auto-retry on 401 (regenerate JWT + retry once)
//   - Supports filter, startDate, endDate query params (spec 5.2)
//   - Validates custom date range before sending request
//   - Falls back to demo JSON in demo mode
// -------------------------------------------------------------------

const { getValidJwtToken }             = require("./jwtService");
const { pollRedisForUserData,
        getUserDataFromRedis }          = require("./redisService");
const fs   = require("fs");
const path = require("path");

// ═══════════════════════════════════════════════════════════════
// PLUG IN HERE — from the dev
// ═══════════════════════════════════════════════════════════════
const APP_BASE_URL = process.env.APP_BASE_URL || "https://your-app-api.com";

// Exact endpoint from spec section 5.1
const TRANSACTIONS_PATH = "sevaai/users";

// Valid filter values from spec section 5.2
const VALID_FILTERS  = ["lastWeek", "month", "lastMonth", "3Months", "6Months", "1Year", "custom"];

// Default filter — spec recommends 6Months for sufficient history
const DEFAULT_FILTER = process.env.DEFAULT_FILTER || "6Months";


// ── Demo mode helpers ────────────────────────────────────────────
function readDemoJSON(filename) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, filename), "utf-8"));
}

function formatNaira(amount) {
  return `NGN${Math.abs(amount).toLocaleString("en-NG")}`;
}

function daysAgo(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}


// ── Validate and build query string (spec section 5.2) ───────────
// Rules:
//   - filter must be one of the valid enum values
//   - if filter=custom, both startDate AND endDate are required
//   - startDate must be chronologically before endDate
//   - all dates must be ISO 8601 with timezone offset
function buildQueryString(filter = DEFAULT_FILTER, startDate = null, endDate = null) {

  // Validate filter value
  if (!VALID_FILTERS.includes(filter)) {
    throw new Error(`INVALID_FILTER: "${filter}" is not valid. Use: ${VALID_FILTERS.join(" | ")}`);
  }

  // Custom filter requires both dates
  if (filter === "custom") {
    if (!startDate || !endDate) {
      throw new Error("MISSING_DATES: filter=custom requires both startDate and endDate");
    }

    // Validate ISO 8601 format
    const startMs = Date.parse(startDate);
    const endMs   = Date.parse(endDate);

    if (isNaN(startMs)) throw new Error(`INVALID_DATE: startDate "${startDate}" is not valid ISO 8601`);
    if (isNaN(endMs))   throw new Error(`INVALID_DATE: endDate "${endDate}" is not valid ISO 8601`);

    // startDate must be before endDate (spec section 5.2)
    if (startMs >= endMs) {
      throw new Error("INVALID_DATE_RANGE: startDate must be chronologically before endDate");
    }

    return `?filter=custom&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
  }

  return `?filter=${filter}`;
}


// ── Fire-and-forget request to backend ───────────────────────────
// Spec section 5.1:
//   - GET baseurl/api/v1/sevaai/users/:userId/transactions
//   - JWT in Authorization header
//   - Does NOT wait for data in response body
//   - Backend validates JWT, fetches data, writes to Redis
// Auto-retry on 401 (spec section 4.2)
async function triggerBackendDataFetch(userId, filter = DEFAULT_FILTER, startDate = null, endDate = null, retryCount = 0) {

  const token      = getValidJwtToken();
  const queryStr   = buildQueryString(filter, startDate, endDate);
  const url        = `${APP_BASE_URL}${TRANSACTIONS_PATH}/${userId}/transactions${queryStr}`;

  console.log(`[Backend] Fire-and-forget → ${url}`);
  console.log(`[JWT Token] ${token}`);

  const response = await fetch(url, {
    method:  "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type":  "application/json",
    }
  });

  const responseBody = await response.text();
  console.log(`[Backend Response] Status: ${response.status}, Body: ${responseBody}`);

  // 401 — JWT rejected, retry once with fresh token (spec section 4.2)
  if (response.status === 401 && retryCount === 0) {
    console.warn("[Backend] 401 received — regenerating JWT and retrying once");
    return triggerBackendDataFetch(userId, filter, startDate, endDate, 1);
  }

  // 401 on second attempt — abort
  if (response.status === 401 && retryCount > 0) {
    throw new Error("AUTH_FAILED: JWT rejected by backend after retry");
  }

  // 404 — userId not found in database
  if (response.status === 404) {
    throw new Error("USER_NOT_FOUND: Identity verification failed — userId not in database");
  }

  // 5xx server errors
  if (response.status >= 500) {
    throw new Error(`BACKEND_ERROR: Server returned ${response.status}`);
  }

  // 200 — backend accepted and is writing to Redis
  console.log("[Backend] Request accepted — backend writing to Redis");
  return true;
}


// ── Main data fetching function ───────────────────────────────────
async function fetchUserData(userId, filter, startDate, endDate) {

  // ── DEMO MODE (delete this block when going live) ─────────────
  const isDemoMode = !userId || userId === "demo";
  if (isDemoMode) {
    console.log("   [DEMO MODE] Loading local JSON data...");
    const profile      = readDemoJSON("user-profile.json");
    const transactions = readDemoJSON("transactions.json");
    return { profile, transactions };
  }
  // ── END DEMO BLOCK ─────────────────────────────────────────────


  // ── LIVE MODE (uncomment when backend is ready) ────────────────
  
  console.log(`[Retriever] Fetching data for user: ${userId}`);

  // Step 1: Check Redis first — use cached data if still fresh
  const cached = await getUserDataFromRedis(userId);
  if (cached) {
    console.log(`[Retriever] Using cached Redis data for user: ${userId}`);
    return mapUserData(cached);
  }

  // Step 2: Trigger backend fire-and-forget (spec section 5.1)
  await triggerBackendDataFetch(userId, filter, startDate, endDate);

  // Step 3: Poll Redis with backoff until data is available (spec section 6.4)
  const rawData = await pollRedisForUserData(userId);

  // Step 4: Map and return
  return mapUserData(rawData);
  
  // ── END LIVE MODE ──────────────────────────────────────────────
}


// ── Map Redis payload to Seva internal format ─────────────────────
// PLUG IN HERE — adjust field names once dev shares sample Redis payload
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
function detectIntent(query) {
  if (!query) return "GREETING";
  const q = query.toLowerCase();
  if (q.match(/save more|how.*save|saving tips|savings|put money aside/))            return "SAVE_MORE";
  if (q.match(/analyz|analyse|spending|where.*money|breakdown|spent|broke|no money/)) return "ANALYZE_SPENDING";
  if (q.match(/budget plan|create.*budget|help.*plan|plan.*month|monthly/))          return "BUDGET_PLAN";
  if (q.match(/invest|investment|stocks|shares|portfolio|returns|grow.*money/))      return "INVESTMENT_TIPS";
  if (q.match(/afford|can i spend|have enough/))                                     return "ANALYZE_SPENDING";
  if (q.match(/goal|target|reach/))                                                  return "SAVE_MORE";
  return "GENERAL";
}


// ── Context builders ─────────────────────────────────────────────
function getGreetingContext(profile) {
  const name = profile?.user?.name || "there";
  return { intent: "GREETING", context: `USER: ${name}. ACTION: User just opened Seva chat. Send a warm welcome greeting introducing yourself as Seva, their AI personal finance assistant.` };
}

function getSaveMoreContext(profile) {
  const u    = profile.user;
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
  const u       = profile.user;
  const income  = u.monthlyIncome;
  const bills   = 60000;
  const savings = Math.round(income * 0.25);
  const lines   = Object.entries(profile.budgets || {}).map(([c, a]) => `${c}: ${formatNaira(a)}`).join(", ");
  return { intent: "BUDGET_PLAN", context: `USER: ${u.name}. INTENT: BUDGET_PLAN. Monthly income: ${formatNaira(income)}. Bills: ${formatNaira(bills)}. Savings (25%): ${formatNaira(savings)}. Flexible: ${formatNaira(income - bills - savings)}. Budgets: ${lines || "none set"}. Balance: ${formatNaira(u.walletBalance)}.` };
}

function getInvestmentContext(profile) {
  const u = profile.user;
  return { intent: "INVESTMENT_TIPS", context: `USER: ${u.name}. INTENT: INVESTMENT_TIPS. Monthly income: ${formatNaira(u.monthlyIncome)}. Savings: ${formatNaira(u.savingsBalance)}. User asking about Nigerian investment options. Provide 3 practical options with brief explanations.` };
}


// ── Main retriever export ─────────────────────────────────────────
async function retrieve(query, userId, filter, startDate, endDate) {
  const { profile, transactions } = await fetchUserData(userId, filter, startDate, endDate);
  const intent = detectIntent(query);
  let result;

  switch (intent) {
    case "GREETING":         result = getGreetingContext(profile);              break;
    case "SAVE_MORE":        result = getSaveMoreContext(profile);              break;
    case "ANALYZE_SPENDING": result = getAnalyzeContext(transactions, profile); break;
    case "BUDGET_PLAN":      result = getBudgetContext(profile);               break;
    case "INVESTMENT_TIPS":  result = getInvestmentContext(profile);           break;
    default:                 result = getBudgetContext(profile);               break;
  }

  result.userName = profile.user.name;
  result.intent   = intent;
  return result;
}

module.exports = { retrieve, detectIntent, triggerBackendDataFetch, buildQueryString };
