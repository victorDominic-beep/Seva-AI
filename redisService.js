// redisService.js — Seva AI v1.0
// -------------------------------------------------------------------
// Handles all Redis operations:
//   - Reading user data written by the backend (fire-and-forget pattern)
//   - Polling with exponential backoff until data is available
//   - Checking data freshness
// -------------------------------------------------------------------

const Redis = require("ioredis");

// ═══════════════════════════════════════════════════════════════
// PLUG IN HERE — Redis connection details from the dev
// Add these to your .env file
// ═══════════════════════════════════════════════════════════════
let redisClient = null;

function getRedisClient() {
  if (redisClient) return redisClient;

  redisClient = new Redis({
  host:     process.env.REDIS_HOST,
  port:     parseInt(process.env.REDIS_PORT) || 6379,
  username: process.env.REDIS_USERNAME || "default",
  password: process.env.REDIS_PASSWORD,
  tls:      process.env.REDIS_TLS === "true" ? {} : undefined,
    retryStrategy: (times) => {
      if (times > 3) return null; // stop retrying after 3 attempts
      return Math.min(times * 200, 2000);
    }
  });

  redisClient.on("connect",  () => console.log("[Redis] Connected"));
  redisClient.on("error",    (err) => console.error("[Redis] Error:", err.message));
  redisClient.on("close",    () => console.log("[Redis] Connection closed"));

  return redisClient;
}


// ── Build the Redis key for a user ───────────────────────────────
// Key format from spec section 6.2: seva:user:{userId}:profile
function buildRedisKey(userId) {
  return `SEVATRANSACTS:${userId}`;
}


// ── Poll Redis for user data with exponential backoff ────────────
// Spec section 6.4:
//   - Start at 200ms intervals
//   - Back off exponentially to max 2s per attempt
//   - Timeout after 10 seconds total
async function pollRedisForUserData(userId) {
  const redis      = getRedisClient();
  const key        = buildRedisKey(userId);
  const startTime  = Date.now();
  const maxWait    = 10000; // 10 seconds total
  const minDelay   = 200;   // start at 200ms
  const maxDelay   = 2000;  // max 2s per attempt
  let   attempt    = 0;

  console.log(`[Redis] Polling for key: ${key}`);

  while (Date.now() - startTime < maxWait) {
    attempt++;

    const data = await redis.get(key);

    if (data) {
      console.log(`[Redis] Data found after ${attempt} attempt(s) — ${Date.now() - startTime}ms`);
      try {
        return JSON.parse(data);
      } catch {
        throw new Error("REDIS_PARSE_ERROR: Could not parse user data from Redis");
      }
    }

    // Exponential backoff: 200ms → 400ms → 800ms → 1600ms → 2000ms max
    const delay = Math.min(minDelay * Math.pow(2, attempt - 1), maxDelay);
    console.log(`[Redis] Data not ready — attempt ${attempt}, retrying in ${delay}ms`);
    await sleep(delay);
  }

  // Timed out — data not available within 10 seconds
  throw new Error("REDIS_TIMEOUT: User data not available after 10 seconds");
}


// ── Check if Redis data is fresh ──────────────────────────────────
// Compares the stored timestamp against current time
// Returns true if data is fresh enough to use
function isDataFresh(userData, maxAgeMs = 3600000) { // default 1 hour
  if (!userData?.fetchedAt) return false;
  const age = Date.now() - userData.fetchedAt;
  return age < maxAgeMs;
}


// ── Get user data from Redis (with freshness check) ───────────────
// Returns null if key doesn't exist or data is stale
async function getUserDataFromRedis(userId) {
  const redis = getRedisClient();
  const key   = buildRedisKey(userId);

  try {
    const data = await redis.get(key);
    if (!data) return null;

    const parsed = JSON.parse(data);

    // Check freshness
    if (!isDataFresh(parsed)) {
      console.log(`[Redis] Data for ${userId} is stale — needs refresh`);
      return null;
    }

    return parsed;
  } catch (err) {
    console.error(`[Redis] Error reading key ${key}:`, err.message);
    return null;
  }
}


// ── Store session server-side in Redis ────────────────────────────
// Seva stores active sessions in Redis for server-side validation
async function storeSession(sessionId, sessionData, ttlSeconds = 7200) {
  const redis = getRedisClient();
  const key   = `seva:session:${sessionId}`;

  await redis.set(key, JSON.stringify(sessionData), "EX", ttlSeconds);
  console.log(`[Redis] Session stored: ${sessionId} (TTL: ${ttlSeconds}s)`);
}


// ── Get session from Redis ────────────────────────────────────────
async function getSession(sessionId) {
  const redis = getRedisClient();
  const key   = `seva:session:${sessionId}`;

  const data = await redis.get(key);
  if (!data) return null;

  return JSON.parse(data);
}


// ── Delete session from Redis (on logout) ─────────────────────────
async function deleteSession(sessionId) {
  const redis = getRedisClient();
  const key   = `seva:session:${sessionId}`;
  await redis.del(key);
  console.log(`[Redis] Session deleted: ${sessionId}`);
}


// ── Slide session TTL on active request ───────────────────────────
// Spec section 7.3 — reset TTL on each active request
async function refreshSessionTTL(sessionId, ttlSeconds = 7200) {
  const redis = getRedisClient();
  const key   = `seva:session:${sessionId}`;
  await redis.expire(key, ttlSeconds);
}


// ── Helper ────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ── Disconnect Redis (for graceful shutdown) ──────────────────────
async function disconnectRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}


module.exports = {
  getRedisClient,
  pollRedisForUserData,
  getUserDataFromRedis,
  storeSession,
  getSession,
  deleteSession,
  refreshSessionTTL,
  disconnectRedis,
};
