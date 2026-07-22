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
  // Under-development specs — only skipped cases (screen not built). Kept off GitHub
  // (see automation/.gitignore) AND ignored here so CI and local runs match. Delete a
  // line here + in .gitignore when the screen ships and its cases are un-skipped.
  testIgnore: [
    'company-settings-access.spec.ts',
    'company-settings-edit.spec.ts',
    'company-settings-view.spec.ts',
    'user-management-create.spec.ts',
    'user-management-edit.spec.ts',
    'user-management-email.spec.ts',
    'user-management-status.spec.ts',
  ],
  outputDir: 'test-results',
  fullyParallel: false,
  // One worker by default: sequential runs map pass/fail cleanly to a single
  // TC-ID during stabilization (automation-architecture.rules §2).
  workers: 1,
  // A full-suite run does ~60 sequential Cognito logins; under that burst the
  // dev auth throttles ("Invalid email or password" on valid creds) and the app
  // can stall on /login. Retries let those transient, load-induced failures
  // recover (individual specs almost never retry). The durable fix is auth
  // session reuse (storageState) — tracked separately.
  retries: 2,
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
  // Projects give auth-session reuse: `setup` logs in once per app and saves
  // storageState; `admin` / `po` depend on it and load the saved session, so
  // tests don't re-log-in (removing the login burst that throttled dev). The
  // `login` project deliberately has NO storageState — it tests the login flow
  // itself and must start unauthenticated.
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'login',
      testMatch: /login\.spec\.ts/,
    },
    {
      name: 'admin',
      dependencies: ['setup'],
      use: { storageState: 'playwright/.auth/admin.json' },
      testMatch: /(tenant-list|tenant-create|tenant-edit|tenant-toggle|setup-handover|ux-states)\.spec\.ts/,
    },
    {
      name: 'po',
      dependencies: ['setup'],
      use: { storageState: 'playwright/.auth/po.json' },
      testMatch: /user-management-.*\.spec\.ts/,
    },
  ],
});
