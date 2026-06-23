const client = require('prom-client');
const { sendAlert } = require('./alerting');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const WINDOW_MS = Number(process.env.OBSERVABILITY_WINDOW_MS || 5 * 60 * 1000);
const requestSamples = [];

const httpRequestDurationMs = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in ms',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [25, 50, 100, 200, 400, 800, 1500, 3000, 5000],
});

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

const appReadinessOk = new client.Gauge({
  name: 'app_readiness_ok',
  help: '1 when readiness checks pass, otherwise 0',
});

register.registerMetric(httpRequestDurationMs);
register.registerMetric(httpRequestsTotal);
register.registerMetric(appReadinessOk);

function pruneSamples(now = Date.now()) {
  while (requestSamples.length && requestSamples[0].ts < now - WINDOW_MS) {
    requestSamples.shift();
  }
}

function recordRequestSample(durationMs, statusCode) {
  const now = Date.now();
  requestSamples.push({ ts: now, durationMs, statusCode });
  pruneSamples(now);
}

function getRequestStats() {
  pruneSamples();
  const total = requestSamples.length;
  const errors5xx = requestSamples.filter((s) => s.statusCode >= 500).length;
  const durations = requestSamples.map((s) => s.durationMs).sort((a, b) => a - b);
  const p95 = durations.length ? durations[Math.floor(durations.length * 0.95)] || 0 : 0;

  return {
    windowMs: WINDOW_MS,
    total,
    errors5xx,
    errorRate: total ? errors5xx / total : 0,
    p95,
  };
}

function metricsMiddleware(req, res, next) {
  if (req.path === '/health' || req.path === '/health/ready' || req.path === '/metrics') {
    return next();
  }

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const route = req.route && req.route.path ? req.route.path : req.path || req.originalUrl;
    const labels = { method: req.method, route, status_code: String(res.statusCode) };

    httpRequestDurationMs.observe(labels, durationMs);
    httpRequestsTotal.inc(labels);
    recordRequestSample(durationMs, res.statusCode);

    if (res.statusCode >= 500) {
      sendAlert('HTTP 500', {
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
      });
    }
  });
  next();
}

async function metricsHandler(req, res) {
  try {
    const { evaluateReadiness } = require('./readiness');
    const readiness = await evaluateReadiness();
    appReadinessOk.set(readiness.ok ? 1 : 0);
  } catch (_) {
    appReadinessOk.set(0);
  }

  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}

function getMetricsSnapshot() {
  return {
    requestStats: getRequestStats(),
  };
}

module.exports = {
  metricsMiddleware,
  metricsHandler,
  getRequestStats,
  getMetricsSnapshot,
};
