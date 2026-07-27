// Direct CQM database publish path — bypasses AWS Secrets Manager entirely.
//
// Activated when CQM_DIRECT_DB=1 OR all of DB_HOST / DB_USER / DB_PASSWORD /
// DB_NAME are set in .env (see resolveDirectDbConfig() below). Mirrors the
// Python reference in cqm/dbhelper.py + cqm/cqm.py (FE boilerplate):
//   1. Open an SSH tunnel to the bastion using the same key the AWS path uses.
//   2. mysql2 connects through the forwarded stream (no local TCP listener).
//   3. INSERT one automation_run row + N test_case_execution rows in a single
//      transaction, exactly the way the Python helper does.
//
// Module is consumed by reporters/cqmReporter.cjs; no other consumer.

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { Client: SshClient } = require('ssh2');
const mysql = require('mysql2/promise');

const DEFAULT_DB_PORT = 3306;
const DEFAULT_SSH_PORT = 22;
const SSH_READY_TIMEOUT_MS = 20000;
const COMPONENT_LOOKUP_LIMIT = 1;

function envFirst(...keys) {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw && String(raw).trim()) {
      return String(raw).trim();
    }
  }
  return '';
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function explicitFlag() {
  return String(process.env.CQM_DIRECT_DB ?? '')
    .trim()
    .toLowerCase();
}

// Direct-DB path is FORCED — caller must skip the AWS path entirely.
// Set CQM_DIRECT_DB=1 (or true/yes) to opt in.
function directDbForced() {
  const flag = explicitFlag();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

// Direct-DB path is forbidden — caller must NOT fall back to it even on
// AWS failure. Set CQM_DIRECT_DB=0 (or false/no) to opt out.
function directDbDisabledExplicitly() {
  const flag = explicitFlag();
  return flag === '0' || flag === 'false' || flag === 'no';
}

// Direct-DB env vars are populated — caller MAY use direct as primary or
// as a fallback for the AWS path (subject to the two flags above).
function directDbAvailable() {
  return Boolean(
    envFirst('DB_HOST', 'MYSQL_HOST') &&
      envFirst('DB_USER', 'MYSQL_USER') &&
      envFirst('DB_PASSWORD', 'MYSQL_PASSWORD', 'DB_PASS') &&
      envFirst('DB_NAME', 'MYSQL_DATABASE')
  );
}

// Legacy single-flag accessor — retained for backwards compatibility with
// older callers; new code should use the three predicates above so we can
// distinguish "force", "forbid", and "available as fallback".
function directDbEnabled() {
  if (directDbForced()) return true;
  if (directDbDisabledExplicitly()) return false;
  return directDbAvailable();
}

function resolveDirectDbConfig(layerRoot) {
  const sshKeyRaw = envFirst('SSH_KEY_PATH', 'SSH_PEM_PATH', 'SONAR_SSH_PEM_PATH');
  const sshKeyPath =
    sshKeyRaw && !path.isAbsolute(sshKeyRaw) ? path.resolve(layerRoot, sshKeyRaw) : sshKeyRaw;

  return {
    sshHost: envFirst('SSH_HOST', 'SONAR_SSH_HOST'),
    sshPort: parsePositiveInt(envFirst('SSH_PORT', 'SONAR_SSH_PORT'), DEFAULT_SSH_PORT),
    sshUser: envFirst('SSH_USER', 'SONAR_SSH_USER'),
    sshKeyPath,
    dbHost: envFirst('DB_HOST', 'MYSQL_HOST'),
    dbPort: parsePositiveInt(envFirst('DB_PORT', 'MYSQL_PORT'), DEFAULT_DB_PORT),
    dbUser: envFirst('DB_USER', 'MYSQL_USER'),
    dbPassword: envFirst('DB_PASSWORD', 'MYSQL_PASSWORD', 'DB_PASS'),
    dbName: envFirst('DB_NAME', 'MYSQL_DATABASE'),
  };
}

function validateDirectDbConfig(cfg) {
  const required = [
    ['sshHost', 'SSH_HOST'],
    ['sshUser', 'SSH_USER'],
    ['sshKeyPath', 'SSH_KEY_PATH'],
    ['dbHost', 'DB_HOST'],
    ['dbUser', 'DB_USER'],
    ['dbName', 'DB_NAME'],
  ];
  const missing = required.filter(([prop]) => !cfg[prop]).map(([, envName]) => envName);
  if (missing.length > 0) {
    throw new Error(`CQM direct-DB mode missing env: ${missing.join(', ')}`);
  }
  if (!fs.existsSync(cfg.sshKeyPath)) {
    throw new Error(`CQM direct-DB: SSH key not found at ${cfg.sshKeyPath}`);
  }
}

function openSshClient(cfg) {
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    const onError = (err) => {
      client.removeAllListeners();
      reject(err);
    };
    client
      .once('ready', () => {
        client.removeListener('error', onError);
        resolve(client);
      })
      .once('error', onError)
      .connect({
        host: cfg.sshHost,
        port: cfg.sshPort,
        username: cfg.sshUser,
        privateKey: fs.readFileSync(cfg.sshKeyPath),
        readyTimeout: SSH_READY_TIMEOUT_MS,
      });
  });
}

function forwardOutStream(sshClient, dbHost, dbPort) {
  return new Promise((resolve, reject) => {
    sshClient.forwardOut('127.0.0.1', 0, dbHost, dbPort, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stream);
    });
  });
}

async function setupDirectDb(cfg) {
  validateDirectDbConfig(cfg);
  const sshClient = await openSshClient(cfg);
  let conn = null;
  try {
    const stream = await forwardOutStream(sshClient, cfg.dbHost, cfg.dbPort);
    conn = await mysql.createConnection({
      user: cfg.dbUser,
      password: cfg.dbPassword,
      database: cfg.dbName,
      stream,
    });
  } catch (err) {
    try {
      sshClient.end();
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
  return {
    conn,
    async close() {
      try {
        await conn.end();
      } catch {
        /* best-effort cleanup */
      }
      try {
        sshClient.end();
      } catch {
        /* best-effort cleanup */
      }
    },
  };
}

async function lookupComponentIdByKey(conn, componentKey) {
  if (!componentKey) {
    throw new Error('lookupComponentIdByKey: componentKey is empty');
  }
  if (/^\d+$/.test(componentKey)) {
    return Number(componentKey);
  }
  // Real schema (verified via DESCRIBE repo_component): match the `vend_*` form
  // against `venturedive_id`, fall back to plain `component_key` so projects
  // using either spelling work without a code change.
  const [rows] = await conn.query(
    `SELECT id FROM repo_component
       WHERE venturedive_id = ? OR component_key = ?
       LIMIT ${COMPONENT_LOOKUP_LIMIT}`,
    [componentKey, componentKey]
  );
  if (!rows || rows.length === 0) {
    throw new Error(
      `No row in repo_component with venturedive_id or component_key = "${componentKey}". ` +
        `Either correct COMPONENT_KEY in .env or set COMPONENT_ID=<numeric id> directly.`
    );
  }
  return rows[0].id;
}

async function insertAutomationRun(conn, runData) {
  const sql = `INSERT INTO automation_run (
      component_id,
      master_branch_commit_id,
      total_test_cases,
      total_test_passed,
      total_test_failed,
      total_test_skipped,
      execution_start_time,
      execution_end_time,
      executed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const [result] = await conn.execute(sql, [
    runData.component_id,
    runData.master_branch_commit_id,
    runData.total_test_cases,
    runData.total_test_passed,
    runData.total_test_failed,
    runData.total_test_skipped,
    runData.execution_start_time,
    runData.execution_end_time,
    runData.executed_at,
  ]);
  return result.insertId;
}

// The CQM schema carries a nullable "test type" column (smoke / regression) that the
// documented column set omits. We detect its real name at runtime (installs vary:
// `test_type` vs `test_case_type`) and only add it to the INSERT when it exists — so a
// schema without it still inserts cleanly instead of erroring on an unknown column.
async function detectTestTypeColumn(conn) {
  try {
    const [rows] = await conn.query(
      `SHOW COLUMNS FROM test_case_execution WHERE Field IN ('test_type', 'test_case_type')`
    );
    if (Array.isArray(rows) && rows.length > 0) {
      // Prefer the exact 'test_type' spelling when both somehow exist.
      const names = rows.map((r) => r.Field);
      return names.includes('test_type') ? 'test_type' : names[0];
    }
  } catch {
    /* SHOW COLUMNS failed → treat as absent, insert without the column */
  }
  return null;
}

async function insertTestExecutions(conn, automationRunId, tests) {
  if (!Array.isArray(tests) || tests.length === 0) {
    return 0;
  }
  const typeCol = await detectTestTypeColumn(conn);
  const cols = [
    'automation_run_id',
    'test_case_id',
    'test_case_name',
    'test_case_status',
    'failure_reason',
    'test_start_time',
    'test_end_time',
    'recorded_at',
  ];
  if (typeCol) {
    cols.push(typeCol);
  }
  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT INTO test_case_execution (${cols.join(', ')}) VALUES (${placeholders})`;
  let inserted = 0;
  for (const t of tests) {
    const status = t.test_case_status || 'unknown';
    const failureReason = status === 'Failed' ? t.failure_reason || null : null;
    const testCaseId = t.test_case_id || t.test_case_name || 'unknown';
    const values = [
      automationRunId,
      testCaseId,
      t.test_case_name || '',
      status,
      failureReason,
      t.test_start_time || null,
      t.test_end_time || null,
      t.recorded_at || null,
    ];
    if (typeCol) {
      values.push(t.test_type || null);
    }
    await conn.execute(sql, values);
    inserted += 1;
  }
  return inserted;
}

function getCurrentGitCommitId() {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

module.exports = {
  directDbEnabled,
  directDbForced,
  directDbDisabledExplicitly,
  directDbAvailable,
  resolveDirectDbConfig,
  setupDirectDb,
  lookupComponentIdByKey,
  insertAutomationRun,
  insertTestExecutions,
  getCurrentGitCommitId,
};
