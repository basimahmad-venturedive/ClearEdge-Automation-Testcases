const path = require('node:path');
const { env } = require('../../config/env.cjs');

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
  mappingFile: path.resolve(__dirname, '..', 'mappingStore', 'caseMapping.json'),
  runContextFile: path.resolve(__dirname, '..', 'mappingStore', 'runContext.json'),
  customQanameId: env.testRail.customQanameId,
  customExecutionernameId: env.testRail.customExecutionernameId,
  templateId: env.testRail.templateId,
  apiTypeId: env.testRail.apiTypeId,
  customAutomatedNo: env.testRail.customAutomatedNo,
  customAutomatedYes: env.testRail.customAutomatedYes
};

module.exports = { testRailConfig };
