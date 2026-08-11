// Single source of truth for "a TestRail run must only contain cases that actually
// executed". Skipped/never-run cases can't be posted (TestRail rejects status_id 3,
// "Untested"), so they linger as Untested rows unless the run is trimmed.
//
// Used from two places so a trim happens even if one of them dies:
//   1. publishRecords.cjs — immediately after results are posted (in-process).
//   2. scripts/testrail-trim-untested.cjs — a standalone CI post-step that runs
//      regardless of the test-runner exit code.
// Both are idempotent: a second call on an already-trimmed run is a no-op.

const TESTRAIL_STATUS_UNTESTED = 3;

function toFiniteCaseIds(values) {
  return [...new Set(values)].filter((id) => Number.isFinite(id));
}

async function fetchTestsWithRetry(client, runId, attempts, log) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await client.getTests(runId);
    } catch (error) {
      lastError = error;
      log(`[TestRail] get_tests attempt ${attempt}/${attempts} failed: ${error.message}`);
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  throw lastError;
}

/**
 * Remove every Untested case from a run, keeping only cases that carry a result.
 *
 * Safety rules:
 * - Never empties a run: if nothing is known to have executed, it aborts untouched.
 * - Never drops a posted result: `alwaysKeepCaseIds` (the batch just published) is
 *   always kept, and every case whose test row already has a status is kept too.
 * - Retries update_run, then re-reads the run to confirm the Untested rows are gone.
 *
 * @returns {Promise<{ status: string, kept: number, removed: number, remainingUntested: number|null, error?: string }>}
 */
async function trimUntestedFromRun(client, runId, options = {}) {
  const {
    alwaysKeepCaseIds = [],
    attempts = 3,
    logger = console
  } = options;
  const log = (message) => logger.log(message);
  const warn = (message) => (logger.warn ? logger.warn(message) : logger.log(message));

  if (!runId) {
    return { status: 'skipped', kept: 0, removed: 0, remainingUntested: null, error: 'no run id' };
  }

  const keep = new Set(toFiniteCaseIds(alwaysKeepCaseIds));
  let untestedCount = null;

  let tests = null;
  try {
    tests = await fetchTestsWithRetry(client, runId, attempts, warn);
  } catch (error) {
    // Fall back to the just-published batch: correct for the normal
    // publish-once-per-run flow, and still strictly better than leaving the run full.
    warn(`[TestRail] get_tests unavailable (${error.message}); trimming to just-published cases only.`);
  }

  if (Array.isArray(tests)) {
    untestedCount = 0;
    for (const test of tests) {
      if (test.status_id === TESTRAIL_STATUS_UNTESTED) {
        untestedCount += 1;
      } else {
        keep.add(test.case_id);
      }
    }

    if (untestedCount === 0) {
      log(`[TestRail] Run ${runId} has no Untested cases — nothing to trim.`);
      return { status: 'noop', kept: keep.size, removed: 0, remainingUntested: 0 };
    }
  }

  const caseIds = toFiniteCaseIds([...keep]);
  if (caseIds.length === 0) {
    // Trimming to an empty case list would wipe the run. Nothing executed (or the
    // publish never landed) — leave the run exactly as it is and say so loudly.
    warn(
      `[TestRail] Refusing to trim run ${runId}: no executed case found, trimming would empty the run.`
    );
    return {
      status: 'aborted',
      kept: 0,
      removed: 0,
      remainingUntested: untestedCount,
      error: 'no executed cases'
    };
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await client.updateRun(runId, { include_all: false, case_ids: caseIds });
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      warn(`[TestRail] update_run attempt ${attempt}/${attempts} failed: ${error.message}`);
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  if (lastError) {
    warn(
      `[TestRail] Could not trim Untested cases from run ${runId} after ${attempts} attempt(s): ${lastError.message}`
    );
    return {
      status: 'failed',
      kept: caseIds.length,
      removed: 0,
      remainingUntested: untestedCount,
      error: lastError.message
    };
  }

  // Verify rather than assume — a silent partial update would otherwise look like success.
  let remainingUntested = null;
  try {
    const after = await client.getTests(runId);
    remainingUntested = after.filter((test) => test.status_id === TESTRAIL_STATUS_UNTESTED).length;
  } catch (error) {
    warn(`[TestRail] Post-trim verification skipped (${error.message}).`);
  }

  const removed = untestedCount === null ? null : untestedCount - (remainingUntested || 0);
  log(
    `[TestRail] Trimmed run ${runId} to ${caseIds.length} executed case(s)` +
      (removed === null ? '' : `; removed ${removed} Untested case(s)`) +
      (remainingUntested === null ? '.' : `; ${remainingUntested} Untested remaining.`)
  );

  if (remainingUntested) {
    warn(
      `[TestRail] Run ${runId} still reports ${remainingUntested} Untested case(s) after trim — check the API user's "Add/Edit Test Runs" permission.`
    );
  }

  return {
    status: remainingUntested ? 'partial' : 'trimmed',
    kept: caseIds.length,
    removed: removed === null ? 0 : removed,
    remainingUntested
  };
}

module.exports = { TESTRAIL_STATUS_UNTESTED, trimUntestedFromRun };
