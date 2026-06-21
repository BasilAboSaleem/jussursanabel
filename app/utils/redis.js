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

function waitForRedisReady(client, timeoutMs = 10000) {
  if (client.status === "ready") return Promise.resolve(true);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Redis connect timeout"));
    }, timeoutMs);

    const onReady = () => {
      cleanup();
      resolve(true);
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      client.off("ready", onReady);
      client.off("error", onError);
    };

    client.once("ready", onReady);
    client.once("error", onError);

    if (client.status === "wait") {
      client.connect().catch(onError);
    }
  });
}

async function connectRedisIfNeeded() {
  if (!redisClient) return false;
  if (redisClient.status === "ready") return true;

  try {
    if (
      redisClient.status === "connecting" ||
      redisClient.status === "connect" ||
      redisClient.status === "reconnecting"
    ) {
      await waitForRedisReady(redisClient);
      return redisClient.status === "ready";
    }

    if (redisClient.status === "wait") {
      await redisClient.connect();
      return redisClient.status === "ready";
    }

    await waitForRedisReady(redisClient);
    return redisClient.status === "ready";
  } catch (err) {
    if (/already connecting|already connected/i.test(err.message)) {
      try {
        await waitForRedisReady(redisClient);
        return redisClient.status === "ready";
      } catch (waitErr) {
        systemLogger.error("Failed to connect Redis", { error: waitErr.message });
        return false;
      }
    }
    systemLogger.error("Failed to connect Redis", { error: err.message });
    return false;
  }
}

module.exports = {
  redisClient,
  connectRedisIfNeeded,
  redisEnabled: Boolean(redisClient),
};
