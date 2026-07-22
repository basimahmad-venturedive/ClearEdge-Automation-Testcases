/**
 * Self-contained ExtentReports-style HTML reporter for the API-TS Vitest suite.
 * Writes a single dashboard file per run to automation/reports/html/api/latest.html
 * (path is fixed per team convention — do not read it from .env, it is not a secret/base-URL).
 *
 * Each test row expands to show every HTTP call it made — request headers, request
 * payload, response headers, response body — captured by src/utils/apiCapture.ts and
 * handed over on `task.meta.apiCalls`. A status filter (All / Passed / Failed / Skipped)
 * sits at the top of the report.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Reporter, TestModule } from "vitest/node";

/**
 * Feature specs live in documents/input/SPEC_CEIQ-*.md. Every test file names its
 * owning spec in its header comment (e.g. "CEIQ-FEAT-004 Company Settings ..."), so
 * we read that code straight from the source. This label map turns the raw code into
 * the human title used in the report's Spec filter; unknown codes fall back to the code.
 */
const FEATURE_LABELS: Record<string, string> = {
  "CEIQ-FEAT-001": "Admin Portal",
  "CEIQ-FEAT-002": "User Authentication",
  "CEIQ-FEAT-003": "User Management",
  "CEIQ-FEAT-004": "Company Settings",
  "CEIQ-FEAT-005": "Vendor Directory",
  "CEIQ-FOUND-001": "Identity, RBAC & Audit",
};

const UNMAPPED = "Unmapped";
const featureCache = new Map<string, string>();

/** First CEIQ-FEAT-/CEIQ-FOUND- code in a test file's source, cached per file. */
function featureForModule(absPath: string): string {
  const cached = featureCache.get(absPath);
  if (cached) return cached;
  let code = UNMAPPED;
  try {
    const match = readFileSync(absPath, "utf-8").match(/CEIQ-(?:FEAT|FOUND)-\d+/);
    if (match) code = match[0];
  } catch {
    /* unreadable source — leave Unmapped */
  }
  featureCache.set(absPath, code);
  return code;
}

/** "CEIQ-FEAT-004 — Company Settings" (or just the code when unmapped/unknown). */
function featureLabel(code: string): string {
  const name = FEATURE_LABELS[code];
  return name ? `${code} — ${name}` : code;
}

interface ApiCall {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  status: number | null;
  statusText: string;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  durationMs: number;
  error?: string;
}

interface FlatResult {
  suite: string;
  name: string;
  file: string;
  feature: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  message?: string;
  stack?: string;
  apiCalls: ApiCall[];
}

const REPORT_DIR = path.resolve(__dirname, "../../reports/html/api");
const REPORT_FILE = path.join(REPORT_DIR, "latest.html");

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_.]+/g,
  /Authorization"?\s*[:=]\s*"?\S+/gi,
  /"?(?:api[_-]?key|password|token|refreshToken|accessToken|idToken)"?\s*[:=]\s*"[^"]*"/gi,
];

function redact(input: string | undefined): string | undefined {
  if (!input) return input;
  return SECRET_PATTERNS.reduce((s, re) => s.replace(re, "<redacted>"), input);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON-stringify arbitrary captured data, redact secrets, escape for HTML. */
function fmt(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) {
    text = "(empty)";
  } else if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  return escapeHtml(redact(text) ?? "");
}

export default class ExtentReporter implements Reporter {
  private startedAt = new Date();

  onInit(): void {
    this.startedAt = new Date();
  }

  onTestRunStart(): void {
    this.startedAt = new Date();
  }

  // Vitest 4 reporter hook (replaces the removed onFinished(files) — the old hook never
  // fired under v4, so latest.html went stale). Flattens the TestModule tree via the
  // reporting API (TestModule.children.allTests() -> TestCase.result()/diagnostic()/meta()).
  onTestRunEnd(testModules: ReadonlyArray<TestModule> = []): void {
    const results: FlatResult[] = [];
    for (const mod of testModules) {
      const relFile = path.relative(path.resolve(__dirname, ".."), mod.moduleId);
      const feature = featureForModule(mod.moduleId);
      for (const test of mod.children.allTests()) {
        const res = test.result();
        const status: FlatResult["status"] =
          res.state === "passed" ? "passed" : res.state === "failed" ? "failed" : "skipped";
        const firstError = res.state === "failed" ? res.errors?.[0] : undefined;
        const parts = test.fullName.split(" > ");
        const suite = parts.length > 1 ? parts.slice(0, -1).join(" > ") : "(root)";
        const meta = test.meta() as { apiCalls?: ApiCall[] };
        results.push({
          suite,
          name: test.name,
          file: relFile,
          feature,
          status,
          durationMs: Math.round(test.diagnostic()?.duration ?? 0),
          message: redact(firstError?.message),
          stack: redact(firstError?.stack),
          apiCalls: Array.isArray(meta?.apiCalls) ? meta.apiCalls : [],
        });
      }
    }

    const total = results.length;
    const passed = results.filter((r) => r.status === "passed").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const passRate = total > 0 ? Math.round((passed / total) * 1000) / 10 : 0;
    const durationS = ((Date.now() - this.startedAt.getTime()) / 1000).toFixed(2);

    const html = renderHtml({
      results,
      total,
      passed,
      failed,
      skipped,
      passRate,
      durationS,
      startedAt: this.startedAt,
      environment: process.env.TEST_ENV ?? "local",
    });

    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(REPORT_FILE, html, "utf-8");
    // eslint-disable-next-line no-console
    console.log(`\nExtent-style HTML report written: ${REPORT_FILE}`);
  }
}

function renderApiCall(call: ApiCall): string {
  const statusText = call.status !== null ? `${call.status} ${escapeHtml(call.statusText)}` : "NO RESPONSE";
  const statusClass = call.status === null ? "err" : call.status < 400 ? "ok" : "bad";
  return `
    <div class="api-call">
      <div class="api-call-head">
        <span class="method">${escapeHtml(call.method)}</span>
        <span class="url">${escapeHtml(redact(call.url) ?? "")}</span>
        <span class="http-status ${statusClass}">${statusText}</span>
        <span class="muted">${call.durationMs} ms</span>
      </div>
      ${call.error ? `<div class="api-error">Network error: ${escapeHtml(redact(call.error) ?? "")}</div>` : ""}
      <div class="api-grid">
        <div class="api-pane"><h5>Request Headers</h5><pre>${fmt(call.requestHeaders)}</pre></div>
        <div class="api-pane"><h5>Request Payload</h5><pre>${fmt(call.requestBody)}</pre></div>
        <div class="api-pane"><h5>Response Headers</h5><pre>${fmt(call.responseHeaders)}</pre></div>
        <div class="api-pane"><h5>Response Body</h5><pre>${fmt(call.responseBody)}</pre></div>
      </div>
    </div>`;
}

function renderHtml(data: {
  results: FlatResult[];
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  durationS: string;
  startedAt: Date;
  environment: string;
}): string {
  const { results, total, passed, failed, skipped, passRate, durationS, startedAt, environment } = data;

  const donutDeg = total > 0 ? (passRate / 100) * 360 : 0;

  const bySuite = new Map<string, FlatResult[]>();
  for (const r of results) {
    if (!bySuite.has(r.suite)) bySuite.set(r.suite, []);
    bySuite.get(r.suite)!.push(r);
  }

  // Per-feature counts drive the "Spec" filter dropdown so results can be viewed one
  // feature spec (CEIQ-FEAT-xxx / CEIQ-FOUND-xxx) at a time — the code is read from each
  // test file's header (see featureForModule). Unmapped files sort last.
  const byFeature = new Map<string, number>();
  for (const r of results) byFeature.set(r.feature, (byFeature.get(r.feature) ?? 0) + 1);
  const specOptions = [...byFeature.entries()]
    .sort(([a], [b]) => (a === UNMAPPED ? 1 : b === UNMAPPED ? -1 : a.localeCompare(b)))
    .map(([code, count]) => `<option value="${escapeHtml(code)}">${escapeHtml(featureLabel(code))} (${count})</option>`)
    .join("");

  const rows = [...bySuite.entries()]
    .map(([suite, tests], suiteIdx) => {
      const testRows = tests
        .map((t, i) => {
          const rowId = `s${suiteIdx}-t${i}`;
          const badgeClass = t.status;
          const hasError = Boolean(t.message || t.stack);
          const hasApi = t.apiCalls.length > 0;
          const hasDetail = hasError || hasApi;
          const apiSummary = hasApi ? `<span class="api-count">${t.apiCalls.length} call${t.apiCalls.length === 1 ? "" : "s"}</span>` : "";
          return `
        <tr class="test-row ${badgeClass}" data-status="${t.status}" data-feature="${escapeHtml(t.feature)}" data-row="${rowId}" ${hasDetail ? `onclick="toggleDetail('${rowId}')" style="cursor:pointer"` : ""}>
          <td><span class="badge ${badgeClass}">${t.status.toUpperCase()}</span></td>
          <td>${escapeHtml(t.name)} ${apiSummary}</td>
          <td class="muted">${escapeHtml(t.file)}</td>
          <td class="muted">${t.durationMs} ms</td>
        </tr>
        ${
          hasDetail
            ? `<tr class="detail-row" id="detail-${rowId}" data-row="${rowId}" style="display:none">
          <td colspan="4">
            <div class="detail-box">
              ${
                hasError
                  ? `<div class="error-block">
                      <div><strong>Failure</strong></div>
                      <pre>${escapeHtml(t.message ?? "(no message)")}</pre>
                      ${t.stack ? `<details><summary>Stack trace</summary><pre>${escapeHtml(t.stack)}</pre></details>` : ""}
                    </div>`
                  : ""
              }
              ${hasApi ? t.apiCalls.map((c) => renderApiCall(c)).join("") : ""}
              ${!hasApi && !hasError ? "<div class='muted'>No HTTP calls recorded.</div>" : ""}
            </div>
          </td>
        </tr>`
            : ""
        }`;
        })
        .join("");
      return `
      <div class="suite-block">
        <h3 class="suite-title">${escapeHtml(suite)}</h3>
        <table class="test-table">
          <thead><tr><th>Status</th><th>Test</th><th>File</th><th>Duration</th></tr></thead>
          <tbody>${testRows}</tbody>
        </table>
      </div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>API Automation — Extent Report</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --pass: #2e7d32; --fail: #c62828; --skip: #f9a825; --bg: #0f172a; --panel: #ffffff;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #f4f6f9; color: #1e293b; }
  header { background: var(--bg); color: #fff; padding: 24px 32px; }
  header h1 { margin: 0 0 4px; font-size: 22px; }
  header .meta { font-size: 13px; color: #94a3b8; }
  .dashboard { display: flex; gap: 24px; padding: 24px 32px 8px; flex-wrap: wrap; align-items: center; }
  .card { background: var(--panel); border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.1); padding: 20px; }
  .donut-card { display: flex; align-items: center; gap: 20px; }
  .donut {
    width: 120px; height: 120px; border-radius: 50%;
    background: conic-gradient(var(--pass) 0deg ${donutDeg}deg, #e2e8f0 ${donutDeg}deg 360deg);
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .donut span { background: #fff; border-radius: 50%; width: 84px; height: 84px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 20px; }
  .stats { display: flex; gap: 16px; }
  .stat { text-align: center; min-width: 70px; }
  .stat .num { font-size: 24px; font-weight: 700; }
  .stat.pass .num { color: var(--pass); }
  .stat.fail .num { color: var(--fail); }
  .stat.skip .num { color: var(--skip); }
  .stat .lbl { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: .03em; }
  .filter-bar { display: flex; gap: 10px; padding: 8px 32px 20px; flex-wrap: wrap; }
  .filter-btn { border: 1px solid #cbd5e1; background: #fff; color: #334155; padding: 7px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .filter-btn:hover { background: #eef2f7; }
  .filter-btn.active { background: var(--bg); color: #fff; border-color: var(--bg); }
  .filter-btn.all.active { background: #334155; border-color: #334155; }
  .filter-btn.passed.active { background: var(--pass); border-color: var(--pass); }
  .filter-btn.failed.active { background: var(--fail); border-color: var(--fail); }
  .filter-btn.skipped.active { background: var(--skip); border-color: var(--skip); color: #1e293b; }
  .spec-filter { display: flex; align-items: center; gap: 8px; margin-left: auto; font-size: 13px; color: #334155; font-weight: 600; }
  .spec-filter select { border: 1px solid #cbd5e1; background: #fff; color: #334155; padding: 7px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; cursor: pointer; max-width: 340px; }
  main { padding: 0 32px 40px; }
  .suite-title { margin: 28px 0 8px; font-size: 15px; color: #334155; }
  .test-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .test-table th { text-align: left; background: #eef2f7; padding: 10px 14px; font-size: 12px; text-transform: uppercase; color: #64748b; }
  .test-table td { padding: 10px 14px; font-size: 13px; border-top: 1px solid #eef2f7; vertical-align: top; }
  .muted { color: #64748b; }
  .badge { padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; color: #fff; white-space: nowrap; }
  .badge.passed { background: var(--pass); }
  .badge.failed { background: var(--fail); }
  .badge.skipped { background: var(--skip); }
  .api-count { display: inline-block; margin-left: 8px; font-size: 11px; color: #475569; background: #e2e8f0; border-radius: 10px; padding: 1px 8px; }
  .detail-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px; }
  .error-block { background: #fff7f7; border: 1px solid #fecaca; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px; }
  .detail-box pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; margin: 6px 0; background: #0f172a; color: #e2e8f0; padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
  .error-block pre { background: #fff; color: #7f1d1d; }
  .api-call { border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 12px; background: #fff; }
  .api-call-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 14px; border-bottom: 1px solid #eef2f7; font-size: 13px; }
  .api-call-head .method { font-weight: 700; color: #1d4ed8; }
  .api-call-head .url { font-family: ui-monospace, Menlo, Consolas, monospace; word-break: break-all; flex: 1; min-width: 200px; }
  .http-status { font-weight: 700; padding: 2px 8px; border-radius: 10px; font-size: 11px; }
  .http-status.ok { background: #dcfce7; color: #166534; }
  .http-status.bad { background: #fee2e2; color: #991b1b; }
  .http-status.err { background: #fef9c3; color: #854d0e; }
  .api-error { padding: 8px 14px; color: #991b1b; font-size: 12px; }
  .api-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px 14px; }
  .api-pane h5 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; }
  .api-pane pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; margin: 0; background: #0f172a; color: #e2e8f0; padding: 10px 12px; border-radius: 6px; max-height: 320px; overflow: auto; }
  @media (max-width: 720px) { .api-grid { grid-template-columns: 1fr; } }
  footer { text-align: center; padding: 16px; color: #94a3b8; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>API Automation — Execution Report</h1>
  <div class="meta">Environment: ${escapeHtml(environment)} &nbsp;·&nbsp; Started: ${startedAt.toISOString()} &nbsp;·&nbsp; Duration: ${durationS}s</div>
</header>
<div class="dashboard">
  <div class="card donut-card">
    <div class="donut"><span>${passRate}%</span></div>
    <div class="stats">
      <div class="stat"><div class="num">${total}</div><div class="lbl">Total</div></div>
      <div class="stat pass"><div class="num">${passed}</div><div class="lbl">Passed</div></div>
      <div class="stat fail"><div class="num">${failed}</div><div class="lbl">Failed</div></div>
      <div class="stat skip"><div class="num">${skipped}</div><div class="lbl">Skipped</div></div>
    </div>
  </div>
</div>
<div class="filter-bar">
  <button class="filter-btn all active" data-filter="all" onclick="applyFilter('all')">All (${total})</button>
  <button class="filter-btn passed" data-filter="passed" onclick="applyFilter('passed')">Passed (${passed})</button>
  <button class="filter-btn failed" data-filter="failed" onclick="applyFilter('failed')">Failed (${failed})</button>
  <button class="filter-btn skipped" data-filter="skipped" onclick="applyFilter('skipped')">Skipped (${skipped})</button>
  <label class="spec-filter">
    <span>Spec:</span>
    <select id="spec-select" onchange="applyFilter()">
      <option value="all">All specs (${total})</option>
      ${specOptions}
    </select>
  </label>
</div>
<main>
${rows || "<p>No tests executed.</p>"}
</main>
<footer>Generated by automation/api-ts/reporters/extentReporter.ts</footer>
<script>
  function toggleDetail(id) {
    var el = document.getElementById('detail-' + id);
    if (el) el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
  }
  var currentStatus = 'all';
  // applyFilter() re-applies both the status filter (buttons) and the spec filter (dropdown).
  // Called with a status to change the status; called with no argument (from the dropdown)
  // to keep the current status and just re-evaluate the selected spec.
  function applyFilter(status) {
    if (status) currentStatus = status;
    document.querySelectorAll('.filter-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.filter === currentStatus);
    });
    var specSelect = document.getElementById('spec-select');
    var spec = specSelect ? specSelect.value : 'all';
    document.querySelectorAll('tr.test-row').forEach(function (row) {
      var statusOk = currentStatus === 'all' || row.dataset.status === currentStatus;
      var specOk = spec === 'all' || row.dataset.feature === spec;
      var show = statusOk && specOk;
      row.style.display = show ? '' : 'none';
      var detail = document.getElementById('detail-' + row.dataset.row);
      if (detail && !show) detail.style.display = 'none';
    });
    document.querySelectorAll('.suite-block').forEach(function (block) {
      var anyVisible = Array.prototype.some.call(block.querySelectorAll('tr.test-row'), function (r) {
        return r.style.display !== 'none';
      });
      block.style.display = anyVisible ? '' : 'none';
    });
  }
</script>
</body>
</html>`;
}
