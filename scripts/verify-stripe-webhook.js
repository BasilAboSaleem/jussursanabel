/**
 * Verifies Stripe webhook configuration and endpoint behavior.
 *
 * Prerequisites:
 * - STRIPE_WEBHOOK_SECRET and a Stripe secret key in .env
 * - Server running at BASE_URL
 *
 * Usage: npm run verify:stripe-webhook
 */
require('dotenv').config();

const {
  collectWebhookSecrets,
  constructStripeWebhookEvent,
  getStripeWebhookRawBody,
} = require('../app/utils/stripeWebhook');
const { getStripeSecretKey } = require('../app/utils/stripeConfig');
const Stripe = require('stripe');

const baseUrl = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const webhookPath = '/donations/webhook';
const webhookUrl = `${baseUrl}${webhookPath}`;

const EXPECTED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
];

const stripeSecretKey = getStripeSecretKey();

function checkEnv() {
  if (!stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }
  const secrets = collectWebhookSecrets();
  if (!secrets.length) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  }
  console.log('✓ Stripe secret key present');
  console.log(`✓ Webhook signing secret(s) configured: ${secrets.length}`);
  if (process.env.STRIPE_CLI_WEBHOOK_SECRET) {
    console.log('✓ STRIPE_CLI_WEBHOOK_SECRET set (for stripe listen)');
  } else if (process.env.NODE_ENV !== 'production') {
    console.warn('⚠ STRIPE_CLI_WEBHOOK_SECRET not set — only needed for `stripe listen` (optional if you have STRIPE_WEBHOOK_SECRET from the org)');
  }
}

async function postWebhook(body, headers = {}) {
  return fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  });
}

async function checkMissingSignature() {
  const response = await postWebhook('{}');
  const body = await response.text();
  if (response.status === 503) {
    throw new Error(
      'Server returned 503 (Stripe not configured). Restart the server after editing .env: npm run dev — or type rs in the nodemon terminal.'
    );
  }
  if (response.status !== 400 || !body.includes('Missing Stripe signature')) {
    throw new Error(`Expected 400 for missing signature, got ${response.status}: ${body}`);
  }
  console.log('✓ Webhook rejects requests without stripe-signature (400)');
}

async function checkInvalidSignature() {
  const response = await postWebhook('{"id":"evt_bad"}', {
    'stripe-signature': 't=0,v1=invalid',
  });
  if (response.status !== 400) {
    const body = await response.text();
    throw new Error(`Expected 400 for invalid signature, got ${response.status}: ${body}`);
  }
  console.log('✓ Webhook rejects invalid signatures (400)');
}

async function checkValidSignedEvent() {
  const stripe = new Stripe(stripeSecretKey);
  const payload = JSON.stringify({
    id: 'evt_verify_stripe_webhook',
    object: 'event',
    type: 'checkout.session.expired',
    data: {
      object: {
        id: 'cs_verify_test',
        object: 'checkout.session',
        metadata: {},
      },
    },
  });

  const rawBody = Buffer.from(payload, 'utf8');
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: collectWebhookSecrets()[0],
  });

  const response = await postWebhook(payload, {
    'stripe-signature': signature,
  });
  const body = await response.json().catch(() => ({}));

  if (response.status !== 200 || body.received !== true) {
    throw new Error(`Expected 200 { received: true }, got ${response.status}: ${JSON.stringify(body)}`);
  }

  // Sanity-check shared helper matches handler path
  constructStripeWebhookEvent(stripe, rawBody, signature);
  getStripeWebhookRawBody({ body: rawBody });

  console.log('✓ Webhook accepts a correctly signed event (200)');
}

function printOperationalNotes() {
  const productionUrl = (process.env.BASE_URL || baseUrl).replace(/\/$/, '');
  console.log(`\nWebhook endpoint: ${productionUrl}${webhookPath}`);
  console.log('Subscribe in Stripe Dashboard to:');
  EXPECTED_EVENTS.forEach((event) => console.log(`  - ${event}`));
  console.log('\nSuper-admin status API: GET /admin/stripe-webhook-status');
  console.log('Local live forwarding (use CLI secret, not Dashboard secret):');
  console.log('  npm run stripe:webhook:listen');
  console.log('  # copy whsec_ from CLI output → STRIPE_CLI_WEBHOOK_SECRET in .env');
  console.log('  stripe trigger checkout.session.completed');
  console.log('\nManual E2E: complete payment then close browser before success_url — transaction should verify via webhook.');
}

async function main() {
  console.log(`Verifying Stripe webhook against ${webhookUrl}`);
  checkEnv();
  await checkMissingSignature();
  await checkInvalidSignature();
  await checkValidSignedEvent();
  printOperationalNotes();
  console.log('\nStripe webhook verification completed.');
}

main().catch((err) => {
  console.error('Stripe webhook verification failed:', err.message);
  process.exit(1);
});
