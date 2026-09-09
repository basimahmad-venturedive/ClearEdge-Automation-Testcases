/**
 * ONE-OFF sweep of pre-ledger test data on a live tenant.
 *
 *   node scripts/sweep-legacy.mjs                      # DRY RUN (default) — deletes nothing
 *   node scripts/sweep-legacy.mjs --apply              # actually delete
 *   node scripts/sweep-legacy.mjs --entity=users       # one entity at a time
 *   node scripts/sweep-legacy.mjs --limit=50 --apply   # batch, resumable — just run it again
 *
 * This is the companion to sweep-fixtures.mjs, which is the RIGHT tool: it deletes only ids
 * the harness recorded creating. Everything on QA from before that ledger existed has no
 * manifest, so the only way to reach it is to match on shape — which is guessing, and guessing
 * deletes real data. So every rule below was derived by sampling the live tenant on 2026-09-09
 * and is deliberately biased toward FALSE NEGATIVES: leaving test data behind is cheap, and
 * deleting someone's fixture is not. Retire this script once it has been run.
 *
 * MEASURED BASIS (QA, 2026-09-09 — re-measure before trusting these numbers again):
 *   users      643 total, 608 @example.com
 *   vendors    875 total, ~98% faker-shaped in the first 250
 *   contracts  430 total, 271 with no name and status in_review
 *   sourcing   882 total — NO RULE, see below
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiTsDir = path.resolve(here, "..");
const TEST_ENV = process.env.TEST_ENV ?? "qa";
dotenv.config({ path: path.join(apiTsDir, "envs", `.env.${TEST_ENV}`), override: true });

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (n, d) => (argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split("=").slice(1).join("=");
const APPLY = has("--apply");
const LIMIT = Number(val("limit", "0")) || Infinity;
const ONLY = String(val("entity", "")).split(",").filter(Boolean);

const B = process.env.API_BASE_URL;
const REGION = process.env.AWS_REGION ?? "us-east-1";
const H = { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth" };

// ---------------------------------------------------------------------------
// The rules. Each says what it matches AND, just as importantly, what it spares.
// ---------------------------------------------------------------------------

/**
 * USERS — `@example.com` only.
 * RFC 2606 reserves example.com; it can never be a deliverable address, so a user there is
 * definitionally not a real person. SPARED: the other 35, which include a colleague's
 * `basim.navaid+test1234567@venturedive.com` and faker addresses at real providers
 * (gmail/yahoo/yopmail). Those are probably test data too — "probably" is not good enough.
 */
const userRule = (u) => /@example\.com$/i.test(u.email ?? "");

/**
 * VENDORS — the fixture generator's signature.
 * `newVendor()` builds `${faker.company.name()} ${faker.string.alphanumeric(5)}`, so a trailing
 * 5-char token that looks random (has a digit, or mixes case) is the generator's fingerprint.
 * The `X Probe <base36>` names come from the UI-probe scripts. SPARED: anything whose trailing
 * token is a plain lowercase word, because a real vendor could legitimately end that way.
 */
const vendorRule = (v) => {
  const name = v.name ?? "";
  if (/\b(Profile|Table|EditDelete|Seed|Fixture)\s+Probe\s+[a-z0-9]{6,}$/i.test(name)) return true;
  const m = name.match(/ ([A-Za-z0-9]{5})$/);
  if (!m) return false;
  const tok = m[1];
  return /[0-9]/.test(tok) || (/[a-z]/.test(tok) && /[A-Z]/.test(tok));
};

/**
 * CONTRACTS — uploads that never became contracts.
 * `contractName` is populated by Stage 1 extraction, so a family with NO name still sitting in
 * `in_review` is an upload whose extraction never completed. Endpoint #10 404s on it (spec v1.7
 * SS9.5 — no saved representative version), so it cannot be opened, saved or used by anyone.
 * It is garbage regardless of who created it. Each candidate is additionally verified live
 * (detail must 404) before deletion — see verifyContractUnusable. SPARED: every named contract,
 * and everything active/expired/terminated.
 */
const contractRule = (c) => (c.contractName == null || c.contractName === "") && c.status === "in_review";

/**
 * SOURCING — deliberately NO RULE.
 * The 882 events carry realistic, human-authored titles ("Office Ergonomic Chairs – 25 Units",
 * "HR Payroll Platform Implementation", "Residential House Construction – 5 Marla"), not faker
 * output — they look like manual QA and demo data. One is literally named
 * "VP QA DEADLINE FIXTURE (backdate me)", i.e. a fixture a teammate is waiting on. There is no
 * marker here that separates test from real, so this script will not touch sourcing events.
 * Clear them by hand, or leave them to the ledger from now on.
 */

const get = async (A, u) => {
  for (let i = 0; i < 3; i++) {
    try { return await axios.get(u, A); } catch { await new Promise((s) => setTimeout(s, 1200)); }
  }
  return { status: 0, data: {} };
};

async function fetchAll(A, apiPath, key) {
  const rows = [];
  for (let p = 1; p <= 80; p++) {
    let r = await get(A, `${B}${apiPath}?page=${p}&limit=50`);
    if (r.status !== 200) r = await get(A, `${B}${apiPath}?page=${p}`);
    if (r.status !== 200) break;
    const d = r.data?.data?.[key] ?? [];
    if (!d.length) break;
    rows.push(...d);
    const tp = r.data?.data?.pagination?.totalPages;
    if (tp && p >= tp) break;
  }
  return rows;
}

async function mint(clientId, user, pass) {
  const r = await axios.post(`https://cognito-idp.${REGION}.amazonaws.com/`,
    { AuthFlow: "USER_PASSWORD_AUTH", ClientId: clientId, AuthParameters: { USERNAME: user, PASSWORD: pass } },
    { headers: H, validateStatus: () => true });
  if (r.status !== 200) throw new Error(`login ${user}: ${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);
  return r.data.AuthenticationResult.IdToken;
}

const po = await mint(process.env.COGNITO_TENANT_APP_CLIENT_ID, process.env.DEV_TENANT_USERNAME, process.env.DEV_TENANT_PASSWORD);
const A = { headers: { Authorization: `Bearer ${po}` }, validateStatus: () => true, timeout: 30000 };
const TENANT_ID = JSON.parse(Buffer.from(po.split(".")[1], "base64url").toString())["custom:tenant_id"];

/**
 * Users are deleted through the ADMIN route, not the tenant app.
 * `DELETE /users/:id` does not exist — probed on QA it answers a BARE 404 with an empty body
 * (an unmatched route), where every real route answers 404 with an error CODE. The tenant
 * surface can only deactivate. So this needs an admin token and the tenant id, and without
 * them the users step is skipped rather than failing 608 times.
 */
let adminToken = null;
const needsAdmin = !ONLY.length || ONLY.includes("users");
if (needsAdmin) {
  try {
    adminToken = await mint(process.env.COGNITO_ADMIN_APP_CLIENT_ID, process.env.DEV_ADMIN_USERNAME, process.env.DEV_ADMIN_PASSWORD);
  } catch (e) {
    console.log(`[legacy-sweep] no admin token (${String(e.message).slice(0, 80)}) — the users step will be skipped.`);
  }
}

/** A contract is only swept if the API itself confirms it is unreachable. */
async function verifyContractUnusable(id) {
  const d = await get(A, `${B}/contracts/${id}`);
  return d.status === 404;
}

const PLAN = [
  { name: "users", apiPath: "/users", key: "users", rule: userRule, label: (x) => x.email, token: () => adminToken, requires: () => Boolean(adminToken), del: (x) => `${B}/admin/tenants/${TENANT_ID}/users/${x.id}` },
  { name: "vendors", apiPath: "/vendors", key: "vendors", rule: vendorRule, label: (x) => x.name, del: (x) => `${B}/vendors/${x.id}` },
  { name: "contracts", apiPath: "/contracts", key: "contracts", rule: contractRule, label: (x) => `${x.contractId} (${x.contractName ?? "no name"})`, del: (x) => `${B}/contracts/${x.familyId}`, id: (x) => x.familyId, verify: verifyContractUnusable },
];

console.log(`[legacy-sweep] target=${TEST_ENV}  mode=${APPLY ? "APPLY — records WILL be deleted" : "DRY RUN — nothing will be deleted"}`);
console.log(`[legacy-sweep] sourcing events are intentionally NOT swept (no reliable marker — see the header).\n`);

let grandDeleted = 0, grandFailed = 0;
const auditLog = [];

for (const step of PLAN) {
  if (ONLY.length && !ONLY.includes(step.name)) continue;
  if (step.requires && !step.requires()) { console.log(`### ${step.name.toUpperCase()}  SKIPPED — prerequisite unavailable (see above)
`); continue; }
  const rows = await fetchAll(A, step.apiPath, step.key);
  const matched = rows.filter(step.rule);
  const spared = rows.filter((r) => !step.rule(r));

  console.log(`### ${step.name.toUpperCase()}  fetched=${rows.length}  MATCH=${matched.length}  SPARED=${spared.length}`);
  console.log(`    spared sample: ${spared.slice(0, 5).map(step.label).join(" | ") || "(none)"}`);
  console.log(`    match  sample: ${matched.slice(0, 5).map(step.label).join(" | ") || "(none)"}`);

  const batch = matched.slice(0, LIMIT === Infinity ? matched.length : LIMIT);
  if (!APPLY) { console.log(`    would delete ${batch.length}${batch.length < matched.length ? ` of ${matched.length} (--limit)` : ""}\n`); continue; }

  let del = 0, skip = 0, fail = 0;
  for (const row of batch) {
    const id = step.id ? step.id(row) : row.id;
    if (step.verify && !(await step.verify(id))) { skip++; continue; }  // still usable → leave it
    const bearer = step.token ? step.token() : po;
    const r = await axios.delete(step.del(row), { headers: { Authorization: `Bearer ${bearer}` }, validateStatus: () => true, timeout: 30000 });
    if (r.status >= 200 && r.status < 300) { del++; auditLog.push({ entity: step.name, id, label: step.label(row) }); }
    else if (r.status === 404) { skip++; }
    else { fail++; if (fail <= 5) console.log(`    FAIL ${id} -> ${r.status} ${JSON.stringify(r.data?.error?.code ?? "")}`); }
    if ((del + skip + fail) % 25 === 0) process.stdout.write(`    …${del + skip + fail}/${batch.length}\r`);
  }
  console.log(`    deleted=${del}  skipped=${skip}  failed=${fail}\n`);
  grandDeleted += del; grandFailed += fail;
}

if (APPLY) {
  const out = path.join(apiTsDir, ".artifacts", `legacy-sweep-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(auditLog, null, 2), "utf8");
  console.log(`[legacy-sweep] deleted=${grandDeleted}  failed=${grandFailed}`);
  console.log(`[legacy-sweep] audit written: ${out}`);
} else {
  console.log("[legacy-sweep] re-run with --apply to delete. Consider --limit=50 for the first batch.");
}
process.exit(grandFailed > 0 ? 1 : 0);
