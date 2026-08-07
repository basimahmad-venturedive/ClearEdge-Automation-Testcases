import { defineConfig, type PlaywrightTestProject, type ReporterDescription } from '@playwright/test';
import { baseUrl, hasVar, isCi } from './utils/env';

/**
 * The `po` project logs into the MAIN app and reuses playwright/.auth/po.json,
 * which the setup project only writes when PO_EMAIL + PO_PASSWORD are present.
 * Without those creds the PO setup skips, so including the project anyway makes
 * every user-management spec ERROR on the missing storageState (ENOENT). Gate it
 * on the creds so a credential-less run (e.g. CI without the tenant password)
 * simply doesn't run those specs instead of failing them.
 */
const hasPoCreds = hasVar('PO_EMAIL') && hasVar('PO_PASSWORD');

const poProject: PlaywrightTestProject[] = hasPoCreds
  ? [
      {
        name: 'po',
        dependencies: ['setup'],
        use: { storageState: 'playwright/.auth/po.json' },
        // PO-only tenant-app screens: User Management (FEAT-003), Company
        // Settings (FEAT-004), and Vendor Directory (FEAT-005) all live behind
        // the Procurement-Owner session. Each prefix is anchored to a path
        // boundary ([\\/]) so it matches only specs whose FILENAME starts with it
        // — otherwise the bare `sourcing-` alternative would also swallow the
        // role-access specs (…-sourcing-access.spec.ts), which must run under the
        // pm/analyst sessions instead.
        testMatch: /[\\/](user-management|company-settings|vendors|clause-config|sourcing)-[^\\/]*\.spec\.ts$/,
      },
    ]
  : [];

/**
 * Role-based access projects for FEAT-007 Sourcing. Each loads the storageState of
 * its role (saved by auth.setup) and runs ONLY that role's access spec, so the
 * assertions run under the right permission set (Manager = manage_sourcing parity
 * with the Owner; Analyst = view_sourcing read-only). Gated on the role creds so a
 * credential-less run simply skips them instead of ERRORing on a missing session.
 */
const hasPmCreds = hasVar('PM_EMAIL') && hasVar('PM_PASSWORD');
const hasAnalystCreds = hasVar('ANALYST_EMAIL') && hasVar('ANALYST_PASSWORD');

const roleProjects: PlaywrightTestProject[] = [
  ...(hasPmCreds
    ? [
        {
          name: 'pm',
          dependencies: ['setup'],
          use: { storageState: 'playwright/.auth/pm.json' },
          testMatch: /manager-sourcing-access\.spec\.ts/,
        },
      ]
    : []),
  ...(hasAnalystCreds
    ? [
        {
          name: 'analyst',
          dependencies: ['setup'],
          use: { storageState: 'playwright/.auth/analyst.json' },
          testMatch: /analyst-sourcing-access\.spec\.ts/,
        },
      ]
    : []),
];

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
    'user-management-create.spec.ts',
    'user-management-edit.spec.ts',
    'user-management-email.spec.ts',
    'user-management-status.spec.ts',
  ],
  outputDir: 'test-results',
  // Per-test budget. The Playwright default (30s) is tight against the dev
  // CloudFront/SPA cold start: the first test after auth setup pays the app's
  // boot cost inside its own timeout and can tip over 30s (e.g. TC-CSEDIT-005),
  // then passes on retry. 60s absorbs the cold start without masking real hangs.
  timeout: 60_000,
  // Web-first assertion budget. The Playwright default (5s) is too tight for
  // mid-test steps against a throttled dev (a textarea/button/toast occasionally
  // lands >5s late and flakes, then passes on retry). 15s absorbs the lag;
  // negative assertions (toHaveCount(0), not.toBeVisible) still return instantly
  // on the happy path, so this doesn't slow green runs.
  expect: { timeout: 15_000 },
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
      // CEIQ-FEAT-008 Vendor Portal — the /portal/:token route is PUBLIC and
      // unauthenticated (ASM-01), so this project deliberately has NO storageState
      // and NO setup dependency: it must start with a clean, logged-out context
      // (like `login`). The spec skips its whole describe when the portal env +
      // seeded token are absent (utils/env.hasPortalEnv), so a credential-less run
      // simply reports skips instead of running or failing.
      name: 'portal',
      testMatch: /vendor-portal\.spec\.ts/,
    },
    {
      name: 'admin',
      dependencies: ['setup'],
      use: { storageState: 'playwright/.auth/admin.json' },
      testMatch: /(tenant-list|tenant-create|tenant-edit|tenant-toggle|setup-handover|ux-states)\.spec\.ts/,
    },
    ...poProject,
    ...roleProjects,
  ],
});
