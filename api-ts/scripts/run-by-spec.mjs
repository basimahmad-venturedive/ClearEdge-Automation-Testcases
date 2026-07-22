/**
 * Run the API-TS suite for ONE feature spec (CEIQ-FEAT-xxx / CEIQ-FOUND-xxx).
 *
 * The feature specs live in documents/input/SPEC_CEIQ-*.md. Every test file names
 * its owning spec in its header comment (e.g. "CEIQ-FEAT-004 Company Settings ..."),
 * so this script scans tests/, matches the files whose header references the requested
 * feature, and runs Vitest against exactly those files under the chosen environment.
 * This mirrors the "Spec" filter in the HTML report (reporters/extentReporter.ts):
 * run one spec here → the report shows that one spec.
 *
 * Usage (via package.json → "test:spec"):
 *   npm run test:spec -- dev FEAT-004
 *   npm run test:spec -- local CEIQ-FOUND-001 --reporter=verbose
 *   npm run test:spec -- dev 003 -t "TC-UMAPI-001"
 *
 * The feature token is tolerant: FEAT-004, feat-004, CEIQ-FEAT-004, FEAT004 and the
 * bare number 004 all resolve to CEIQ-FEAT-004. With no / an unknown feature it prints
 * the available specs and exits non-zero. Extra Vitest flags go after the feature.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KNOWN_ENVS = ['local', 'dev', 'qa', 'prod'];
const FEATURE_RE = /CEIQ-(?:FEAT|FOUND)-\d+/;

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '..');
const testsDir = path.join(apiDir, 'tests');
const require = createRequire(import.meta.url);

const [env, feature, ...passthrough] = process.argv.slice(2);

if (!KNOWN_ENVS.includes(env)) {
  console.error(
    `run-by-spec: first arg must be an environment (${KNOWN_ENVS.join(', ')}), got "${env ?? ''}".`,
  );
  console.error('Usage: npm run test:spec -- <env> <feature>   e.g. npm run test:spec -- dev FEAT-004');
  process.exit(1);
}

/** Map every test file → the feature code named in its header comment. */
function scanFeatures() {
  const map = new Map(); // code -> ["tests/<file>", ...]
  for (const name of readdirSync(testsDir)) {
    if (!name.endsWith('.test.ts')) continue;
    let code = null;
    try {
      code = (readFileSync(path.join(testsDir, name), 'utf-8').match(FEATURE_RE) || [])[0] ?? null;
    } catch {
      /* unreadable — skip */
    }
    if (!code) continue;
    if (!map.has(code)) map.set(code, []);
    map.get(code).push(path.posix.join('tests', name));
  }
  return map;
}

const norm = (s) => String(s).trim().toUpperCase().replace(/^CEIQ-/, '');
function matchCode(code, req) {
  const c = norm(code); // FEAT-004
  const r = norm(req); // user input, normalised
  return c === r || c.replace('-', '') === r || c.replace(/^(FEAT|FOUND)-/, '') === r;
}

const features = scanFeatures();

function printAvailable() {
  console.error('\nAvailable specs:');
  for (const [code, files] of [...features.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.error(`  ${code}  (${files.length} file${files.length === 1 ? '' : 's'})`);
  }
}

if (!feature) {
  console.error('run-by-spec: missing <feature>. Usage: npm run test:spec -- <env> <feature>');
  printAvailable();
  process.exit(1);
}

const matchedCode = [...features.keys()].find((c) => matchCode(c, feature));
if (!matchedCode) {
  console.error(`run-by-spec: no test files map to spec "${feature}".`);
  printAvailable();
  process.exit(1);
}

const files = features.get(matchedCode);
console.log(`Running ${matchedCode} — ${files.length} file(s) on ${env}:`);
for (const f of files) console.log(`  • ${f}`);

// Resolve Vitest's CLI (vitest/vitest.mjs) via its package.json so we run it with the
// current Node binary (no shell) — passthrough args are forwarded literally, cross-platform.
const vitestCli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const result = spawnSync(process.execPath, [vitestCli, 'run', ...files, ...passthrough], {
  cwd: apiDir,
  stdio: 'inherit',
  env: { ...process.env, TEST_ENV: env },
});
process.exit(result.status ?? 1);
