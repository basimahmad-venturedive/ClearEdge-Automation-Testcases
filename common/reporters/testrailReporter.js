import { createTestRun } from '../testrail/testrailClient.js';
import logger from '../logger/logger.js';

let testRailClient = null;
const finalResults = new Map();

class TestRailReporter {
  async onBegin() {
    testRailClient = await createTestRun('Login');
  }

  onTestEnd(test, result) {
    if (!testRailClient?.enabled) return;

    const caseId = test.annotations.find((a) => a.type === 'testrail')?.description;
    if (!caseId) return;

    const attempt = (finalResults.get(caseId)?.attempt || 0) + 1;
    finalResults.set(caseId, {
      status: result.status,
      attempt,
      error: result.error?.message || '',
      duration: result.duration,
    });
  }

  async onEnd() {
    if (!testRailClient?.enabled) return;

    for (const [caseId, data] of finalResults.entries()) {
      const status = testRailClient.mapStatus(data.status);
      const comment = [
        `Duration: ${data.duration}ms`,
        `Attempts: ${data.attempt}`,
        data.error ? `Error: ${data.error}` : '',
      ].filter(Boolean).join('\n');

      try {
        await testRailClient.addResult(caseId, status, comment);
      } catch (error) {
        logger.error(`Failed to update TestRail for ${caseId}: ${error.message}`);
      }
    }

    logger.info('TestRail sync completed');
  }
}

export default TestRailReporter;
