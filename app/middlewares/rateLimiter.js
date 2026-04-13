const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { redisClient, redisEnabled } = require('../utils/redis');
const isProduction = process.env.NODE_ENV === 'production';
const isLoadTestMode = process.env.LOAD_TEST_MODE === 'true';
const isStripeWebhook = (req) => req.originalUrl === '/donations/webhook' || req.path === '/donations/webhook';
const skipPublicFastPaths = (req) =>
    req.path === '/health' ||
    req.path === '/health/ready' ||
    req.path === '/metrics' ||
    req.path.startsWith('/assets/') ||
    req.path === '/favicon.ico';
const shouldSkipLimiter = (req) => isStripeWebhook(req) || isLoadTestMode || skipPublicFastPaths(req);
const authMax = Number(process.env.AUTH_RATE_LIMIT_MAX || (isProduction ? 25 : 10000));
const paymentMax = Number(process.env.PAYMENT_RATE_LIMIT_MAX || (isProduction ? 35 : 120));
const apiMax = Number(process.env.API_RATE_LIMIT_MAX || (isProduction ? 3000 : 8000));
const useRedisStore = redisEnabled && redisClient && process.env.RATE_LIMIT_REDIS !== 'false';

const createRedisStore = (prefix) => {
    if (!useRedisStore) return undefined;
    return new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
        prefix,
    });
};

// حماية مسارات تسجيل الدخول وإنشاء الحسابات (منع التخمين)
exports.authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // ساعة واحدة
    max: authMax,
    message: 'تم إيقاف محاولات تسجيل الدخول مؤقتاً لحماية النظام، يرجى المحاولة بعد ساعة.',
    standardHeaders: true, 
    legacyHeaders: false, 
    skip: shouldSkipLimiter,
    store: createRedisStore('rl:auth:')
});

// حماية مسارات الدفع والتبرع (الحد من الاحتيال)
exports.paymentLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // ساعة واحدة
    max: paymentMax,
    message: 'تم تجاوز عدد محاولات الدفع المسموحة لحماية البطاقات. يرجى المحاولة لاحقاً.',
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkipLimiter,
    store: createRedisStore('rl:payment:')
});

// حماية عامة لباقي مسارات النظام (الحد من ضغط الـ DDoS)
exports.apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 دقيقة
    max: apiMax,
    message: 'هناك ضغط كبير على النظام، يرجى المحاولة بعد قليل.',
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkipLimiter,
    store: createRedisStore('rl:api:')
});
