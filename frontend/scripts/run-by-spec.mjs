/**
 * Run the frontend (Playwright) suite for ONE feature spec (CEIQ-FEAT-xxx).
 *
 * The feature specs live in documents/input/SPEC_CEIQ-*.md. Every *.spec.ts file
 * names its owning spec in its header comment (e.g. "CEIQ-FEAT-004 — Company
 * Settings ..."), so this script scans tests/, matches the spec files whose header
 * references the requested feature, and hands that file list to run-env.mjs — which
 * flushes stale reports, sets TEST_ENV, then runs Playwright against just those files.
 * Running one spec this way yields a report scoped to that one spec (results spec-wise).
 *
 * Usage (via package.json → "test:spec"):
 *   npm run test:spec -- dev FEAT-004
 *   npm run test:spec -- dev CEIQ-FEAT-003 --headed
 *   npm run test:spec -- qa 001 -g "TC-ADMLIST-001"
 *
 * The feature token is tolerant: FEAT-004, feat-004, CEIQ-FEAT-004, FEAT004 and the
 * bare number 004 all resolve to CEIQ-FEAT-004. With no / an unknown feature it prints
 * the available specs and exits non-zero. Extra Playwright flags go after the feature.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KNOWN_ENVS = ['local', 'dev', 'qa', 'prod'];
const FEATURE_RE = /CEIQ-(?:FEAT|FOUND)-\d+/;

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '..');
const testsDir = path.join(frontendDir, 'tests');

const [env, feature, ...passthrough] = process.argv.slice(2);

if (!KNOWN_ENVS.includes(env)) {
  console.error(
    `run-by-spec: first arg must be an environment (${KNOWN_ENVS.join(', ')}), got "${env ?? ''}".`,
  );
  console.error('Usage: npm run test:spec -- <env> <feature>   e.g. npm run test:spec -- dev FEAT-004');
  process.exit(1);
}

/** Map every *.spec.ts file → the feature code named in its header comment. */
function scanFeatures() {
  const map = new Map(); // code -> ["tests/<file>", ...]
  for (const name of readdirSync(testsDir)) {
    if (!name.endsWith('.spec.ts')) continue;
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
  console.error(`run-by-spec: no spec files map to feature "${feature}".`);
  printAvailable();
  process.exit(1);
}

const files = features.get(matchedCode);
console.log(`Running ${matchedCode} — ${files.length} spec file(s) on ${env}:`);
for (const f of files) console.log(`  • ${f}`);

// Delegate to run-env.mjs so reports are flushed and TEST_ENV is set exactly as a
// normal `npm run test:<env>` — passing the matched files (then any extra flags) as
// Playwright's positional path filters.
const result = spawnSync(
  process.execPath,
  [path.join(here, 'run-env.mjs'), env, ...files, ...passthrough],
  { cwd: frontendDir, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
