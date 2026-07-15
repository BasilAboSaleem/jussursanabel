const nodemailer = require("nodemailer");

function isEmailConfigured() {
  return Boolean(process.env.EMAIL_USERNAME && process.env.EMAIL_PASSWORD);
}

function resolveSmtpPort() {
  return parseInt(process.env.EMAIL_PORT, 10) || 587;
}

function resolveSmtpSecure(port) {
  if (process.env.EMAIL_SECURE === "true") return true;
  if (process.env.EMAIL_SECURE === "false") return false;
  return port === 465;
}

function buildMailTransporter() {
  if (!isEmailConfigured()) return null;

  const port = resolveSmtpPort();
  const secure = resolveSmtpSecure(port);

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port,
    secure,
    auth: {
      user: process.env.EMAIL_USERNAME,
      pass: process.env.EMAIL_PASSWORD,
    },
    connectionTimeout: Number(process.env.EMAIL_CONNECTION_TIMEOUT_MS || 15000),
    greetingTimeout: Number(process.env.EMAIL_GREETING_TIMEOUT_MS || 15000),
    tls: {
      rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === "true",
    },
  });
}

function getMailFrom() {
  const fromAddress =
    process.env.EMAIL_FROM || process.env.EMAIL_USERNAME || "noreply@sanabel.ps";
  return `منصة نَمير <${fromAddress}>`;
}

async function verifySmtpConnection() {
  const transporter = buildMailTransporter();
  if (!transporter) return { ok: false, reason: "not_configured" };
  try {
    await transporter.verify();
    return { ok: true, port: resolveSmtpPort() };
  } catch (error) {
    return { ok: false, reason: error.message, port: resolveSmtpPort() };
  }
}

module.exports = {
  isEmailConfigured,
  buildMailTransporter,
  getMailFrom,
  verifySmtpConnection,
  resolveSmtpPort,
};
