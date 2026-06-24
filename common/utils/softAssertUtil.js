import logger from '../logger/logger.js';

/**
 * Soft assertion utility — collects failures and reports at end.
 */
export class SoftAssert {
  constructor() {
    this.failures = [];
  }

  assert(condition, message) {
    if (!condition) {
      this.failures.push(message);
      logger.warn(`SOFT ASSERT FAILED: ${message}`);
    }
  }

  assertEqual(actual, expected, message) {
    if (actual !== expected) {
      this.failures.push(`${message} — expected: ${expected}, actual: ${actual}`);
      logger.warn(`SOFT ASSERT FAILED: ${message}`);
    }
  }

  assertTruthy(value, message) {
    this.assert(!!value, message);
  }

  report() {
    if (this.failures.length > 0) {
      throw new Error(`Soft assertion failures (${this.failures.length}):\n${this.failures.join('\n')}`);
    }
  }

  reset() {
    this.failures = [];
  }
}
