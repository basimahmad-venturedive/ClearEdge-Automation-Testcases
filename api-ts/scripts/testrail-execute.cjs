const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function vitestEntryPoint(layerRoot) {
  return path.join(layerRoot, 'node_modules', 'vitest', 'vitest.mjs');
}

// Vitest 4 + Vite's path resolution on Windows breaks when the cwd uses a
// lowercase drive letter (e.g. `c:\...`) because `import.meta.url` produces an
// uppercase variant — paths fail to compare and the worker runner context is
// never associated with the test file. Symptom: every `describe()` throws
// `TypeError: Cannot read properties of undefined (reading 'config')` at suite
// load and 0 tests execute. cmd.exe preserves whatever case was typed; PowerShell
// auto-normalizes. Force uppercase drive letter for every spawned child here.
function normalizeWindowsDriveLetter(absolutePath) {
  if (process.platform !== 'win32') {
    return absolutePath;
  }
  if (/^[a-z]:[\\/]/.test(absolutePath)) {
    return absolutePath.charAt(0).toUpperCase() + absolutePath.slice(1);
  }
  return absolutePath;
}

function main() {
  const layerRoot = normalizeWindowsDriveLetter(path.resolve(__dirname, '..'));
  const junitOut = path.resolve(layerRoot, '..', 'reports', 'api-ts-junit.xml');

  runStrict('node', ['scripts/testrail-import.cjs'], {}, layerRoot);
  runStrict('node', ['scripts/testrail-create-run.cjs'], {}, layerRoot);

  // Drop any previous run's JUnit so TestRail publish cannot read stale XML on the
  // first retry tick (Vitest writes this file near process exit; without unlink the
  // old file often satisfies parseRecordsFromJUnit immediately).
  try {
    fs.unlinkSync(junitOut);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const runStartedAtMs = Date.now();
  fs.mkdirSync(path.dirname(junitOut), { recursive: true });

  const testRailEnv = {
    TESTRAIL_INTEGRATION: 'true',
    VITEST_TESTRAIL_PUBLISH: '1',
    TESTRAIL_JUNIT_OUT: junitOut,
    // Publish script waits until the JUnit file mtime is >= this (fresh write).
    TESTRAIL_JUNIT_MIN_MTIME_MS: String(runStartedAtMs)
  };

  // Force JUnit output path on the CLI so the report is always written to the
  // same file Windows + npx + config env can otherwise miss. Config still
  // lists the junit reporter; this matches `vitest --outputFile.junit` help.
  const vitestMjs = vitestEntryPoint(layerRoot);
  if (!fs.existsSync(vitestMjs)) {
    throw new Error(`Vitest CLI missing at ${vitestMjs} — run npm install in automation/backend`);
  }

  const vitestStatus = spawnReturningStatus(
    process.execPath,
    [vitestMjs, 'run', '--outputFile.junit', junitOut],
    testRailEnv,
    layerRoot
  );
  const publishStatus = spawnReturningStatus(
    'node',
    ['scripts/testrail-publish-from-junit.cjs', '--from-execute'],
    testRailEnv,
    layerRoot
  );

  if (publishStatus !== 0) {
    process.exit(publishStatus === null ? 1 : publishStatus);
  }

  process.exit(vitestStatus === 0 || vitestStatus === null ? 0 : vitestStatus);
}

function spawnReturningStatus(command, args, extraEnv = {}, cwd = process.cwd()) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: normalizeWindowsDriveLetter(cwd),
    env: {
      ...process.env,
      ...extraEnv
    }
  });

  if (result.signal) {
    return 1;
  }

  return result.status === null ? 1 : result.status;
}

function runStrict(command, args, extraEnv = {}, cwd = process.cwd()) {
  const status = spawnReturningStatus(command, args, extraEnv, cwd);
  if (status !== 0) {
    process.exit(status);
  }
}

main();
