/**
 * Load gate — Baseline / Stress / Soak with SLO enforcement.
 *
 * Prerequisites:
 * - Server running at BASE_URL
 * - For capacity testing without 429 noise: LOAD_TEST_MODE=true on server
 * - Recommended: Redis + PM2 cluster for production-like results
 *
 * Usage: npm run load:gate
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const autocannon = require('autocannon');
const SLO = require('../load-tests/slo');

const baseUrl = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

function percentile(latency, p) {
  const key = `p${String(p).replace('.', '_')}`;
  if (latency[key] != null) return latency[key];
  if (p === 95 && latency.p97_5 != null) return Math.round(latency.p97_5 * 0.98);
  if (p === 99 && latency.p97_5 != null) return latency.p97_5;
  return latency.p99 || latency.max || latency.average || 0;
}

function summarizeResult(profile, result) {
  const total = result.requests.total || 0;
  const failed = (result.errors || 0) + (result.timeouts || 0) + (result.non2xx || 0);
  const errorRate = total > 0 ? failed / total : 0;
  const p95 = percentile(result.latency, 95);

  return {
    profile: profile.name,
    path: profile.path,
    connections: profile.connections,
    durationSec: profile.durationSec,
    totalRequests: total,
    failedRequests: failed,
    errorRate: Number(errorRate.toFixed(4)),
    p95Ms: Math.round(p95),
    avgMs: Math.round(result.latency.average || 0),
    throughputRps: Number((result.requests.average || 0).toFixed(2)),
    passed: true,
    violations: [],
  };
}

function evaluateAgainstSlo(profile, summary) {
  const violations = [];

  if (summary.errorRate > SLO.ERROR_RATE_MAX) {
    violations.push(`error rate ${(summary.errorRate * 100).toFixed(2)}% > ${SLO.ERROR_RATE_MAX * 100}%`);
  }

  if (profile.publicPage && summary.p95Ms > SLO.P95_MS_MAX) {
    violations.push(`p95 ${summary.p95Ms}ms > ${SLO.P95_MS_MAX}ms`);
  }

  summary.passed = violations.length === 0;
  summary.violations = violations;
  return summary;
}

function runAutocannon(profile) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: `${baseUrl}${profile.path}`,
        connections: profile.connections,
        duration: profile.durationSec,
        headers: { Accept: 'text/html,application/json' },
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );

    autocannon.track(instance, { renderProgressBar: true });
  });
}

async function warmCache() {
  const rounds = Number(process.env.LOAD_GATE_WARMUP_ROUNDS || 5);
  console.log(`Warming public page cache (${rounds} rounds)...`);
  for (let round = 1; round <= rounds; round += 1) {
    for (const route of SLO.WARMUP_PATHS) {
      try {
        const response = await fetch(`${baseUrl}${route}`, {
          headers: { Accept: 'text/html' },
        });
        await response.arrayBuffer();
        if (round === 1 || round === rounds) {
          const cacheHeader = response.headers.get('x-cache') || 'n/a';
          console.log(`  warmed ${route} -> ${response.status} (${cacheHeader})`);
        }
      } catch (err) {
        console.warn(`  warm-up failed for ${route}: ${err.message}`);
      }
    }
  }
}

async function main() {
  console.log(`Load gate target: ${baseUrl}`);
  console.log(`SLO: error rate < ${SLO.ERROR_RATE_MAX * 100}%, p95 <= ${SLO.P95_MS_MAX}ms (public pages)`);

  if (process.env.LOAD_TEST_MODE !== 'true') {
    console.warn('Tip: set LOAD_TEST_MODE=true on the server to avoid rate-limit 429 during stress.');
  }

  await warmCache();

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    slo: { p95MsMax: SLO.P95_MS_MAX, errorRateMax: SLO.ERROR_RATE_MAX },
    results: [],
    passed: true,
  };

  const profiles = [
    SLO.PROFILES.baseline,
    ...SLO.PROFILES.stress,
    SLO.PROFILES.soak,
  ];

  for (const profile of profiles) {
    console.log(`\n▶ Running ${profile.name} (${profile.connections}c / ${profile.durationSec}s) ${profile.path}`);
    const raw = await runAutocannon(profile);
    const summary = evaluateAgainstSlo(profile, summarizeResult(profile, raw));
    report.results.push(summary);

    const status = summary.passed ? 'PASS' : 'FAIL';
    console.log(
      `${status} ${profile.name}: p95=${summary.p95Ms}ms avg=${summary.avgMs}ms errors=${(summary.errorRate * 100).toFixed(2)}% rps=${summary.throughputRps}`
    );
    if (summary.violations.length) {
      summary.violations.forEach((v) => console.log(`  - ${v}`));
      report.passed = false;
    }
  }

  const reportPath = path.join(__dirname, '..', 'load-tests', 'latest-gate-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to ${reportPath}`);

  if (!report.passed) {
    console.error('\nLoad gate FAILED — SLO breach detected.');
    process.exit(1);
  }

  console.log('\nLoad gate PASSED — ready for beta traffic profile.');
}

main().catch((err) => {
  console.error('Load gate error:', err.message);
  process.exit(1);
});
