/**
 * One-off: create TestRail cases for the per-row TC-IDs produced by splitting the
 * data-driven test.each blocks (TC-ADMAPI-004-NN, TC-RBAC-002-NN, …) so each test
 * execution maps 1:1 to a TestRail case.
 *
 * Reuses the existing CaseImporter (loads + MERGES caseMapping.json, creates only
 * missing cases — safe to re-run). After it runs it also syncs the new entries into
 * ../../testcases/testrail_map.json.
 *
 * RUN ONCE with TestRail creds available (same env config/env.cjs reads — i.e.
 * TESTRAIL_URL / TESTRAIL_USERNAME / TESTRAIL_PASSWORD / TESTRAIL_PROJECT_ID, or an
 * api-ts/.env written by the pipeline):
 *     node scripts/import-split-rows.cjs
 * Then commit the updated testrail/mappingStore/caseMapping.json (and testrail_map.json).
 */
const fs = require('node:fs');
const path = require('node:path');
const { TestRailClient } = require('../testrail/client/testRailClient.cjs');
const { testRailConfig } = require('../testrail/config/testrailConfig.cjs');
const { CaseImporter } = require('../testrail/importer/caseImporter.cjs');
const { MappingStore } = require('../testrail/mappingStore/mappingStore.cjs');
const { defaultTraceabilityPath, loadAutomatedCaseIds } = require('../testrail/traceability/automatedCaseIds.cjs');

const pad = (i) => String(i + 1).padStart(2, '0');

// ── Row data (mirrors the test.each inputs, in the same order the tests emit) ──
const ENDPOINTS = [
  '4a GET /admin/tenants', '4b POST /admin/tenants', '4c GET /admin/tenants/:id',
  '4d PATCH /admin/tenants/:id/company', '4e PATCH /admin/tenants/:id/status',
  '4f PATCH /admin/tenants/:id/owner', '4g POST /admin/tenants/:id/handover',
];
const VARIANTS = ['i missing header', 'ii tampered JWT', 'iii tenant-pool JWT (wrong pool)'];
const DOMAIN_SUBS = ['11a bare domain', '11b https + www', '11c www prefix', '11d path + query', '11e port suffix'];
const VALIDATION_SUBS = ['13a name empty', '13b domain empty', '13c domain invalid format', '13d address empty', '13e ownerName empty', '13f ownerEmail invalid', '13g multiple invalid fields'];
const MAXLEN_FIELDS = ['name', 'domain', 'address', 'ownerName', 'ownerEmail'];
const MANAGER_RIGHTS = ['manage_contracts', 'view_contracts', 'manage_sourcing', 'view_sourcing', 'manage_vendors', 'view_vendors', 'view_dashboard', 'use_ai_assistant'];
const ANALYST_VIEW = ['view_contracts', 'view_sourcing', 'view_vendors', 'view_dashboard', 'use_ai_assistant'];
const ANALYST_WRITE = ['manage_contracts', 'manage_sourcing', 'manage_vendors', 'manage_users', 'view_audit_logs'];
const RBAC004 = ['role-manager', 'role-analyst'];
const VENDOR_STATES = ['expired', 'used', 'revoked', 'active_but_expires_at_past'];
const TENANT_LEN = [255, 256];
const USER_ROLES = ['procurement_manager', 'procurement_analyst'];

function tc(caseId, title, steps, expectedResult, actor) {
  return { caseId, title, module: 'API', priority: 'P0', actor, steps: [steps], expectedResult };
}

function buildRows() {
  const rows = [];
  // TC-ADMAPI-004 — endpoint × token-variant (probe-major)
  let i = 0;
  for (const e of ENDPOINTS) for (const v of VARIANTS) {
    rows.push(tc(`TC-ADMAPI-004-${pad(i++)}`, `${e} with ${v} → 401 ERR_AUTH_INVALID_TOKEN`,
      `Call ${e} with a ${v} admin token.`, '401; error.code=ERR_AUTH_INVALID_TOKEN; no side effects.',
      'Unauthenticated / tenant-pool token holder'));
  }
  // TC-ADMAPI-011 — domain normalization variants
  DOMAIN_SUBS.forEach((sub, n) => rows.push(tc(`TC-ADMAPI-011-${pad(n)}`,
    `duplicate domain ${sub} → 409 ERR_TENANT_DOMAIN_DUPLICATE`,
    `Create a tenant whose domain (${sub}) normalizes to a domain already owned.`,
    '409 ERR_TENANT_DOMAIN_DUPLICATE; nothing created.', 'Platform Admin')));
  // TC-ADMAPI-013 — create validation matrix
  VALIDATION_SUBS.forEach((sub, n) => rows.push(tc(`TC-ADMAPI-013-${pad(n)}`,
    `${sub} → 400 ERR_VALIDATION_FAILED`, `Create a tenant with ${sub}.`,
    '400 ERR_VALIDATION_FAILED with the exact §5 per-field message(s).', 'Platform Admin')));
  // TC-ADMAPI-014 — max-length boundaries (field × at/over limit)
  let m = 0;
  for (const f of MAXLEN_FIELDS) for (const kind of ['at limit', 'over limit']) {
    rows.push(tc(`TC-ADMAPI-014-${pad(m++)}`, `${f} ${kind} boundary`,
      `Create a tenant with ${f} ${kind}.`,
      'At limit → accepted (2xx); over limit → 400 with the field max-length message.', 'Platform Admin'));
  }
  // TC-RBAC-002 — Manager rights
  MANAGER_RIGHTS.forEach((r, n) => rows.push(tc(`TC-RBAC-002-${pad(n)}`,
    `Manager has right=${r} (US-RBAC-004 AC-001)`, `As a Manager, call the endpoint guarded by ${r}.`,
    'Access granted (right present in Manager role).', 'Procurement Manager')));
  // TC-RBAC-003a — Analyst view rights (allowed)
  ANALYST_VIEW.forEach((r, n) => rows.push(tc(`TC-RBAC-003a-${pad(n)}`,
    `Analyst view right=${r} succeeds (US-RBAC-005 AC-001)`, `As an Analyst, call the endpoint guarded by ${r}.`,
    'Access granted (view right present for Analyst).', 'Procurement Analyst')));
  // TC-RBAC-003b — Analyst write rights (denied)
  ANALYST_WRITE.forEach((r, n) => rows.push(tc(`TC-RBAC-003b-${pad(n)}`,
    `Analyst write right=${r} denied`, `As an Analyst, call the endpoint guarded by ${r}.`,
    '403 denied (write right absent for Analyst).', 'Procurement Analyst')));
  // TC-RBAC-004 — role denied user management
  RBAC004.forEach((role, n) => rows.push(tc(`TC-RBAC-004-${pad(n)}`,
    `role=${role} denied User Management access (SR-014)`, `As ${role}, call a User Management endpoint.`,
    '403 denied (manage_users absent).', role)));
  // TC-VENDOR-003 — token states rejected
  VENDOR_STATES.forEach((s, n) => rows.push(tc(`TC-VENDOR-003-${pad(n)}`,
    `token state=${s} rejected 401 (SR-009)`, `Present a vendor token in state=${s}.`,
    '401 rejected.', 'Vendor')));
  // TC-TENANT-013 — name/domain length boundary
  TENANT_LEN.forEach((len, n) => rows.push(tc(`TC-TENANT-013-${pad(n)}`,
    `tenant name/domain length=${len} boundary (§5.2 varchar(255))`, `Create a tenant with name length=${len}.`,
    len <= 255 ? 'Accepted (201).' : 'Rejected (400 length boundary).', 'Platform Admin')));
  // TC-USER-001 — PO creates roles
  USER_ROLES.forEach((role, n) => rows.push(tc(`TC-USER-001-${pad(n)}`,
    `PO creates role=${role}, active immediately, notification email sent (US-RBAC-003 AC-001)`,
    `As PO, create a user with role=${role}.`, 'User created active; notification email sent.', 'Procurement Owner')));
  return rows;
}

function requireEnv(k) {
  if (!String(process.env[k] || '').trim()) {
    throw new Error(`Missing ${k}. Set TESTRAIL_URL/USERNAME/PASSWORD/PROJECT_ID (or run where api-ts/.env has them).`);
  }
}

async function main() {
  ['TESTRAIL_URL', 'TESTRAIL_USERNAME', 'TESTRAIL_PASSWORD', 'TESTRAIL_PROJECT_ID'].forEach(requireEnv);
  const rows = buildRows();
  console.log(`[split-rows] generated ${rows.length} row-case(s) to ensure in TestRail project ${testRailConfig.projectId}`);

  const layerRoot = path.resolve(__dirname, '..');
  const client = new TestRailClient(testRailConfig);
  const mappingStore = new MappingStore(testRailConfig.mappingFile, testRailConfig.runContextFile);
  const automatedCaseIds = loadAutomatedCaseIds(defaultTraceabilityPath(layerRoot), layerRoot);
  const importer = new CaseImporter({
    client,
    projectId: testRailConfig.projectId,
    mappingStore,
    customQanameId: testRailConfig.customQanameId,
    templateId: testRailConfig.templateId,
    apiTypeId: testRailConfig.apiTypeId,
    customAutomatedNo: testRailConfig.customAutomatedNo,
    customAutomatedYes: testRailConfig.customAutomatedYes,
    automatedCaseIds,
  });

  const mapping = await importer.importCases(rows);
  console.log(`[split-rows] caseMapping.json now has ${Object.keys(mapping).length} entries.`);

  // Sync the new IDs into the testrail_map.json seed (source of truth), merged.
  const seedPath = path.resolve(layerRoot, '..', '..', 'testcases', 'testrail_map.json');
  try {
    const seed = fs.existsSync(seedPath) ? JSON.parse(fs.readFileSync(seedPath, 'utf8')) : {};
    let added = 0;
    for (const { caseId } of rows) {
      if (mapping[caseId] && seed[caseId] !== mapping[caseId]) { seed[caseId] = mapping[caseId]; added += 1; }
    }
    fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2) + '\n', 'utf8');
    console.log(`[split-rows] synced ${added} entr(ies) into ${seedPath}`);
  } catch (e) {
    console.warn(`[split-rows] could not sync testrail_map.json: ${e.message}`);
  }
}

main().catch((e) => { console.error(`[split-rows] FAILED: ${e.message}`); process.exit(1); });
