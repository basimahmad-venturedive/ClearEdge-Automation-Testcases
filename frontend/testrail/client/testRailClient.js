const axios = require('axios');

class TestRailClient {
  constructor({ url, username, password, retries = 2 }) {
    this.url = this.normalizeUrl(url);
    this.retries = retries;
    this.http = axios.create({
      baseURL: `${this.url}/index.php?/api/v2`,
      auth: {
        username,
        password
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  normalizeUrl(url) {
    return (url || '').replace(/\/$/, '');
  }

  async request(method, endpoint, body) {
    let lastError;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await this.http.request({
          method,
          url: endpoint,
          data: body
        });
        return response.data;
      } catch (error) {
        lastError = error;

        if (attempt === this.retries || !this.shouldRetry(error)) {
          break;
        }

        await this.delay(500 * (attempt + 1));
      }
    }

    throw this.toError(method, endpoint, lastError);
  }

  shouldRetry(error) {
    const status = error.response?.status;
    return !status || status >= 500 || status === 429;
  }

  delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  toError(method, endpoint, error) {
    const status = error.response?.status || 'NO_STATUS';
    const details = JSON.stringify(error.response?.data || error.message);
    return new Error(`TestRail API ${method} ${endpoint} failed: ${status} ${details}`);
  }

  async getProjects() {
    const data = await this.request('GET', '/get_projects');
    return Array.isArray(data) ? data : data.projects || [];
  }

  async getProjectByName(projectName) {
    const projects = await this.getProjects();
    return projects.find((project) => project.name.toLowerCase() === projectName.toLowerCase());
  }

  async getSections(projectId) {
    const data = await this.request('GET', `/get_sections/${projectId}`);
    return Array.isArray(data) ? data : data.sections || [];
  }

  async addSection(projectId, name) {
    return await this.request('POST', `/add_section/${projectId}`, { name });
  }

  async getCases(projectId) {
    const data = await this.request('GET', `/get_cases/${projectId}`);
    return Array.isArray(data) ? data : data.cases || [];
  }

  async addCase(sectionId, payload) {
    return await this.request('POST', `/add_case/${sectionId}`, payload);
  }

  async updateCase(caseId, payload) {
    return await this.request('POST', `/update_case/${caseId}`, payload);
  }

  async addRun(projectId, payload) {
    return await this.request('POST', `/add_run/${projectId}`, payload);
  }

  async addResultsForCases(runId, results) {
    return await this.request('POST', `/add_results_for_cases/${runId}`, { results });
  }
}

module.exports = { TestRailClient };
