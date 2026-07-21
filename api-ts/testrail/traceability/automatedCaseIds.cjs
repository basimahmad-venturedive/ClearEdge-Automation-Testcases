const fs = require('node:fs');
const path = require('node:path');

const AUTOMATION_PATH_PATTERN = /automation\/api-ts\//;
// Must stay in sync with AUTOMATION_ID_PATTERN in testrail/publishRecords.cjs.
const TC_ID_IN_TEST_PATTERN = /TC-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+(?:-\d+)?/g;
// Only lines that declare a test carry real case ids — file headers / TODO comments
// reference related-but-not-automated ids (e.g. fault-injection cases) and must not
// be treated as automated.
// Must list EVERY test-declaring wrapper used in tests/ (see testrail-create-run.cjs):
// liveOnly/dbOnly/localOnly are our env-gating wrappers, else the run and the published
// results disagree on which cases exist.
const TEST_DECLARATION_PATTERN = /\b(?:test|liveTest|liveOnly|dbOnly|localOnly|it)(?:\.\w+)*\s*(?:\([^)]*\))?\s*\(/;

/**
 * Parse testcases/TRACEABILITY.md and return TC-IDs with a real backend automation path.
 * @param {string} traceabilityPath absolute path to TRACEABILITY.md
 * @returns {Set<string>}
 */
function loadAutomatedCaseIdsFromTraceability(traceabilityPath) {
  const automated = new Set();

  if (!fs.existsSync(traceabilityPath)) {
    return automated;
  }

  const lines = fs.readFileSync(traceabilityPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim().startsWith('| TC-')) {
      continue;
    }

    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);

    if (cells.length < 4) {
      continue;
    }

    const [tcId, , , automationPath] = cells;
    const normalisedPath = (automationPath || '').toLowerCase();
    if (
      normalisedPath &&
      normalisedPath !== 'tbd' &&
      !normalisedPath.includes('backlog') &&
      AUTOMATION_PATH_PATTERN.test(automationPath)
    ) {
      automated.add(tcId);
    }
  }

  return automated;
}

/**
 * Collect TC-IDs referenced in Vitest files under tests/ (automated by definition).
 * @param {string} layerRoot automation/api-ts absolute path
 * @returns {Set<string>}
 */
function loadAutomatedCaseIdsFromTestSuites(layerRoot) {
  const automated = new Set();
  const testsDir = path.join(layerRoot, 'tests');

  if (!fs.existsSync(testsDir)) {
    return automated;
  }

  walkTestFiles(testsDir, (filePath) => {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!TEST_DECLARATION_PATTERN.test(line)) {
        continue;
      }
      for (const id of line.match(TC_ID_IN_TEST_PATTERN) || []) {
        // TC-CEIQ-* are spec-document references inside skip reasons, not case ids.
        if (!id.startsWith('TC-CEIQ-')) {
          automated.add(id);
        }
      }
    }
  });

  return automated;
}

function walkTestFiles(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTestFiles(fullPath, onFile);
    } else if (entry.isFile() && /\.test\.(js|ts)$/.test(entry.name)) {
      onFile(fullPath);
    }
  }
}

/**
 * Union of TRACEABILITY.md paths and test-suites/ TC-IDs.
 * @param {string} traceabilityPath
 * @param {string} layerRoot
 * @returns {Set<string>}
 */
function loadAutomatedCaseIds(traceabilityPath, layerRoot) {
  const automated = loadAutomatedCaseIdsFromTraceability(traceabilityPath);
  for (const id of loadAutomatedCaseIdsFromTestSuites(layerRoot)) {
    automated.add(id);
  }
  return automated;
}

function defaultTraceabilityPath(layerRoot) {
  return path.resolve(layerRoot, '..', '..', 'testcases', 'TRACEABILITY.md');
}

module.exports = {
  loadAutomatedCaseIds,
  loadAutomatedCaseIdsFromTraceability,
  loadAutomatedCaseIdsFromTestSuites,
  defaultTraceabilityPath
};
