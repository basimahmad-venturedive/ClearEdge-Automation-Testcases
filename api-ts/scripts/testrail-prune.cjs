const path = require('node:path');
const { TestRailClient } = require('../testrail/client/testRailClient.cjs');
const { testRailConfig } = require('../testrail/config/testrailConfig.cjs');
const { MappingStore } = require('../testrail/mappingStore/mappingStore.cjs');
const { MarkdownTestCaseParser } = require('../testrail/mdParser/markdownTestCaseParser.cjs');
const { TestCaseSchemaValidator } = require('../testrail/mdParser/testCaseSchemaValidator.cjs');

async function main() {
  validateConfig();

  const layerRoot = path.resolve(__dirname, '..');
  const testCasesPath = path.resolve(layerRoot, testRailConfig.testCasesFile);
  const parser = new MarkdownTestCaseParser();
  const validator = new TestCaseSchemaValidator();
  const testCases = parser.parseFile(testCasesPath);

  validator.validateAll(testCases);

  const desiredIds = new Set(testCases.map((tc) => tc.caseId));
  const mappingStore = new MappingStore(testRailConfig.mappingFile, testRailConfig.runContextFile);
  const mapping = mappingStore.loadMapping();

  const client = new TestRailClient(testRailConfig);
  const removed = [];
  const kept = [];
  let saw403 = false;

  for (const tcId of Object.keys(mapping)) {
    if (desiredIds.has(tcId)) {
      kept.push(tcId);
      continue;
    }

    const numericId = mapping[tcId];
    try {
      await client.deleteCase(numericId);
      removed.push(`${tcId} (${numericId})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const is404 = /\bfailed:\s*404\b/.test(message);
      const is403 = /\bfailed:\s*403\b/.test(message);
      if (is404) {
        removed.push(`${tcId} (${numericId}) — already deleted in TestRail`);
      } else if (is403) {
        saw403 = true;
        removed.push(
          `${tcId} (${numericId}) — mapping-only (API user cannot delete_case); remove manually in TestRail if needed`
        );
      } else {
        throw error;
      }
    }
    delete mapping[tcId];
  }

  mappingStore.saveMapping(mapping);

  if (saw403) {
    console.warn(
      '[TestRail] One or more delete_case calls returned HTTP 403 (insufficient permissions). ' +
        'Orphan TC rows were removed from caseMapping.json only. ' +
        'Ask a TestRail admin to delete those cases in the UI or grant delete_case for this API user.'
    );
  }

  console.log(`[TestRail] Prune complete — kept ${kept.length} case(s), removed ${removed.length} orphan mapping entr(y/ies).`);
  if (removed.length > 0) {
    console.log(`[TestRail] Removed: ${removed.join('; ')}`);
  }
}

function validateConfig() {
  const missing = ['url', 'username', 'password', 'projectId'].filter((key) => !testRailConfig[key]);

  if (missing.length > 0) {
    throw new Error(`Missing TestRail config: ${missing.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(`[TestRail] Prune failed: ${error.message}`);
  process.exit(1);
});
