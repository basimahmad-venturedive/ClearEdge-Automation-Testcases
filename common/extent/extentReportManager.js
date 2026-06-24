import fs from 'fs';
import path from 'path';
import { ensureDir } from '../utils/fileUtil.js';
import { formatDate } from '../utils/dateUtil.js';
import config from '../config/configManager.js';
import logger from '../logger/logger.js';

/**
 * Extent-style HTML report generator for Playwright results.
 */
class ExtentReportManager {
  constructor() {
    this.results = [];
    this.startTime = null;
    this.endTime = null;
  }

  onBegin() {
    if (!config.reporting.extent) return;
    this.startTime = Date.now();
    logger.info('Extent report collection started');
  }

  onTestEnd(test, result) {
    if (!config.reporting.extent) return;
    const testrailId = test.annotations.find((a) => a.type === 'testrail')?.description || '';
    this.results.push({
      title: test.title,
      status: result.status,
      duration: result.duration,
      testrailId,
      tags: test.tags,
      error: result.error?.message || '',
      attachments: result.attachments.map((a) => a.name),
    });
  }

  onEnd() {
    if (!config.reporting.extent) return;
    this.endTime = Date.now();
    this.generateReport();
  }

  generateReport() {
    const reportDir = path.resolve('reports/extent');
    ensureDir(reportDir);

    const passed = this.results.filter((r) => r.status === 'passed').length;
    const failed = this.results.filter((r) => r.status === 'failed').length;
    const skipped = this.results.filter((r) => r.status === 'skipped').length;
    const duration = ((this.endTime - this.startTime) / 1000).toFixed(2);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ClearEdge Automation Report</title>
  <style>
    body { font-family: Segoe UI, sans-serif; margin: 0; background: #f5f5f5; }
    .header { background: #1a237e; color: white; padding: 24px 32px; }
    .summary { display: flex; gap: 24px; padding: 24px 32px; }
    .card { background: white; border-radius: 8px; padding: 16px 24px; box-shadow: 0 1px 3px rgba(0,0,0,.12); flex: 1; }
    .card h3 { margin: 0 0 8px; font-size: 14px; color: #666; }
    .card .value { font-size: 28px; font-weight: bold; }
    .passed { color: #2e7d32; } .failed { color: #c62828; } .skipped { color: #f57f17; }
    table { width: calc(100% - 64px); margin: 0 32px 32px; border-collapse: collapse; background: white; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #e8eaf6; }
    tr:hover { background: #f5f5f5; }
    .status-passed { color: #2e7d32; font-weight: bold; }
    .status-failed { color: #c62828; font-weight: bold; }
    .status-skipped { color: #f57f17; font-weight: bold; }
    .meta { padding: 0 32px 16px; color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>ClearEdge Automation Report</h1>
    <p>Login Module Test Execution</p>
  </div>
  <div class="meta">
    <p>Environment: <strong>${config.env}</strong> | Browser: Chromium | Duration: ${duration}s | Generated: ${formatDate(new Date(), 'YYYY-MM-DD HH:mm:ss')}</p>
  </div>
  <div class="summary">
    <div class="card"><h3>Total</h3><div class="value">${this.results.length}</div></div>
    <div class="card"><h3>Passed</h3><div class="value passed">${passed}</div></div>
    <div class="card"><h3>Failed</h3><div class="value failed">${failed}</div></div>
    <div class="card"><h3>Skipped</h3><div class="value skipped">${skipped}</div></div>
  </div>
  <table>
    <thead><tr><th>Test</th><th>TestRail ID</th><th>Status</th><th>Duration (ms)</th><th>Tags</th><th>Error</th></tr></thead>
    <tbody>
      ${this.results.map((r) => `
        <tr>
          <td>${r.title}</td>
          <td>${r.testrailId || '-'}</td>
          <td class="status-${r.status}">${r.status.toUpperCase()}</td>
          <td>${r.duration}</td>
          <td>${r.tags.join(', ')}</td>
          <td>${r.error || '-'}</td>
        </tr>`).join('')}
    </tbody>
  </table>
</body>
</html>`;

    const reportPath = path.join(reportDir, `extent-report-${formatDate(new Date(), 'YYYY-MM-DD_HH-mm-ss')}.html`);
    fs.writeFileSync(reportPath, html, 'utf-8');
    logger.info(`Extent report generated: ${reportPath}`);
  }
}

export default ExtentReportManager;
