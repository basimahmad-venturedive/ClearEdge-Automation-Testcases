const { TestRailClient } = require('../testrail/client/testRailClient');
const { testRailConfig } = require('../testrail/config/testrailConfig');
const { MappingStore } = require('../testrail/mappingStore/mappingStore');
const { RunCreator } = require('../testrail/runCreator/runCreator');

async function main() {
  validateConfig();

  const mappingStore = new MappingStore(testRailConfig.mappingFile, testRailConfig.runContextFile);
  const mapping = mappingStore.loadMapping();
  const caseIds = Object.values(mapping);

  if (caseIds.length === 0) {
    throw new Error('No TestRail case mapping found. Run npm run testrail:import first.');
  }

  const client = new TestRailClient(testRailConfig);
  const runCreator = new RunCreator({
    client,
    projectId: testRailConfig.projectId,
    mappingStore,
    runName: testRailConfig.runName,
    environment: testRailConfig.environment
  });

  const runContext = await runCreator.createRun(caseIds);
  console.log(`[TestRail] Created run ${runContext.runId}${runContext.runUrl ? `: ${runContext.runUrl}` : ''}`);
}

function validateConfig() {
  const missing = ['url', 'username', 'password', 'projectId'].filter((key) => !testRailConfig[key]);

  if (missing.length > 0) {
    throw new Error(`Missing TestRail config: ${missing.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(`[TestRail] Run creation failed: ${error.message}`);
  process.exit(1);
});
