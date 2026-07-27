/**
 * Create BUG-VENDOR-002 in Jira (rich ADF description) and attach the Word
 * report + actual/design screenshots. Same mechanism as jira-log-bug-docx.mjs.
 *
 *   node automation/scripts/jira-log-bug-002.mjs [--dry-run]
 *
 * Env loaded from automation/.env → .env.local → shared/config/.env →
 * frontend/.env → api-ts/.env (real env wins). Required: JIRA_BASE_URL,
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
  path.join(bugDir, 'BUG-VENDOR-002.docx'),
  path.join(bugDir, 'BUG-VENDOR-002-actual.png'),
  path.join(bugDir, 'BUG-VENDOR-002-design.png'),
];

const summary = 'BUG-VENDOR-002 — "Add vendor" form fields render without their labels (only placeholders shown)';

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
    p(t('In the "Add vendor" modal, the input fields are rendered without their text labels. Fields are identified only by faint placeholder text, so once a value is entered the field\'s purpose is no longer shown. The approved design has a visible label above every field, including the red required-field asterisks. The current build renders only the section headers (VENDOR DETAILS, PRIMARY CONTACT, ADDRESS, SECONDARY CONTACT, COMPLIANCE DOCUMENTS) — the per-field labels are missing.')),

    heading('Steps to reproduce'),
    ol(
      'Log in to the ClearEdge app (dev environment).',
      'Open the Vendors module and click "Add vendor".',
      'Inspect the fields in the "Add vendor" modal (both columns).',
    ),

    heading('Expected result (per design)'),
    p(t('Every field shows a visible label above the input, matching the approved design:')),
    ul(
      'Vendor details: Vendor name *, Category *, Subcategory *, Website, Notes.',
      'Primary contact: Name *, Email *, Phone *.',
      'Address: Street Address, Street Address Line 2, City, State, ZIP Code.',
      'Secondary contact: Name, Email, Phone.',
      'Compliance documents: W-9, Certificate of Insurance (COI).',
    ),
    p(t('Required fields are marked with a red asterisk (*).')),

    heading('Actual result'),
    p(t('Only the section headers are present. Individual field labels are missing entirely — each field is identified solely by placeholder text (e.g. "Select category", "https://", "123 Main St", "State", "12345"). Required-field asterisks are also absent from the individual fields. Once a user types a value, no persistent label remains to identify the field.')),

    heading('Impact'),
    ul(
      'Usability: users must infer each field from placeholder text, which disappears once they start typing.',
      'Accessibility: absent field labels break programmatic label association for screen readers (WCAG 2.1 — 1.3.1 Info & Relationships, 3.3.2 Labels or Instructions).',
      'The form does not match the approved design specification.',
    ),

    p(strong('Attachments: '), t('BUG-VENDOR-002.docx (full report), BUG-VENDOR-002-actual.png (missing labels, annotated), BUG-VENDOR-002-design.png (expected).')),
  ],
};

const labels = ['qa-automation', 'vendor-directory', 'ui', 'accessibility', 'severity-medium', 'p2'];

const payload = {
  fields: {
    project: { key: process.env.JIRA_PROJECT_KEY },
    issuetype: { name: process.env.JIRA_ISSUE_TYPE || 'Bug' },
    summary, description, labels,
  },
};

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) { console.error(`Missing required env ${name}.`); process.exit(1); }
  return v;
}
for (const fp of files) {
  if (!existsSync(fp)) { console.error(`Attachment not found: ${fp}`); process.exit(1); }
}

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
