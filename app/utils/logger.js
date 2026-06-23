const fs = require('fs');
const path = require('path');
const ActivityLog = require('../models/ActivityLog');
const winston = require('winston');
require('winston-daily-rotate-file');

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const loggerLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'info');
const logRetentionDays = process.env.LOG_RETENTION_DAYS || '14d';
const logMaxSize = process.env.LOG_MAX_SIZE || '20m';

const rotateDefaults = {
  datePattern: 'YYYY-MM-DD',
  maxFiles: logRetentionDays,
  maxSize: logMaxSize,
  zippedArchive: process.env.LOG_ZIP_ARCHIVE !== 'false',
};

const systemLogger = winston.createLogger({
  level: loggerLevel,
  format: logFormat,
  transports: [
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, 'error-%DATE%.log'),
      level: 'error',
      ...rotateDefaults,
    }),
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, 'combined-%DATE%.log'),
      ...rotateDefaults,
    }),
  ],
});

if (process.env.NODE_ENV !== 'production' || process.env.LOG_CONSOLE === 'true') {
  systemLogger.add(
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    })
  );
}

function getLogConfiguration() {
  return {
    level: loggerLevel,
    retention: logRetentionDays,
    maxSize: logMaxSize,
    zippedArchive: process.env.LOG_ZIP_ARCHIVE !== 'false',
    directory: logsDir,
    transports: systemLogger.transports.length,
  };
}

function verifyLogConfiguration() {
  const config = getLogConfiguration();
  systemLogger.info('Log rotation configured', config);
  return config;
}

exports.systemLogger = systemLogger;
exports.getLogConfiguration = getLogConfiguration;
exports.verifyLogConfiguration = verifyLogConfiguration;

exports.logActivity = async (userId, action, targetType, targetId, details, metadata = {}) => {
  try {
    await ActivityLog.create({
      user: userId,
      action,
      targetType,
      targetId,
      details,
      metadata,
    });
  } catch (err) {
    systemLogger.warn('Failed to log activity', { error: err.message });
  }
};
