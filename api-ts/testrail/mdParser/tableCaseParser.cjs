// Table-format Test Case parser for the ClearEdge `testcases/TC-CEIQ-*.md` suites.
//
// The kit's original `markdownTestCaseParser.cjs` only understands the legacy
// colon format (`## Test Case ID:` …). The ClearEdge suites are authored in the
// richer *table* format (`#### TC-ID — title` followed by a `| Field | Value |`
// table). This parser reads that table format and — crucially — knows how to
// DERIVE any narrative field a case is missing, so a publish/enrich run never
// pushes an empty Preconditions / Test data / Steps / Expected / Postconditions /
// Notes / (API) Response payload field to TestRail.
//
// Pair with `scripts/testrail-sync-fields-and-labels.cjs`, which maps every field
// returned here onto its dedicated TestRail custom field.

const fs = require('node:fs');

// spec label (lowercased, ** and spaces stripped) -> canonical field key
const FIELD_ALIASES = {
  testrailId: ['testrail id'],
  specRef: ['spec reference'],
  module: ['module / layer', 'module/layer', 'module'],
  type: ['type'],
  priority: ['priority'],
  actor: ['actor / role', 'actor/role', 'actor'],
  precond: ['preconditions', 'precondition'],
  testData: ['test data'],
  steps: ['steps'],
  expected: ['expected results', 'expected result'],
  respPayload: ['response payload', 'response body'],
  postcond: ['postconditions / cleanup', 'postconditions/cleanup', 'postconditions', 'postcondition'],
  autoReady: ['automation readiness'],
  notes: ['notes / dependencies', 'notes/dependencies', 'notes']
};

// Narrative rows every case must carry (respPayload is required for API cases only).
const REQUIRED_NARRATIVE = ['precond', 'testData', 'steps', 'expected', 'postcond', 'notes'];

const ROW_RE = /^\|\s*\*{0,2}(.+?)\*{0,2}\s*\|\s*(.*?)\s*\|\s*$/;

function labelToField(label) {
  const l = label.toLowerCase().replace(/\*/g, '').trim();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(l)) return field;
  }
  return null;
}

function parse(content) {
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let cur = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^####\s+TC-[A-Z0-9-]*\d/.test(lines[i])) {
      if (cur) blocks.push(cur);
      const rest = lines[i].replace(/^####\s+/, '');
      const sepIdx = rest.search(/\s[—–-]\s/);
      const idPart = sepIdx >= 0 ? rest.slice(0, sepIdx) : rest;
      const ids = idPart.match(/TC-[A-Z0-9-]*\d+/g) || [];
      const title = sepIdx >= 0 ? rest.slice(sepIdx).replace(/^\s[—–-]\s/, '').trim() : rest.trim();
      cur = { id: ids[0], ids, title, rows: {} };
      continue;
    }
    if (!cur) continue;
    const r = lines[i].match(ROW_RE);
    if (r) {
      const field = labelToField(r[1]);
      if (field && cur.rows[field] === undefined) cur.rows[field] = r[2].trim();
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function parseFile(filePath) {
  return parse(fs.readFileSync(filePath, 'utf-8'));
}

function isApiCase(b) {
  const mod = (b.rows.module || '').toLowerCase();
  if (mod.includes('api')) return true;
  const prefix = (b.id || '').replace(/^TC-/, '').split('-')[0];
  return /API$/.test(prefix);
}

function mutates(b) {
  const t = `${b.title} ${b.rows.steps || ''} ${b.rows.testData || ''}`.toUpperCase();
  return /\b(POST|PUT|PATCH|DELETE)\b|CREATE|UPDATE|INSERT|SAVE|MODIF/.test(t);
}

function firstHttp(b) {
  const sources = [b.rows.testData, b.rows.steps, b.rows.expected, b.rows.specRef, b.title];
  const re = /\b(GET|POST|PUT|PATCH|DELETE)\b\s+`?(\/[A-Za-z0-9_\-\/\.\{\}:]+)`?/;
  for (const s of sources) {
    if (!s) continue;
    const m = s.match(re);
    if (m) return { method: m[1], path: m[2].replace(/`/g, '') };
  }
  for (const s of sources) {
    if (!s) continue;
    const m = s.match(/`?(\/api\/v\d\/[A-Za-z0-9_\-\/\.\{\}:]+)`?/);
    if (m) return { method: 'the documented method', path: m[1] };
  }
  return null;
}

function looksLikeObject(frag) {
  if (/^\{\s*\d*\s*,?\s*\d*\s*\}$/.test(frag)) return false; // reject regex quantifier {4,}
  return /[A-Za-z]/.test(frag) && frag.includes(':');
}

function firstJson(s) {
  if (!s) return '';
  for (let start = s.indexOf('{'); start !== -1; start = s.indexOf('{', start + 1)) {
    const prev2 = s.slice(Math.max(0, start - 2), start);
    if (/\d$/.test(prev2) || /\\d$/.test(prev2)) continue;
    let depth = 0;
    for (let i = start; i < s.length; i += 1) {
      if (s[i] === '{') depth += 1;
      else if (s[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          const frag = s.slice(start, i + 1);
          if (looksLikeObject(frag)) return frag;
          break;
        }
      }
    }
  }
  return '';
}

function deriveTestData(b) {
  const http = firstHttp(b);
  const body = firstJson(b.rows.steps) || firstJson(b.rows.expected);
  if (isApiCase(b)) {
    let s = http ? `\`${http.method} ${http.path}\`` : 'Request per Steps';
    s += '; `Authorization: Bearer <token>` for the case actor';
    if (body) s += `; body ${body}`;
    return `${s}.`;
  }
  return 'N/A — no external data; interaction and inputs are described in Preconditions / Steps.';
}

function deriveSteps(b) {
  const td = b.rows.testData || '';
  const mod = (b.rows.module || '').toUpperCase();
  const looksSql = /\bSELECT\b[\s\S]{0,140}\bFROM\b/i.test(td)
    || /^\s*`?\s*(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+TABLE|SELECT)\b/i.test(td)
    || /`\s*(SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i.test(td);
  const isDbModule = mod === 'DB' || /^DB\b|\bDB$|\bDATABASE\b/.test(mod);
  if (looksSql || isDbModule) {
    return '1. Execute the query / data operation shown in Test data against the database. 2. Assert the data expectations described in Expected results.';
  }
  const http = firstHttp(b);
  if (http) {
    const parts = [
      `1. Send \`${http.method} ${http.path}\` with the headers/body in Test data (actor: ${b.rows.actor || 'authorized user'}).`,
      '2. Inspect the response status code and body.'
    ];
    if (/integration/i.test(b.rows.type || b.rows.module || '') || /GET|persist|restore|read-after-write/i.test(b.rows.postcond || b.rows.expected || '')) {
      parts.push('3. (Integration) Issue a follow-up read to confirm the change persisted.');
    }
    return parts.join(' ');
  }
  if (isApiCase(b)) {
    const meth = (b.title.match(/\b(GET|POST|PUT|PATCH|DELETE)\b/) || [])[1];
    let s = `1. Send the ${meth ? `\`${meth}\` ` : ''}request documented for this case (endpoint per Spec reference / Test data) with the case actor's authorization. 2. Inspect the response status code and body.`;
    if (/integration/i.test(`${b.rows.type || ''} ${b.rows.module || ''}`)) s += ' 3. (Integration) Issue a follow-up read to confirm the change persisted.';
    return s;
  }
  return '1. Exercise the condition described in this case (see Preconditions / Expected results). 2. Verify the expected outcome.';
}

function deriveResponsePayload(b) {
  const exp = b.rows.expected || '';
  const statuses = [...new Set([...exp.matchAll(/\b([1-5]\d\d)\b/g)].map((m) => m[1]))];
  const errs = [...new Set([...exp.matchAll(/ERR_[A-Z_]+/g)].map((m) => m[0]))];
  const json = firstJson(exp);
  const bits = [];
  if (statuses.length) bits.push(`Status: ${statuses.join(' / ')}`);
  if (json) bits.push(`Body: ${json}`);
  else if (/success\s*:?\s*true|\bdata\b/i.test(exp)) bits.push('Body: `{ success: true, data: { … } }` envelope');
  else if (/success\s*:?\s*false|\berror\b/i.test(exp)) bits.push('Body: `{ success: false, error: { code, message } }` envelope');
  if (errs.length) bits.push(`Error code(s): ${errs.map((e) => `\`${e}\``).join(', ')}`);
  if (!bits.length) return 'See Expected results for the response contract.';
  return `${bits.join('. ')}.`;
}

function derivePostcond(b) {
  return mutates(b)
    ? 'Remove or restore any records created / modified by this case to leave the tenant state clean.'
    : 'None (no persistent state changed).';
}

function deriveAuth(b) {
  const td = `${b.rows.testData || ''} ${b.rows.steps || ''}`;
  const m = td.match(/Authorization:\s*Bearer[^`,;.]*|Bearer\s+<[^>]+>|Bearer\s+`[^`]+`/i);
  return m ? m[0].trim() : 'Bearer <token> for the case actor';
}

// Return a fully-populated field bundle for a case — every narrative field filled
// (from the spec when present, otherwise derived). API cases also get response/
// request-body + authorization. This is the single source the publisher pushes.
function resolvedFields(b) {
  const out = {
    precond: b.rows.precond || 'See Steps and Spec reference for the required setup.',
    testData: b.rows.testData || deriveTestData(b),
    steps: b.rows.steps || deriveSteps(b),
    expected: b.rows.expected || 'See Spec reference; assert the documented outcome.',
    postcond: b.rows.postcond || derivePostcond(b),
    notes: b.rows.notes || 'None.'
  };
  if (isApiCase(b)) {
    out.respPayload = b.rows.respPayload || deriveResponsePayload(b);
    out.requestBody = firstJson(b.rows.testData) || firstJson(b.rows.steps) || '';
    out.authorization = deriveAuth(b);
  }
  return out;
}

// Which required narrative fields the SPEC is missing (before derivation) — used
// by the completeness report / gap check.
function missingFields(b) {
  const req = [...REQUIRED_NARRATIVE];
  if (isApiCase(b)) req.push('respPayload');
  return req.filter((f) => !b.rows[f]);
}

module.exports = {
  FIELD_ALIASES,
  REQUIRED_NARRATIVE,
  parse,
  parseFile,
  isApiCase,
  firstJson,
  deriveTestData,
  deriveSteps,
  deriveResponsePayload,
  derivePostcond,
  deriveAuth,
  resolvedFields,
  missingFields
};
