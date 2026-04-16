// ===========================
// Subul Platform System - app.js
// ===========================

const express = require("express");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const flash = require("connect-flash");
const morgan = require("morgan");
const cors = require("cors");
const hpp = require("hpp");
const path = require("path");
const helmet = require("helmet");
const compression = require("compression");
const methodOverride = require("method-override");
const i18n = require("i18n");
const { cloudinaryEnabled } = require("./app/utils/storyVideo");
const { connectRedisIfNeeded, redisClient } = require("./app/utils/redis");
const { startQueueWorkers } = require("./app/utils/queue");
const { metricsMiddleware, metricsHandler } = require("./app/utils/monitoring");
const { sanitizeRequest } = require("./app/middlewares/securitySanitizer");

i18n.configure({
  locales: ['ar', 'en'],
  directory: path.join(__dirname, 'locales'),
  defaultLocale: 'ar',
  cookie: 'lang',
  objectNotation: true,
  updateFiles: false
});

const csurf = require("csurf");

// Config / DB
const connectDB = require("./app/constants/db"); 
connectDB();

// Middlewares
const authMiddleware = require("./app/middlewares/auth");
const { apiLimiter, authLimiter, paymentLimiter } = require("./app/middlewares/rateLimiter");
const { systemLogger } = require("./app/utils/logger");
const { sendAlert } = require("./app/utils/alerting");

// App Initialization
const app = express();
app.disable("x-powered-by");
const isProduction = process.env.NODE_ENV === "production";
const rawCorsOrigins = process.env.CORS_ORIGINS || process.env.BASE_URL || "";
const allowedOrigins = rawCorsOrigins
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

if (isProduction) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY || 1));
}

const assetBaseUrl = (process.env.CDN_BASE_URL || "").replace(/\/$/, "");
app.locals.asset = (pathValue = "") => {
  if (!assetBaseUrl) return pathValue;
  if (pathValue.startsWith("http://") || pathValue.startsWith("https://")) return pathValue;
  if (!pathValue.startsWith("/")) return `${assetBaseUrl}/${pathValue}`;
  return `${assetBaseUrl}${pathValue}`;
};

// Lightweight endpoints should bypass expensive middleware.
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.get("/health/ready", async (req, res) => {
  try {
    const redisStatus = redisClient ? redisClient.status : "disabled";
    return res.status(200).json({
      ok: true,
      redis: redisStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/metrics", metricsHandler);

// View Engine Setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
// app.use(expressLayouts);
// app.set("layout", "layouts/main-layout");

// Global Middleware
const bodyLimit = process.env.APP_BODY_LIMIT || "5mb";
const jsonParser = express.json({ limit: bodyLimit });
const urlEncodedParser = express.urlencoded({ extended: true, limit: bodyLimit });
app.use((req, res, next) => {
  if (req.originalUrl === "/donations/webhook") return next();
  jsonParser(req, res, next);
});
app.use((req, res, next) => {
  if (req.originalUrl === "/donations/webhook") return next();
  urlEncodedParser(req, res, next);
});
app.use(cookieParser());
app.use(i18n.init);
app.use(hpp());
app.use(sanitizeRequest);
app.use(express.static(path.join(__dirname, "public"), { maxAge: "30d" }));

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      
      // In development, allow everything
      if (!isProduction) return callback(null, true);
      
      // Sanitize the incoming origin
      const sanitizedOrigin = origin.trim().replace(/\/$/, "");
      
      // Check if it's in our allowed list
      if (allowedOrigins.some(o => o === sanitizedOrigin)) {
        return callback(null, true);
      }
      
      // Fallback: If it's the same origin as BASE_URL, allow it
      const baseUrlSanitized = (process.env.BASE_URL || "").trim().replace(/\/$/, "");
      if (sanitizedOrigin === baseUrlSanitized) {
        return callback(null, true);
      }

      console.error(`[CORS Error] Origin blocked: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(compression());
app.use(methodOverride("_method"));
app.use(metricsMiddleware);

// Security
app.use(helmet({ 
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "https://js.stripe.com"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
        connectSrc: ["'self'", "https://api.stripe.com", "wss:", "ws:"],
        frameSrc: ["'self'", "https://checkout.stripe.com", "https://js.stripe.com", "https://www.youtube.com", "https://www.youtube-nocookie.com", "https://www.google.com"],
        mediaSrc: ["'self'", "https:", "blob:"],
        formAction: ["'self'", "https://checkout.stripe.com"],
      },
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));
app.use(apiLimiter); // Apply global rate limiter

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

// Session + Flash 
app.use(
  session({
    secret: process.env.SESSION_SECRET || (isProduction ? undefined : "subulDevSecrets"),
    resave: false,
    saveUninitialized: false,
    proxy: isProduction,
    store: process.env.MONGODB_URI
      ? MongoStore.create({
          mongoUrl: process.env.MONGODB_URI,
          ttl: 60 * 60 * 24,
          autoRemove: "native",
          crypto: { secret: process.env.SESSION_SECRET || (isProduction ? undefined : "subulDevSecrets") },
        })
      : undefined,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24,
      sameSite: process.env.SESSION_SAME_SITE || "lax",
    },
  })
);
app.use(flash());

// CSRF Protection
const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: process.env.CSRF_SAME_SITE || "lax",
  },
});
app.use((req, res, next) => {
  // Skip CSRF check for multipart uploads as multer needs to parse body first
  // and global csurf runs before route-specific multer
  if (
    req.originalUrl.includes('/proof-of-impact') ||
    req.originalUrl.includes('/updates') ||
    req.originalUrl.includes('/donations/webhook')
  ) {
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
  res.locals.cloudinaryEnabled = cloudinaryEnabled;
  res.locals.asset = app.locals.asset;
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
const transactionController = require("./app/controllers/transactionController");

app.use("/", indexRoutes);
app.use("/auth", authLimiter, authRoutes);
app.use("/cases", caseRoutes);
app.use("/admin", adminRoutes);
app.post("/donations/webhook", express.raw({ type: "application/json" }), transactionController.handleStripeWebhook);
app.use("/donations", paymentLimiter, donationRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/messages", messageRoutes);
app.use("/profile", profileRoutes);
app.use("/support", supportRoutes);
app.use("/notifications", notificationRoutes);

// Initialize optional infrastructure in background
connectRedisIfNeeded().then(() => {
  startQueueWorkers();
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
  if (status >= 500) {
    sendAlert("HTTP 500", {
      method: req.method,
      url: req.originalUrl,
      message: err.message,
    });
  }
  res.status(status).render("errors/error", { 
      title: "خطأ في النظام",
      message: err.message || "حدث خطأ غير متوقع، يرجى المحاولة لاحقاً.",
      error: process.env.NODE_ENV === 'development' ? err : {},
      user: req.user || null
  });
});

module.exports = app;
