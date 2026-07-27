/**
 * Create BUG-VENDOR-005 in Jira (rich ADF description), attach the Word report,
 * and link it to CLRE-111 as "Relates". Same mechanism as jira-log-bug-docx.mjs.
 *
 *   node automation/scripts/jira-log-bug-005.mjs [--dry-run]
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
const files = [path.join(bugDir, 'BUG-VENDOR-005.docx')];
const RELATES_TO = 'CLRE-111';

const summary = 'BUG-VENDOR-005 — "Edit vendor" form does not reset; unsaved edits persist when the Edit modal is reopened';

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
    p(strong('Environment: '), t('dev · ClearEdge app · dbut9mm5q1aps.cloudfront.net/vendors · Edit vendor modal')),
    p(strong('Severity: '), t('Medium'), t('   '), strong('Priority: '), t('P2'), t('   '), strong('Related: '), t('CLRE-111 (same root cause)')),

    heading('Summary'),
    p(t('The "Edit vendor" form does not reset its state. If a user opens a vendor to edit, changes or adds text, then cancels without saving, the previously entered (unsaved) text is still shown when the Edit modal is next opened — instead of the vendor\'s currently saved values. This is the Edit-flow counterpart of the Add-vendor reset issue (CLRE-111) and appears to share the same root cause.')),

    heading('Steps to reproduce'),
    ol(
      'Log in to the ClearEdge app (dev environment) and open the Vendors module.',
      'Open a vendor to edit (Edit vendor modal).',
      'Add or modify text in one or more fields.',
      'Click "Cancel" (or close the modal) without saving.',
      'Reopen the Edit modal (for the same vendor, or another vendor).',
      'Observe the field values in the reopened form.',
    ),

    heading('Expected result'),
    p(t('The Edit modal reloads the vendor\'s currently saved values; the cancelled edits are discarded. No unsaved text from the previous edit session remains, and opening a different vendor shows that vendor\'s own saved data.')),

    heading('Actual result'),
    p(t('The previously entered (unsaved) text is still present in the fields when the Edit modal is reopened, instead of the vendor\'s saved values. The form retains stale, dirty state from the cancelled session.')),

    heading('Impact'),
    ul(
      'Users may unknowingly save stale or incorrect edits carried over from a previous, cancelled session.',
      'If a different vendor is opened next, the previous vendor\'s typed values can appear on it — risking saving one vendor\'s data onto another record.',
      'Confusing experience — the form does not reflect the record actually being edited.',
    ),

    heading('Notes / suspected area (to confirm)'),
    p(t('Same root cause as CLRE-111: the form component state (react-hook-form values or local state) is not reset / re-initialised when the modal closes/unmounts or when it next opens. For the Edit flow, reset the form to the selected vendor\'s data on open (and/or fully unmount the form on close) so it always reflects the record being edited.')),

    p(strong('Attachment: '), t('BUG-VENDOR-005.docx (full report). No screenshot (behavioural bug).')),
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
  console.log('Relates to:', RELATES_TO);
  console.log('ADF nodes:', description.content.length);
  process.exit(0);
}

const baseUrl = requireEnv('JIRA_BASE_URL').replace(/\/$/, '');
requireEnv('JIRA_PROJECT_KEY');
const token = requireEnv('JIRA_API_TOKEN');
const email = process.env.JIRA_EMAIL?.trim();
const authHeader = email ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` : `Bearer ${token}`;
const H = { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' };

const res = await fetch(`${baseUrl}/rest/api/3/issue`, { method: 'POST', headers: H, body: JSON.stringify(payload) });
const text = await res.text();
if (!res.ok) { console.error(`Jira create failed: ${res.status} ${res.statusText}`); console.error(text.slice(0, 800)); process.exit(1); }
const json = JSON.parse(text);
console.log(`Created ${json.key}: ${baseUrl}/browse/${json.key}`);

// attach
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

// link to CLRE-111 (Relates)
const linkRes = await fetch(`${baseUrl}/rest/api/3/issueLink`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ type: { name: 'Relates' }, inwardIssue: { key: json.key }, outwardIssue: { key: RELATES_TO } }),
});
if (linkRes.ok) console.log(`Linked ${json.key} → ${RELATES_TO} (Relates)`);
else { console.error(`Link failed: ${linkRes.status}`); console.error((await linkRes.text()).slice(0, 400)); }
console.log('Done.');
