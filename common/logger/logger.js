import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { LOG_LEVELS } from '../constants/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logsDir = path.resolve(__dirname, '../../logs');

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(logsDir, `execution-${timestamp}.log`);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || LOG_LEVELS.INFO,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp: ts, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `[${ts}] [${level.toUpperCase()}] ${message}${metaStr}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp: ts, level, message }) => `[${ts}] ${level}: ${message}`)
      ),
    }),
    new winston.transports.File({ filename: logFile }),
    new winston.transports.File({ filename: path.join(logsDir, 'error.log'), level: 'error' }),
  ],
});

export const logStep = (step) => logger.info(`STEP: ${step}`);
export const logApiRequest = (method, url, body) =>
  logger.debug(`API REQUEST: ${method} ${url}`, { body });
export const logApiResponse = (status, url, body) =>
  logger.debug(`API RESPONSE: ${status} ${url}`, { body });
export const logBrowserConsole = (type, text) =>
  logger.debug(`BROWSER CONSOLE [${type}]: ${text}`);
export const logNetwork = (method, url, status) =>
  logger.debug(`NETWORK: ${method} ${url} -> ${status}`);
export const logPerformance = (metric, value) =>
  logger.info(`PERFORMANCE: ${metric} = ${value}ms`);

export default logger;
