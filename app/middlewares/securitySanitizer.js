function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (value && typeof value === "object") {
    const sanitized = {};
    for (const [key, child] of Object.entries(value)) {
      // Drop suspicious keys often used for NoSQL injection.
      if (key.startsWith("$") || key.includes(".")) continue;
      sanitized[key] = sanitizeValue(child);
    }
    return sanitized;
  }

  if (typeof value === "string") {
    return value.replace(/\0/g, "").trim();
  }

  return value;
}

function sanitizeRequest(req, _res, next) {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeValue(req.body);
  }
  if (req.query && typeof req.query === "object") {
    req.query = sanitizeValue(req.query);
  }
  if (req.params && typeof req.params === "object") {
    req.params = sanitizeValue(req.params);
  }
  return next();
}

module.exports = {
  sanitizeRequest,
};

