const { env } = require('../testrail/config/testrailEnv');
const { TestRailClient } = require('../testrail/client/testRailClient');
const { testRailConfig } = require('../testrail/config/testrailConfig');
const { MappingStore } = require('../testrail/mappingStore/mappingStore');
const { ResultPublisher } = require('../testrail/resultPublisher/resultPublisher');

class TestRailReporter {
  constructor() {
    this.resultsByAutomationId = new Map();
    this.mappingStore = new MappingStore(testRailConfig.mappingFile, testRailConfig.runContextFile);
  }

  onTestEnd(test, result) {
    const automationIds = this.extractAutomationIds(test.title);

    if (automationIds.length === 0) {
      return;
    }

    for (const automationId of automationIds) {
      this.resultsByAutomationId.set(automationId, { test, result, automationId });
    }
  }

  async onEnd() {
    if (!env.testRail.enabled) {
      return;
    }

    if (!this.hasRequiredConfig()) {
      console.warn('[TestRail] Integration enabled, but required config is missing. Skipping TestRail publish.');
      return;
    }

    const mapping = this.mappingStore.loadMapping();
    const runContext = this.mappingStore.loadRunContext();

    // Skipped tests did not execute. Do NOT post them (TestRail rejects status_id 3
    // "Untested" anyway) — leaving them unposted lets the trim below drop them so the
    // run shows only passed/failed, matching the api-ts behaviour.
    const executed = Array.from(this.resultsByAutomationId.values()).filter(
      ({ result }) => !this.isSkippedStatus(result.status)
    );
    const skippedCount = this.resultsByAutomationId.size - executed.length;
    if (skippedCount > 0) {
      console.log(`[TestRail] Excluding ${skippedCount} skipped test(s) — they will not appear in the run.`);
    }

    const results = executed
      .map(({ test, result, automationId }) => this.toTestRailResult(test, result, automationId, mapping[automationId]))
      .filter(Boolean);

    if (results.length === 0) {
      console.warn('[TestRail] No mapped, executed automation Case IDs found in test titles. Nothing to publish.');
      return;
    }

    if (!runContext.runId) {
      console.warn('[TestRail] No run context found. Run npm run testrail:create-run before publishing results.');
      return;
    }

    const client = new TestRailClient({
      url: env.testRail.url,
      username: env.testRail.username,
      password: env.testRail.password
    });

    try {
      const publisher = new ResultPublisher({ client, runId: runContext.runId });
      await publisher.publish(results);
      console.log(`[TestRail] Published ${results.length} result(s) to run ${runContext.runId}.`);

      // Cases that were in the run but never received a result linger as "Untested".
      // Trim the run to only cases that actually got a result. Opt out with
      // TESTRAIL_TRIM_UNTESTED=false.
      if (this.shouldTrimUntested()) {
        await this.trimRunToExecutedCases(client, runContext.runId, results);
      }
    } catch (error) {
      console.warn(`[TestRail] Failed to publish results: ${error.message}`);
    }
  }

  shouldTrimUntested() {
    const raw = String(process.env.TESTRAIL_TRIM_UNTESTED ?? 'true').trim().toLowerCase();
    return raw !== 'false' && raw !== '0' && raw !== 'no';
  }

  async trimRunToExecutedCases(client, runId, justPublished) {
    // TestRail status_id 3 == "Untested" (initial, no-result state).
    const UNTESTED = 3;
    // Always keep just-published cases; add any other case that already has a result.
    const keep = new Set(justPublished.map((row) => row.case_id));
    try {
      const tests = await client.getTests(runId);
      for (const test of tests) {
        if (test.status_id !== UNTESTED) {
          keep.add(test.case_id);
        }
      }
    } catch (error) {
      console.warn(`[TestRail] get_tests failed (${error.message}); trimming to just-published cases.`);
    }

    const uniqueCaseIds = [...keep].filter((id) => Number.isFinite(id));
    if (uniqueCaseIds.length === 0) {
      return;
    }

    try {
      await client.updateRun(runId, { include_all: false, case_ids: uniqueCaseIds });
      console.log(
        `[TestRail] Trimmed run ${runId} to ${uniqueCaseIds.length} executed case(s); Untested cases removed.`
      );
    } catch (error) {
      console.warn(`[TestRail] Could not trim Untested cases from run ${runId}: ${error.message}`);
    }
  }

  extractAutomationIds(title) {
    return title.match(/[A-Z]+-[A-Z]+-\d+/g) || [];
  }

  toTestRailResult(test, result, automationId, testRailCaseId) {
    if (!testRailCaseId) {
      console.warn(`[TestRail] No mapping found for automation Case ID ${automationId}. Skipping result.`);
      return null;
    }

    return {
      case_id: testRailCaseId,
      status_id: this.statusIdFor(result.status),
      comment: this.buildComment(test, result, automationId),
      elapsed: this.elapsedFor(result.duration)
    };
  }

  isSkippedStatus(status) {
    // Playwright never-executed outcomes. 'timedOut'/'interrupted' are real failures
    // and are intentionally NOT treated as skipped.
    return status === 'skipped' || status === 'pending';
  }

  statusIdFor(status) {
    // Skipped tests are filtered out before this is called, so only passed (1) and
    // failed (5) reach TestRail — the run shows only passed/failed.
    if (status === 'passed') {
      return 1;
    }

    return 5;
  }

  elapsedFor(durationMs) {
    return `${Math.max(1, Math.ceil(durationMs / 1000))}s`;
  }

  buildComment(test, result, automationId) {
    const title = test.titlePath().join(' > ');
    const stepLog = this.buildStepLog(result);
    const attachments = this.buildAttachmentLog(result);

    if (result.status === 'passed') {
      return [
        'Automated test passed.',
        '',
        `Automation Case ID: ${automationId}`,
        `Test: ${title}`,
        '',
        stepLog,
        attachments
      ]
        .filter(Boolean)
        .join('\n');
    }

    const errorMessage = result.error?.message || 'No error details available.';
    const failedStep = this.findFailedStep(result.steps);

    return [
      `Automated test ${result.status}.`,
      '',
      `Automation Case ID: ${automationId}`,
      `Test: ${title}`,
      failedStep ? `Failed Step: ${failedStep.title}` : '',
      '',
      stepLog,
      '',
      `Error:\n${errorMessage}`,
      attachments
    ]
      .filter(Boolean)
      .join('\n');
  }

  buildStepLog(result) {
    const testSteps = this.collectTestSteps(result.steps);

    if (testSteps.length === 0) {
      return 'Steps:\nNo named Playwright steps were captured for this test.';
    }

    const lines = ['Steps:'];
    testSteps.forEach((step, index) => {
      const status = step.error ? 'FAILED' : 'PASSED';
      lines.push(`Step ${index + 1}: ${status} - ${step.title}`);

      if (step.error?.message) {
        lines.push(`Failure: ${step.error.message}`);
      }
    });

    return lines.join('\n');
  }

  collectTestSteps(steps = []) {
    const testSteps = [];

    for (const step of steps) {
      if (step.category === 'test.step') {
        testSteps.push(step);
      }

      testSteps.push(...this.collectTestSteps(step.steps || []));
    }

    return testSteps;
  }

  findFailedStep(steps = []) {
    for (const step of steps) {
      if (step.category === 'test.step' && step.error) {
        return step;
      }

      const nestedFailedStep = this.findFailedStep(step.steps || []);
      if (nestedFailedStep) {
        return nestedFailedStep;
      }
    }

    return null;
  }

  buildAttachmentLog(result) {
    const attachments = result.attachments.filter((attachment) => attachment.path);

    if (attachments.length === 0) {
      return '';
    }

    return [
      '',
      'Failure Artifacts:',
      ...attachments.map((attachment) => `${attachment.name}: ${attachment.path}`)
    ].join('\n');
  }

  hasRequiredConfig() {
    return Boolean(
      env.testRail.url &&
        env.testRail.username &&
        env.testRail.password &&
        env.testRail.projectId
    );
  }
}

module.exports = TestRailReporter;
