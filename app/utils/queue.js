const { Queue, Worker } = require('bullmq');
const crypto = require('crypto');
const { redisClient, redisEnabled, connectRedisIfNeeded } = require('./redis');
const { systemLogger } = require('./logger');
const { buildMailTransporter, isEmailConfigured } = require('./emailConfig');

let emailQueue = null;
let emailWorker = null;
let queueStarted = false;
let recentFailureCount = 0;
let lastFailureAt = null;
let lastSuccessAt = null;

function createQueueConnection() {
  return redisClient.duplicate({ maxRetriesPerRequest: null });
}

function startQueueWorkers() {
  if (queueStarted) return { started: false, reason: 'already_started' };
  if (!redisEnabled || !redisClient) {
    systemLogger.info('Queue workers skipped (Redis disabled)');
    return { started: false, reason: 'redis_disabled' };
  }

  if (!isEmailConfigured()) {
    systemLogger.warn('Email queue worker not started (SMTP not configured)');
    return { started: false, reason: 'smtp_not_configured' };
  }

  const connection = createQueueConnection();
  const workerConnection = createQueueConnection();

  const queueDefaults = {
    attempts: Number(process.env.EMAIL_QUEUE_ATTEMPTS || 3),
    backoff: {
      type: 'exponential',
      delay: Number(process.env.EMAIL_QUEUE_BACKOFF_MS || 2000),
    },
    removeOnComplete: Number(process.env.EMAIL_QUEUE_KEEP_COMPLETE || 1000),
    removeOnFail: Number(process.env.EMAIL_QUEUE_KEEP_FAILED || 2000),
  };

  emailQueue = new Queue('emails', {
    connection,
    defaultJobOptions: queueDefaults,
  });

  emailWorker = new Worker(
    'emails',
    async (job) => {
      const transporter = buildMailTransporter();
      if (!transporter) {
        throw new Error('SMTP not configured');
      }
      await transporter.sendMail(job.data);
      lastSuccessAt = new Date().toISOString();
    },
    {
      connection: workerConnection,
      concurrency: Number(process.env.EMAIL_WORKER_CONCURRENCY || 5),
    }
  );

  emailWorker.on('completed', () => {
    if (recentFailureCount > 0) recentFailureCount = Math.max(0, recentFailureCount - 1);
  });

  emailWorker.on('failed', (job, err) => {
    recentFailureCount += 1;
    lastFailureAt = new Date().toISOString();
    systemLogger.error('Email job failed', {
      jobId: job && job.id,
      attemptsMade: job && job.attemptsMade,
      error: err.message,
    });
  });

  emailWorker.on('error', (err) => {
    systemLogger.error('Email worker error', { error: err.message });
  });

  queueStarted = true;
  systemLogger.info('Queue workers started', {
    concurrency: Number(process.env.EMAIL_WORKER_CONCURRENCY || 5),
    attempts: queueDefaults.attempts,
  });

  return { started: true };
}

async function enqueueEmail(mailOptions) {
  if (!emailQueue || !isEmailConfigured()) return false;

  const recipient = mailOptions.to || mailOptions.email || 'unknown';
  const jobId = `email:${Date.now()}:${crypto.randomBytes(4).toString('hex')}:${recipient}`;

  await emailQueue.add('send', mailOptions, { jobId });
  return true;
}

async function getQueueHealth() {
  if (!queueStarted || !emailQueue) {
    return {
      running: false,
      reason: !redisEnabled ? 'redis_disabled' : 'not_started',
      smtpConfigured: isEmailConfigured(),
    };
  }

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    emailQueue.getWaitingCount(),
    emailQueue.getActiveCount(),
    emailQueue.getCompletedCount(),
    emailQueue.getFailedCount(),
    emailQueue.getDelayedCount(),
  ]);

  const failureThreshold = Number(process.env.EMAIL_QUEUE_FAILURE_ALERT_THRESHOLD || 10);
  const unhealthy = recentFailureCount >= failureThreshold;

  return {
    running: true,
    smtpConfigured: true,
    waiting,
    active,
    completed,
    failed,
    delayed,
    recentFailureCount,
    unhealthy,
    lastFailureAt,
    lastSuccessAt,
  };
}

async function stopQueueWorkers() {
  if (!queueStarted) return;

  const tasks = [];
  if (emailWorker) tasks.push(emailWorker.close());
  if (emailQueue) tasks.push(emailQueue.close());
  await Promise.all(tasks);

  emailWorker = null;
  emailQueue = null;
  queueStarted = false;
  systemLogger.info('Queue workers stopped');
}

module.exports = {
  startQueueWorkers,
  enqueueEmail,
  getQueueHealth,
  stopQueueWorkers,
  isQueueStarted: () => queueStarted,
};
