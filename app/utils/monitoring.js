const client = require("prom-client");

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDurationMs = new client.Histogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration in ms",
  labelNames: ["method", "route", "status_code"],
  buckets: [25, 50, 100, 200, 400, 800, 1500, 3000, 5000],
});

register.registerMetric(httpRequestDurationMs);

function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const route = req.route && req.route.path ? req.route.path : req.path || req.originalUrl;
    httpRequestDurationMs.observe(
      { method: req.method, route, status_code: String(res.statusCode) },
      durationMs
    );
  });
  next();
}

async function metricsHandler(req, res) {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
}

module.exports = {
  metricsMiddleware,
  metricsHandler,
};

