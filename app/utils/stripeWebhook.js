/**
 * Stripe webhook signing — supports Dashboard secret + optional CLI secret for local `stripe listen`.
 */

function collectWebhookSecrets() {
  const secrets = [];

  const add = (raw) => {
    if (!raw) return;
    raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((secret) => {
        if (!secrets.includes(secret)) secrets.push(secret);
      });
  };

  add(process.env.STRIPE_WEBHOOK_SECRET);
  add(process.env.STRIPE_CLI_WEBHOOK_SECRET);

  return secrets;
}

function getStripeWebhookRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  return null;
}

function constructStripeWebhookEvent(stripe, rawBody, signature) {
  const secrets = collectWebhookSecrets();
  if (!secrets.length) {
    throw new Error('No webhook signing secrets configured');
  }

  let lastError;
  for (const secret of secrets) {
    try {
      return stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

function getWebhookSignatureHint(secretsTried) {
  if (secretsTried > 1) {
    return 'None of the configured webhook secrets matched — confirm STRIPE_WEBHOOK_SECRET (Dashboard) and STRIPE_CLI_WEBHOOK_SECRET (stripe listen output).';
  }
  if (process.env.NODE_ENV === 'production') {
    return 'Confirm STRIPE_WEBHOOK_SECRET matches the signing secret for this endpoint in Stripe Dashboard.';
  }
  return 'For local `stripe listen`, copy the whsec_ secret from the CLI terminal into STRIPE_CLI_WEBHOOK_SECRET (Dashboard secret is different).';
}

module.exports = {
  collectWebhookSecrets,
  getStripeWebhookRawBody,
  constructStripeWebhookEvent,
  getWebhookSignatureHint,
};
