// Create TestRail cases from a table-format testcases/TC-*.md suite.
//
// The kit's `testrail:import` uses the legacy colon-format parser and cannot read
// the ClearEdge table format; `testrail:sync-fields-and-labels` only UPDATES cases
// that are already mapped. This script fills the gap: it CREATES the cases with
// their full field set, under a `US-*` root section with one child section per
// TC-ID prefix (the layout already used by US-CT / US-VD on project 110).
//
// Usage:
//   node scripts/testrail-create-cases.cjs --file ../../testcases/TC-CEIQ-FEAT-012.md            # dry run
//   node scripts/testrail-create-cases.cjs --file ../../testcases/TC-CEIQ-FEAT-012.md --go       # write
//   ...add --user-story US-HDR-002 to override the file header's own `**User story / epic:**`
//
// Idempotent: an id already present in testcases/testrail_map.json is skipped, and a
// case whose title already exists in the target section is adopted rather than duplicated.

const fs = require('node:fs');
const path = require('node:path');

const parser = require('../testrail/mdParser/tableCaseParser.cjs');
const { TestRailClient } = require('../testrail/client/testRailClient.cjs');
const { testRailConfig } = require('../testrail/config/testrailConfig.cjs');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

const GO = has('--go');
const FILE = val('--file');
const USER_STORY_OVERRIDE = val('--user-story');

if (!FILE) { console.error('Missing --file <path to TC-*.md>'); process.exit(1); }

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TC_PATH = path.resolve(process.cwd(), FILE);
const MAP_FILE = path.join(REPO_ROOT, 'testcases', 'testrail_map.json');

// ---- priorities: P0 highest ----
function priorityIdFor(priority) {
  const p = (priority || '').toUpperCase();
  if (p.includes('P0')) return 4;
  if (p.includes('P1')) return 3;
  if (p.includes('P2')) return 2;
  return 1;
}

// ---- field payload: same mapping the sync script verified on project 110 ----
function splitSteps(text) {
  if (!text) return [{ content: 'See test case.', expected: '' }];
  const parts = text.split(/(?:^|\s)(?=\d+\.\s)/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return [{ content: text.trim(), expected: '' }];
  return parts.map((p) => ({ content: p.replace(/^\d+\.\s*/, '').trim(), expected: '' }));
}

function fieldPayload(b) {
  const rf = parser.resolvedFields(b);
  // `Goals` is disabled on project 110, so Postconditions render inside Expected.
  const expected = `${rf.expected}\n\n**Postconditions / cleanup:** ${rf.postcond}`;
  const payload = {
    custom_preconds: rf.precond,
    custom_steps_separated: splitSteps(rf.steps),
    custom_expected: expected,
    custom_description: rf.notes,
    custom_testdata: rf.testData
  };
  if (parser.isApiCase(b)) {
    payload.custom_api_parameters = rf.testData;
    payload.custom_response_body = rf.respPayload;
    payload.custom_request_body = rf.requestBody || '';
    payload.custom_authorization = rf.authorization;
    payload.custom_api_headers = 'Content-Type: application/json';
  }
  return payload;
}

function userStoryFromFile(content) {
  const m = content.match(/\*\*User story \/ epic:\*\*\s*`?(US-[A-Z0-9-]+)`?/);
  return m ? m[1] : undefined;
}

function prefixOf(id) {
  const m = (id || '').match(/^TC-([A-Z0-9]+)-\d+$/);
  return m ? m[1] : 'MISC';
}

(async () => {
  const content = fs.readFileSync(TC_PATH, 'utf-8');
  const userStory = USER_STORY_OVERRIDE || userStoryFromFile(content);
  if (!userStory) { console.error('No `**User story / epic:** US-*` header found; pass --user-story'); process.exit(1); }

  const blocks = parser.parseFile(TC_PATH);
  const map = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, 'utf-8')) : {};

  const todo = blocks.filter((b) => b.id && !map[b.id]);
  const byPrefix = new Map();
  for (const b of todo) {
    const p = prefixOf(b.id);
    if (!byPrefix.has(p)) byPrefix.set(p, []);
    byPrefix.get(p).push(b);
  }

  console.log(`Suite: ${path.basename(TC_PATH)}`);
  console.log(`User story section: ${userStory}`);
  console.log(`Parsed: ${blocks.length}  |  already mapped: ${blocks.length - todo.length}  |  to create: ${todo.length}`);
  console.log(`Child sections: ${[...byPrefix.entries()].map(([p, v]) => `${p}(${v.length})`).join(' ')}`);
  const apiCount = todo.filter((b) => parser.isApiCase(b)).length;
  console.log(`Templates: API(5) ${apiCount}  |  UI(2) ${todo.length - apiCount}`);

  if (!GO) {
    const sample = todo[0];
    if (sample) {
      console.log('\n(dry-run — pass --go to write). Sample payload:');
      console.log(JSON.stringify({
        title: `${sample.id} — ${sample.title}`,
        refs: sample.id,
        template_id: parser.isApiCase(sample) ? 5 : 2,
        type_id: parser.isApiCase(sample) ? 15 : 16,
        priority_id: priorityIdFor(sample.rows.priority),
        ...fieldPayload(sample)
      }, null, 2).slice(0, 1800));
    }
    return;
  }

  if (!testRailConfig.url || !testRailConfig.username || !testRailConfig.password) {
    console.error('Missing TESTRAIL_URL / TESTRAIL_USERNAME / TESTRAIL_PASSWORD.');
    process.exit(1);
  }

  const client = new TestRailClient(testRailConfig);
  const projectId = testRailConfig.projectId;

  const sections = await client.getSections(projectId);
  let root = sections.find((s) => s.name === userStory && !s.parent_id);
  if (!root) {
    root = await client.request('POST', `/add_section/${projectId}`, { name: userStory });
    console.log(`created root section ${root.id}:${userStory}`);
  } else {
    console.log(`reusing root section ${root.id}:${userStory}`);
  }

  const childByName = new Map(sections.filter((s) => s.parent_id === root.id).map((s) => [s.name, s]));
  for (const prefix of byPrefix.keys()) {
    if (childByName.has(prefix)) continue;
    const created = await client.request('POST', `/add_section/${projectId}`, { name: prefix, parent_id: root.id });
    childByName.set(prefix, created);
    console.log(`created child section ${created.id}:${prefix}`);
  }

  // adopt rather than duplicate: index existing cases in the target sections by title
  const existing = await client.getCases(projectId);
  const targetSectionIds = new Set([...childByName.values()].map((s) => s.id));
  const byTitle = new Map();
  for (const c of existing) {
    if (targetSectionIds.has(c.section_id)) byTitle.set(c.title, c);
  }

  let created = 0; let adopted = 0; const failures = [];
  for (const [prefix, list] of byPrefix.entries()) {
    const section = childByName.get(prefix);
    for (const b of list) {
      const title = `${b.id} — ${b.title}`;
      const found = byTitle.get(title);
      if (found) { map[b.id] = found.id; adopted += 1; continue; }
      const isApi = parser.isApiCase(b);
      const payload = {
        title,
        refs: b.id,
        template_id: isApi ? 5 : 2,
        type_id: isApi ? 15 : 16,
        priority_id: priorityIdFor(b.rows.priority),
        ...fieldPayload(b)
      };
      try {
        const c = await client.addCase(section.id, payload);
        map[b.id] = c.id;
        created += 1;
        if (created % 25 === 0) console.log(`  …created ${created}`);
      } catch (e) {
        failures.push({ id: b.id, error: e.message });
      }
    }
  }

  fs.writeFileSync(MAP_FILE, `${JSON.stringify(map, null, 2)}\n`);
  console.log(`\ncreated=${created}  adopted=${adopted}  failed=${failures.length}  map entries=${Object.keys(map).length}`);
  for (const f of failures.slice(0, 10)) console.log(`  FAIL ${f.id}: ${f.error}`);
})().catch((e) => { console.error(`[TestRail] create failed: ${e.message}`); process.exit(1); });
