const path = require('path');
const { env } = require('./testrailEnv');

const testRailConfig = {
  enabled: env.testRail.enabled,
  url: env.testRail.url,
  username: env.testRail.username,
  password: env.testRail.password,
  projectId: env.testRail.projectId,
  projectName: env.testRail.projectName,
  runName: env.testRail.runName,
  environment: env.testRail.environment,
  testCasesFile: env.testRail.testCasesFile,
  mappingFile: path.resolve(__dirname, '../mappingStore/caseMapping.json'),
  runContextFile: path.resolve(__dirname, '../mappingStore/runContext.json')
};

module.exports = { testRailConfig };
