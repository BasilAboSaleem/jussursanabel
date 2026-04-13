const Redis = require("ioredis");
const { systemLogger } = require("./logger");

let redisClient = null;

const redisUrl = process.env.REDIS_URL;

if (redisUrl) {
  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 10000),
    keepAlive: Number(process.env.REDIS_KEEPALIVE_MS || 30000),
    retryStrategy(times) {
      const base = Number(process.env.REDIS_RETRY_BASE_MS || 200);
      const max = Number(process.env.REDIS_RETRY_MAX_MS || 5000);
      return Math.min(base * times, max);
    },
  });

  redisClient.on("error", (err) => {
    systemLogger.error("Redis error", { error: err.message });
  });
  redisClient.on("reconnecting", () => {
    systemLogger.warn("Redis reconnecting");
  });
  redisClient.on("ready", () => {
    systemLogger.info("Redis ready");
  });
}

async function connectRedisIfNeeded() {
  if (!redisClient) return false;
  if (redisClient.status === "ready") return true;
  try {
    await redisClient.connect();
    systemLogger.info("Redis connected");
    return true;
  } catch (err) {
    systemLogger.error("Failed to connect Redis", { error: err.message });
    return false;
  }
}

module.exports = {
  redisClient,
  connectRedisIfNeeded,
  redisEnabled: Boolean(redisClient),
};

