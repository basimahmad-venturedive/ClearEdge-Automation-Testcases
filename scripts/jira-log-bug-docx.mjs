/**
 * Create a Jira bug from a rich (ADF) description and attach supporting files
 * (e.g. a Word bug report + a screenshot). Companion to jira-log-bug.mjs, for
 * when the bug artifact is an MS-Word .docx rather than a markdown file.
 *
 *   node automation/scripts/jira-log-bug-docx.mjs [--dry-run]
 *
 * The ADF description and attachments for the current bug are defined inline
 * below (BUG-VENDOR-001). Zero external deps: built-in fetch/FormData/Blob
 * (Node 18+) + the same tiny .env parser as jira-log-bug.mjs.
 *
 * Credentials come ONLY from the environment (real env wins; otherwise loaded
 * from automation/.env → .env.local → shared/config/.env → frontend/.env →
 * api-ts/.env). See automation/.env.example. Required env: JIRA_BASE_URL,
 * JIRA_PROJECT_KEY, JIRA_API_TOKEN (+ JIRA_EMAIL for Cloud Basic auth).
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const automationDir = path.resolve(here, '..');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const raw of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = val;
  }
}
for (const rel of ['.env', '.env.local', 'shared/config/.env', 'frontend/.env', 'api-ts/.env']) {
  loadEnvFile(path.join(automationDir, rel));
}

const dryRun = process.argv.includes('--dry-run');

// ---- bug definition ------------------------------------------------------
const clearEdgeRoot = path.resolve(automationDir, '..');
const docxPath = path.join(clearEdgeRoot, 'documents', 'output', 'Bug Reports', 'BUG-VENDOR-001.docx');
const shotPath = path.join(clearEdgeRoot, 'documents', 'output', 'Bug Reports', 'BUG-VENDOR-001-evidence.png');

const summary = 'BUG-VENDOR-001 — Vendors page shows "Request failed with status code 404" on load (dashboard API returns 404)';

const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const strong = (text) => t(text, [{ type: 'strong' }]);
const heading = (text) => ({ type: 'heading', attrs: { level: 3 }, content: [t(text)] });
const p = (...content) => ({ type: 'paragraph', content });
const li = (text) => ({ type: 'listItem', content: [p(t(text))] });

const description = {
  type: 'doc',
  version: 1,
  content: [
    p(strong('Environment: '), t('dev · ClearEdge app · dbut9mm5q1aps.cloudfront.net/vendors')),
    p(strong('Severity: '), t('Medium'), t('   '), strong('Priority: '), t('P2'), t('   '), strong('Source: '), t('Manual finding')),
    p(strong('Trace ID: '), { type: 'text', text: 'ac0ba919-7d09-4d73…', marks: [{ type: 'code' }] }),

    heading('Summary'),
    p(t('When a user lands on the Vendors page, the app fires a request to a dashboard API endpoint that returns HTTP 404 ("Cannot GET /api/… — Not Found"). A red "Request failed with status code 404" toast is shown on every visit. The vendor directory table itself still renders, but the failed request and error toast make the page look broken.')),

    heading('Steps to reproduce'),
    {
      type: 'orderedList',
      content: [
        li('Log in to the ClearEdge app (dev environment).'),
        li('Navigate to the Vendors page (/vendors).'),
        li('Observe the toast notification near the top of the page.'),
        li('Open DevTools → Network and inspect the failing requests and their response bodies.'),
      ],
    },

    heading('Expected result'),
    p(t('The Vendors page loads cleanly — all supporting API requests succeed (HTTP 200) and no error toast is shown.')),

    heading('Actual result'),
    p(t('A red "Request failed with status code 404" toast appears on load. In the Network panel the dashboard request returns HTTP 404 with this body:')),
    {
      type: 'codeBlock',
      attrs: { language: 'json' },
      content: [t('{\n  "success": false,\n  "error": {\n    "message": "Cannot GET /api/dashboard",\n    "error": "Not Found",\n    "statusCode": 404,\n    "details": {}\n  },\n  "meta": { "traceId": "ac0ba919-7d09-4d73…" }\n}')],
    },
    p(t('The vendor list still populates (e.g. VEN-000133, VEN-000132), so the failure is limited to the dashboard/supporting request rather than the vendor listing itself.')),

    heading('Notes / suspected area (to confirm)'),
    p(t('The failing call is a GET to an /api/dashboard-style route the backend does not expose ("Cannot GET" is the framework default 404 for an unregistered route). Either the Vendors page is issuing a dashboard request it should not, or the API route/base path is misconfigured for this environment. Confirm against the deployed API routes and the Vendors page data-fetching.')),

    heading('Impact'),
    p(t('Every user landing on the Vendors page sees a failure toast, eroding trust in the page and potentially masking genuine errors. If dashboard data is expected on this view, that content is also missing.')),

    p(strong('Full report: '), t('see attached Word document (BUG-VENDOR-001.docx). Screenshot evidence attached (BUG-VENDOR-001-evidence.png).')),
  ],
};

const labels = ['qa-automation', 'vendor-directory', 'severity-medium', 'p2'];

const payload = {
  fields: {
    project: { key: process.env.JIRA_PROJECT_KEY },
    issuetype: { name: process.env.JIRA_ISSUE_TYPE || 'Bug' },
    summary,
    description,
    labels,
  },
};

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing required env ${name}. Set it in automation/.env (see automation/.env.example).`);
    process.exit(1);
  }
  return v;
}

for (const fp of [docxPath, shotPath]) {
  if (!existsSync(fp)) {
    console.error(`Attachment not found: ${fp}`);
    process.exit(1);
  }
}

if (dryRun) {
  console.log('--- DRY RUN (nothing sent) ---');
  console.log('Target:', `${process.env.JIRA_BASE_URL || '<unset>'}/rest/api/3/issue`);
  console.log('Summary:', summary);
  console.log('Labels:', labels.join(', '));
  console.log('Attachments:', [docxPath, shotPath].map((f) => path.basename(f)).join(', '));
  console.log('Description ADF nodes:', description.content.length);
  process.exit(0);
}

const baseUrl = requireEnv('JIRA_BASE_URL').replace(/\/$/, '');
requireEnv('JIRA_PROJECT_KEY');
const token = requireEnv('JIRA_API_TOKEN');
const email = process.env.JIRA_EMAIL?.trim();
const authHeader = email
  ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
  : `Bearer ${token}`;

// 1) create the issue
const res = await fetch(`${baseUrl}/rest/api/3/issue`, {
  method: 'POST',
  headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(payload),
});
const text = await res.text();
if (!res.ok) {
  console.error(`Jira create failed: ${res.status} ${res.statusText}`);
  console.error(text.slice(0, 800));
  process.exit(1);
}
const json = JSON.parse(text);
console.log(`Created ${json.key}: ${baseUrl}/browse/${json.key}`);

// 2) attach files
async function attach(fp) {
  const form = new FormData();
  const buf = readFileSync(fp);
  form.append('file', new Blob([buf]), path.basename(fp));
  const ares = await fetch(`${baseUrl}/rest/api/3/issue/${json.key}/attachments`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'X-Atlassian-Token': 'no-check', Accept: 'application/json' },
    body: form,
  });
  const atext = await ares.text();
  if (!ares.ok) {
    console.error(`Attach failed for ${path.basename(fp)}: ${ares.status} ${ares.statusText}`);
    console.error(atext.slice(0, 500));
    return false;
  }
  console.log(`Attached ${path.basename(fp)}`);
  return true;
}
await attach(docxPath);
await attach(shotPath);
console.log('Done.');
