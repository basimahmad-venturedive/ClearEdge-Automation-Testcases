import config from '../config/configManager.js';
import { TESTRAIL_STATUS } from '../constants/index.js';
import { timestampForRun } from '../utils/dateUtil.js';
import logger from '../logger/logger.js';

/**
 * TestRail API client for test run management and result updates.
 */
export class TestRailClient {
  constructor() {
    const { url, username, apiKey, projectId, suiteId } = config.testRail;
    this.baseUrl = url;
    this.auth = Buffer.from(`${username}:${apiKey}`).toString('base64');
    this.projectId = projectId;
    this.suiteId = suiteId;
    this.runId = null;
    this.enabled = config.reporting.testRail && !!url && !!apiKey;
  }

  async request(method, endpoint, body) {
    const response = await fetch(`${this.baseUrl}/index.php?/api/v2/${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${this.auth}`,
      },
      ...(body && { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TestRail API error ${response.status}: ${text}`);
    }

    return response.json();
  }

  async createRun(name) {
    if (!this.enabled) return null;
    const run = await this.request('POST', 'add_run/' + this.projectId, {
      suite_id: parseInt(this.suiteId, 10),
      name,
      include_all: true,
    });
    this.runId = run.id;
    logger.info(`TestRail run created: ${run.id} - ${name}`);
    return run.id;
  }

  async addResult(caseId, status, comment = '') {
    if (!this.enabled || !this.runId || !caseId) return;
    const numericCaseId = caseId.replace(/^C/, '');
    await this.request('POST', `add_result_for_case/${this.runId}/${numericCaseId}`, {
      status_id: status,
      comment,
    });
    logger.debug(`TestRail result updated: ${caseId} -> status ${status}`);
  }

  mapStatus(playwrightStatus) {
    const map = {
      passed: TESTRAIL_STATUS.PASSED,
      failed: TESTRAIL_STATUS.FAILED,
      skipped: TESTRAIL_STATUS.UNTESTED,
      timedOut: TESTRAIL_STATUS.FAILED,
    };
    return map[playwrightStatus] || TESTRAIL_STATUS.UNTESTED;
  }
}

export const createTestRun = async (suiteType = 'Login') => {
  const client = new TestRailClient();
  if (client.enabled) {
    const runName = `Automation ${suiteType} - ${timestampForRun()}`;
    await client.createRun(runName);
  }
  return client;
};
