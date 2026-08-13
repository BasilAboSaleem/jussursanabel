/**
 * Verifies Redis connectivity, memory policy, and readiness endpoint.
 *
 * Usage: npm run verify:redis
 */
require('dotenv').config();

const baseUrl = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

async function main() {
  if (!process.env.REDIS_URL) {
    console.error('REDIS_URL is not set in .env');
    process.exit(1);
  }

  const { connectRedisIfNeeded, getRedisHealth } = require('../app/utils/redis');
  const { startQueueWorkers, getQueueHealth } = require('../app/utils/queue');

  const connected = await connectRedisIfNeeded();
  if (!connected) {
    throw new Error('Could not connect to Redis');
  }
  console.log('✓ Redis connection established');

  const health = await getRedisHealth();
  console.log(`✓ Redis ping: ${health.ping}`);
  if (health.maxmemoryPolicy) {
    const policyLabel = health.policyOk ? '✓' : '⚠';
    console.log(`${policyLabel} maxmemory-policy: ${health.maxmemoryPolicy} (expected ${health.expectedPolicy})`);
  } else {
    console.log('ℹ maxmemory-policy unavailable (common on managed Redis)');
  }

  const queueStart = startQueueWorkers();
  const queue = await getQueueHealth();
  if (queue.running || queueStart.started) {
    console.log('✓ Email queue worker running');
  } else {
    console.log(`ℹ Email queue not running (${queue.reason || queueStart.reason})`);
  }

  const readyResponse = await fetch(`${baseUrl}/health/ready`);
  const readyBody = await readyResponse.json();
  if (!readyResponse.ok || !readyBody.ok) {
    throw new Error(`/health/ready returned unhealthy: ${JSON.stringify(readyBody)}`);
  }
  console.log('✓ /health/ready is healthy');
  console.log(JSON.stringify(readyBody, null, 2));

  const { stopQueueWorkers } = require('../app/utils/queue');
  await stopQueueWorkers();

  const mongoose = require('mongoose');
  const { redisClient } = require('../app/utils/redis');
  if (redisClient && redisClient.status === 'ready') {
    await redisClient.quit().catch(() => {});
  }
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect().catch(() => {});
  }

  console.log('Redis verification completed.');
}

main().catch((err) => {
  console.error('Redis verification failed:', err.message);
  process.exit(1);
}).finally(() => {
  setTimeout(() => process.exit(0), 50);
});
