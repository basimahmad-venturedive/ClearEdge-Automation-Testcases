import logger from '../logger/logger.js';

/**
 * Retry utility for flaky operations.
 */
export const retry = async (fn, options = {}) => {
  const { maxAttempts = 3, delayMs = 1000, label = 'operation' } = options;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      logger.warn(`Retry ${attempt}/${maxAttempts} failed for ${label}: ${error.message}`);
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
};
