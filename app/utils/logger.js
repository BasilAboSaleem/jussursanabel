const ActivityLog = require('../models/ActivityLog');
const winston = require('winston');
require('winston-daily-rotate-file');

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const loggerLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'info');

const systemLogger = winston.createLogger({
  level: loggerLevel,
  format: logFormat,
  transports: [
    new winston.transports.DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '14d'
    }),
    new winston.transports.DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d'
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  systemLogger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

exports.systemLogger = systemLogger;

/**
 * Log a user action
 * @param {string} userId - ID of the user performing the action
 * @param {string} action - Action type enum
 * @param {string} targetType - Model being affected
 * @param {string} targetId - ID of the affected item
 * @param {string} details - Human readable description
 * @param {object} metadata - Optional extra data
 */
exports.logActivity = async (userId, action, targetType, targetId, details, metadata = {}) => {
    try {
        await ActivityLog.create({
            user: userId,
            action,
            targetType,
            targetId,
            details,
            metadata
        });
    } catch (err) {
        systemLogger.warn('Failed to log activity', { error: err.message });
    }
};
