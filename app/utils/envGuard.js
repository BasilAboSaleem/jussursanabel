const { systemLogger } = require("./logger");

const REQUIRED_IN_PROD = [
  "SESSION_SECRET",
  "JWT_SECRET",
  "MONGODB_URI",
  "STRIPE_SECRET_KEY",
];

const RECOMMENDED_IN_PROD = [
  "STRIPE_WEBHOOK_SECRET",
  "BASE_URL",
  "REDIS_URL",
  "ALERT_WEBHOOK_URL",
  "EMAIL_USERNAME",
  "EMAIL_PASSWORD",
  "EMAIL_FROM",
];

function verifyProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;

  const missing = REQUIRED_IN_PROD.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    const msg = `Missing required production env vars: ${missing.join(", ")}`;
    const strict = process.env.STRICT_ENV_VALIDATION === "true";
    if (strict) {
      throw new Error(msg);
    }
    systemLogger.warn(msg);
  }

  const missingRecommended = RECOMMENDED_IN_PROD.filter((key) => !process.env[key]);
  if (missingRecommended.length > 0) {
    systemLogger.warn(
      `Missing recommended production env vars: ${missingRecommended.join(", ")}`
    );
  }

  if (!process.env.EMAIL_USERNAME || !process.env.EMAIL_PASSWORD) {
    systemLogger.warn(
      "SMTP is not configured — welcome emails, password reset, and donation receipts will not be delivered in production"
    );
  }

  const wantsRedisRateLimit = (process.env.RATE_LIMIT_REDIS || "true").trim().toLowerCase() !== "false";
  if (wantsRedisRateLimit && !process.env.REDIS_URL) {
    const msg =
      "REDIS_URL is required in production when RATE_LIMIT_REDIS is enabled (distributed rate limiting across instances)";
    if (process.env.STRICT_ENV_VALIDATION === "true") {
      throw new Error(msg);
    }
    systemLogger.error(msg);
  }

  const authMax = Number(process.env.AUTH_RATE_LIMIT_MAX || 25);
  const paymentMax = Number(process.env.PAYMENT_RATE_LIMIT_MAX || 35);
  const apiMax = Number(process.env.API_RATE_LIMIT_MAX || 2000);
  if (authMax > 100 || paymentMax > 200 || apiMax > 5000) {
    systemLogger.warn("Rate limits are set very high for production — review AUTH/PAYMENT/API_RATE_LIMIT_MAX", {
      authMax,
      paymentMax,
      apiMax,
    });
  }
}

module.exports = { verifyProductionEnv };
