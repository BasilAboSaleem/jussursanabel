const Redis = require('ioredis');
const { systemLogger } = require('./logger');

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

  redisClient.on('error', (err) => {
    systemLogger.error('Redis error', { error: err.message });
  });
  redisClient.on('reconnecting', () => {
    systemLogger.warn('Redis reconnecting');
  });
  redisClient.on('ready', () => {
    systemLogger.info('Redis ready');
  });
}

function waitForRedisReady(client, timeoutMs = 10000) {
  if (client.status === 'ready') return Promise.resolve(true);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Redis connect timeout'));
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
      client.off('ready', onReady);
      client.off('error', onError);
    };

    client.once('ready', onReady);
    client.once('error', onError);

    if (client.status === 'wait') {
      client.connect().catch(onError);
    }
  });
}

async function connectRedisIfNeeded() {
  if (!redisClient) return false;
  if (redisClient.status === 'ready') return true;

  try {
    if (
      redisClient.status === 'connecting' ||
      redisClient.status === 'connect' ||
      redisClient.status === 'reconnecting'
    ) {
      await waitForRedisReady(redisClient);
      return redisClient.status === 'ready';
    }

    if (redisClient.status === 'wait') {
      await redisClient.connect();
      return redisClient.status === 'ready';
    }

    await waitForRedisReady(redisClient);
    return redisClient.status === 'ready';
  } catch (err) {
    if (/already connecting|already connected/i.test(err.message)) {
      try {
        await waitForRedisReady(redisClient);
        return redisClient.status === 'ready';
      } catch (waitErr) {
        systemLogger.error('Failed to connect Redis', { error: waitErr.message });
        return false;
      }
    }
    systemLogger.error('Failed to connect Redis', { error: err.message });
    return false;
  }
}

async function pingRedis() {
  if (!redisClient) return { ok: false, reason: 'disabled' };
  const ready = await connectRedisIfNeeded();
  if (!ready) return { ok: false, reason: 'not_ready', status: redisClient.status };

  try {
    const pong = await redisClient.ping();
    return { ok: pong === 'PONG', pong, status: redisClient.status };
  } catch (err) {
    return { ok: false, reason: err.message, status: redisClient.status };
  }
}

async function getRedisMemoryPolicy() {
  if (!redisClient || redisClient.status !== 'ready') return null;

  try {
    const result = await redisClient.config('GET', 'maxmemory-policy');
    return Array.isArray(result) ? result[1] : null;
  } catch (err) {
    systemLogger.warn('Could not read Redis maxmemory-policy (managed Redis may restrict CONFIG)', {
      error: err.message,
    });
    return null;
  }
}

async function getRedisHealth() {
  const ping = await pingRedis();
  const policy = ping.ok ? await getRedisMemoryPolicy() : null;
  const expectedPolicy = (process.env.REDIS_MAXMEMORY_POLICY || 'noeviction').toLowerCase();
  const policyOk = !policy || policy.toLowerCase() === expectedPolicy;

  return {
    enabled: Boolean(redisClient),
    connected: ping.ok,
    status: redisClient ? redisClient.status : 'disabled',
    ping: ping.pong || null,
    maxmemoryPolicy: policy,
    policyOk,
    expectedPolicy,
  };
}

async function verifyRedisInfrastructure({ socketAdapterActive = false, queueHealth = null } = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  const requiresRedis = Boolean(process.env.REDIS_URL);

  if (isProduction && !requiresRedis) {
    const msg = 'REDIS_URL is missing in production — realtime, queues, and distributed rate limits require Redis';
    if (process.env.STRICT_ENV_VALIDATION === 'true') {
      throw new Error(msg);
    }
    systemLogger.error(msg);
  }

  const health = await getRedisHealth();

  if (requiresRedis && !health.connected) {
    const msg = 'REDIS_URL is set but Redis is not reachable';
    if (process.env.STRICT_ENV_VALIDATION === 'true') {
      throw new Error(msg);
    }
    systemLogger.error(msg);
  }

  if (health.connected && health.maxmemoryPolicy && !health.policyOk) {
    systemLogger.warn('Redis maxmemory-policy is not noeviction — queue/socket data may be evicted under memory pressure', {
      current: health.maxmemoryPolicy,
      expected: health.expectedPolicy,
    });
  }

  const wantsSocketAdapter = (process.env.SOCKET_REDIS_ADAPTER || 'true').trim().toLowerCase() !== 'false';
  if (isProduction && wantsSocketAdapter && requiresRedis && !socketAdapterActive) {
    systemLogger.warn('SOCKET_REDIS_ADAPTER is enabled but adapter is not active');
  }

  if (queueHealth && queueHealth.unhealthy) {
    systemLogger.error('Email queue reports elevated recent failures', queueHealth);
  }

  systemLogger.info('Redis infrastructure verified', {
    connected: health.connected,
    maxmemoryPolicy: health.maxmemoryPolicy,
    socketAdapterActive,
    queueRunning: Boolean(queueHealth && queueHealth.running),
  });

  return health;
}

module.exports = {
  redisClient,
  connectRedisIfNeeded,
  pingRedis,
  getRedisHealth,
  verifyRedisInfrastructure,
  redisEnabled: Boolean(redisClient),
};
