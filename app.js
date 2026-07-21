// ===========================
// Nameer Platform System - app.js
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
const fs = require("fs");
const helmet = require("helmet");
const compression = require("compression");
const methodOverride = require("method-override");
const i18n = require("i18n");
const { cloudinaryEnabled } = require("./app/utils/storyVideo");
const { metricsMiddleware, metricsHandler } = require("./app/utils/monitoring");
const { protectMetrics } = require("./app/middlewares/metricsAuth");
const { sanitizeRequest } = require("./app/middlewares/securitySanitizer");
const { resolveUserAvatar } = require("./app/utils/userAvatar");
const { resolveAdminBackUrl, resolveDashboardPageIcon } = require("./app/utils/adminNavigation");
const { usesAdminPanel, isSuperAdmin } = require("./app/utils/adminRoles");
const { getBuildVersion } = require("./app/utils/buildVersion");

i18n.configure({
  locales: ['ar', 'en'],
  directory: path.join(__dirname, 'locales'),
  defaultLocale: 'ar',
  cookie: 'lang',
  objectNotation: true,
  updateFiles: false
});

const { csrfProtection, shouldSkipGlobalCsrf } = require("./app/middlewares/csrf");
const {
  buildHelmetConfig,
  resolveTrustProxy,
  sessionCookieOptions,
  isProduction,
} = require("./app/config/security");

// Middlewares
const authMiddleware = require("./app/middlewares/auth");
const { apiLimiter, authLimiter, paymentLimiter, selfTestLimiter } = require("./app/middlewares/rateLimiter");
const { systemLogger } = require("./app/utils/logger");
const { sendAlert } = require("./app/utils/alerting");
const { verifyProductionEnv } = require("./app/utils/envGuard");
const transactionController = require("./app/controllers/transactionController");

verifyProductionEnv();

// App Initialization
const app = express();
app.disable("x-powered-by");
const rawCorsOrigins = process.env.CORS_ORIGINS || process.env.BASE_URL || "";
const allowedOrigins = rawCorsOrigins
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

const trustProxy = resolveTrustProxy();
if (trustProxy !== false) {
  app.set("trust proxy", trustProxy);
}

app.use((req, res, next) => {
  res.removeHeader("X-Powered-By");
  next();
});

const assetBaseUrl = (process.env.CDN_BASE_URL || "").replace(/\/$/, "");
const buildVersion = getBuildVersion();

function withAssetVersion(pathValue = "") {
  if (!pathValue || pathValue.startsWith("http://") || pathValue.startsWith("https://")) {
    return pathValue;
  }
  const separator = pathValue.includes("?") ? "&" : "?";
  return `${pathValue}${separator}v=${buildVersion}`;
}

app.locals.asset = (pathValue = "") => {
  let url = pathValue;
  if (assetBaseUrl) {
    if (pathValue.startsWith("http://") || pathValue.startsWith("https://")) {
      url = pathValue;
    } else if (!pathValue.startsWith("/")) {
      url = `${assetBaseUrl}/${pathValue}`;
    } else {
      url = `${assetBaseUrl}${pathValue}`;
    }
  }
  return withAssetVersion(url);
};
app.locals.buildVersion = buildVersion;

// Lightweight endpoints should bypass expensive middleware.
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.get("/health/ready", async (req, res) => {
  try {
    const { evaluateReadiness } = require("./app/utils/readiness");
    const readiness = await evaluateReadiness();

    return res.status(readiness.ok ? 200 : 503).json({
      ok: readiness.ok,
      mongo: readiness.mongo,
      redis: readiness.redis,
      queue: readiness.queue,
      socketAdapter: readiness.socketAdapter,
      checks: readiness.checks,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(503).json({ ok: false, error: err.message });
  }
});

app.get("/metrics", protectMetrics, metricsHandler);

const bodyLimit = process.env.APP_BODY_LIMIT || "5mb";

// Stripe webhook must use raw body and bypass session/CSRF middleware
app.post(
  "/donations/webhook",
  express.raw({ type: () => true, limit: bodyLimit }),
  transactionController.handleStripeWebhook
);

// View Engine Setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
// app.use(expressLayouts);
// app.set("layout", "layouts/main-layout");

// Global Middleware
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
const siteContentMiddleware = require("./app/middlewares/siteContent");
app.use(siteContentMiddleware);
const { earlyPublicPageCache } = require("./app/middlewares/cache");
app.use(earlyPublicPageCache);
app.use(
  hpp({
    checkQuery: true,
    checkBody: true,
    checkBodyOnlyForContentType: ["application/x-www-form-urlencoded", "application/json"],
  })
);
app.use(sanitizeRequest);

app.get("/sw.js", (req, res) => {
  const swPath = path.join(__dirname, "public", "sw.js");
  const template = fs.readFileSync(swPath, "utf8");
  const body = template.replace(/__BUILD_VERSION__/g, buildVersion);
  res.set("Content-Type", "application/javascript; charset=utf-8");
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.send(body);
});

app.use(express.static(path.join(__dirname, "public"), { maxAge: isProduction ? "30d" : 0 }));

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

// Security headers (Helmet + CSP)
app.use(helmet(buildHelmetConfig()));
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
    proxy: trustProxy !== false,
    store: process.env.MONGODB_URI
      ? MongoStore.create({
          mongoUrl: process.env.MONGODB_URI,
          ttl: 60 * 60 * 24,
          autoRemove: "native",
          crypto: { secret: process.env.SESSION_SECRET || (isProduction ? undefined : "subulDevSecrets") },
        })
      : undefined,
    cookie: sessionCookieOptions(),
  })
);
app.use(flash());

// CSRF Protection (multipart routes validate CSRF after multer on their routers)
app.use((req, res, next) => {
  if (shouldSkipGlobalCsrf(req)) return next();
  csrfProtection(req, res, next);
});

// Global view locals
app.use(authMiddleware.isLoggedIn); // Check if user is logged in for every request
app.use(authMiddleware.enforcePasswordChange);
app.use(authMiddleware.enforceBeneficiaryApproval);
app.use((req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : '';
  res.locals.user = req.user || null; // Ensure user is at least null
  res.locals.lang = req.getLocale();
  res.locals.currentLocale = req.getLocale();
  res.locals.langDir = req.getLocale() === 'ar' ? 'rtl' : 'ltr';
  res.locals.title = ""; // Default title to avoid ReferenceError
  res.locals.currentPath = (req.originalUrl || req.path || "").split("?")[0];
  res.locals.cloudinaryEnabled = cloudinaryEnabled;
  res.locals.asset = app.locals.asset;
  res.locals.buildVersion = buildVersion;
  res.locals.userAvatar = resolveUserAvatar;
  res.locals.resolveAdminBackUrl = resolveAdminBackUrl;
  res.locals.resolveDashboardPageIcon = resolveDashboardPageIcon;
  res.locals.usesAdminPanel = usesAdminPanel;
  res.locals.isSuperAdmin = isSuperAdmin;
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

if (process.env.ENABLE_RATE_LIMIT_SELFTEST === "true" && !isProduction) {
  app.get("/__internal/rate-limit-selftest", selfTestLimiter, (req, res) => {
    res.json({ ok: true, message: "rate limit self-test ok" });
  });
}

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
  if (err.code === 'EBADCSRFTOKEN') {
    systemLogger.warn('CSRF token validation failed', { method: req.method, url: req.originalUrl, ip: req.ip });
    req.flash('error', req.getLocale() === 'ar'
      ? 'انتهت صلاحية الجلسة. يرجى تحديث الصفحة والمحاولة مرة أخرى.'
      : 'Your session expired. Please refresh the page and try again.');
    const referer = req.get('Referrer') || req.get('Referer');
    if (referer && !referer.includes('/auth/login')) {
      return res.redirect(referer);
    }
    return res.redirect('/');
  }

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
