const { Queue, Worker } = require("bullmq");
const { redisClient, redisEnabled } = require("./redis");
const { systemLogger } = require("./logger");
const { buildMailTransporter, isEmailConfigured } = require("./emailConfig");

let emailQueue = null;
let emailWorker = null;
let queueStarted = false;

function startQueueWorkers() {
  if (queueStarted) return;
  if (!redisEnabled || !redisClient) {
    systemLogger.info("Queue workers skipped (Redis disabled)");
    return;
  }

  if (!isEmailConfigured()) {
    systemLogger.warn("Email queue worker not started (SMTP not configured)");
    return;
  }

  const connection = redisClient.duplicate();

  const queueDefaults = {
    attempts: Number(process.env.EMAIL_QUEUE_ATTEMPTS || 3),
    backoff: {
      type: "exponential",
      delay: Number(process.env.EMAIL_QUEUE_BACKOFF_MS || 2000),
    },
    removeOnComplete: Number(process.env.EMAIL_QUEUE_KEEP_COMPLETE || 1000),
    removeOnFail: Number(process.env.EMAIL_QUEUE_KEEP_FAILED || 2000),
  };

  emailQueue = new Queue("emails", {
    connection,
    defaultJobOptions: queueDefaults,
  });
  emailWorker = new Worker(
    "emails",
    async (job) => {
      const transporter = buildMailTransporter();
      if (!transporter) {
        throw new Error("SMTP not configured");
      }
      await transporter.sendMail(job.data);
    },
    {
      connection,
      concurrency: Number(process.env.EMAIL_WORKER_CONCURRENCY || 5),
    }
  );

  emailWorker.on("failed", (job, err) => {
    systemLogger.error("Email job failed", { jobId: job && job.id, error: err.message });
  });
  emailWorker.on("error", (err) => {
    systemLogger.error("Email worker error", { error: err.message });
  });

  queueStarted = true;
  systemLogger.info("Queue workers started");
}

async function enqueueEmail(mailOptions) {
  if (!emailQueue || !isEmailConfigured()) return false;
  await emailQueue.add("send", mailOptions, {
    jobId: `email:${Date.now()}:${mailOptions.to}`,
  });
  return true;
}

module.exports = {
  startQueueWorkers,
  enqueueEmail,
};
