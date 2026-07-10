const path = require('path');
const { TestRailClient } = require('../testrail/client/testRailClient');
const { testRailConfig } = require('../testrail/config/testrailConfig');
const { CaseImporter } = require('../testrail/importer/caseImporter');
const { MappingStore } = require('../testrail/mappingStore/mappingStore');
const { MarkdownTestCaseParser } = require('../testrail/mdParser/markdownTestCaseParser');
const { TestCaseSchemaValidator } = require('../testrail/mdParser/testCaseSchemaValidator');
const {
  collectAutomatedCaseIds,
  collectAutomationPaths
} = require('../testrail/utils/automationIds');
const {
  defaultTraceabilityPath,
  syncTraceability
} = require('../testrail/utils/traceabilitySync');

async function main() {
  validateConfig();

  const frontendRoot = process.cwd();
  const testCasesPath = path.resolve(frontendRoot, testRailConfig.testCasesFile);
  const parser = new MarkdownTestCaseParser();
  const validator = new TestCaseSchemaValidator();
  const testCases = parser.parseFile(testCasesPath);

  validator.validateAll(testCases);

  const automatedIds = collectAutomatedCaseIds(path.join(frontendRoot, 'tests'));
  const automationPaths = collectAutomationPaths(path.join(frontendRoot, 'tests'));

  const client = new TestRailClient(testRailConfig);
  const mappingStore = new MappingStore(testRailConfig.mappingFile, testRailConfig.runContextFile);
  const importer = new CaseImporter({
    client,
    projectId: testRailConfig.projectId,
    mappingStore,
    automatedIds
  });

  const mapping = await importer.importCases(testCases);
  const automatedCount = testCases.filter((tc) => automatedIds.has(tc.caseId)).length;
  console.log(`[TestRail] Imported ${Object.keys(mapping).length} case mapping(s).`);
  console.log(
    `[TestRail] Type: Functional Web (type_id=13); custom_automated=1 on ${automatedCount} automated case(s).`
  );

  const traceabilityFile = defaultTraceabilityPath(frontendRoot);
  const rowCount = syncTraceability({
    testCases,
    mapping,
    automationPaths,
    automatedIds,
    traceabilityFile
  });
  console.log(`[TestRail] Updated traceability: ${traceabilityFile} (${rowCount} row(s)).`);
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
