const { createAdapter } = require('@socket.io/redis-adapter');
const { redisClient, connectRedisIfNeeded } = require('./redis');
const { systemLogger } = require('./logger');

let adapterAttached = false;

function shouldUseSocketRedisAdapter() {
  if (!redisClient) return false;
  const flag = (process.env.SOCKET_REDIS_ADAPTER || '').trim().toLowerCase();
  if (flag === 'false') return false;
  if (flag === 'true') return true;
  return process.env.NODE_ENV === 'production';
}

async function attachSocketRedisAdapter(io) {
  if (!io || adapterAttached) return false;
  if (!shouldUseSocketRedisAdapter()) {
    systemLogger.info('Socket.IO Redis adapter disabled');
    return false;
  }

  const ready = await connectRedisIfNeeded();
  if (!ready) {
    systemLogger.error('Socket.IO Redis adapter skipped — Redis not ready');
    return false;
  }

  const pubClient = redisClient.duplicate();
  const subClient = redisClient.duplicate();

  pubClient.on('error', (err) => {
    systemLogger.error('Socket Redis pub client error', { error: err.message });
  });
  subClient.on('error', (err) => {
    systemLogger.error('Socket Redis sub client error', { error: err.message });
  });

  io.adapter(createAdapter(pubClient, subClient));
  adapterAttached = true;
  systemLogger.info('Socket.IO Redis adapter attached');
  return true;
}

function isSocketRedisAdapterActive() {
  return adapterAttached;
}

module.exports = {
  attachSocketRedisAdapter,
  isSocketRedisAdapterActive,
  shouldUseSocketRedisAdapter,
};
