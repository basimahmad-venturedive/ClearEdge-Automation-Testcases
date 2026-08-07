/**
 * Typed environment accessor for the frontend automation layer.
 *
 * Policy (.claude/rules/secrets-and-env.rules.md):
 * - Every base URL and credential lives in a local `.env` (never committed).
 * - A missing BASE URL is a configuration error → FAIL LOUD at config time,
 *   never fall back to localhost or any hardcoded default.
 * - A missing SECRET (credentials) → tests skip cleanly at runtime with a
 *   message naming the variable and the file to populate.
 * - No inline `process.env.…` anywhere else in specs, pages, or locators —
 *   everything is read through this module.
 * - Per-environment switching (local / dev / qa / prod) is done by SELECTING A
 *   DIFFERENT `.env` FILE via `TEST_ENV`, never by `if (env === …)` branches in
 *   test code (secrets-and-env.rules §1a rule 3).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';

/** The four supported target environments. Select one with the `TEST_ENV` var. */
export const KNOWN_ENVS = ['local', 'dev', 'qa', 'prod'] as const;
export type TestEnv = (typeof KNOWN_ENVS)[number];

/**
 * Which environment this run targets. Chosen by `TEST_ENV` (from the shell /
 * CI), defaulting to `local`. An unknown value fails loud so a typo can never
 * silently run against the wrong stack.
 *   TEST_ENV=dev npm test      (bash / CI)
 *   $env:TEST_ENV='dev'; npm test   (PowerShell)
 */
export function testEnv(): TestEnv {
  const raw = (process.env.TEST_ENV ?? 'local').trim().toLowerCase();
  if (!(KNOWN_ENVS as readonly string[]).includes(raw)) {
    throw new Error(
      `Configuration error: TEST_ENV="${raw}" is not one of: ${KNOWN_ENVS.join(', ')}. ` +
        'Set TEST_ENV to local, dev, qa, or prod (e.g. `TEST_ENV=dev npm test`).',
    );
  }
  return raw as TestEnv;
}

const FRONTEND_DIR = path.resolve(__dirname, '..');
const SELECTED_ENV = testEnv();

/**
 * .env search order — the FIRST file to set a variable wins (dotenv
 * `override: false`), so the per-environment file takes precedence over the
 * shared defaults:
 *   1. automation/frontend/.env.<TEST_ENV>   ← per-environment URLs + creds (highest priority)
 *   2. automation/frontend/.env              ← shared, non-URL defaults (TestRail/CQM flags, etc.)
 *   3. automation/shared/config/.env
 *   4. repo root .env
 *
 * For TEST_ENV=local the per-environment file is `.env.local`.
 */
const ENV_SEARCH_ORDER: readonly string[] = [
  path.join(FRONTEND_DIR, `.env.${SELECTED_ENV}`),
  path.join(FRONTEND_DIR, '.env'),
  path.resolve(FRONTEND_DIR, '..', 'shared', 'config', '.env'),
  path.resolve(FRONTEND_DIR, '..', '..', '.env'),
];

for (const envFile of ENV_SEARCH_ORDER) {
  if (fs.existsSync(envFile)) {
    loadDotenv({ path: envFile, override: false });
  }
}

const ENV_FILE_HINT =
  `automation/frontend/.env.${SELECTED_ENV} (copy automation/frontend/.env.example and fill in ` +
  `the real value for the "${SELECTED_ENV}" environment)`;

function readVar(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Returns the variable or throws a loud, actionable configuration error. */
export function requireVar(name: string): string {
  const value = readVar(name);
  if (value === undefined) {
    throw new Error(
      `Configuration error: required environment variable "${name}" is not set ` +
        `for the "${SELECTED_ENV}" environment. ` +
        `Populate it in ${ENV_FILE_HINT}. ` +
        'This suite never falls back to localhost or any hardcoded default.',
    );
  }
  return value;
}

/** True when the variable is present and non-empty (for clean test.skip on missing secrets). */
export function hasVar(name: string): boolean {
  return readVar(name) !== undefined;
}

/**
 * Admin portal base URL Playwright opens (E2E_BASE_URL) — this is the
 * `baseURL` in playwright.config.ts. Called at config-load time → fails loud
 * when missing for the selected environment.
 */
export function baseUrl(): string {
  return requireVar('E2E_BASE_URL');
}

/**
 * ClearEdge main-application base URL (APP_BASE_URL) — the tenant-facing app,
 * distinct from the admin portal. Used by flows that cross into the app (e.g.
 * verifying a handed-over tenant's access). Fails loud when missing.
 */
export function appBaseUrl(): string {
  return requireVar('APP_BASE_URL');
}

/**
 * Admin backend API origin (ADMIN_API_BASE_URL) — the host the admin SPA calls
 * for `/api/v1/admin/*` (a separate origin from the SPA on dev/prod). Used by
 * the API seeding harness (utils/adminApi.ts) to create controlled test data.
 * Fails loud when missing.
 */
export function adminApiBaseUrl(): string {
  return requireVar('ADMIN_API_BASE_URL');
}

/**
 * Main-app backend API base (APP_API_BASE_URL, e.g. https://host/api) — the app
 * SPA calls `/v1/users/*` under here. Used by the User Management seeder
 * (utils/appApi.ts). Fails loud when missing.
 */
export function appApiBaseUrl(): string {
  return requireVar('APP_API_BASE_URL');
}

/**
 * Vendor-Portal invitation token (PORTAL_TOKEN) — the sole access credential for
 * the unauthenticated `/portal/:token` route (CEIQ-FEAT-008 ASM-01). It is NOT a
 * login secret: it is minted by the Sourcing "invite vendor" action (SRC-06), not
 * deployed, so there is currently no way to seed one. Guard with hasPortalEnv() +
 * test.skip before calling; a missing value throws the standard loud config error.
 */
export function portalToken(): string {
  return requireVar('PORTAL_TOKEN');
}

/**
 * True only when the Vendor Portal can actually be driven end-to-end: a portal
 * host (APP_BASE_URL — the public tenant-facing origin the `/portal/:token` route
 * lives on) AND a seeded invitation token (PORTAL_TOKEN) are both present. The
 * portal is public/unauthenticated, so there are no credentials to check — only
 * the host + a live token. tests/vendor-portal.spec.ts gates its whole describe on
 * this so a run without a seeded token SKIPS cleanly (never fails, never hits the
 * network) — see testcases/TC-CEIQ-FEAT-008.md §6 Gaps.
 */
export function hasPortalEnv(): boolean {
  return hasVar('APP_BASE_URL') && hasVar('PORTAL_TOKEN');
}

/** Platform Admin email — SECRET. Guard with hasVar('PA_EMAIL') + test.skip before calling. */
export function paEmail(): string {
  return requireVar('PA_EMAIL');
}

/** Platform Admin password — SECRET. Guard with hasVar('PA_PASSWORD') + test.skip before calling. */
export function paPassword(): string {
  return requireVar('PA_PASSWORD');
}

/** Procurement Owner email (main app / tenant Cognito pool) — SECRET. Guard with hasVar('PO_EMAIL'). */
export function poEmail(): string {
  return requireVar('PO_EMAIL');
}

/** Procurement Owner password — SECRET. Guard with hasVar('PO_PASSWORD') + test.skip before calling. */
export function poPassword(): string {
  return requireVar('PO_PASSWORD');
}

/** Procurement Manager email (same tenant pool as PO) — for manager-parity access cases. */
export function pmEmail(): string {
  return requireVar('PM_EMAIL');
}
/** Procurement Manager password — SECRET. Guard with hasVar('PM_PASSWORD') + test.skip. */
export function pmPassword(): string {
  return requireVar('PM_PASSWORD');
}

/** Procurement Analyst email (view-only) — for read-only access cases. */
export function analystEmail(): string {
  return requireVar('ANALYST_EMAIL');
}
/** Procurement Analyst password — SECRET. Guard with hasVar('ANALYST_PASSWORD') + test.skip. */
export function analystPassword(): string {
  return requireVar('ANALYST_PASSWORD');
}

/** Non-secret CI knob. */
export function isCi(): boolean {
  return readVar('CI') !== undefined;
}
