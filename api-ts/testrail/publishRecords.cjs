const { trimmed, asBool, env: kitEnv } = require('../config/env.cjs');
const { TestRailClient } = require('./client/testRailClient.cjs');
const { MappingStore } = require('./mappingStore/mappingStore.cjs');
const { ResultPublisher } = require('./resultPublisher/resultPublisher.cjs');
const { testRailConfig } = require('./config/testrailConfig.cjs');

// ClearEdge TC-IDs only (e.g. TC-AUTH-001, TC-ADMAPI-050, TC-UAUTH-API-002,
// flattened data-set ids like TC-ADMAPI-013-4). Kept tight so epic ids like
// CEIQ-FEAT-001 in a title are not misread as case ids. Greedy: the longest id
// at a position wins, so TC-ADMAPI-013-4 is one id, not TC-ADMAPI-013 plus "-4".
const AUTOMATION_ID_PATTERN = /TC-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+(?:-\d+)?/g;
const TESTRAIL_STATUS_PASSED = 1;
const TESTRAIL_STATUS_FAILED = 5;
// NOTE: TestRail status_id 3 ("Untested") is the *initial* state of a case in a
// run and is rejected by add_results_for_cases. Skipped tests must therefore NOT
// be posted at all — they remain "Untested" in TestRail naturally, which is the
// correct semantics for "did not execute in this run".
const SKIPPED_STATUSES = new Set(['skipped', 'pending']);

function extractAutomationIds(title) {
  // TC-CEIQ-* are spec/testcase DOCUMENT references (e.g. "see TC-CEIQ-FEAT-003.md"
  // inside skip reasons), never automation case ids.
  return (title.match(AUTOMATION_ID_PATTERN) || []).filter((id) => !id.startsWith('TC-CEIQ-'));
}

function isSkippedStatus(status) {
  return SKIPPED_STATUSES.has(status);
}

function statusIdFor(status) {
  if (status === 'passed' || status === 'pass') {
    return TESTRAIL_STATUS_PASSED;
  }
  // Quota / 429: still an automation failure for the case — Failed, not Blocked.
  if (status === 'rate_limited') {
    return TESTRAIL_STATUS_FAILED;
  }
  return TESTRAIL_STATUS_FAILED;
}

function elapsedFor(durationMs) {
  return `${Math.max(1, Math.ceil(Number(durationMs) / 1000))}s`;
}

function buildComment(record, automationId) {
  const lines = [];

  if (record.status === 'passed' || record.status === 'pass') {
    lines.push('Automated test passed.');
  } else if (record.status === 'rate_limited') {
    lines.push(
      'Automated test failed: upstream rate/quota limit (e.g. HTTP 429). Fix API key / plan or wait for quota reset.'
    );
  } else {
    lines.push('Automated test failed.');
  }

  lines.push('');
  lines.push(`Automation Case ID: ${automationId}`);
  lines.push(`Test: ${record.fullTitle || record.title}`);

  if (record.filePath) {
    lines.push(`File: ${record.filePath}`);
  }

  if (record.errorMessage && record.status !== 'passed' && record.status !== 'pass') {
    lines.push('');
    lines.push('Error:');
    lines.push(record.errorMessage);
  }

  return lines.join('\n');
}

function toTestRailResult(record, automationId, testRailCaseId, options = {}) {
  if (!testRailCaseId) {
    // eslint-disable-next-line no-console
    console.warn(`[TestRail] No mapping found for automation Case ID ${automationId}. Skipping result.`);
    return null;
  }

  const result = {
    case_id: testRailCaseId,
    status_id: statusIdFor(record.status),
    comment: buildComment(record, automationId),
    elapsed: elapsedFor(record.duration)
  };

  // Project 107 ("Genetech - Ride Hailing App") requires `custom_executionername`
  // (a Result Field; dropdown option id) on every row sent to /add_results_for_cases.
  // Source: GET /api/v2/get_result_fields → field 38 system_name=custom_executionername.
  if (options.customExecutionernameId !== undefined) {
    result.custom_executionername = options.customExecutionernameId;
  }

  return result;
}

function hasRequiredTestRailConfig() {
  return Boolean(
    trimmed('TESTRAIL_URL') &&
      trimmed('TESTRAIL_USERNAME') &&
      trimmed('TESTRAIL_PASSWORD') &&
      trimmed('TESTRAIL_PROJECT_ID')
  );
}

/**
 * @param {Array<{ fullTitle?: string, title?: string, status: string, duration?: number, errorMessage?: string, filePath?: string }>} records
 * @returns {Promise<{ published: number, runId?: number, skippedReason?: string }>}
 */
async function publishRecordsToTestRail(records) {
  if (!hasRequiredTestRailConfig()) {
    return { published: 0, skippedReason: 'missing TestRail URL/credentials/project id' };
  }

  if (!Array.isArray(records) || records.length === 0) {
    return { published: 0, skippedReason: 'no test result rows to publish' };
  }

  const executedRecords = records.filter((record) => !isSkippedStatus(record.status));
  const skippedCount = records.length - executedRecords.length;
  if (skippedCount > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[TestRail] Filtered ${skippedCount} skipped record(s) — TestRail rejects status_id 3 (Untested); ` +
        'those cases will remain Untested in the run, which is the correct state for "did not execute".'
    );
  }

  if (executedRecords.length === 0) {
    return { published: 0, skippedReason: 'all records were skipped — nothing to post (cases stay Untested)' };
  }

  const mappingStore = new MappingStore(testRailConfig.mappingFile, testRailConfig.runContextFile);
  const mapping = mappingStore.loadMapping();
  const runContext = mappingStore.loadRunContext();
  const resultsByCaseId = new Map();

  const resultOptions = {
    customExecutionernameId: kitEnv.testRail.customExecutionernameId
  };

  for (const record of executedRecords) {
    const automationIds = extractAutomationIds(record.fullTitle || record.title || '');
    for (const automationId of automationIds) {
      const result = toTestRailResult(record, automationId, mapping[automationId], resultOptions);
      if (result) {
        resultsByCaseId.set(automationId, result);
      }
    }
  }

  if (resultsByCaseId.size === 0) {
    return {
      published: 0,
      skippedReason: 'no mapped TC-* ids in titles (check JUnit names vs caseMapping.json)'
    };
  }

  if (!runContext.runId) {
    return { published: 0, skippedReason: 'no run id in runContext.json' };
  }

  const client = new TestRailClient({
    url: trimmed('TESTRAIL_URL'),
    username: trimmed('TESTRAIL_USERNAME'),
    password: trimmed('TESTRAIL_PASSWORD')
  });

  const publisher = new ResultPublisher({ client, runId: runContext.runId });
  const payload = [...resultsByCaseId.values()];
  const apiResponse = await publisher.publish(payload);
  assertTestRailAddResultsOk(apiResponse);

  await markCasesAutomated(client, resultsByCaseId, mapping, kitEnv.testRail.customAutomatedYes);

  // Results are posted only for cases that actually executed (passed/failed);
  // skipped cases are never posted and would otherwise linger as "Untested" in
  // the run. Trim the run down to exactly the executed cases so the run reflects
  // only passed + failed. Runs after publish (add_results_for_cases requires the
  // case to still be in the run); removing an untested case removes only its
  // empty test row, never a posted result. Opt out with TESTRAIL_TRIM_UNTESTED=false.
  if (asBool(process.env.TESTRAIL_TRIM_UNTESTED, true)) {
    await trimRunToExecutedCases(client, runContext.runId, payload);
  }

  return { published: resultsByCaseId.size, runId: runContext.runId };
}

// TestRail status_id 3 == "Untested" (the initial, no-result state of a case in a run).
const TESTRAIL_STATUS_UNTESTED = 3;

/**
 * Trim a run so it contains only cases that have a result (passed/failed/etc.),
 * dropping every "Untested" case. Keys off the run's OWN state via get_tests, so
 * it never deletes a previously-posted result even if the run is published to in
 * multiple batches — it only removes case rows that truly never executed.
 */
async function trimRunToExecutedCases(client, runId, justPublishedPayload) {
  // Always keep the cases we just posted; add any other case that already carries a
  // result from an earlier batch. This never drops a just-published pass/fail even if
  // get_tests is truncated or fails.
  const keep = new Set(justPublishedPayload.map((row) => row.case_id));
  try {
    const tests = await client.getTests(runId);
    for (const test of tests) {
      if (test.status_id !== TESTRAIL_STATUS_UNTESTED) {
        keep.add(test.case_id);
      }
    }
  } catch (error) {
    // Non-fatal: fall back to just the cases we posted (correct for the common
    // single-publish-per-run flow).
    // eslint-disable-next-line no-console
    console.warn(`[TestRail] get_tests failed (${error.message}); trimming to just-published cases.`);
  }

  const uniqueCaseIds = [...keep].filter((id) => Number.isFinite(id));
  if (uniqueCaseIds.length === 0) {
    return;
  }

  try {
    await client.updateRun(runId, { include_all: false, case_ids: uniqueCaseIds });
    // eslint-disable-next-line no-console
    console.log(
      `[TestRail] Trimmed run ${runId} to ${uniqueCaseIds.length} executed case(s); Untested cases removed.`
    );
  } catch (error) {
    // Non-fatal: results are already posted. The run just keeps its Untested rows.
    // eslint-disable-next-line no-console
    console.warn(`[TestRail] Could not trim Untested cases from run ${runId}: ${error.message}`);
  }
}

async function markCasesAutomated(client, resultsByCaseId, mapping, customAutomatedYes) {
  if (customAutomatedYes === undefined) {
    return;
  }

  let updated = 0;
  for (const automationId of resultsByCaseId.keys()) {
    const testRailCaseId = mapping[automationId];
    if (!testRailCaseId) {
      continue;
    }

    await client.updateCase(testRailCaseId, { custom_automated: customAutomatedYes });
    updated += 1;
  }

  if (updated > 0) {
    // eslint-disable-next-line no-console
    console.log(`[TestRail] Set custom_automated=Yes on ${updated} executed case(s).`);
  }
}

function assertTestRailAddResultsOk(data) {
  if (data == null) {
    return;
  }

  const rows = Array.isArray(data) ? data : data.results;
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  const rejected = rows.filter((row) => row && typeof row.error === 'string' && row.error.length > 0);
  if (rejected.length > 0) {
    const sample = rejected
      .slice(0, 3)
      .map((row) => `${row.case_id ?? '?'}: ${row.error}`)
      .join('; ');
    throw new Error(
      `TestRail add_results_for_cases rejected ${rejected.length}/${rows.length} row(s). Examples: ${sample}`
    );
  }
}

function shouldPublishFromEnv() {
  return asBool(process.env.TESTRAIL_INTEGRATION) || asBool(process.env.VITEST_TESTRAIL_PUBLISH);
}

module.exports = {
  AUTOMATION_ID_PATTERN,
  buildComment,
  extractAutomationIds,
  hasRequiredTestRailConfig,
  isSkippedStatus,
  publishRecordsToTestRail,
  shouldPublishFromEnv,
  statusIdFor,
  toTestRailResult
};
