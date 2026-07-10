const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const {
  publishRecordsToTestRail,
  shouldPublishFromEnv
} = require('../testrail/publishRecords.cjs');

const LAYER_ROOT = path.resolve(__dirname, '..');
const defaultJunitPath = path.resolve(LAYER_ROOT, '..', 'reports', 'api-ts-junit.xml');

const forceFromExecute = process.argv.includes('--from-execute');

function extractFailurePlainText(inner) {
  const failureMessageMatch = inner.match(/<failure[^>]*message="([^"]*)"/);
  if (failureMessageMatch) {
    return decodeXmlEntities(failureMessageMatch[1]);
  }
  const errorMessageMatch = inner.match(/<error[^>]*message="([^"]*)"/);
  if (errorMessageMatch) {
    return decodeXmlEntities(errorMessageMatch[1]);
  }
  return inner.slice(0, 4000);
}

function isRateOrQuotaLimitedMessage(text) {
  const lower = text.toLowerCase();
  return (
    lower.includes('rate_limit_exceeded') ||
    lower.includes('rate limit') ||
    lower.includes('free-tier limit') ||
    lower.includes('quota') ||
    (lower.includes('429') && lower.includes('rate'))
  );
}

function decodeXmlEntities(value) {
  if (!value) {
    return '';
  }
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseRecordsFromJUnit(xml) {
  const records = [];
  const re = /<testcase\b([^>]*)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let match = re.exec(xml);

  while (match !== null) {
    const attrs = match[1];
    const inner = match[2] || '';
    // `name="` must not match inside `classname="` — use start or whitespace before `name`.
    const nameMatch = attrs.match(/(?:^|\s)name="([^"]*)"/);
    const timeMatch = attrs.match(/(?:^|\s)time="([^"]*)"/);

    if (nameMatch) {
      const fullTitle = decodeXmlEntities(nameMatch[1]);
      let status = 'passed';
      if (/<skipped\b/.test(inner)) {
        status = 'skipped';
      } else if (/<failure\b/.test(inner) || /<error\b/.test(inner)) {
        const failurePlain = extractFailurePlainText(inner);
        status = isRateOrQuotaLimitedMessage(failurePlain) ? 'rate_limited' : 'failed';
      }

      const seconds = timeMatch ? Number(timeMatch[1]) : 0;
      const duration = Number.isFinite(seconds) ? seconds * 1000 : 0;
      const failureMessageMatch = inner.match(/<failure[^>]*message="([^"]*)"/);
      const errorMessageMatch = inner.match(/<error[^>]*message="([^"]*)"/);
      const errorMessage = failureMessageMatch
        ? decodeXmlEntities(failureMessageMatch[1])
        : errorMessageMatch
          ? decodeXmlEntities(errorMessageMatch[1])
          : '';

      records.push({
        title: fullTitle,
        fullTitle,
        status,
        duration,
        errorMessage,
        filePath: ''
      });
    }

    match = re.exec(xml);
  }

  return records;
}

function resolveJUnitPath() {
  const fromEnv = process.env.TESTRAIL_JUNIT_OUT;
  if (fromEnv && String(fromEnv).trim()) {
    return path.resolve(String(fromEnv).trim());
  }
  return defaultJunitPath;
}

function junitFileIsFreshEnough(junitPath) {
  const raw = process.env.TESTRAIL_JUNIT_MIN_MTIME_MS;
  if (!raw || !String(raw).trim()) {
    return true;
  }
  const minMs = Number(String(raw).trim());
  if (!Number.isFinite(minMs)) {
    return true;
  }
  try {
    const { mtimeMs } = fs.statSync(junitPath);
    // Allow small clock / FS timestamp skew (Windows can bucket mtimes).
    return mtimeMs >= minMs - 3000;
  } catch {
    return false;
  }
}

async function readRecordsWithRetry(junitPath) {
  const maxAttempts = 60;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (fs.existsSync(junitPath) && junitFileIsFreshEnough(junitPath)) {
      const xml = fs.readFileSync(junitPath, 'utf8');
      const records = parseRecordsFromJUnit(xml);
      if (records.length > 0) {
        return records;
      }
    }

    if (attempt < maxAttempts) {
      await delay(100);
    }
  }

  return [];
}

async function main() {
  if (!forceFromExecute && !shouldPublishFromEnv()) {
    return;
  }

  const junitPath = resolveJUnitPath();

  if (!fs.existsSync(junitPath)) {
    // eslint-disable-next-line no-console
    console.warn(`[TestRail] JUnit file missing at ${junitPath}; cannot publish from JUnit fallback.`);
    return;
  }

  const records = await readRecordsWithRetry(junitPath);

  if (records.length > 0) {
    const breakdown = records.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});
    // eslint-disable-next-line no-console
    console.log(
      `[TestRail] JUnit source ${junitPath} — ${records.length} testcase(s), ` +
        `parsed status counts: ${JSON.stringify(breakdown)} (this is what will be sent to TestRail)`
    );
  }

  if (records.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[TestRail] JUnit at ${junitPath} had no parsable <testcase> rows after waiting — publish skipped.`
    );
    return;
  }

  try {
    const outcome = await publishRecordsToTestRail(records);
    if (outcome.published > 0) {
      // eslint-disable-next-line no-console
      console.log(`[TestRail] Published ${outcome.published} result(s) to run ${outcome.runId} (from JUnit).`);
    } else if (outcome.skippedReason) {
      // eslint-disable-next-line no-console
      console.warn(`[TestRail] JUnit fallback did not publish: ${outcome.skippedReason}`);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[TestRail] JUnit fallback publish failed: ${error.message}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.warn(`[TestRail] JUnit publish script failed: ${error.message}`);
  process.exit(1);
});
