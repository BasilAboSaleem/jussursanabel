/**
 * Stripe keys — STRIPE_MODE=test|live picks test/live pair; STRIPE_SECRET_KEY overrides either.
 */
const Stripe = require('stripe');

let cachedClient = null;
let cachedSecretKey = null;

function resolveStripeMode() {
  return (process.env.STRIPE_MODE || 'live').trim().toLowerCase();
}

function getStripeSecretKey() {
  const direct = process.env.STRIPE_SECRET_KEY;
  if (direct && direct.trim()) return direct.trim();

  const mode = resolveStripeMode();
  if (mode === 'test') {
    const test =
      process.env.STRIPE_TEST_SECRET_KEY ||
      process.env.TEST_SECRET_KEY;
    if (test && test.trim()) return test.trim();
  }

  const live =
    process.env.STRIPE_LIVE_SECRET_KEY ||
    process.env.Live_Secret_KEY;
  if (live && live.trim()) return live.trim();

  const fallbackTest = process.env.STRIPE_TEST_SECRET_KEY || process.env.TEST_SECRET_KEY;
  return fallbackTest && fallbackTest.trim() ? fallbackTest.trim() : null;
}

function getStripePublishableKey() {
  const direct = process.env.STRIPE_PUBLISHABLE_KEY;
  if (direct && direct.trim()) return direct.trim();

  const mode = resolveStripeMode();
  if (mode === 'test') {
    const test =
      process.env.STRIPE_TEST_PUBLISHABLE_KEY ||
      process.env.TEST_PUB_KEY;
    if (test && test.trim()) return test.trim();
  }

  const live =
    process.env.STRIPE_LIVE_PUBLISHABLE_KEY ||
    process.env.Live_Publishable_key;
  if (live && live.trim()) return live.trim();

  const fallbackTest = process.env.STRIPE_TEST_PUBLISHABLE_KEY || process.env.TEST_PUB_KEY;
  return fallbackTest && fallbackTest.trim() ? fallbackTest.trim() : null;
}

function getStripeClient() {
  const key = getStripeSecretKey();
  if (!key) {
    cachedClient = null;
    cachedSecretKey = null;
    return null;
  }
  if (!cachedClient || cachedSecretKey !== key) {
    cachedClient = new Stripe(key);
    cachedSecretKey = key;
  }
  return cachedClient;
}

module.exports = {
  getStripeSecretKey,
  getStripePublishableKey,
  getStripeClient,
  resolveStripeMode,
};
