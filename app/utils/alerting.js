const axios = require('axios');
const { systemLogger } = require('./logger');

const cooldownMs = Number(process.env.ALERT_COOLDOWN_MS || 5 * 60 * 1000);
const lastSentAt = new Map();

function isAlertsEnabled() {
  return process.env.OBSERVABILITY_ALERTS_ENABLED !== 'false';
}

async function sendAlert(title, details = {}) {
  if (!isAlertsEnabled()) return { sent: false, reason: 'disabled' };

  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (!webhook) {
    if (process.env.NODE_ENV === 'production' && !sendAlert._warnedMissingWebhook) {
      systemLogger.warn('ALERT_WEBHOOK_URL is not set — operational alerts will only appear in logs');
      sendAlert._warnedMissingWebhook = true;
    }
    return { sent: false, reason: 'no_webhook' };
  }

  const now = Date.now();
  const last = lastSentAt.get(title) || 0;
  if (now - last < cooldownMs) {
    return { sent: false, reason: 'cooldown' };
  }
  lastSentAt.set(title, now);

  try {
    await axios.post(
      webhook,
      {
        text: `[ALERT] ${title}`,
        details,
        service: 'jussur-sanabel',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
      },
      { timeout: Number(process.env.ALERT_WEBHOOK_TIMEOUT_MS || 5000) }
    );
    systemLogger.warn('Alert dispatched', { title, details });
    return { sent: true };
  } catch (err) {
    systemLogger.error('Failed to dispatch alert', { title, error: err.message });
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendAlert, isAlertsEnabled };
