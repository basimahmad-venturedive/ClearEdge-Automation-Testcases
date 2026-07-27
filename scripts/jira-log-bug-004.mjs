/**
 * Create BUG-VENDOR-004 in Jira (rich ADF description) and attach the Word
 * report + evidence screenshot. Same mechanism as jira-log-bug-docx.mjs.
 *
 *   node automation/scripts/jira-log-bug-004.mjs [--dry-run]
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = val;
  }
}
for (const rel of ['.env', '.env.local', 'shared/config/.env', 'frontend/.env', 'api-ts/.env']) {
  loadEnvFile(path.join(automationDir, rel));
}

const dryRun = process.argv.includes('--dry-run');
const root = path.resolve(automationDir, '..');
const bugDir = path.join(root, 'documents', 'output', 'Bug Reports');
const files = [
  path.join(bugDir, 'BUG-VENDOR-004.docx'),
  path.join(bugDir, 'BUG-VENDOR-004-actual.png'),
];

const summary = 'BUG-VENDOR-004 — No frontend validation for Email/Website URL; backend validation errors not shown to the user';

const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const strong = (text) => t(text, [{ type: 'strong' }]);
const heading = (text) => ({ type: 'heading', attrs: { level: 3 }, content: [t(text)] });
const p = (...content) => ({ type: 'paragraph', content });
const li = (text) => ({ type: 'listItem', content: [p(t(text))] });
const ol = (...items) => ({ type: 'orderedList', content: items.map(li) });
const ul = (...items) => ({ type: 'bulletList', content: items.map(li) });

const description = {
  type: 'doc',
  version: 1,
  content: [
    p(strong('Environment: '), t('dev · ClearEdge app · dbut9mm5q1aps.cloudfront.net/vendors · Add / Edit vendor modal')),
    p(strong('Severity: '), t('High'), t('   '), strong('Priority: '), t('P2'), t('   '), strong('Source: '), t('Manual finding')),
    p(strong('Trace ID: '), { type: 'text', text: 'e9b67ec9-1317-4780-960c-64ca42a3311b', marks: [{ type: 'code' }] }),

    heading('Summary'),
    p(t('The vendor form (Add / Edit vendor) has no client-side validation for the Email and Website URL fields, and it does not display the backend validation errors that come back when an invalid value is submitted. When a user enters an invalid email or website, no inline validation is shown, the request is sent, the API rejects it with ERR_VALIDATION_FAILED, and the frontend shows no error at all — the save silently fails and the user gets no feedback.')),

    heading('Steps to reproduce'),
    ol(
      'Log in to the ClearEdge app (dev environment).',
      'Open the Vendors module and open the Add vendor modal (or edit an existing vendor).',
      'Enter an invalid Website URL (e.g. "zeetest_eit.com" with no protocol) and/or an invalid Email value.',
      'Fill the remaining required fields and click "Save changes" / "Add vendor".',
      'Observe the form (no inline validation) and the Network response in DevTools.',
    ),

    heading('Expected result'),
    ul(
      'The Email and Website URL fields are validated on the client before submit, showing a clear inline message (e.g. "Please enter a valid email address." / "Please enter a valid website URL."), consistent with the existing "This field is required." validation.',
      'If the backend still returns a validation error, the frontend maps error.details.fields to the matching fields and/or shows a visible error toast, so the user always knows why the save failed.',
    ),

    heading('Actual result'),
    p(t('There is no client-side validation for Email or Website URL — the invalid values are submitted. The API responds with HTTP 400 and this body:')),
    {
      type: 'codeBlock',
      attrs: { language: 'json' },
      content: [t('{\n  "success": false,\n  "error": {\n    "code": "ERR_VALIDATION_FAILED",\n    "message": "One or more fields are invalid.",\n    "details": { "fields": { "website": "Please enter a valid website URL." } }\n  },\n  "meta": { "traceId": "e9b67ec9-1317-4780-960c-64ca42a3311b" }\n}')],
    },
    p(t('The frontend displays no error at all — neither an inline field message nor a toast. The save silently fails and the user is left with no feedback.')),

    heading('Impact'),
    ul(
      'Users cannot tell why the save failed; the form appears broken and the action cannot be completed.',
      'Invalid data reaches the backend unnecessarily on every attempt.',
      'Inconsistent with the required-field validation already present on the form ("This field is required.").',
    ),

    heading('Notes / suspected area (to confirm)'),
    ul(
      'Add client-side schema validation for the Email and Website URL fields (same validation layer used for required fields).',
      'On a non-2xx API response, parse error.details.fields and set the corresponding field errors, and/or surface error.message as a toast — do not swallow the error.',
    ),

    p(strong('Attachments: '), t('BUG-VENDOR-004.docx (full report), BUG-VENDOR-004-actual.png (DevTools response evidence).')),
  ],
};

const labels = ['qa-automation', 'vendor-directory', 'ui', 'validation', 'error-handling', 'severity-high', 'p2'];

const payload = { fields: { project: { key: process.env.JIRA_PROJECT_KEY }, issuetype: { name: process.env.JIRA_ISSUE_TYPE || 'Bug' }, summary, description, labels } };

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) { console.error(`Missing required env ${name}.`); process.exit(1); }
  return v;
}
for (const fp of files) if (!existsSync(fp)) { console.error(`Attachment not found: ${fp}`); process.exit(1); }

if (dryRun) {
  console.log('--- DRY RUN ---');
  console.log('Summary:', summary);
  console.log('Labels:', labels.join(', '));
  console.log('Attachments:', files.map((f) => path.basename(f)).join(', '));
  console.log('ADF nodes:', description.content.length);
  process.exit(0);
}

const baseUrl = requireEnv('JIRA_BASE_URL').replace(/\/$/, '');
requireEnv('JIRA_PROJECT_KEY');
const token = requireEnv('JIRA_API_TOKEN');
const email = process.env.JIRA_EMAIL?.trim();
const authHeader = email ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` : `Bearer ${token}`;

const res = await fetch(`${baseUrl}/rest/api/3/issue`, {
  method: 'POST',
  headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(payload),
});
const text = await res.text();
if (!res.ok) { console.error(`Jira create failed: ${res.status} ${res.statusText}`); console.error(text.slice(0, 800)); process.exit(1); }
const json = JSON.parse(text);
console.log(`Created ${json.key}: ${baseUrl}/browse/${json.key}`);

async function attach(fp) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(fp)]), path.basename(fp));
  const ares = await fetch(`${baseUrl}/rest/api/3/issue/${json.key}/attachments`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'X-Atlassian-Token': 'no-check', Accept: 'application/json' },
    body: form,
  });
  if (!ares.ok) { console.error(`Attach failed for ${path.basename(fp)}: ${ares.status}`); console.error((await ares.text()).slice(0, 500)); return; }
  console.log(`Attached ${path.basename(fp)}`);
}
for (const fp of files) await attach(fp);
console.log('Done.');
