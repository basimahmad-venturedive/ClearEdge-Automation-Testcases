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
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * .env search order per the skill/rules:
 * automation/frontend/.env → automation/frontend/.env.local →
 * automation/shared/config/.env → repo root .env
 */
const ENV_SEARCH_ORDER: readonly string[] = [
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '..', '.env.local'),
  path.resolve(__dirname, '..', '..', 'shared', 'config', '.env'),
  path.resolve(__dirname, '..', '..', '..', '.env'),
];

for (const envFile of ENV_SEARCH_ORDER) {
  if (fs.existsSync(envFile)) {
    loadDotenv({ path: envFile, override: false });
  }
}

const ENV_FILE_HINT =
  'automation/frontend/.env (copy automation/frontend/.env.example and fill in the real value)';

function readVar(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Returns the variable or throws a loud, actionable configuration error. */
export function requireVar(name: string): string {
  const value = readVar(name);
  if (value === undefined) {
    throw new Error(
      `Configuration error: required environment variable "${name}" is not set. ` +
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
 * Admin portal base URL Playwright opens (E2E_BASE_URL).
 * Called at config-load time by playwright.config.ts → fails loud when missing.
 */
export function baseUrl(): string {
  return requireVar('E2E_BASE_URL');
}

/** Platform Admin email — SECRET. Guard with hasVar('PA_EMAIL') + test.skip before calling. */
export function paEmail(): string {
  return requireVar('PA_EMAIL');
}

/** Platform Admin password — SECRET. Guard with hasVar('PA_PASSWORD') + test.skip before calling. */
export function paPassword(): string {
  return requireVar('PA_PASSWORD');
}

/** Non-secret CI knob. */
export function isCi(): boolean {
  return readVar('CI') !== undefined;
}
