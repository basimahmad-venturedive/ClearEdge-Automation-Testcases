import { defineConfig, type ReporterDescription } from '@playwright/test';
import { baseUrl, isCi } from './utils/env';

/**
 * Integration reporters (TestRail + CQM) are opt-in and only appended when their
 * env flag is on, so ordinary local runs stay quiet. `utils/env` already loaded
 * the .env chain at import time, so process.env is populated here.
 * - TESTRAIL_INTEGRATION=1 → publish results to the run in testrail/mappingStore/runContext.json
 * - CQM_INTEGRATION=1       → insert automation_run + test_case_execution rows
 */
function isOn(flag: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes((flag ?? '').trim().toLowerCase());
}

const integrationReporters: ReporterDescription[] = [];
if (isOn(process.env.TESTRAIL_INTEGRATION)) {
  integrationReporters.push(['./reporters/testrailReporter.js']);
}
if (isOn(process.env.CQM_INTEGRATION)) {
  integrationReporters.push(['./reporters/cqmReporter.js']);
}

/**
 * Playwright config — CEIQ-FEAT-001 Admin Portal UI suite.
 *
 * `baseUrl()` is evaluated at CONFIG-LOAD time: when E2E_BASE_URL is missing
 * from automation/frontend/.env the whole run fails loud with an actionable
 * message. There is deliberately no localhost fallback
 * (.claude/rules/secrets-and-env.rules.md §1a).
 */
export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results',
  fullyParallel: false,
  // One worker by default: sequential runs map pass/fail cleanly to a single
  // TC-ID during stabilization (automation-architecture.rules §2).
  workers: 1,
  retries: 0,
  forbidOnly: isCi(),
  reporter: [
    ['list'],
    ['json', { outputFile: 'reports/last-run.json' }],
    ['html', { outputFolder: '../reports/playwright-html', open: 'never' }],
    ...integrationReporters,
  ],
  use: {
    baseURL: baseUrl(),
    // Failure evidence retained per frontend-automation / reporting rules:
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
