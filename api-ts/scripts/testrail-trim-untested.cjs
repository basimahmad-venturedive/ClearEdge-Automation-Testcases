// Standalone "no Untested rows left behind" pass.
//
// The reporter already trims right after it publishes, but that happens inside the
// Vitest process — if the runner dies, is killed by CI, or TestRail hiccups at that
// exact moment, the run keeps its Untested rows (that is how the 2026-08-10 nightly
// ended up 255 passed / 1 failed / 88 Untested). Run this as a CI post-step, after
// the test command and regardless of its exit code, and the run is always trimmed.
//
// Usage:
//   node scripts/testrail-trim-untested.cjs                 # run id from runContext.json
//   node scripts/testrail-trim-untested.cjs --run-id=12345   # explicit run
//   TESTRAIL_RUN_ID=12345 node scripts/testrail-trim-untested.cjs
//   node scripts/testrail-trim-untested.cjs --strict         # non-zero exit on failure
//
// Exits 0 by default (best-effort: never fail a build over report cosmetics).

const { asBool, trimmed } = require('../config/env.cjs');
const { TestRailClient } = require('../testrail/client/testRailClient.cjs');
const { testRailConfig } = require('../testrail/config/testrailConfig.cjs');
const { MappingStore } = require('../testrail/mappingStore/mappingStore.cjs');
const { trimUntestedFromRun } = require('../testrail/runTrimmer/untestedTrimmer.cjs');

const strict = process.argv.includes('--strict');

function resolveRunId() {
  const fromArg = process.argv.find((arg) => arg.startsWith('--run-id='));
  if (fromArg) {
    return Number(fromArg.split('=')[1]);
  }

  const fromEnv = trimmed('TESTRAIL_RUN_ID');
  if (fromEnv) {
    return Number(fromEnv);
  }

  const mappingStore = new MappingStore(testRailConfig.mappingFile, testRailConfig.runContextFile);
  const runContext = mappingStore.loadRunContext();
  return Number(runContext.runId);
}

function hasCredentials() {
  return Boolean(
    trimmed('TESTRAIL_URL') && trimmed('TESTRAIL_USERNAME') && trimmed('TESTRAIL_PASSWORD')
  );
}

async function main() {
  if (!asBool(process.env.TESTRAIL_TRIM_UNTESTED, true)) {
    console.log('[TestRail] TESTRAIL_TRIM_UNTESTED is off — nothing to do.');
    return;
  }

  if (!hasCredentials()) {
    console.log('[TestRail] No TestRail URL/credentials — trim skipped.');
    return;
  }

  const runId = resolveRunId();
  if (!Number.isFinite(runId) || runId <= 0) {
    console.log('[TestRail] No run id (runContext.json / --run-id / TESTRAIL_RUN_ID) — trim skipped.');
    return;
  }

  const client = new TestRailClient({
    url: trimmed('TESTRAIL_URL'),
    username: trimmed('TESTRAIL_USERNAME'),
    password: trimmed('TESTRAIL_PASSWORD')
  });

  const outcome = await trimUntestedFromRun(client, runId);

  if (strict && (outcome.status === 'failed' || outcome.status === 'partial')) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.warn(`[TestRail] Untested trim failed: ${error.message}`);
  if (strict) {
    process.exit(1);
  }
});
