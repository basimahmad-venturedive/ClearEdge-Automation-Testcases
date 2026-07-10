// Playwright CQM reporter — inserts one automation_run row + N test_case_execution
// rows into the VentureDive CQM MySQL database after a run.
//
// Gating: no-op unless CQM_INTEGRATION=1 (or true/yes).
//
// Dual path (mirrors automation/api-ts/reporters/cqmReporter.cjs):
//   • AWS path    — Secrets Manager via @test/integrations, when AWS_* + SSH_* set.
//   • Direct path — SSH tunnel + mysql2 (reporters/cqmDirect.js), when DB_* set.
// CQM_DIRECT_DB=1 forces direct; =0 forbids the direct fallback.

const cqmDirect = require('./cqmDirect');

const DEFAULT_CQM_TIMEZONE = 'Asia/Karachi';
const DEFAULT_SSH_PORT = 22;
const FAILURE_REASON_HARD_LIMIT = 250;
const FAILURE_REASON_LINE_LIMIT = 2;

function cqmEnabled() {
  const value = String(process.env.CQM_INTEGRATION ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
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
  const uiComponentKey = envValue('COMPONENT_KEY_UI');
  if (uiComponentKey) {
    return uiComponentKey;
  }
  return mustEnv('COMPONENT_KEY_API');
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
  // eslint-disable-next-line no-control-regex
  const noAnsi = (message || '').replace(/\[.*?m/g, '');
  const lines = noAnsi.split('\n');
  const filtered = lines.filter((line) => /Expected|Received|Error|Timed out|expect/i.test(line));
  return (
    filtered.slice(0, FAILURE_REASON_LINE_LIMIT).join(' ').trim() ||
    noAnsi.slice(0, FAILURE_REASON_HARD_LIMIT)
  ).trim();
}

function formatScenarioTitle(test) {
  return test.title.replace(/\s+@\S+/g, '').trim();
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
      return require(id);
    } catch (error) {
      loadErrors.push(`${id}: ${error.message}`);
    }
  }
  throw new Error(`Could not load DB connection module from @test/integrations.\n${loadErrors.join('\n')}`);
}

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

function decideCqmPath() {
  const directAvailable = cqmDirect.directDbAvailable();
  const directForced = cqmDirect.directDbForced();
  const directForbidden = cqmDirect.directDbDisabledExplicitly();
  const awsReady = awsPathConfigured();

  if (directForced) {
    return { primary: 'direct', fallback: null, reason: 'CQM_DIRECT_DB=1 forces direct DB; AWS path skipped.' };
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
    return { primary: 'direct', fallback: null, reason: 'AWS env incomplete; falling through to direct DB.' };
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

  onBegin() {
    this.results = [];
    this.totalPassed = 0;
    this.totalFailed = 0;
    this.totalSkipped = 0;
    this.startTime = new Date();
  }

  onTestEnd(test, result) {
    const start = new Date(result.startTime);
    const end = new Date(start.getTime() + result.duration);
    const isPassed = result.status === 'passed';
    const isFailed = result.status === 'failed' || result.status === 'timedOut';
    const isSkipped = result.status === 'skipped' || result.status === 'interrupted';
    const errorMessage = result.errors?.[0]?.message || '';

    this.results.push({
      test_case_name: formatScenarioTitle(test),
      test_case_status: isPassed ? 'Passed' : isSkipped ? 'Skipped' : 'Failed',
      failure_reason: isFailed ? cleanFailureReason(errorMessage || 'Unknown error') : null,
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

  async onEnd() {
    if (!cqmEnabled()) {
      return;
    }

    const decision = decideCqmPath();
    console.log(`[CqmReporter] Routing — ${decision.reason}`);

    if (!decision.primary) {
      console.warn(
        '[CqmReporter] No usable CQM path (set AWS_* + SSH_* for AWS path, or DB_* for direct path).'
      );
      return;
    }

    try {
      if (decision.primary === 'aws') {
        try {
          await this.runAwsPath();
        } catch (err) {
          console.warn(`[CqmReporter] AWS path failed: ${err.message}`);
          if (decision.fallback === 'direct') {
            console.log('[CqmReporter] Falling back to DIRECT DB.');
            await this.runDirectPath();
          } else {
            throw err;
          }
        }
      } else {
        await this.runDirectPath();
      }
    } catch (error) {
      console.error('[CqmReporter] Failed to report to CQM DB:', error.message);
    }
  }

  async runAwsPath() {
    const {
      setupDatabaseConnection,
      Insert_Records,
      Insert_Test_Execution_Records,
      getComponentIdByKey,
      getGitCommitId
    } = loadDbConnectionModule();

    const db = await setupDatabaseConnection(
      mustEnv('AWS_SECRET_NAME', 'secret_name'),
      mustEnv('AWS_REGION', 'region'),
      mustEnv('AWS_ACCESS_KEY_ID', 'AccessKey'),
      mustEnv('AWS_SECRET_ACCESS_KEY', 'SecretAccessKey'),
      envValue('AWS_SESSION_TOKEN', 'SessionToken'),
      mustEnv('SSH_HOST', 'sshHost'),
      parsePort(envValue('SSH_PORT', 'sshPort') || String(DEFAULT_SSH_PORT)),
      mustEnv('SSH_USER', 'sshUser'),
      mustEnv('SSH_KEY_PATH', 'sshKeyPath')
    );

    if (!db) {
      throw new Error('setupDatabaseConnection returned null — check AWS keys / region / secret name / VPN.');
    }

    try {
      const componentKey = resolveComponentKey();
      const componentId = await getComponentIdByKey(db, componentKey);
      const commitId = resolveCommitId(getGitCommitId);
      const executionStart = formatDateTime(this.startTime);
      const executionEnd = formatDateTime(new Date());
      const totalCases = this.totalPassed + this.totalFailed + this.totalSkipped;

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
      console.log(`[CqmReporter] SUCCESS — automation_run=${automationRunId}, tests=${this.results.length} (AWS mode).`);
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

  async runDirectPath() {
    const cfg = cqmDirect.resolveDirectDbConfig(__dirname);
    const handle = await cqmDirect.setupDirectDb(cfg);
    try {
      const componentKey = resolveComponentKey();
      const componentId = await cqmDirect.lookupComponentIdByKey(handle.conn, componentKey);
      const commitId = resolveCommitId(cqmDirect.getCurrentGitCommitId);
      const executionStart = formatDateTime(this.startTime);
      const executionEnd = formatDateTime(new Date());
      const totalCases = this.totalPassed + this.totalFailed + this.totalSkipped;

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
      console.log(`[CqmReporter] SUCCESS — automation_run=${automationRunId}, tests=${inserted} (direct mode).`);
    } finally {
      try {
        await handle.close();
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

module.exports = CqmReporter;
