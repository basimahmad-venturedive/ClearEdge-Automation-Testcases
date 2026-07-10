const path = require('node:path');
const { TestRailClient } = require('../testrail/client/testRailClient.cjs');
const { testRailConfig } = require('../testrail/config/testrailConfig.cjs');
const { CaseImporter } = require('../testrail/importer/caseImporter.cjs');
const { MappingStore } = require('../testrail/mappingStore/mappingStore.cjs');
const { MarkdownTestCaseParser } = require('../testrail/mdParser/markdownTestCaseParser.cjs');
const { TestCaseSchemaValidator } = require('../testrail/mdParser/testCaseSchemaValidator.cjs');
const {
  defaultTraceabilityPath,
  loadAutomatedCaseIds
} = require('../testrail/traceability/automatedCaseIds.cjs');

async function main() {
  validateConfig();

  const layerRoot = path.resolve(__dirname, '..');
  const testCasesPath = path.resolve(layerRoot, testRailConfig.testCasesFile);
  const parser = new MarkdownTestCaseParser();
  const validator = new TestCaseSchemaValidator();
  const testCases = parser.parseFile(testCasesPath);

  validator.validateAll(testCases);

  const client = new TestRailClient(testRailConfig);
  const mappingStore = new MappingStore(testRailConfig.mappingFile, testRailConfig.runContextFile);
  const automatedCaseIds = loadAutomatedCaseIds(defaultTraceabilityPath(layerRoot), layerRoot);
  const importer = new CaseImporter({
    client,
    projectId: testRailConfig.projectId,
    mappingStore,
    customQanameId: testRailConfig.customQanameId,
    templateId: testRailConfig.templateId,
    apiTypeId: testRailConfig.apiTypeId,
    customAutomatedNo: testRailConfig.customAutomatedNo,
    customAutomatedYes: testRailConfig.customAutomatedYes,
    automatedCaseIds
  });

  const mapping = await importer.importCases(testCases);
  const yesCount = importer.lastAutomatedYesCount ?? 0;
  console.log(
    `[TestRail] Imported ${Object.keys(mapping).length} case mapping(s); ` +
      `${yesCount} marked custom_automated=Yes (automated in test-suites/ or TRACEABILITY.md).`
  );
}

function validateConfig() {
  const missing = ['url', 'username', 'password', 'projectId'].filter((key) => !testRailConfig[key]);

  if (missing.length > 0) {
    throw new Error(`Missing TestRail config: ${missing.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(`[TestRail] Import failed: ${error.message}`);
  process.exit(1);
});
