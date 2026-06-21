// ===========================
// School Sanable System - server.js
// ===========================

require("dotenv").config();
const http = require("http");
const connectDB = require("./app/constants/db");
const { systemLogger } = require("./app/utils/logger");
const { verifySmtpConnection } = require("./app/utils/emailConfig");
const { connectRedisIfNeeded } = require("./app/utils/redis");
const { startQueueWorkers } = require("./app/utils/queue");

process.on("uncaughtException", (err) => {
  if (err.code === "EADDRINUSE") return;
  systemLogger.error("UNCAUGHT EXCEPTION! Shutting down...", { stack: err.stack });
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  systemLogger.error("UNHANDLED REJECTION! Shutting down...", { stack: err.stack });
  process.exit(1);
});

async function initInfrastructure() {
  const redisOk = await connectRedisIfNeeded();
  if (redisOk) {
    startQueueWorkers();
    systemLogger.info("Redis and email queue workers ready");
  } else if (process.env.REDIS_URL) {
    systemLogger.warn("Redis unavailable — emails will be sent directly via SMTP");
  }
}

async function purgeIncompleteStripeDonations() {
  const Transaction = require("./app/models/Transaction");
  try {
    const result = await Transaction.deleteMany({
      status: { $in: ["pending", "failed"] },
      paymentMethod: "stripe_checkout",
    });
    if (result.deletedCount > 0) {
      systemLogger.info("Purged incomplete Stripe checkout records", { count: result.deletedCount });
    }
  } catch (err) {
    systemLogger.warn("Could not purge incomplete Stripe donations", { error: err.message });
  }
}

async function bootstrap() {
  await connectDB();

  const app = require("./app");
  const { authenticateSocket, joinAuthorizedRooms } = require("./app/utils/socketAuth");

  const PORT = process.env.PORT || 3000;
  const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
  const isProduction = process.env.NODE_ENV === "production";
  const socketCorsOrigins = (process.env.CORS_ORIGINS || process.env.BASE_URL || BASE_URL)
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);

  const server = http.createServer(app);

  const { Server } = require("socket.io");
  const io = new Server(server, {
    cors: {
      origin: isProduction ? socketCorsOrigins : true,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    joinAuthorizedRooms(socket, socket.user);
    systemLogger.info("Socket connected", { userId: String(socket.user._id), role: socket.user.role });

    socket.on("join", () => {});

    socket.on("typing", (data) => {
      if (!data?.receiverId || String(data.senderId) !== String(socket.user._id)) return;
      io.to(String(data.receiverId)).emit("userTyping", { userId: String(socket.user._id) });
    });

    socket.on("stopTyping", (data) => {
      if (!data?.receiverId || String(data.senderId) !== String(socket.user._id)) return;
      io.to(String(data.receiverId)).emit("userStopTyping", { userId: String(socket.user._id) });
    });

    socket.on("disconnect", () => {
      systemLogger.info("Socket disconnected", { userId: String(socket.user._id) });
    });
  });

  app.set("io", io);

  await initInfrastructure();
  await purgeIncompleteStripeDonations();

  const { startScheduler } = require("./app/utils/scheduler");
  startScheduler(app);

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\n❌ المنفذ ${PORT} مستخدم بالفعل. أوقف السيرفر السابق أو غيّر PORT في .env\n` +
          `   Windows: netstat -ano | findstr :${PORT}  ثم  taskkill /PID <رقم> /F\n`
      );
      process.exit(1);
    }
    throw err;
  });

  server.listen(PORT, "0.0.0.0", async () => {
    console.log(`🚀 Server running at: ${BASE_URL}`);

    const smtpCheck = await verifySmtpConnection();
    if (smtpCheck.ok) {
      systemLogger.info("SMTP connection verified", { port: smtpCheck.port });
    } else if (smtpCheck.reason !== "not_configured") {
      systemLogger.error("SMTP connection failed at startup", {
        port: smtpCheck.port,
        error: smtpCheck.reason,
        hint:
          smtpCheck.port === 465
            ? "Try EMAIL_PORT=587 and EMAIL_SECURE=false for mail.senabilcharity.org"
            : undefined,
      });
    }
  });

  module.exports = server;
}

bootstrap().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
