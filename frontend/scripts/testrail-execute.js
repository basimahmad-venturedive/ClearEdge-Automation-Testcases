const { spawnSync } = require('child_process');

function main() {
  run('node', ['scripts/testrail-import.js']);
  run('node', ['scripts/testrail-create-run.js']);
  run(npxCommand(), ['playwright', 'test'], {
    TESTRAIL_INTEGRATION: 'true'
  });
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnv
    }
  });

  if (result.status !== 0) {
    process.exit(result.status);
  }
}

function npxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

main();
