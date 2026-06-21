const { systemLogger } = require("../utils/logger");

let warnedUnprotected = false;

function normalizeIp(ip) {
  if (!ip) return "";
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

function parseAllowedIps() {
  return (process.env.METRICS_ALLOWED_IPS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isIpAllowed(clientIp, allowedIps) {
  const ip = normalizeIp(clientIp);
  return allowedIps.some((entry) => entry === "*" || entry === ip);
}

function hasBasicAuthConfig() {
  return Boolean(process.env.METRICS_BASIC_AUTH_USER && process.env.METRICS_BASIC_AUTH_PASS);
}

function checkBasicAuth(req) {
  const expectedUser = process.env.METRICS_BASIC_AUTH_USER;
  const expectedPass = process.env.METRICS_BASIC_AUTH_PASS;
  const header = req.headers.authorization || "";

  if (!header.startsWith("Basic ")) return false;

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return false;

  const user = decoded.slice(0, separator);
  const pass = decoded.slice(separator + 1);
  return user === expectedUser && pass === expectedPass;
}

function isMetricsProtectionConfigured() {
  return parseAllowedIps().length > 0 || hasBasicAuthConfig();
}

function protectMetrics(req, res, next) {
  if (process.env.METRICS_DISABLED === "true") {
    return res.status(404).end();
  }

  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) {
    return next();
  }

  const allowedIps = parseAllowedIps();

  if (!isMetricsProtectionConfigured()) {
    if (!warnedUnprotected) {
      systemLogger.warn(
        "Metrics endpoint blocked in production: set METRICS_ALLOWED_IPS and/or METRICS_BASIC_AUTH_USER + METRICS_BASIC_AUTH_PASS"
      );
      warnedUnprotected = true;
    }
    return res.status(403).send("Forbidden");
  }

  if (allowedIps.length && isIpAllowed(req.ip, allowedIps)) {
    return next();
  }

  if (hasBasicAuthConfig() && checkBasicAuth(req)) {
    return next();
  }

  if (hasBasicAuthConfig()) {
    res.set("WWW-Authenticate", 'Basic realm="metrics"');
    return res.status(401).send("Unauthorized");
  }

  return res.status(403).send("Forbidden");
}

module.exports = {
  protectMetrics,
  isMetricsProtectionConfigured,
};
