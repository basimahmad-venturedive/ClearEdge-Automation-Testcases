/**
 * Read-only TestRail mapping sync.
 *
 * Adds `TC-ID -> case-id` entries to caseMapping.json for active TC-IDs that are
 * CURRENTLY UNMAPPED, by matching cases that already exist in the TestRail project
 * (on `refs` or on the TC-ID embedded in the title). It:
 *   - NEVER creates or updates a TestRail case (unlike scripts/testrail-import.cjs,
 *     which authors cases from markdown and can spawn duplicates), and
 *   - NEVER overwrites an existing mapping entry — only fills in the missing ones.
 * So it is safe to run repeatedly and cannot disturb the maintained mapping.
 *
 * Use it to pull already-published suites (e.g. vendor TC-VDAPI-*, clause TC-CCAPI-*)
 * into caseMapping.json so CQM / the quality gate / TestRail publish count them.
 *
 * Requires TestRail creds in the environment: TESTRAIL_URL, TESTRAIL_USERNAME,
 * TESTRAIL_PASSWORD, TESTRAIL_PROJECT_ID. Review the caseMapping.json diff and commit.
 */
const fs = require('node:fs');
const path = require('node:path');
const { TestRailClient } = require('../testrail/client/testRailClient.cjs');
const { testRailConfig } = require('../testrail/config/testrailConfig.cjs');
const { MappingStore } = require('../testrail/mappingStore/mappingStore.cjs');

// Keep in sync with testrail-create-run.cjs / publishRecords.cjs.
const TC_ID_PATTERN = /TC-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+(?:-\d+)?/g;
const TEST_DECLARATION_PATTERN = /\b(?:test|liveTest|liveOnly|dbOnly|localOnly|it)(?:\.\w+)*\s*(?:\([^)]*\))?\s*\(/;
const TESTS_DIR = path.resolve(__dirname, '..', 'tests');

function collectActiveTcIds(dir, found = new Set()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectActiveTcIds(full, found);
    } else if (/\.test\.(js|ts)$/.test(entry.name)) {
      for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
        if (!TEST_DECLARATION_PATTERN.test(line)) continue;
        for (const id of line.match(TC_ID_PATTERN) || []) {
          if (!id.startsWith('TC-CEIQ-')) found.add(id); // TC-CEIQ-* are spec-doc refs
        }
      }
    }
  }
  return found;
}

/** TC-IDs a TestRail case carries, via its refs field and its title. */
function tcIdsForCase(testRailCase) {
  const ids = new Set();
  for (const ref of String(testRailCase.refs || '').split(',')) {
    const trimmed = ref.trim();
    if (trimmed.startsWith('TC-') && !trimmed.startsWith('TC-CEIQ-')) ids.add(trimmed);
  }
  for (const id of String(testRailCase.title || '').match(TC_ID_PATTERN) || []) {
    if (!id.startsWith('TC-CEIQ-')) ids.add(id);
  }
  return ids;
}

async function main() {
  const missing = ['url', 'username', 'password', 'projectId'].filter((key) => !testRailConfig[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing TestRail config: ${missing.join(', ')}. Set TESTRAIL_URL / TESTRAIL_USERNAME / ` +
        'TESTRAIL_PASSWORD / TESTRAIL_PROJECT_ID before running.'
    );
  }

  const store = new MappingStore(testRailConfig.mappingFile, testRailConfig.runContextFile);
  const mapping = store.loadMapping();
  const active = collectActiveTcIds(TESTS_DIR);
  const unmapped = [...active].filter(
    (id) => !Object.prototype.hasOwnProperty.call(mapping, id)
  );

  console.log(`[sync] ${active.size} active TC-ID(s) in tests/; ${unmapped.length} currently unmapped.`);
  if (unmapped.length === 0) {
    console.log('[sync] nothing to do — every active TC-ID is already mapped.');
    return;
  }

  const client = new TestRailClient(testRailConfig);
  const cases = await client.getCases(testRailConfig.projectId); // READ-ONLY
  console.log(`[sync] fetched ${cases.length} existing case(s) from project ${testRailConfig.projectId}.`);

  const index = new Map(); // TC-ID -> [caseId, ...]
  for (const testRailCase of cases) {
    for (const id of tcIdsForCase(testRailCase)) {
      if (!index.has(id)) index.set(id, []);
      index.get(id).push(testRailCase.id);
    }
  }

  const added = [];
  const ambiguous = [];
  const notFound = [];
  for (const id of unmapped) {
    const hits = index.get(id);
    if (!hits || hits.length === 0) {
      notFound.push(id);
      continue;
    }
    if (hits.length > 1) ambiguous.push(`${id} -> C${hits.join(' / C')}`);
    mapping[id] = hits[0]; // only fill unmapped; never overwrite an existing entry
    added.push(`${id} -> C${hits[0]}`);
  }

  if (added.length > 0) {
    store.saveMapping(mapping);
    console.log(`[sync] added ${added.length} mapping(s):`);
    for (const line of added) console.log('   +', line);
  } else {
    console.log('[sync] no unmapped TC-ID matched an existing TestRail case — nothing written.');
  }
  if (ambiguous.length > 0) {
    console.log(`[sync] ⚠ ${ambiguous.length} TC-ID(s) matched MORE THAN ONE case (used the first — check for duplicates in TestRail):`);
    for (const line of ambiguous) console.log('   ?', line);
  }
  if (notFound.length > 0) {
    console.log(`[sync] ⚠ ${notFound.length} unmapped TC-ID(s) had NO matching case in TestRail (create them there first):`);
    console.log('    ' + notFound.join(', '));
  }
  console.log(`[sync] caseMapping.json now has ${Object.keys(mapping).length} entr${Object.keys(mapping).length === 1 ? 'y' : 'ies'}.`);
}

main().catch((error) => {
  console.error(`[sync] failed: ${error.message}`);
  process.exit(1);
});
