/**
 * Create BUG-VENDOR-006 in Jira (rich ADF description) and attach the Word
 * report. Same mechanism as jira-log-bug-docx.mjs. No screenshot.
 *
 *   node automation/scripts/jira-log-bug-006.mjs [--dry-run]
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
const files = [path.join(bugDir, 'BUG-VENDOR-006.docx')];

const summary = 'BUG-VENDOR-006 — Compliance documents (W-9 / Certificate of Insurance) are not uploaded from the vendor form';

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
    p(strong('Environment: '), t('dev · ClearEdge app · dbut9mm5q1aps.cloudfront.net/vendors · Add / Edit vendor modal · Compliance Documents section')),
    p(strong('Severity: '), t('Medium'), t('   '), strong('Priority: '), t('P2'), t('   '), strong('Source: '), t('Manual finding')),

    heading('Summary'),
    p(t('In the vendor form (Add / Edit vendor), the Compliance Documents section provides "Upload W-9" and "Upload Certificate of Insurance (COI)" actions. Selecting a file for either does not result in the document being uploaded and stored against the vendor — the compliance documents are not saved.')),

    heading('Steps to reproduce'),
    ol(
      'Log in to the ClearEdge app (dev environment) and open the Vendors module.',
      'Open the Add vendor modal (or edit an existing vendor).',
      'In the Compliance Documents section, click "Upload W-9" and select a file.',
      'Click "Upload Certificate of Insurance (COI)" and select a file.',
      'Complete the required fields and save the vendor.',
      'Reopen the vendor and check the Compliance Documents section.',
    ),

    heading('Expected result'),
    p(t('The selected W-9 and COI files are uploaded and associated with the vendor. On reopening the vendor, the uploaded documents are shown (with a filename and a way to view/download or replace them).')),

    heading('Actual result'),
    p(t('The compliance documents are not uploaded. The selected files are not stored against the vendor, and no uploaded document is present when the vendor is reopened.')),

    heading('Impact'),
    ul(
      'Vendors cannot have their compliance documentation (W-9, COI) stored, undermining the compliance-tracking purpose of the vendor directory.',
      'Any downstream feature that depends on these documents (e.g. compliance status, reminders) will have no data to work with.',
    ),

    heading('Open questions / info needed to pinpoint'),
    p(t('The exact failure point should be confirmed by the developer — please capture which of these is happening:')),
    ul(
      'The file picker does not open when the Upload button is clicked; or',
      'A file can be selected but nothing visibly happens (no filename shown, no request sent); or',
      'An upload request is sent but the API returns an error (capture the Network request/response and traceId); or',
      'The upload appears to succeed but the document is not persisted / not linked to the vendor on reopen.',
    ),
    p(t('Attaching the Network request/response for the upload call (and any console error) would let the team pinpoint the layer at fault.')),

    p(strong('Attachment: '), t('BUG-VENDOR-006.docx (full report). No screenshot.')),
  ],
};

const labels = ['qa-automation', 'vendor-directory', 'file-upload', 'compliance', 'severity-medium', 'p2'];

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
