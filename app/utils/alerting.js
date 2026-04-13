const axios = require("axios");

async function sendAlert(title, details = {}) {
  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await axios.post(webhook, {
      text: `[ALERT] ${title}`,
      details,
      service: "jussur-sanabel",
      timestamp: new Date().toISOString(),
    });
  } catch (_) {
    // Avoid recursive failures in alert path
  }
}

module.exports = { sendAlert };

