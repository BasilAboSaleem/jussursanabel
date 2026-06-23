const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { redisClient, redisEnabled } = require('../utils/redis');
const { systemLogger } = require('../utils/logger');

const isProduction = process.env.NODE_ENV === 'production';
const isLoadTestMode = process.env.LOAD_TEST_MODE === 'true';

const PRODUCTION_DEFAULTS = {
  auth: 25,
  payment: 35,
  api: 2000,
};

const DEVELOPMENT_DEFAULTS = {
  auth: 10000,
  payment: 120,
  api: 8000,
};

function parseLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const defaults = isProduction ? PRODUCTION_DEFAULTS : DEVELOPMENT_DEFAULTS;
const authMax = parseLimit(process.env.AUTH_RATE_LIMIT_MAX, defaults.auth);
const paymentMax = parseLimit(process.env.PAYMENT_RATE_LIMIT_MAX, defaults.payment);
const apiMax = parseLimit(process.env.API_RATE_LIMIT_MAX, defaults.api);

function isStripeWebhook(req) {
  return req.originalUrl === '/donations/webhook' || req.path === '/donations/webhook';
}

function skipPublicFastPaths(req) {
  return (
    req.path === '/health' ||
    req.path === '/health/ready' ||
    req.path === '/metrics' ||
    req.path.startsWith('/assets/') ||
    req.path === '/favicon.ico'
  );
}

function shouldSkipGlobalLimiter(req) {
  return isStripeWebhook(req) || isLoadTestMode || skipPublicFastPaths(req);
}

function shouldUseRedisStore() {
  if (!redisEnabled || !redisClient) return false;
  const flag = (process.env.RATE_LIMIT_REDIS || '').trim().toLowerCase();
  if (flag === 'false') return false;
  if (flag === 'true') return true;
  return Boolean(process.env.REDIS_URL);
}

function createRedisStore(prefix) {
  if (!shouldUseRedisStore()) return undefined;
  return new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix,
  });
}

function buildRateLimitHandler(scope) {
  return (req, res, _next, options) => {
    systemLogger.warn('Rate limit exceeded', {
      scope,
      ip: req.ip,
      method: req.method,
      path: req.originalUrl,
    });

    res.status(options.statusCode);

    const wantsJson =
      req.xhr ||
      req.path.startsWith('/api/') ||
      (req.get('Accept') || '').includes('application/json');

    if (wantsJson) {
      return res.json({
        ok: false,
        error: 'too_many_requests',
        message: options.message,
        retryAfter: res.getHeader('Retry-After') || null,
      });
    }

    return res.type('text').send(options.message);
  };
}

const sharedOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler('api'),
};

exports.authLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 60 * 60 * 1000,
  max: authMax,
  message: 'تم إيقاف محاولات تسجيل الدخول مؤقتاً لحماية النظام، يرجى المحاولة بعد ساعة.',
  skipSuccessfulRequests: true,
  skip: (req) => shouldSkipGlobalLimiter(req) || req.method === 'GET',
  handler: buildRateLimitHandler('auth'),
  store: createRedisStore('rl:auth:'),
});

exports.paymentLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 60 * 60 * 1000,
  max: paymentMax,
  message: 'تم تجاوز عدد محاولات الدفع المسموحة لحماية البطاقات. يرجى المحاولة لاحقاً.',
  skipSuccessfulRequests: true,
  skip: (req) => shouldSkipGlobalLimiter(req) || req.method === 'GET',
  handler: buildRateLimitHandler('payment'),
  store: createRedisStore('rl:payment:'),
});

exports.apiLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60 * 1000,
  max: apiMax,
  message: 'هناك ضغط كبير على النظام، يرجى المحاولة بعد قليل.',
  skip: shouldSkipGlobalLimiter,
  handler: buildRateLimitHandler('api'),
  store: createRedisStore('rl:api:'),
});

/** Local verification only — max 5 req/min (see scripts/verify-rate-limits.js) */
exports.selfTestLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 60 * 1000,
  max: 5,
  message: 'self-test rate limit exceeded',
  skip: shouldSkipGlobalLimiter,
  handler: buildRateLimitHandler('selftest'),
  store: createRedisStore('rl:selftest:'),
});

exports.getRateLimitConfiguration = () => ({
  authMax,
  paymentMax,
  apiMax,
  redisStore: shouldUseRedisStore(),
  loadTestMode: isLoadTestMode,
  windows: {
    auth: '1h',
    payment: '1h',
    api: '15m',
  },
});

exports.verifyRateLimitInfrastructure = async ({ redisReady = false } = {}) => {
  const config = exports.getRateLimitConfiguration();
  const wantsRedis = (process.env.RATE_LIMIT_REDIS || 'true').trim().toLowerCase() !== 'false';

  if (isProduction && wantsRedis && !process.env.REDIS_URL) {
    const msg = 'RATE_LIMIT_REDIS is enabled but REDIS_URL is missing — limits will be per-process only';
    if (process.env.STRICT_ENV_VALIDATION === 'true') {
      throw new Error(msg);
    }
    systemLogger.error(msg);
  }

  if (isProduction && wantsRedis && process.env.REDIS_URL && !redisReady) {
    systemLogger.warn('Redis is not ready — rate limits are using in-memory store until Redis connects');
  }

  if (isProduction && wantsRedis && redisReady && !config.redisStore) {
    systemLogger.warn('Redis is ready but rate-limit store is disabled — check RATE_LIMIT_REDIS');
  }

  systemLogger.info('Rate limit configuration', config);
  return config;
};
