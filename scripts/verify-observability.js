/**
 * Verifies health, readiness, and metrics endpoints.
 *
 * Usage: npm run verify:observability
 */
require('dotenv').config();

const baseUrl = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

async function checkHealth() {
  const response = await fetch(`${baseUrl}/health`);
  const body = await response.text();
  if (response.status !== 200 || body.trim() !== 'OK') {
    throw new Error(`/health unexpected response: ${response.status} ${body}`);
  }
  console.log('✓ /health returns 200 OK');
}

async function checkReady() {
  const response = await fetch(`${baseUrl}/health/ready`);
  const body = await response.json();
  if (!body || typeof body.ok !== 'boolean') {
    throw new Error('/health/ready returned invalid JSON');
  }
  console.log(`✓ /health/ready responds (${response.status}) ok=${body.ok}`);
  if (!body.ok) {
    console.warn('  readiness detail:', JSON.stringify(body.checks || body));
  }
}

async function checkMetrics() {
  const headers = {};
  if (process.env.METRICS_BASIC_AUTH_USER && process.env.METRICS_BASIC_AUTH_PASS) {
    const token = Buffer.from(
      `${process.env.METRICS_BASIC_AUTH_USER}:${process.env.METRICS_BASIC_AUTH_PASS}`
    ).toString('base64');
    headers.Authorization = `Basic ${token}`;
  }

  const response = await fetch(`${baseUrl}/metrics`, { headers });
  const body = await response.text();

  if (process.env.NODE_ENV === 'production' && response.status === 403) {
    console.log('✓ /metrics protected in production (403 without credentials)');
    return;
  }

  if (response.status !== 200) {
    throw new Error(`/metrics returned ${response.status}`);
  }

  if (!body.includes('http_request_duration_ms')) {
    throw new Error('/metrics missing prometheus histogram');
  }
  console.log('✓ /metrics returns Prometheus metrics');
}

async function checkLogs() {
  const { getLogConfiguration } = require('../app/utils/logger');
  const config = getLogConfiguration();
  if (!config.retention || !config.maxSize) {
    throw new Error('Log rotation config incomplete');
  }
  console.log(`✓ Log rotation configured (retention=${config.retention}, maxSize=${config.maxSize})`);
}

async function main() {
  console.log(`Verifying observability against ${baseUrl}`);
  await checkHealth();
  await checkReady();
  await checkMetrics();
  await checkLogs();
  console.log('Observability verification completed.');
}

main().catch((err) => {
  console.error('Observability verification failed:', err.message);
  process.exit(1);
});
