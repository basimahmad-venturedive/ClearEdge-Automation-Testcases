// Centralised environment loader for reporters / scripts (CommonJS).
// Vitest tests load their own env via src/config/env.ts; this file exists only
// so the TestRail / CQM reporters and testrail-* scripts can read TESTRAIL_* /
// CQM_* without importing the TS source graph.

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const LAYER_ROOT = path.resolve(__dirname, '..');

// Search order: api-ts/.env → api-ts/.env.local → shared/config/.env → repo root .env
const ENV_SEARCH_PATHS = [
  path.resolve(LAYER_ROOT, '.env'),
  path.resolve(LAYER_ROOT, '.env.local'),
  path.resolve(LAYER_ROOT, '..', 'shared', 'config', '.env'),
  path.resolve(LAYER_ROOT, '..', '..', '.env')
];

for (const envPath of ENV_SEARCH_PATHS) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

function trimmed(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalised = String(value).trim().toLowerCase();
  return normalised === '1' || normalised === 'true' || normalised === 'yes';
}

function optionalNaturalNumber(envKey) {
  const raw = trimmed(envKey);
  if (!raw) {
    return undefined;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `${envKey} must be a non-negative integer (digits only). Got: ${JSON.stringify(raw)}`
    );
  }
  return parseInt(raw, 10);
}

const env = {
  testRail: {
    enabled: asBool(process.env.TESTRAIL_INTEGRATION),
    url: trimmed('TESTRAIL_URL'),
    username: trimmed('TESTRAIL_USERNAME'),
    password: trimmed('TESTRAIL_PASSWORD'),
    projectId: trimmed('TESTRAIL_PROJECT_ID'),
    projectName: trimmed('TESTRAIL_PROJECT_NAME') || 'ClearEdge',
    runName: trimmed('TESTRAIL_RUN_NAME') || 'ClearEdge API (Vitest) Automated Run',
    environment: trimmed('TESTRAIL_ENVIRONMENT') || 'local',
    testCasesFile: trimmed('TESTRAIL_TESTCASES_FILE') || '../../testcases/TC-CEIQ-FOUND-001.md',
    customQanameId: optionalNaturalNumber('TESTRAIL_CUSTOM_QANAME'),
    // ClearEdge (vdqa.testrail.io project 110) uses template id 5 ("BE Test Cases");
    // this instance has no template id 6. Verify with get_templates on a new instance.
    templateId: optionalNaturalNumber('TESTRAIL_TEMPLATE_ID') ?? 5,
    customExecutionernameId: optionalNaturalNumber('TESTRAIL_CUSTOM_EXECUTIONERNAME'),
    apiTypeId: optionalNaturalNumber('TESTRAIL_API_TYPE_ID') ?? 15,
    // Checkbox-style Automated field defaults: 0 = No, 1 = Yes (override per project via env).
    customAutomatedNo: optionalNaturalNumber('TESTRAIL_CUSTOM_AUTOMATED_NO') ?? 0,
    customAutomatedYes: optionalNaturalNumber('TESTRAIL_CUSTOM_AUTOMATED_YES') ?? 1
  },
  cqm: {
    enabled: asBool(process.env.CQM_INTEGRATION)
  }
};

module.exports = { env, trimmed, asBool, optionalNaturalNumber };
