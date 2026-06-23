const { systemLogger } = require('./logger');
const { sendAlert } = require('./alerting');
const { getRequestStats } = require('./monitoring');
const { evaluateReadiness } = require('./readiness');

let timer = null;
let lastReadinessOk = true;

function thresholds() {
  return {
    errorRate: Number(process.env.ALERT_5XX_RATE_THRESHOLD || 0.02),
    p95Ms: Number(process.env.ALERT_P95_MS_THRESHOLD || 2000),
    minSamples: Number(process.env.ALERT_MIN_SAMPLES || 50),
  };
}

async function runObservabilityChecks() {
  if (process.env.OBSERVABILITY_ALERTS_ENABLED === 'false') return;

  const stats = getRequestStats();
  const limits = thresholds();

  if (stats.total >= limits.minSamples && stats.errorRate > limits.errorRate) {
    await sendAlert('High HTTP 5xx rate', {
      errorRate: Number(stats.errorRate.toFixed(4)),
      threshold: limits.errorRate,
      errors5xx: stats.errors5xx,
      total: stats.total,
      windowMs: stats.windowMs,
    });
  }

  if (stats.total >= limits.minSamples && stats.p95 > limits.p95Ms) {
    await sendAlert('High P95 latency', {
      p95Ms: Math.round(stats.p95),
      thresholdMs: limits.p95Ms,
      total: stats.total,
      windowMs: stats.windowMs,
    });
  }

  try {
    const readiness = await evaluateReadiness();
    if (!readiness.ok && lastReadinessOk) {
      await sendAlert('Readiness check failed', {
        checks: readiness.checks,
        mongo: readiness.mongo,
        redisConnected: readiness.redis.connected,
        queueUnhealthy: readiness.queue.unhealthy,
        socketAdapterActive: readiness.socketAdapter.active,
      });
    }
    if (readiness.ok && !lastReadinessOk) {
      await sendAlert('Readiness recovered', { checks: readiness.checks });
    }
    lastReadinessOk = readiness.ok;
  } catch (err) {
    await sendAlert('Readiness check error', { error: err.message });
    lastReadinessOk = false;
  }
}

function startObservabilityWatchdog() {
  if (timer) return;

  const intervalMs = Number(process.env.OBSERVABILITY_CHECK_INTERVAL_MS || 60000);
  timer = setInterval(() => {
    runObservabilityChecks().catch((err) => {
      systemLogger.error('Observability watchdog failed', { error: err.message });
    });
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  systemLogger.info('Observability watchdog started', {
    intervalMs,
    thresholds: thresholds(),
    alertsEnabled: process.env.OBSERVABILITY_ALERTS_ENABLED !== 'false',
  });
}

function stopObservabilityWatchdog() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = {
  startObservabilityWatchdog,
  stopObservabilityWatchdog,
  runObservabilityChecks,
};
