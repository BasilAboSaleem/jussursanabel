const { redisClient, redisEnabled } = require("../utils/redis");

const memoryCache = new Map();
const inflightRenders = new Map();
const PAGE_CACHE_INVALIDATE_CHANNEL = "page-cache:invalidate";
let invalidationSubscriber = null;

/** Exact public paths eligible for early cache (before session/csrf/compression). */
const EARLY_CACHE_PATHS = {
  "/": 90,
  "/stories": 120, 
  "/contact": 300,
  "/transparency": 300,
  "/cases": 60,
};

function resolvePageLocale(req) {
  if (req.cookies?.lang === "en") return "en";
  if (req.cookies?.lang === "ar") return "ar";
  if (typeof req.getLocale === "function") {
    const locale = req.getLocale();
    if (locale === "en" || locale === "ar") return locale;
  }
  return "ar";
}

function buildPageCacheKey(req) {
  const locale = resolvePageLocale(req);
  return `page:${req.originalUrl.split("?")[0]}:${locale}`;
}

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

async function readCachedPage(key) {
  const fromMemory = getFromMemoryCache(key);
  if (fromMemory) return fromMemory;

  if (!redisEnabled || !redisClient) return null;

  try {
    const fromRedis = await redisClient.get(key);
    if (fromRedis) {
      setToMemoryCache(key, fromRedis, 120);
      return fromRedis;
    }
  } catch (_) {}

  return null;
}

function writeCachedPage(key, value, ttlSeconds) {
  setToMemoryCache(key, value, ttlSeconds);
  if (redisEnabled && redisClient) {
    redisClient.set(key, value, "EX", ttlSeconds).catch(() => {});
  }
}

function deleteMemoryCacheKeys(keys) {
  for (const key of keys) {
    memoryCache.delete(key);
  }
}

function buildPublicCaseCacheKeys(caseId) {
  const id = String(caseId);
  const paths = ["/", "/cases", "/cases/feed", "/stories", `/cases/${id}`];
  const locales = ["ar", "en"];
  const keys = [];
  for (const pagePath of paths) {
    for (const locale of locales) {
      keys.push(`page:${pagePath}:${locale}`);
    }
  }
  return keys;
}

async function invalidatePublicCaseCaches(caseId) {
  const keys = buildPublicCaseCacheKeys(caseId);
  deleteMemoryCacheKeys(keys);

  if (!redisEnabled || !redisClient) return keys;

  try {
    if (keys.length) {
      await redisClient.del(...keys);
    }
    await redisClient.publish(PAGE_CACHE_INVALIDATE_CHANNEL, JSON.stringify(keys));
  } catch (_) {}

  return keys;
}

function initPageCacheInvalidation() {
  if (!redisEnabled || !redisClient || invalidationSubscriber) return;

  try {
    invalidationSubscriber = redisClient.duplicate();
    invalidationSubscriber.subscribe(PAGE_CACHE_INVALIDATE_CHANNEL, () => {});
    invalidationSubscriber.on("message", (channel, payload) => {
      if (channel !== PAGE_CACHE_INVALIDATE_CHANNEL) return;
      try {
        const keys = JSON.parse(payload);
        if (Array.isArray(keys)) deleteMemoryCacheKeys(keys);
      } catch (_) {}
    });
  } catch (_) {
    invalidationSubscriber = null;
  }
}

function sendCachedPage(res, body, ttlSeconds, hitLabel = "HIT") {
  res.set("X-Cache", hitLabel);
  res.set("Cache-Control", `public, max-age=${ttlSeconds}`);
  return res.send(body);
}

function shouldBypassPageCache(req) {
  if (req.method !== "GET") return true;
  if (req.user) return true;
  if (req.cookies?.jwt) return true;
  if (req.query?.nocache === "1") return true;
  return false;
}

/**
 * Fast path for anonymous public pages — runs before session/compression.
 * Serves only cache HITs; MISS continues through the normal pipeline.
 */
function earlyPublicPageCache(req, res, next) {
  if (shouldBypassPageCache(req)) return next();

  const ttlSeconds = EARLY_CACHE_PATHS[req.path];
  if (!ttlSeconds) return next();

  const key = buildPageCacheKey(req);
  const fromMemory = getFromMemoryCache(key);
  if (fromMemory) {
    return sendCachedPage(res, fromMemory, ttlSeconds, "HIT-EARLY");
  }

  readCachedPage(key)
    .then((cached) => {
      if (cached) {
        return sendCachedPage(res, cached, ttlSeconds, "HIT-EARLY");
      }
      next();
    })
    .catch(() => next());
}

function pageCache(ttlSeconds = 60) {
  return async (req, res, next) => {
    if (shouldBypassPageCache(req)) return next();

    const key = buildPageCacheKey(req);

    try {
      const cached = await readCachedPage(key);
      if (cached) {
        return sendCachedPage(res, cached, ttlSeconds);
      }

      if (inflightRenders.has(key)) {
        const body = await inflightRenders.get(key);
        return sendCachedPage(res, body, ttlSeconds, "HIT-WAIT");
      }

      let resolveInflight;
      let rejectInflight;
      const inflightPromise = new Promise((resolve, reject) => {
        resolveInflight = resolve;
        rejectInflight = reject;
      });
      inflightRenders.set(key, inflightPromise);

      const originalSend = res.send.bind(res);
      res.set("X-Cache", "MISS");
      res.set("Cache-Control", `public, max-age=${ttlSeconds}`);
      res.send = (body) => {
        try {
          if (res.statusCode === 200 && typeof body === "string") {
            writeCachedPage(key, body, ttlSeconds);
            resolveInflight(body);
          } else {
            rejectInflight(new Error("cache_skip"));
          }
        } catch (err) {
          rejectInflight(err);
        } finally {
          inflightRenders.delete(key);
        }
        return originalSend(body);
      };

      res.on("close", () => {
        if (inflightRenders.get(key) === inflightPromise) {
          inflightRenders.delete(key);
          rejectInflight(new Error("client_aborted"));
        }
      });
    } catch (_) {}

    return next();
  };
}

function buildPublicSiteCacheKeys() {
  const paths = ["/", "/about", "/contact", "/transparency", "/cases", "/stories"];
  const locales = ["ar", "en"];
  const keys = [];
  for (const pagePath of paths) {
    for (const locale of locales) {
      keys.push(`page:${pagePath}:${locale}`);
    }
  }
  return keys;
}

async function invalidatePublicSiteCaches() {
  const keys = buildPublicSiteCacheKeys();
  deleteMemoryCacheKeys(keys);

  if (!redisEnabled || !redisClient) return keys;

  try {
    if (keys.length) {
      await redisClient.del(...keys);
    }
    await redisClient.publish(PAGE_CACHE_INVALIDATE_CHANNEL, JSON.stringify(keys));
  } catch (_) {}

  return keys;
}

module.exports = {
  pageCache,
  earlyPublicPageCache,
  EARLY_CACHE_PATHS,
  invalidatePublicCaseCaches,
  invalidatePublicSiteCaches,
  initPageCacheInvalidation,
};