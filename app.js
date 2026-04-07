// ===========================
// Jussur Sanabel System - app.js
// ===========================

const express = require("express");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const flash = require("connect-flash");
const morgan = require("morgan");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const compression = require("compression");
const methodOverride = require("method-override");
const i18n = require("i18n");

i18n.configure({
  locales: ['ar', 'en'],
  directory: path.join(__dirname, 'locales'),
  defaultLocale: 'ar',
  cookie: 'lang',
  objectNotation: true
});

const csurf = require("csurf");

// Config / DB
const connectDB = require("./app/constants/db"); 
connectDB();

// Middlewares
const authMiddleware = require("./app/middlewares/auth");
const { apiLimiter, authLimiter, paymentLimiter } = require("./app/middlewares/rateLimiter");
const { systemLogger } = require("./app/utils/logger");

// App Initialization
const app = express();

// View Engine Setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
// app.use(expressLayouts);
// app.set("layout", "layouts/main-layout");

// Global Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(i18n.init);
app.use(express.static(path.join(__dirname, "public"), { maxAge: "30d" }));
app.use(cors({ origin: process.env.BASE_URL || "*", credentials: true }));
app.use(compression());
app.use(methodOverride("_method"));

// Security
app.use(helmet({ 
    contentSecurityPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));
app.use(apiLimiter); // Apply global rate limiter

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

// Session + Flash 
app.use(
  session({
    secret: process.env.SESSION_SECRET || "sanabelSecrets",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24,
      sameSite: "lax",
    },
  })
);
app.use(flash());

// CSRF Protection
const csrfProtection = csurf({ cookie: true });
app.use((req, res, next) => {
  // Skip CSRF check for multipart uploads as multer needs to parse body first
  // and global csurf runs before route-specific multer
  if (req.originalUrl.includes('/proof-of-impact') || req.originalUrl.includes('/updates')) {
    return next();
  }
  csrfProtection(req, res, next);
});

// Global view locals
app.use(authMiddleware.isLoggedIn); // Check if user is logged in for every request
app.use((req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : '';
  res.locals.user = req.user || null; // Ensure user is at least null
  res.locals.lang = req.getLocale();
  res.locals.currentLocale = req.getLocale();
  res.locals.langDir = req.getLocale() === 'ar' ? 'rtl' : 'ltr';
  res.locals.title = ""; // Default title to avoid ReferenceError
  next();
});

// --------- Routes ----------
const indexRoutes = require("./app/routes/index");
const authRoutes = require("./app/routes/auth");
const caseRoutes = require("./app/routes/cases");
const adminRoutes = require("./app/routes/admin");
const donationRoutes = require("./app/routes/donations");
const dashboardRoutes = require("./app/routes/dashboard");
const messageRoutes = require("./app/routes/messages");
const profileRoutes = require("./app/routes/profile");
const supportRoutes = require("./app/routes/support");
const notificationRoutes = require("./app/routes/notifications");

app.use("/", indexRoutes);
app.use("/auth", authLimiter, authRoutes);
app.use("/cases", caseRoutes);
app.use("/admin", adminRoutes);
app.use("/donations", paymentLimiter, donationRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/messages", messageRoutes);
app.use("/profile", profileRoutes);
app.use("/support", supportRoutes);
app.use("/notifications", notificationRoutes);

// Health Check
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// 404 Handler
app.use((req, res) => {
  res.status(404).render("errors/error", { 
    title: "404 - غير موجود",
    message: "الصفحة التي تبحث عنها غير موجودة.",
    error: {},
    user: req.user || null
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  systemLogger.error(`[${req.method} ${req.originalUrl}] ${err.message}`, { stack: err.stack, ip: req.ip });
  const status = err.status || 500;
  res.status(status).render("errors/error", { 
      title: "خطأ في النظام",
      message: err.message || "حدث خطأ غير متوقع، يرجى المحاولة لاحقاً.",
      error: process.env.NODE_ENV === 'development' ? err : {},
      user: req.user || null
  });
});

module.exports = app;
