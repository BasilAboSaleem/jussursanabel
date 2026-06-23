const mongoose = require('mongoose');

async function evaluateReadiness() {
  const { getRedisHealth } = require('./redis');
  const { getQueueHealth } = require('./queue');
  const { isSocketRedisAdapterActive, shouldUseSocketRedisAdapter } = require('./socketRedis');

  const mongoStates = new Set([1, 2]);
  const mongoConnected = mongoStates.has(mongoose.connection.readyState);

  const redis = await getRedisHealth();
  const queue = await getQueueHealth();
  const socketAdapter = {
    enabled: shouldUseSocketRedisAdapter(),
    active: isSocketRedisAdapterActive(),
  };

  const requiresRedis =
    process.env.NODE_ENV === 'production' && Boolean(process.env.REDIS_URL);
  const mongoHealthy = mongoConnected;
  const redisHealthy = !requiresRedis || redis.connected;
  const queueHealthy = !queue.unhealthy;
  const socketHealthy = !socketAdapter.enabled || socketAdapter.active;
  const ok = mongoHealthy && redisHealthy && queueHealthy && socketHealthy;

  return {
    ok,
    mongo: { connected: mongoConnected, state: mongoose.connection.readyState },
    redis,
    queue,
    socketAdapter,
    checks: {
      mongo: mongoHealthy,
      redis: redisHealthy,
      queue: queueHealthy,
      socket: socketHealthy,
    },
  };
}

module.exports = { evaluateReadiness };
