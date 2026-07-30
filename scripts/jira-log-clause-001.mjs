/**
 * Create BUG-CLAUSE-001 in Jira (rich ADF description), attach the Word report,
 * and link it to CLRE-69 as "Relates". Same mechanism as jira-log-bug-docx.mjs.
 *
 *   node automation/scripts/jira-log-clause-001.mjs [--dry-run]
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
const files = [path.join(bugDir, 'BUG-CLAUSE-001.docx')];
const RELATES_TO = 'CLRE-69';

const summary = 'BUG-CLAUSE-001 — Direct URL to /clause-configuration redirects to Dashboard after login';

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
    p(strong('Environment: '), t('QA · ClearEdge app · https://qa.clearedgeiq.com/clause-configuration')),
    p(strong('Severity: '), t('Medium'), t('   '), strong('Priority: '), t('P2'), t('   '), strong('Related: '), t('CLRE-69 (same redirect-to-dashboard pattern)')),

    heading('Summary'),
    p(t('When a logged-in user navigates directly to the Clause Configuration page by entering its URL (https://qa.clearedgeiq.com/clause-configuration) in the address bar, the app redirects them to the Dashboard instead of loading the Clause Configuration page. The page cannot be reached via a direct URL (or a page refresh on that route).')),

    heading('Steps to reproduce'),
    ol(
      'Log in to the ClearEdge app on QA (https://qa.clearedgeiq.com).',
      'In the browser address bar, enter https://qa.clearedgeiq.com/clause-configuration and press Enter (or refresh the page while on that route).',
      'Observe the resulting page and URL.',
    ),

    heading('Expected result'),
    p(t('The Clause Configuration page loads at /clause-configuration. Direct navigation and page refresh on that route both work, as long as the logged-in user has permission to access the module.')),

    heading('Actual result'),
    p(t('The app immediately redirects to /dashboard; the Clause Configuration page never renders.')),

    heading('Impact'),
    ul(
      'The Clause Configuration page cannot be deep-linked, bookmarked, or reached by refreshing the page.',
      'If the redirect also affects in-app navigation, the module may be effectively unreachable for affected users.',
    ),

    heading('Notes / suspected area (to confirm)'),
    p(t('This matches the redirect-to-dashboard pattern previously seen for User Management (CLRE-69), where a page-level rights guard issues router.replace("/dashboard") when permissions have not finished loading — i.e. the guard evaluates before rights are hydrated on a direct URL load/refresh. Please confirm: (a) whether the logged-in user actually has the right required for Clause Configuration, and (b) whether reaching the page via the in-app menu works while direct URL / refresh fails. If both point to a hydration race, the guard should wait for rights to finish loading before redirecting.')),

    p(strong('Attachment: '), t('BUG-CLAUSE-001.docx (full report). No screenshot.')),
  ],
};

const labels = ['qa-automation', 'clause-configuration', 'routing', 'rights-guard', 'severity-medium', 'p2'];

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

const linkRes = await fetch(`${baseUrl}/rest/api/3/issueLink`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ type: { name: 'Relates' }, inwardIssue: { key: json.key }, outwardIssue: { key: RELATES_TO } }),
});
if (linkRes.ok) console.log(`Linked ${json.key} → ${RELATES_TO} (Relates)`);
else { console.error(`Link failed (non-fatal): ${linkRes.status}`); console.error((await linkRes.text()).slice(0, 300)); }
console.log('Done.');
