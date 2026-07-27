/**
 * Create BUG-VENDOR-003 in Jira (rich ADF description) and attach the Word
 * report. Same mechanism as jira-log-bug-docx.mjs. No screenshot (behavioural
 * bug; recording to be added later).
 *
 *   node automation/scripts/jira-log-bug-003.mjs [--dry-run]
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
const files = [path.join(bugDir, 'BUG-VENDOR-003.docx')];

const summary = 'BUG-VENDOR-003 — "Add vendor" form does not reset; previous data persists when the modal is reopened';

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
    p(strong('Environment: '), t('dev · ClearEdge app · dbut9mm5q1aps.cloudfront.net/vendors · "Add vendor" modal')),
    p(strong('Severity: '), t('Medium'), t('   '), strong('Priority: '), t('P2'), t('   '), strong('Source: '), t('Manual finding')),

    heading('Summary'),
    p(t('The "Add vendor" form does not reset its state. If a user opens the modal, enters data, then closes it without saving, the previously entered data is still present when they reopen the modal via the "Add vendor" button. A fresh "Add vendor" action should always present an empty form.')),

    heading('Steps to reproduce'),
    ol(
      'Log in to the ClearEdge app (dev environment).',
      'Open the Vendors module and click "Add vendor".',
      'Enter data in one or more fields (e.g. Vendor name, primary contact name/email/phone).',
      'Close the modal without saving (click "Cancel" or the "×" close icon).',
      'Click "Add vendor" again to reopen the modal.',
      'Observe the field values in the reopened form.',
    ),

    heading('Expected result'),
    p(t('The "Add vendor" modal opens with a clean, empty form — none of the values from the previous (abandoned) attempt remain. Every fresh "Add vendor" action starts blank.')),

    heading('Actual result'),
    p(t('The data entered in the previous attempt is still populated when the modal is reopened. The form retains stale state from the abandoned session instead of resetting.')),

    heading('Impact'),
    ul(
      'Users may unintentionally submit leftover data from a previous, abandoned attempt, creating a vendor with incorrect values.',
      'Confusing experience — the form appears to already contain a vendor’s details when a blank form is expected.',
      'Risk of data from one vendor entry bleeding into the next.',
    ),

    heading('Notes / suspected area (to confirm)'),
    p(t('The form component state (e.g. react-hook-form values or local component state) is not reset when the modal closes/unmounts or when it next opens. Likely fix: call the form reset() on open, or fully unmount the form on close so it re-initialises with default (empty) values.')),

    p(strong('Attachment: '), t('BUG-VENDOR-003.docx (full report). Behavioural bug — a short screen recording (open → type → close → reopen showing retained values) to be added.')),
  ],
};

const labels = ['qa-automation', 'vendor-directory', 'ui', 'form-state', 'severity-medium', 'p2'];

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
