/**
 * Cross-platform environment-selecting test runner.
 *
 * Sets TEST_ENV, flushes prior reports, then runs Playwright — so
 * `npm run test:dev` works identically on Windows (PowerShell/cmd), macOS,
 * Linux, and CI without needing `cross-env` or shell-specific `VAR=val`
 * prefixes. utils/env.ts reads TEST_ENV to pick automation/frontend/.env.<env>.
 *
 * Usage (via package.json scripts):
 *   npm run test:dev                       → node scripts/run-env.mjs dev
 *   npm run test:dev -- --headed           → pass extra Playwright args after --
 *   npm run test:qa  -- -g "TC-ADMLOGIN-001"
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KNOWN_ENVS = ['local', 'dev', 'qa', 'prod'];

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const [env, ...passthrough] = process.argv.slice(2);

if (!KNOWN_ENVS.includes(env)) {
  console.error(
    `run-env: TEST_ENV must be one of: ${KNOWN_ENVS.join(', ')} (got "${env ?? ''}").`,
  );
  process.exit(1);
}

/**
 * Run a Node script, inheriting stdio and the TEST_ENV we just selected.
 * We spawn `node <script>` directly (no shell) so passthrough args containing
 * shell metacharacters — e.g. `-g "TC-A|TC-B"` — are passed literally on every
 * platform instead of being reinterpreted by cmd/PowerShell.
 */
function runNode(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: frontendDir,
    stdio: 'inherit',
    env: { ...process.env, TEST_ENV: env },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// 1. Flush stale reports (same as `npm run clean:reports`).
runNode(path.join(here, 'clean-playwright-reports.mjs'), []);

// 2. Run Playwright against the selected environment, forwarding extra args.
//    Resolve the Playwright test CLI and run it with the current Node binary.
const playwrightCli = require.resolve('@playwright/test/cli');
runNode(playwrightCli, ['test', ...passthrough]);
