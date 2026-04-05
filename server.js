// ===========================
// School Sanable System - server.js
// ===========================

require("dotenv").config();
const http = require("http");
const app = require("./app");
const { systemLogger } = require("./app/utils/logger");

process.on('uncaughtException', (err) => {
    systemLogger.error('UNCAUGHT EXCEPTION! Shutting down...', { stack: err.stack });
    process.exit(1);
}); 

process.on('unhandledRejection', (err) => {
    systemLogger.error('UNHANDLED REJECTION! Shutting down...', { stack: err.stack });
    process.exit(1);
});

// --------- Environment ----------
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// --------- Create HTTP Server ----------
const server = http.createServer(app);

// --------- Socket.io Integration ----------
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  console.log("🔌 User connected to chat");

  socket.on("join", (data) => {
    // data: can be userId (string) or { userId, role }
    const userId = typeof data === 'string' ? data : data.userId;
    const role = typeof data === 'object' ? data.role : null;
    
    socket.join(String(userId));
    if (role) {
      socket.join(role);
      console.log(`🎭 User ${userId} joined role room: ${role}`);
    }
    if (role === 'admin' || role === 'super_admin') {
      socket.join("support_admins");
      console.log(`🛡️ Admin ${userId} joined support room`);
    }
    console.log(`👤 User ${userId} joined their individual room`);
  });

  socket.on("sendSupportMessage", (data) => {
    // data: { sender, ticketId, content, isAdmin, userName, userAvatar }
    if (data.isAdmin) {
      // Admin responding -> Send to the specific user's room
      io.to(String(data.receiverId)).emit("newSupportMessage", data);
    } else {
      // User asking -> Send to all admins
      io.to("support_admins").emit("newSupportMessage", data);
    }
    // Also send back to sender for UI confirmation
    socket.emit("newSupportMessage", data);
  });

  // sendMessage socket event removed - messages now handled via messageController to enforce day/time restrictions.

  socket.on("typing", (data) => {
    // data: { senderId, receiverId }
    console.log(`⌨️  User ${data.senderId} is typing to ${data.receiverId}`);
    io.to(String(data.receiverId)).emit("userTyping", { userId: String(data.senderId) });
  });

  socket.on("stopTyping", (data) => {
    // data: { senderId, receiverId }
    console.log(`🛑 User ${data.senderId} stopped typing to ${data.receiverId}`);
    io.to(String(data.receiverId)).emit("userStopTyping", { userId: String(data.senderId) });
  });

  socket.on("disconnect", () => {
    console.log("🔌 User disconnected");
  });
});

// Expose io to app for use in controllers if needed
app.set("io", io);

// --------- Start Scheduler ----------
const { startScheduler } = require("./app/utils/scheduler");
startScheduler(app);

// --------- Start Server ----------
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running at: ${BASE_URL}`);
});

// --------- Export Server ----------
module.exports = server;
