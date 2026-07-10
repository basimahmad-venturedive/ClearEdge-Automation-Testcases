const { asBool } = require('../config/env.cjs');
const { collectRecordsFromTestModules, pickTestModulesArg, toRecord } = require('./reporterUtils.cjs');
const {
  publishRecordsToTestRail,
  shouldPublishFromEnv
} = require('../testrail/publishRecords.cjs');

class TestRailReporter {
  constructor() {
    this.records = [];
  }

  onInit() {
    this.records = [];
  }

  onTestCaseResult(testCase) {
    if (!testCase) {
      return;
    }
    this.records.push(toRecord(testCase));
  }

  async onTestRunEnd(...args) {
    const testModules = pickTestModulesArg(args);

    if (!shouldPublishFromEnv()) {
      return;
    }

    // `npm run testrail:execute` sets this; JUnit fallback runs after Vitest exits.
    if (asBool(process.env.VITEST_TESTRAIL_PUBLISH)) {
      return;
    }

    const fromModules = collectRecordsFromTestModules(testModules);
    const records = fromModules.length > 0 ? fromModules : this.records;

    if (records.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        '[TestRail] No test results on this reporter instance (Vitest worker pool). Results will still be published when using npm run testrail:execute (JUnit fallback).'
      );
      return;
    }

    try {
      const outcome = await publishRecordsToTestRail(records);
      if (outcome.published > 0) {
        // eslint-disable-next-line no-console
        console.log(`[TestRail] Published ${outcome.published} result(s) to run ${outcome.runId}.`);
      } else if (outcome.skippedReason) {
        // eslint-disable-next-line no-console
        console.warn(`[TestRail] Skipped publish: ${outcome.skippedReason}`);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[TestRail] Failed to publish results: ${error.message}`);
    }
  }
}

module.exports = TestRailReporter;
module.exports.default = TestRailReporter;
