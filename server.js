// server.js — Seva AI v1.0
require("dotenv").config();

const express    = require("express");
const cors       = require("cors");
const cookieParser = require("cookie-parser");
const chatRoutes = require("./chat");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin:      process.env.FRONTEND_URL || "http://localhost:5500",
  credentials: true, // required for cookies to work cross-origin
}));
app.use(express.json());
app.use(cookieParser()); // needed to read HTTP-only cookies

app.use("/api/chat", chatRoutes);

app.get("/", (req, res) => {
  res.json({
    status:  "running",
    service: "Seva AI v1.0",
    endpoints: {
      init:     "POST /api/chat/init     — open chat panel",
      chat:     "POST /api/chat          — send message",
      logout:   "POST /api/chat/logout   — end session",
      greeting: "GET  /api/chat/greeting — get welcome message",
      demo:     "GET  /api/chat/demo     — test all flows",
    }
  });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  const { disconnectRedis } = require("./redisService");
  await disconnectRedis();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`\n🚀 Seva AI v1.0 running on http://localhost:${PORT}`);
  console.log(`   Init:    POST http://localhost:${PORT}/api/chat/init`);
  console.log(`   Demo:    GET  http://localhost:${PORT}/api/chat/demo`);
  console.log(`   Chat:    POST http://localhost:${PORT}/api/chat`);
  console.log(`   Logout:  POST http://localhost:${PORT}/api/chat/logout`);
});

module.exports = app;
