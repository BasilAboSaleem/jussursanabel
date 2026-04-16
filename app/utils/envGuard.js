const { systemLogger } = require("./logger");

const REQUIRED_IN_PROD = [
  "SESSION_SECRET",
  "JWT_SECRET",
  "MONGODB_URI",
  "STRIPE_SECRET_KEY",
];

function verifyProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;

  const missing = REQUIRED_IN_PROD.filter((key) => !process.env[key]);
  if (missing.length === 0) return;

  const msg = `Missing required production env vars: ${missing.join(", ")}`;
  const strict = process.env.STRICT_ENV_VALIDATION === "true";
  if (strict) {
    throw new Error(msg);
  }
  systemLogger.warn(msg);
}

module.exports = { verifyProductionEnv };
