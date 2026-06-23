/**
 * Verifies rate limiters return HTTP 429.
 *
 * Prereqs:
 * - Server running with ENABLE_RATE_LIMIT_SELFTEST=true (non-production)
 * - LOAD_TEST_MODE must not be true
 *
 * Usage: npm run verify:rate-limits
 */
require('dotenv').config();

const baseUrl = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    ...options,
    headers: {
      Accept: 'application/json, text/html',
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  return { status: response.status, body, headers: response.headers };
}

async function expect429(label, fn, attempts) {
  let lastStatus = 0;
  for (let i = 0; i < attempts; i += 1) {
    const result = await fn(i);
    lastStatus = result.status;
    if (result.status === 429) {
      console.log(`✓ ${label}: 429 confirmed (attempt ${i + 1})`);
      return;
    }
  }
  throw new Error(`${label}: expected 429 within ${attempts} attempts, last status ${lastStatus}`);
}

async function expectRateLimitHeaders(label, fn) {
  const result = await fn();
  const limit = result.headers.get('ratelimit-limit');
  const remaining = result.headers.get('ratelimit-remaining');
  if (!limit || remaining === null) {
    throw new Error(`${label}: missing RateLimit-* headers`);
  }
  console.log(`✓ ${label}: RateLimit-Limit=${limit}, Remaining=${remaining}`);
}

async function main() {
  if (process.env.LOAD_TEST_MODE === 'true') {
    console.error('Set LOAD_TEST_MODE=false before running rate-limit verification.');
    process.exit(1);
  }

  console.log(`Verifying rate limits against ${baseUrl}`);

  if (process.env.ENABLE_RATE_LIMIT_SELFTEST === 'true') {
    await expect429('Self-test limiter', () => request('/__internal/rate-limit-selftest'), 7);
  } else {
    console.warn('Tip: set ENABLE_RATE_LIMIT_SELFTEST=true on the server for a fast 429 self-test route.');
  }

  await expectRateLimitHeaders('API limiter headers', () => request('/cases/feed'));

  const authMax = Number(process.env.AUTH_RATE_LIMIT_MAX || 10000);
  if (authMax <= 30) {
    await expect429(
      'Auth limiter',
      () =>
        request('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'email=ratelimit-test@example.com&password=wrong-password',
        }),
      authMax + 2
    );
  } else {
    await expectRateLimitHeaders('Auth limiter headers', () =>
      request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'email=ratelimit-test@example.com&password=wrong-password',
      })
    );
  }

  const paymentMax = Number(process.env.PAYMENT_RATE_LIMIT_MAX || 120);
  if (paymentMax <= 40) {
    await expect429(
      'Payment limiter',
      () =>
        request('/donations/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'caseId=000000000000000000000000&amount=10&type=direct',
        }),
      paymentMax + 2
    );
  } else {
    await expectRateLimitHeaders('Payment limiter headers', () =>
      request('/donations/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'caseId=000000000000000000000000&amount=10&type=direct',
      })
    );
  }

  const apiMax = Number(process.env.API_RATE_LIMIT_MAX || 8000);
  if (apiMax <= 50) {
    await expect429('API limiter', () => request('/cases/feed'), apiMax + 3);
  }

  console.log('Rate-limit verification completed.');
}

main().catch((err) => {
  console.error('Rate-limit verification failed:', err.message);
  process.exit(1);
});
