/**
 * Generic ClearEdge bug logger: reads a JSON spec, creates a Jira issue with a
 * rich ADF description, attaches files, and optionally links to a related issue.
 *
 *   node automation/scripts/jira-log-bug-generic.mjs <spec.json> [--dry-run]
 *
 * Spec schema (see the JSON files produced during bug logging):
 *   { bugId, summary, env, severity, priority, related?, traceId?, specRef?,
 *     labels:[...], attachments:[absPath,...],
 *     sections:[ { h, blocks:[ {p} | {ul:[..]} | {ol:[..]} | {code} ] } ] }
 * Image/caption blocks in the spec are ignored here (they live in the .docx).
 *
 * Env loaded from automation/.env → .env.local → shared/config/.env →
 * frontend/.env → api-ts/.env (real env wins).
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

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const specPath = args.find((a) => !a.startsWith('--'));
if (!specPath) { console.error('Usage: node jira-log-bug-generic.mjs <spec.json> [--dry-run]'); process.exit(1); }
const spec = JSON.parse(readFileSync(path.isAbsolute(specPath) ? specPath : path.resolve(process.cwd(), specPath), 'utf8'));

const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const strong = (text) => t(text, [{ type: 'strong' }]);
const heading = (text) => ({ type: 'heading', attrs: { level: 3 }, content: [t(text)] });
const p = (...content) => ({ type: 'paragraph', content });
const li = (text) => ({ type: 'listItem', content: [p(t(text))] });

const content = [];
const meta1 = [strong('Environment: '), t(spec.env)];
content.push(p(...meta1));
const meta2 = [strong('Severity: '), t(spec.severity), t('   '), strong('Priority: '), t(spec.priority)];
if (spec.related) { meta2.push(t('   '), strong('Related: '), t(spec.related)); }
content.push(p(...meta2));
if (spec.specRef) content.push(p(strong('Spec ref: '), t(spec.specRef)));
if (spec.traceId) content.push(p(strong('Trace ID: '), { type: 'text', text: spec.traceId, marks: [{ type: 'code' }] }));

for (const sec of spec.sections) {
  if (sec.h === 'Evidence') continue; // images live in the docx
  content.push(heading(sec.h));
  for (const b of sec.blocks) {
    if (b.p) content.push(p(t(b.p)));
    else if (b.ul) content.push({ type: 'bulletList', content: b.ul.map(li) });
    else if (b.ol) content.push({ type: 'orderedList', content: b.ol.map(li) });
    else if (b.code) content.push({ type: 'codeBlock', attrs: { language: b.lang || 'json' }, content: [t(b.code)] });
  }
}
if (spec.attachments && spec.attachments.length) {
  content.push(p(strong('Attachments: '), t(spec.attachments.map((a) => path.basename(a)).join(', '))));
}

const description = { type: 'doc', version: 1, content };
const payload = { fields: { project: { key: process.env.JIRA_PROJECT_KEY }, issuetype: { name: process.env.JIRA_ISSUE_TYPE || 'Bug' }, summary: spec.summary, description, labels: spec.labels || [] } };

function requireEnv(name) { const v = process.env[name]?.trim(); if (!v) { console.error(`Missing required env ${name}.`); process.exit(1); } return v; }
for (const fp of spec.attachments || []) if (!existsSync(fp)) { console.error(`Attachment not found: ${fp}`); process.exit(1); }

if (dryRun) {
  console.log('--- DRY RUN ---');
  console.log('Summary:', spec.summary);
  console.log('Labels:', (spec.labels || []).join(', '));
  console.log('Attachments:', (spec.attachments || []).map((a) => path.basename(a)).join(', ') || '(none)');
  if (spec.related) console.log('Relates to:', spec.related);
  console.log('ADF nodes:', content.length);
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
    method: 'POST', headers: { Authorization: authHeader, 'X-Atlassian-Token': 'no-check', Accept: 'application/json' }, body: form,
  });
  if (!ares.ok) { console.error(`Attach failed for ${path.basename(fp)}: ${ares.status}`); console.error((await ares.text()).slice(0, 400)); return; }
  console.log(`Attached ${path.basename(fp)}`);
}
for (const fp of spec.attachments || []) await attach(fp);

if (spec.related) {
  const linkRes = await fetch(`${baseUrl}/rest/api/3/issueLink`, { method: 'POST', headers: H, body: JSON.stringify({ type: { name: 'Relates' }, inwardIssue: { key: json.key }, outwardIssue: { key: spec.related.split(/\s/)[0] } }) });
  if (linkRes.ok) console.log(`Linked ${json.key} → ${spec.related.split(/\s/)[0]} (Relates)`);
  else { console.error(`Link failed (non-fatal): ${linkRes.status}`); console.error((await linkRes.text()).slice(0, 300)); }
}
console.log(`Done → ${json.key}`);
