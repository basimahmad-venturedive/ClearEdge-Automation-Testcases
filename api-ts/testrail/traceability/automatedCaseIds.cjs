const fs = require('node:fs');
const path = require('node:path');

const AUTOMATION_PATH_PATTERN = /automation\/api-ts\//;
const TC_ID_IN_TEST_PATTERN = /TC-[A-Z0-9]+-\d+[a-z]?(?:-\d+)?/g;

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
    const contents = fs.readFileSync(filePath, 'utf8');
    const matches = contents.match(TC_ID_IN_TEST_PATTERN);
    if (matches) {
      for (const id of matches) {
        automated.add(id);
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
