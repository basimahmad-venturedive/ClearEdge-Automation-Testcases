const fs = require('fs');
const path = require('path');

const AUTOMATION_ID_PATTERN = /\b(WEB-[A-Z]+-\d+)\b/g;

/**
 * Collect automation Case IDs referenced in Playwright spec titles under tests/.
 */
function collectAutomatedCaseIds(testsDir) {
  const root = path.resolve(testsDir);
  const found = new Set();

  if (!fs.existsSync(root)) {
    return found;
  }

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.name.endsWith('.spec.js')) {
        continue;
      }
      const text = fs.readFileSync(fullPath, 'utf-8');
      for (const match of text.matchAll(AUTOMATION_ID_PATTERN)) {
        found.add(match[1]);
      }
    }
  };

  walk(root);
  return found;
}

/**
 * Map Case ID → first matching spec file + test title line (for TRACEABILITY).
 */
function collectAutomationPaths(testsDir) {
  const root = path.resolve(testsDir);
  const paths = new Map();

  if (!fs.existsSync(root)) {
    return paths;
  }

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.name.endsWith('.spec.js')) {
        continue;
      }
      const rel = path.relative(root, fullPath).split(path.sep).join('/');
      const lines = fs.readFileSync(fullPath, 'utf-8').split('\n');
      for (const line of lines) {
        const match = line.match(/test\(\s*['`]([^'"`]+)['`]/);
        if (!match) {
          continue;
        }
        const idMatch = match[1].match(AUTOMATION_ID_PATTERN);
        if (!idMatch) {
          continue;
        }
        const caseId = idMatch[0];
        if (!paths.has(caseId)) {
          paths.set(caseId, `automation/frontend/tests/${rel} :: ${match[1].trim()}`);
        }
      }
    }
  };

  walk(root);
  return paths;
}

function isTruthyAutomatedFlag(value) {
  const normalized = (value || '').trim().toLowerCase();
  return ['yes', 'true', '1', 'automated'].includes(normalized);
}

function isAutomatedCase(testCase, automatedIds) {
  if (isTruthyAutomatedFlag(testCase.automated)) {
    return true;
  }
  return automatedIds.has(testCase.caseId);
}

module.exports = {
  AUTOMATION_ID_PATTERN,
  collectAutomatedCaseIds,
  collectAutomationPaths,
  isAutomatedCase,
  isTruthyAutomatedFlag
};
