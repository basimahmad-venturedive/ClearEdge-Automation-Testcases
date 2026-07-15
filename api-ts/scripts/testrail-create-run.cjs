const fs = require('node:fs');
const path = require('node:path');
const { TestRailClient } = require('../testrail/client/testRailClient.cjs');
const { testRailConfig } = require('../testrail/config/testrailConfig.cjs');
const { MappingStore } = require('../testrail/mappingStore/mappingStore.cjs');
const { RunCreator } = require('../testrail/runCreator/runCreator.cjs');

const TC_ID_PATTERN = /TC-[A-Z0-9]+-\d+/g;
const TESTS_DIR = path.resolve(__dirname, '..', 'tests');

async function main() {
  validateConfig();

  const mappingStore = new MappingStore(testRailConfig.mappingFile, testRailConfig.runContextFile);
  const mapping = mappingStore.loadMapping();

  if (Object.keys(mapping).length === 0) {
    throw new Error('No TestRail case mapping found. Run npm run testrail:import first.');
  }

  const activeTcIds = collectActiveTcIds(TESTS_DIR);
  if (activeTcIds.length === 0) {
    throw new Error(
      `No active TC-* ids found under ${TESTS_DIR}. Refusing to create an empty TestRail run.`
    );
  }

  const { caseIds, missingTcIds } = mapTcIdsToCaseIds(activeTcIds, mapping);
  if (missingTcIds.length > 0) {
    console.warn(
      `[TestRail] Skipping ${missingTcIds.length} TC-ID(s) present in test-suites/ but not in mapping (run npm run testrail:import to sync): ${missingTcIds.join(', ')}`
    );
  }
  if (caseIds.length === 0) {
    throw new Error(
      'None of the active TC-* ids resolved to a TestRail case id. Run npm run testrail:import first.'
    );
  }

  console.log(
    `[TestRail] Creating run with ${caseIds.length} active case(s) (filtered from ${Object.keys(mapping).length} total in mapping): ${activeTcIds.join(', ')}`
  );

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

function collectActiveTcIds(testsDir) {
  if (!fs.existsSync(testsDir)) {
    return [];
  }
  const found = new Set();
  walkTestFiles(testsDir, (filePath) => {
    const contents = fs.readFileSync(filePath, 'utf8');
    const matches = contents.match(TC_ID_PATTERN);
    if (matches) {
      for (const id of matches) {
        found.add(id);
      }
    }
  });
  return [...found].sort();
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

function mapTcIdsToCaseIds(tcIds, mapping) {
  const caseIds = [];
  const missingTcIds = [];
  for (const tcId of tcIds) {
    if (Object.prototype.hasOwnProperty.call(mapping, tcId)) {
      caseIds.push(mapping[tcId]);
    } else {
      missingTcIds.push(tcId);
    }
  }
  return { caseIds, missingTcIds };
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
