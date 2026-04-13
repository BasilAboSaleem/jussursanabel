# Load Test Results (Current Run)

Date: 2026-04-09
Environment: local single VPS-style node process

## Baseline

- Command: `npx autocannon -c 10 -d 20 http://localhost:3000/health`
- Avg latency: `0.12ms`
- p99 latency: `1ms`
- Throughput: `~14,990 req/s`
- Errors: `0`

## Stress

### Homepage

- Command: `npx autocannon -c 20 -d 30 http://localhost:3000/`
- Avg latency: `2309ms`
- p99 latency: `7701ms`
- Throughput: `8.47 req/s`
- Errors: `0` (timeouts not significant in this run)

### Cases listing

- Command: `npx autocannon -c 20 -d 30 http://localhost:3000/cases`
- Avg latency: `1544ms`
- p99 latency: `6524ms`
- Throughput: `12.64 req/s`
- Errors: `0`

## Soak

- Command: `npx autocannon -c 8 -d 120 http://localhost:3000/cases`
- Avg latency: `834ms`
- p99 latency: `2183ms`
- Throughput: `9.64 req/s`
- Errors: `0`

## Artillery Gate

- Command: `npx artillery run load-tests/artillery.yml`
- Outcome: service stays up, but high rejected/failing requests at high arrival rates.
- Key notes:
  - `429` responses appear heavily under high-rate phases (rate limiter kicking in).
  - `ETIMEDOUT` and some `ECONNREFUSED` occur at peak load.
  - Current single-node setup does not satisfy target SLO under aggressive multi-phase pressure.

## Operational conclusion

- System is stable at low/medium concurrency but not yet ready for high concurrent bursts.
- Next bottlenecks are homepage render path, DB query cost, and process-level concurrency scaling.
- For pure capacity benchmarking, run with `LOAD_TEST_MODE=true` temporarily to avoid limiter noise, then restore to `false`.

---

## Round 2 (PM2 + Redis enabled)

### Infrastructure changes applied

- Redis started using Docker Compose: `ops/docker-compose.redis.yml`
- Process model changed to PM2 cluster mode (`ecosystem.config.js`, 8 instances on this machine)
- Nginx production-ready config added at `ops/nginx/jussur-sanabel.conf`

### Baseline after PM2/Redis

- Command: `npx autocannon -c 20 -d 20 http://localhost:3000/health`
- Avg latency: `3.38ms`
- p99 latency: `18ms`
- Throughput: `~5,167 req/s`

### Stress after PM2/Redis (raw capacity mode with `LOAD_TEST_MODE=true`)

- Homepage (`/`), `c=20 d=20`
  - Avg latency: `430ms`
  - p99 latency: `3012ms`
  - Throughput: `44 req/s`
  - Errors: `1 timeout`

- Cases (`/cases`), `c=20 d=20`
  - Avg latency: `495ms`
  - p99 latency: `2809ms`
  - Throughput: `39.1 req/s`
  - Errors: `1 timeout`

### Soak after PM2/Redis (raw capacity mode)

- Command: `npx autocannon -c 8 -d 90 http://localhost:3000/cases`
- Avg latency: `332ms`
- p99 latency: `377ms`
- Throughput: `24.18 req/s`
- Errors: `0`

### Delta vs previous run (high-level)

- `/` throughput improved from low double-digit/s to ~`44 req/s` in raw capacity mode.
- `/cases` throughput improved to ~`39 req/s` with much lower average latency than previous stressed runs.
- Stability under soak is significantly better (no errors, tight p99).

