const fs = require('fs');
const path = require('path');

const TRACEABILITY_HEADER = `# Traceability — TC-ID ↔ Spec ↔ Automation

Frontend OrangeHRM baseline. Updated automatically after \`npm run testrail:import\`.
Manual edits outside the table are preserved above/below the marker block.

`;

const TABLE_HEADER =
  '| TC-ID | Spec reference | Module / Layer | Automation path | Automated | TestRail case | ToBeAutomated |\n' +
  '|---|---|---|---|---|---|---|\n';

const MARKER_START = '<!-- TRACEABILITY_TABLE_START -->';
const MARKER_END = '<!-- TRACEABILITY_TABLE_END -->';

function defaultTraceabilityPath(frontendRoot) {
  return path.resolve(frontendRoot, '../../testcases/TRACEABILITY.md');
}

function buildRow(testCase, { mapping, automationPaths, automatedIds }) {
  const caseId = testCase.caseId;
  const automated = automatedIds.has(caseId) ? 'Yes' : 'No';
  const testRailCaseId = mapping[caseId] ? String(mapping[caseId]) : 'TBD';
  const automationPath = automationPaths.get(caseId) || 'TBD';
  const specRef = '`automation/frontend/testcases.md`';
  const moduleLayer = `${testCase.module} / Web UI`;
  const toBeAutomated =
    automated === 'Yes' ? 'Yes (Playwright — automated)' : 'Yes (Playwright)';

  return `| \`${caseId}\` | ${specRef} §${caseId} | ${moduleLayer} | \`${automationPath}\` | ${automated} | ${testRailCaseId} | ${toBeAutomated} |`;
}

function syncTraceability({
  testCases,
  mapping,
  automationPaths,
  automatedIds,
  traceabilityFile
}) {
  const rows = testCases.map((testCase) =>
    buildRow(testCase, { mapping, automationPaths, automatedIds })
  );

  const tableBlock = `${MARKER_START}\n${TABLE_HEADER}${rows.join('\n')}\n${MARKER_END}`;

  let content = TRACEABILITY_HEADER;
  if (fs.existsSync(traceabilityFile)) {
    const existing = fs.readFileSync(traceabilityFile, 'utf-8');
    if (existing.includes(MARKER_START) && existing.includes(MARKER_END)) {
      content =
        existing.slice(0, existing.indexOf(MARKER_START)) +
        tableBlock +
        existing.slice(existing.indexOf(MARKER_END) + MARKER_END.length);
    } else {
      content = existing.trimEnd() + '\n\n' + tableBlock + '\n';
    }
  } else {
    content += tableBlock + '\n';
  }

  fs.mkdirSync(path.dirname(traceabilityFile), { recursive: true });
  fs.writeFileSync(traceabilityFile, content, 'utf-8');
  return rows.length;
}

module.exports = {
  MARKER_END,
  MARKER_START,
  defaultTraceabilityPath,
  syncTraceability
};
