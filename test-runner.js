// test-runner.js — Seva AI v4.0
require("dotenv").config();

const { retrieve, detectIntent }          = require("./retriever");
const { buildPrompt }                     = require("./promptBuilder");
const { createJwtToken,
        getValidJwtToken,
        verifyJwtToken,
        createSessionToken }              = require("./jwtService");

const tests = [
  { label: "Greeting",    query: null },
  { label: "Save More",   query: "How can I save more money?" },
  { label: "Analyze",     query: "Analyze my spending" },
  { label: "Budget Plan", query: "Create a budget plan" },
  { label: "Investments", query: "Investment tips" },
];

console.log("╔══════════════════════════════════════════╗");
console.log("║    Seva AI v4.0 — Test Runner            ║");
console.log("╚══════════════════════════════════════════╝\n");

(async () => {

  // ── JWT Tests ──────────────────────────────────────────────
  console.log("── JWT Tests ────────────────────────────────");
  if (process.env.JWT_SECRET) {
    try {
      const token    = createJwtToken();
      const verified = verifyJwtToken(token);
      const fresh    = getValidJwtToken();
      console.log(`✅ JWT Generate    — token created (${token.length} chars)`);
      console.log(`✅ JWT Verify      — valid=${verified.valid} | role=${verified.payload?.sevaRole}`);
      console.log(`✅ JWT Auto-cache  — same token returned: ${token === fresh}`);

      const { token: sessionTok } = createSessionToken("test_user", { name: "Test" });
      console.log(`✅ Session Token   — created (${sessionTok.length} chars)`);
    } catch (err) {
      console.log(`❌ JWT Error: ${err.message}`);
    }
  } else {
    console.log("⚠️  JWT_SECRET not set — skipping JWT tests");
    console.log("   Add JWT values to .env to test JWT\n");
  }

  // ── Redis Tests ────────────────────────────────────────────
  console.log("\n── Redis Tests ──────────────────────────────");
  if (process.env.REDIS_HOST) {
    try {
      const { getRedisClient } = require("./redisService");
      const redis  = getRedisClient();
      await redis.ping();
      console.log("✅ Redis           — connected and responding");
      await redis.quit();
    } catch (err) {
      console.log(`❌ Redis Error: ${err.message}`);
    }
  } else {
    console.log("⚠️  REDIS_HOST not set — skipping Redis test");
    console.log("   Add Redis values to .env to test Redis");
  }

  // ── Flow Tests ─────────────────────────────────────────────
  console.log("\n── Flow Tests ───────────────────────────────");
  for (const t of tests) {
    try {
      const intent  = detectIntent(t.query);
      const context = await retrieve(t.query, "demo");
      const { userMessage } = buildPrompt(t.query, context);
      console.log(`✅ ${t.label.padEnd(14)} → ${intent.padEnd(20)} | ${userMessage.length} chars`);
    } catch (err) {
      console.log(`❌ ${t.label.padEnd(14)} → ERROR: ${err.message}`);
    }
  }

  console.log("\n All tests done. Run: node server.js");
})();
