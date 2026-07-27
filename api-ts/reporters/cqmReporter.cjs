// Vitest 4.x CQM reporter — pushes results to the Sonar/CQM database via
// @test/integrations (private internal package installed from the VentureDive
// registry — see automation/api-js/.npmrc).
//
// Gating: this reporter is a no-op unless CQM_INTEGRATION=1 (or =true).

const fs = require('node:fs');
const path = require('node:path');
const { collectRecordsFromTestModules, pickTestModulesArg, toRecord } = require('./reporterUtils.cjs');
const cqmDirect = require('./cqmDirect.cjs');

const DEFAULT_CQM_TIMEZONE = 'Asia/Karachi';
const DEFAULT_SSH_PORT = 22;
const FAILURE_REASON_HARD_LIMIT = 250;
const FAILURE_REASON_LINE_LIMIT = 2;
const STATUS_LOG_PATH = path.resolve(__dirname, '..', '..', 'reports', 'cqm-last-run.log');

function writeStatus(lines) {
  try {
    fs.mkdirSync(path.dirname(STATUS_LOG_PATH), { recursive: true });
    const header = `# CQM last run — ${new Date().toISOString()}\n`;
    fs.writeFileSync(STATUS_LOG_PATH, header + lines.join('\n') + '\n', 'utf8');
  } catch {
    /* status-log write is best-effort */
  }
}

function logBoth(buffer, line) {
  // Vitest captures console.log inside its own UI — write directly to stderr
  // so cmd / PowerShell flush the line immediately and it shows below the
  // test summary instead of being swallowed.
  process.stderr.write(`${line}\n`);
  buffer.push(line);
}

function cqmEnabled() {
  const normalised = String(process.env.CQM_INTEGRATION ?? '')
    .trim()
    .toLowerCase();
  return normalised === '1' || normalised === 'true' || normalised === 'yes';
}

function envValue(primary, secondary) {
  const primaryValue = process.env[primary];
  if (primaryValue && primaryValue.trim()) {
    return primaryValue.trim();
  }

  if (secondary) {
    const secondaryValue = process.env[secondary];
    if (secondaryValue && secondaryValue.trim()) {
      return secondaryValue.trim();
    }
  }

  return '';
}

function mustEnv(primary, secondary) {
  const value = envValue(primary, secondary);
  if (!value) {
    const fallback = secondary ? ` (or ${secondary})` : '';
    throw new Error(`Missing required env var: ${primary}${fallback}`);
  }
  return value;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isFinite(port) || port <= 0) {
    return DEFAULT_SSH_PORT;
  }
  return port;
}

function resolveComponentKey() {
  const explicit = envValue('COMPONENT_KEY');
  if (explicit) {
    return explicit;
  }

  const apiComponentKey = envValue('COMPONENT_KEY_API');
  if (apiComponentKey) {
    return apiComponentKey;
  }

  return mustEnv('COMPONENT_KEY_UI');
}

function resolveCommitId(getGitCommitId) {
  const explicit = envValue('COMMIT_ID', 'CQM_COMMIT_ID');
  if (explicit) {
    return explicit;
  }

  return getGitCommitId();
}

function formatDateTime(date) {
  const timezone = envValue('CQM_TIMEZONE') || DEFAULT_CQM_TIMEZONE;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const map = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function cleanFailureReason(message) {
  const noAnsi = (message || '').replace(/\u001b\[.*?m/g, '');
  const lines = noAnsi.split('\n');
  const filtered = lines.filter((line) => /Expected|Received|Error|Timed out|expect/i.test(line));
  return (
    filtered.slice(0, FAILURE_REASON_LINE_LIMIT).join(' ').trim() ||
    noAnsi.slice(0, FAILURE_REASON_HARD_LIMIT)
  ).trim();
}

function formatScenarioTitle(record) {
  const base = record.fullTitle || record.title || '';
  return base.replace(/\s+@\S+/g, '').trim();
}

// Suite classification for the CQM `test_type` column. Prefer the per-test tag in the
// title (a @smoke case is also @regression, so @smoke wins as the more specific bucket);
// fall back to the run mode set by the npm scripts (SMOKE_ONLY / REGRESSION_ONLY).
function resolveTestType(record) {
  const raw = `${record.fullTitle || ''} ${record.title || ''}`;
  if (/@smoke\b/i.test(raw)) return 'smoke';
  if (/@regression\b/i.test(raw)) return 'regression';
  if (String(process.env.SMOKE_ONLY) === '1') return 'smoke';
  if (String(process.env.REGRESSION_ONLY) === '1') return 'regression';
  return null;
}

function loadDbConnectionModule() {
  const candidates = [
    '@test/integrations/src/integrations/db_connection',
    '@test/integrations/src/integrations/db_connection.js',
    '@test/integrations/lib/integrations/db_connection',
    '@test/integrations/lib/integrations/db_connection.js'
  ];
  const loadErrors = [];

  for (const id of candidates) {
    try {
      // eslint-disable-next-line global-require
      return require(id);
    } catch (error) {
      loadErrors.push(`${id}: ${error.message}`);
    }
  }

  throw new Error(
    `Could not load DB connection module from @test/integrations.\n${loadErrors.join('\n')}`
  );
}

// AWS path is "configured" when every required Secrets-Manager + SSH var is
// non-empty. We do NOT pre-validate credential VALIDITY here — that only
// surfaces when the SDK actually calls Secrets Manager — but if the env
// itself is missing keys, there is nothing to try and we should jump to the
// direct fallback.
function awsPathConfigured() {
  const required = [
    'AWS_SECRET_NAME',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'SSH_HOST',
    'SSH_USER',
    'SSH_KEY_PATH'
  ];
  return required.every((key) => {
    const v = process.env[key];
    return typeof v === 'string' && v.trim() !== '';
  });
}

// Decide which path(s) to try, given current env. Returns:
//   { primary: 'aws' | 'direct' | null,
//     fallback: 'direct' | null,
//     reason: string }
// `primary` is what we attempt first; `fallback` only fires when the primary
// throws and is purely opt-in via env.
function decideCqmPath() {
  const directAvailable = cqmDirect.directDbAvailable();
  const directForced = cqmDirect.directDbForced();
  const directForbidden = cqmDirect.directDbDisabledExplicitly();
  const awsReady = awsPathConfigured();

  if (directForced) {
    return {
      primary: 'direct',
      fallback: null,
      reason: 'CQM_DIRECT_DB=1 forces direct DB; AWS path skipped.'
    };
  }

  if (awsReady) {
    return {
      primary: 'aws',
      fallback: directAvailable && !directForbidden ? 'direct' : null,
      reason:
        directAvailable && !directForbidden
          ? 'AWS configured (preferred); direct DB available as fallback.'
          : directForbidden
          ? 'AWS configured (preferred); direct fallback disabled by CQM_DIRECT_DB=0.'
          : 'AWS configured (preferred); no direct fallback available (DB_* not set).'
    };
  }

  if (directAvailable && !directForbidden) {
    return {
      primary: 'direct',
      fallback: null,
      reason: 'AWS env incomplete; falling through to direct DB.'
    };
  }

  return {
    primary: null,
    fallback: null,
    reason:
      'Neither path is usable: AWS env incomplete and ' +
      (directForbidden
        ? 'direct DB explicitly disabled (CQM_DIRECT_DB=0).'
        : 'direct DB env (DB_HOST/USER/PASSWORD/NAME) not populated.')
  };
}

class CqmReporter {
  constructor() {
    this.results = [];
    this.totalPassed = 0;
    this.totalFailed = 0;
    this.totalSkipped = 0;
    this.startTime = new Date();
  }

  onInit() {
    this.results = [];
    this.totalPassed = 0;
    this.totalFailed = 0;
    this.totalSkipped = 0;
    this.startTime = new Date();
  }

  onTestCaseResult(testCase) {
    if (!testCase) {
      return;
    }
    this.recordOne(toRecord(testCase));
  }

  async onTestRunEnd(...args) {
    const statusLines = [];
    const BANNER = '================ CQM REPORT ================';

    process.stderr.write(`\n${BANNER}\n`);

    if (!cqmEnabled()) {
      logBoth(statusLines, '[CqmReporter] DISABLED — CQM_INTEGRATION is not 1/true/yes; skipping CQM publish.');
      process.stderr.write(`${BANNER}\n\n`);
      writeStatus(statusLines);
      return;
    }

    logBoth(statusLines, '[CqmReporter] Starting CQM publish flow…');

    const testModules = pickTestModulesArg(args);

    if (testModules.length > 0) {
      this.results = [];
      this.totalPassed = 0;
      this.totalFailed = 0;
      this.totalSkipped = 0;
      for (const record of collectRecordsFromTestModules(testModules)) {
        this.recordOne(record);
      }
    }

    // Collapse executions → one row per test case (TC-ID) so CQM counts CASES like
    // TestRail: a case is Failed if any of its executions failed, Passed if it ran and
    // none failed, else Skipped. (data-driven test.each rows share one TC-ID.)
    this.collapseResultsToCaseLevel();

    logBoth(
      statusLines,
      `[CqmReporter] Collected ${this.results.length} case(s) ` +
        `(passed=${this.totalPassed}, failed=${this.totalFailed}, skipped=${this.totalSkipped}).`
    );

    const decision = decideCqmPath();
    logBoth(statusLines, `[CqmReporter] Routing — ${decision.reason}`);

    if (!decision.primary) {
      logBoth(
        statusLines,
        '[CqmReporter] FAILED — no usable CQM path (set AWS_* + SSH_* for AWS path, or DB_* for direct path).'
      );
      process.stderr.write(`${BANNER}\n\n`);
      writeStatus(statusLines);
      return;
    }

    let succeeded = false;
    let lastError = null;

    if (decision.primary === 'aws') {
      try {
        await this.runAwsPath(statusLines);
        succeeded = true;
      } catch (err) {
        lastError = err;
        logBoth(statusLines, `[CqmReporter] AWS path failed: ${err.message}`);
        if (decision.fallback === 'direct') {
          logBoth(
            statusLines,
            '[CqmReporter] Falling back to DIRECT (DB_* env detected; AWS unavailable).'
          );
          try {
            await this.runDirectPath(statusLines);
            succeeded = true;
            lastError = null;
          } catch (err2) {
            lastError = err2;
            logBoth(statusLines, `[CqmReporter] Direct fallback also failed: ${err2.message}`);
          }
        }
      }
    } else if (decision.primary === 'direct') {
      try {
        await this.runDirectPath(statusLines);
        succeeded = true;
      } catch (err) {
        lastError = err;
      }
    }

    if (!succeeded && lastError) {
      const stack = lastError.stack ? lastError.stack : String(lastError);
      logBoth(statusLines, '[CqmReporter] FAILED — Failed to report to CQM DB:');
      process.stderr.write(`${stack}\n`);
      statusLines.push(stack);
    }

    process.stderr.write(`${BANNER}\n\n`);
    writeStatus(statusLines);
  }

  async runAwsPath(statusLines) {
    const {
      setupDatabaseConnection,
      Insert_Records,
      Insert_Test_Execution_Records,
      getComponentIdByKey,
      getGitCommitId
    } = loadDbConnectionModule();

    const awsSecretName = mustEnv('AWS_SECRET_NAME', 'secret_name');
    const awsRegion = mustEnv('AWS_REGION', 'region');
    const awsAccessKeyId = mustEnv('AWS_ACCESS_KEY_ID', 'aws_access_key_id');
    const awsSecretAccessKey = mustEnv('AWS_SECRET_ACCESS_KEY', 'aws_secret_access_key');
    const awsSessionToken = envValue('AWS_SESSION_TOKEN', 'aws_session_token');
    const sshHost = mustEnv('SSH_HOST', 'sshHost');
    const sshPort = parsePort(envValue('SSH_PORT', 'sshPort') || String(DEFAULT_SSH_PORT));
    const sshUser = mustEnv('SSH_USER', 'sshUser');
    const sshKeyPath = mustEnv('SSH_KEY_PATH', 'sshKeyPath');

    logBoth(
      statusLines,
      `[CqmReporter] Mode: AWS (Secrets Manager + @test/integrations).`
    );
    logBoth(
      statusLines,
      `[CqmReporter] AWS config — region=${awsRegion}, ssh=${sshUser}@${sshHost}:${sshPort}, ` +
        `accessKeyPrefix=${awsAccessKeyId.slice(0, 4)}***, sessionToken=${awsSessionToken ? 'present' : 'absent'}.`
    );

    const db = await setupDatabaseConnection(
      awsSecretName,
      awsRegion,
      awsAccessKeyId,
      awsSecretAccessKey,
      awsSessionToken,
      sshHost,
      sshPort,
      sshUser,
      sshKeyPath
    );

    if (!db) {
      throw new Error(
        'setupDatabaseConnection returned null/undefined — AWS Secrets Manager could not retrieve credentials. ' +
          'Check AWS keys / region / secret name / VPN.'
      );
    }

    try {
      logBoth(statusLines, '[CqmReporter] AWS DB connection established.');

      const componentKey = resolveComponentKey();
      const componentId = await getComponentIdByKey(db, componentKey);
      const commitId = resolveCommitId(getGitCommitId);
      const executionStart = formatDateTime(this.startTime);
      const executionEnd = formatDateTime(new Date());
      const totalCases = this.totalPassed + this.totalFailed + this.totalSkipped;

      logBoth(
        statusLines,
        `[CqmReporter] Inserting automation_run for component=${componentKey} (id=${componentId}), commit=${commitId}.`
      );

      const automationRunId = await Insert_Records(
        db,
        componentId,
        commitId,
        totalCases,
        this.totalPassed,
        this.totalFailed,
        this.totalSkipped,
        executionStart,
        executionEnd,
        executionEnd
      );

      await Insert_Test_Execution_Records(db, this.results, automationRunId);
      logBoth(
        statusLines,
        `[CqmReporter] SUCCESS — Inserted automation_run=${automationRunId}, tests=${this.results.length} (AWS mode).`
      );
    } finally {
      try {
        if (typeof db.end === 'function') {
          db.end();
        }
      } catch {
        /* best-effort cleanup */
      }
    }
  }

  async runDirectPath(statusLines) {
    const layerRoot = path.resolve(__dirname, '..');
    const cfg = cqmDirect.resolveDirectDbConfig(layerRoot);
    logBoth(
      statusLines,
      `[CqmReporter] Mode: DIRECT (SSH tunnel + MySQL, no AWS Secrets Manager).`
    );
    logBoth(
      statusLines,
      `[CqmReporter] Direct config — ssh=${cfg.sshUser}@${cfg.sshHost}:${cfg.sshPort}, ` +
        `db=${cfg.dbHost}:${cfg.dbPort}/${cfg.dbName}, user=${cfg.dbUser}.`
    );

    const handle = await cqmDirect.setupDirectDb(cfg);
    try {
      logBoth(statusLines, '[CqmReporter] Direct DB connection established.');

      const componentKey = resolveComponentKey();
      const componentId = await cqmDirect.lookupComponentIdByKey(handle.conn, componentKey);
      const commitId = resolveCommitId(cqmDirect.getCurrentGitCommitId);
      const executionStart = formatDateTime(this.startTime);
      const executionEnd = formatDateTime(new Date());
      const totalCases = this.totalPassed + this.totalFailed + this.totalSkipped;

      logBoth(
        statusLines,
        `[CqmReporter] Inserting automation_run for component=${componentKey} (id=${componentId}), commit=${commitId}.`
      );

      const automationRunId = await cqmDirect.insertAutomationRun(handle.conn, {
        component_id: componentId,
        master_branch_commit_id: commitId,
        total_test_cases: totalCases,
        total_test_passed: this.totalPassed,
        total_test_failed: this.totalFailed,
        total_test_skipped: this.totalSkipped,
        execution_start_time: executionStart,
        execution_end_time: executionEnd,
        executed_at: executionEnd
      });

      const inserted = await cqmDirect.insertTestExecutions(handle.conn, automationRunId, this.results);
      logBoth(
        statusLines,
        `[CqmReporter] SUCCESS — Inserted automation_run=${automationRunId}, tests=${inserted} (direct mode).`
      );
    } finally {
      try {
        await handle.close();
      } catch {
        /* best-effort cleanup */
      }
    }
  }

  // Group executions by TC-ID (worst status wins) → case-level rows + totals, so CQM
  // matches TestRail's case granularity. Multi-segment ids (TC-UAUTH-API-024) supported.
  // Only count TC-IDs present in caseMapping.json (the TestRail run's universe), so
  // unmapped suites not yet imported to TestRail are excluded everywhere consistently.
  collapseResultsToCaseLevel() {
    const TC_ID = /TC-(?:[A-Z0-9]+-)+\d+/;
    const rank = { Skipped: 0, Passed: 1, Failed: 2 };
    let mapped = null;
    try {
      const mapPath = path.resolve(__dirname, '..', 'testrail', 'mappingStore', 'caseMapping.json');
      mapped = new Set(Object.keys(JSON.parse(fs.readFileSync(mapPath, 'utf8'))));
    } catch {
      mapped = null; // mapping unavailable → count all (no filter)
    }
    const byId = new Map();
    for (const r of this.results) {
      const match = TC_ID.exec(r.test_case_name || '');
      const key = match ? match[0] : r.test_case_name || '';
      if (mapped && !mapped.has(key)) {
        continue;
      }
      const existing = byId.get(key);
      if (!existing || rank[r.test_case_status] > rank[existing.test_case_status]) {
        byId.set(key, r);
      }
    }
    this.results = [...byId.values()];
    this.totalPassed = this.results.filter((r) => r.test_case_status === 'Passed').length;
    this.totalFailed = this.results.filter((r) => r.test_case_status === 'Failed').length;
    this.totalSkipped = this.results.filter((r) => r.test_case_status === 'Skipped').length;
  }

  recordOne(record) {
    const isPassed = record.status === 'passed';
    const isSkipped = record.status === 'skipped';
    const isFailed = record.status === 'failed';
    const start = record.startedAt instanceof Date ? record.startedAt : new Date();
    const end = record.endedAt instanceof Date ? record.endedAt : new Date(start.getTime());
    let testCaseStatus;
    if (isPassed) {
      testCaseStatus = 'Passed';
    } else if (isSkipped) {
      testCaseStatus = 'Skipped';
    } else {
      testCaseStatus = 'Failed';
    }

    this.results.push({
      test_case_name: formatScenarioTitle(record),
      test_case_status: testCaseStatus,
      test_type: resolveTestType(record),
      failure_reason: isFailed ? cleanFailureReason(record.errorMessage || 'Unknown error') : null,
      test_start_time: formatDateTime(start),
      test_end_time: formatDateTime(end),
      recorded_at: formatDateTime(new Date())
    });

    if (isPassed) {
      this.totalPassed += 1;
    } else if (isSkipped) {
      this.totalSkipped += 1;
    } else {
      this.totalFailed += 1;
    }
  }
}

module.exports = CqmReporter;
module.exports.default = CqmReporter;
