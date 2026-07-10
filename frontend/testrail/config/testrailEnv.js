// Standalone env accessor for the TestRail / CQM reporters and testrail-* scripts.
//
// The boilerplate coupled these to config/env.js, which requireEnv()s the app's
// own vars (base URL, login creds). We deliberately decouple here so enabling
// TestRail/CQM never forces unrelated app secrets to be present, and so this
// layer stays aligned with the local frontend's env policy (utils/env.ts):
// .env search order frontend/.env → frontend/.env.local → shared/config/.env → repo root.

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const LAYER_ROOT = path.resolve(__dirname, '..', '..');

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

const env = {
  testRail: {
    enabled: asBool(process.env.TESTRAIL_INTEGRATION),
    url: trimmed('TESTRAIL_URL'),
    username: trimmed('TESTRAIL_USERNAME'),
    password: trimmed('TESTRAIL_PASSWORD'),
    projectId: trimmed('TESTRAIL_PROJECT_ID'),
    projectName: trimmed('TESTRAIL_PROJECT_NAME') || 'ClearEdge',
    runName: trimmed('TESTRAIL_RUN_NAME') || 'ClearEdge UI (Playwright) Automated Run',
    environment: trimmed('TESTRAIL_ENVIRONMENT') || 'local',
    testCasesFile: trimmed('TESTRAIL_TESTCASES_FILE') || '../../testcases/TC-CEIQ-FEAT-001.md'
  },
  cqm: {
    enabled: asBool(process.env.CQM_INTEGRATION)
  }
};

module.exports = { env, trimmed, asBool };
