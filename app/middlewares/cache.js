const { redisClient, redisEnabled } = require("../utils/redis");

const memoryCache = new Map();

function getFromMemoryCache(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function setToMemoryCache(key, value, ttlSeconds) {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

function pageCache(ttlSeconds = 60) {
  return async (req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.user) return next(); // avoid caching personalized pages
    if (req.query && req.query.nocache === "1") return next();

    const key = `page:${req.originalUrl}:${req.getLocale ? req.getLocale() : "ar"}`;
    const canUseRedis = redisEnabled && redisClient;

    try {
      const cached = canUseRedis ? await redisClient.get(key) : getFromMemoryCache(key);
      if (cached) {
        res.set("X-Cache", "HIT");
        res.set("Cache-Control", `public, max-age=${ttlSeconds}`);
        return res.send(cached);
      }

      const originalSend = res.send.bind(res);
      res.set("X-Cache", "MISS");
      res.set("Cache-Control", `public, max-age=${ttlSeconds}`);
      res.send = (body) => {
        try {
          if (res.statusCode === 200 && typeof body === "string") {
            if (canUseRedis) {
              redisClient.set(key, body, "EX", ttlSeconds).catch(() => {});
            } else {
              setToMemoryCache(key, body, ttlSeconds);
            }
          }
        } catch (_) {}
        return originalSend(body);
      };
    } catch (_) {}

    return next();
  };
}

module.exports = { pageCache };

