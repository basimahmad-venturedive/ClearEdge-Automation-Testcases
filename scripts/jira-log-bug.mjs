/**
 * Log a QA bug report to Jira via the REST API — shared across automation
 * layers (API + frontend + mobile).
 *
 *   node automation/scripts/jira-log-bug.mjs <path-to-bug.md> [--dry-run]
 *
 * Reads a `documents/output/Bug Reports/*.md` file, maps it to a Jira issue, and
 * POSTs it to the configured project. Zero external deps (built-in fetch + a
 * tiny .env parser), so it runs from any layer without installing node_modules.
 *
 * Credentials come ONLY from the environment (real env wins; otherwise loaded
 * from automation/.env → automation/.env.local → automation/shared/config/.env →
 * automation/frontend/.env → automation/api-ts/.env), never committed. See
 * .claude/rules/secrets-and-env.rules.md and automation/.env.example.
 *
 * Required env:
 *   JIRA_BASE_URL     e.g. https://your-org.atlassian.net   (no trailing /)
 *   JIRA_PROJECT_KEY  e.g. CEIQ
 *   JIRA_API_TOKEN    Jira API token (Cloud) or Personal Access Token (Server/DC)
 * Auth mode:
 *   - Jira Cloud: also set JIRA_EMAIL  → Basic base64(email:token)
 *   - Jira Server/DC: omit JIRA_EMAIL  → Bearer <token>
 * Optional env:
 *   JIRA_ISSUE_TYPE   default "Bug"
 *   JIRA_API_VERSION  default "3" (Cloud; ADF description). Use "2" for Server/DC.
 *   JIRA_LABELS       comma-separated extra labels (default "qa-automation")
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const automationDir = path.resolve(here, '..');

/** Minimal KEY=VALUE .env reader — sets a key only if not already in env. */
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const raw of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = val;
  }
}

// Real environment wins; then the shared/layer .env files as fallback.
for (const rel of [
  '.env',
  '.env.local',
  'shared/config/.env',
  'frontend/.env',
  'api-ts/.env',
]) {
  loadEnvFile(path.join(automationDir, rel));
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const filePath = args.find((a) => !a.startsWith('--'));

if (!filePath) {
  console.error('Usage: node automation/scripts/jira-log-bug.mjs <path-to-bug.md> [--dry-run]');
  process.exit(1);
}
const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
if (!existsSync(resolved)) {
  console.error(`Bug report not found: ${resolved}`);
  process.exit(1);
}

const md = readFileSync(resolved, 'utf8');

/** Pull a `| **Field** | value |` table row. */
function tableField(name) {
  const re = new RegExp(`\\|\\s*\\*\\*${name}\\*\\*\\s*\\|\\s*(.+?)\\s*\\|`, 'i');
  const m = md.match(re);
  return m ? m[1].trim() : undefined;
}

const h1 = (md.match(/^#\s+(.+)$/m) || [])[1]?.trim();
const summary = (tableField('Title') || h1 || path.basename(resolved))
  .replace(/\s+/g, ' ')
  .slice(0, 250);
const severity = tableField('Severity');
const priority = tableField('Priority');
const sourceTc = tableField('Source TC');

const baseLabels = (process.env.JIRA_LABELS || 'qa-automation')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (severity) baseLabels.push(`severity-${severity.split(/\s/)[0].toLowerCase()}`);
if (priority) baseLabels.push(priority.split(/\s/)[0].toLowerCase());
const labels = [...new Set(baseLabels.map((l) => l.replace(/[^A-Za-z0-9-_]/g, '-')))];

const apiVersion = process.env.JIRA_API_VERSION || '3';
// v3 wants an ADF description; wrap the whole markdown in a codeBlock (readable,
// no fragile markdown->ADF conversion). v2 takes a plain string.
const description =
  apiVersion === '2'
    ? md
    : {
        type: 'doc',
        version: 1,
        content: [
          { type: 'codeBlock', attrs: { language: 'markdown' }, content: [{ type: 'text', text: md }] },
        ],
      };

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

if (dryRun) {
  console.log('--- DRY RUN (nothing sent) ---');
  console.log('Target:', `${process.env.JIRA_BASE_URL || '<JIRA_BASE_URL unset>'}/rest/api/${apiVersion}/issue`);
  console.log('Summary:', summary);
  console.log('Labels:', labels.join(', '));
  console.log('Source TC:', sourceTc || '(none parsed)');
  console.log('Payload:', JSON.stringify(payload, null, 2).slice(0, 1500));
  process.exit(0);
}

const baseUrl = requireEnv('JIRA_BASE_URL').replace(/\/$/, '');
requireEnv('JIRA_PROJECT_KEY');
const token = requireEnv('JIRA_API_TOKEN');
const email = process.env.JIRA_EMAIL?.trim();
const authHeader = email
  ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
  : `Bearer ${token}`;

const res = await fetch(`${baseUrl}/rest/api/${apiVersion}/issue`, {
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
