const nodemailer = require("nodemailer");
const { enqueueEmail } = require("./queue");
const { systemLogger } = require("./logger");
const { sendAlert } = require("./alerting");
const { isEmailConfigured, buildMailTransporter, getMailFrom } = require("./emailConfig");

const isProduction = process.env.NODE_ENV === "production";

function reportEmailFailure(context, result) {
  systemLogger.error("Email delivery failed", {
    ...context,
    reason: result.reason,
    error: result.error && result.error.message,
  });

  if (isProduction) {
    sendAlert("Email delivery failed", {
      ...context,
      reason: result.reason,
    });
  }
}

async function sendViaEthereal(mailOptions) {
  const testAccount = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });

  const info = await transporter.sendMail(mailOptions);
  const previewUrl = nodemailer.getTestMessageUrl(info);

  systemLogger.info("Dev email sent via Ethereal preview", {
    to: mailOptions.to,
    subject: mailOptions.subject,
    previewUrl,
  });

  return { ok: true, delivery: "preview", previewUrl };
}

/**
 * @returns {Promise<{ ok: boolean, delivery?: string, reason?: string, previewUrl?: string, error?: Error }>}
 */
const sendEmail = async (options) => {
  const context = {
    to: options.email,
    subject: options.subject,
    type: options.type || "general",
  };

  const mailOptions = {
    from: getMailFrom(),
    to: options.email,
    subject: options.subject,
    html: options.html,
  };

  try {
    if (isEmailConfigured()) {
      let queued = false;
      if (!options.immediate) {
        try {
          queued = await enqueueEmail(mailOptions);
        } catch (queueErr) {
          systemLogger.warn("Email queue unavailable, sending directly", {
            ...context,
            error: queueErr.message,
          });
        }
      }

      if (queued) {
        systemLogger.info("Email queued", context);
        return { ok: true, delivery: "queued" };
      }

      const transporter = buildMailTransporter();
      await transporter.sendMail(mailOptions);
      systemLogger.info("Email sent", context);
      return { ok: true, delivery: "sent" };
    }

    if (isProduction) {
      const result = { ok: false, reason: "not_configured" };
      reportEmailFailure(context, result);
      return result;
    }

    return sendViaEthereal(mailOptions);
  } catch (error) {
    const result = { ok: false, reason: "send_failed", error };
    reportEmailFailure(context, result);
    return result;
  }
};

module.exports = sendEmail;
