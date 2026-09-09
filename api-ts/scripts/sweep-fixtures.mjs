/**
 * Delete the records this harness created and did not clean up.
 *
 *   node scripts/sweep-fixtures.mjs                 # DRY RUN (default) — prints, deletes nothing
 *   node scripts/sweep-fixtures.mjs --apply         # actually delete
 *   node scripts/sweep-fixtures.mjs --older-than=2  # only entries older than N hours (default 0)
 *   node scripts/sweep-fixtures.mjs --entity=contract,vendor
 *   TEST_ENV=qa node scripts/sweep-fixtures.mjs     # target selection, same as the suite
 *
 * It sweeps ONLY ids present in .artifacts/fixture-ledger.jsonl — records the harness itself
 * created (see src/utils/fixtureLedger.ts). It never matches on "looks like test data":
 * vendor fixtures are `faker.company.name()` plus five random characters and are
 * indistinguishable from real vendors, so a name-pattern sweep on a shared tenant would be
 * guesswork with destructive consequences. An id we wrote down is not a guess.
 *
 * That does mean the ~2,800 records already on QA from before the ledger existed are NOT
 * covered — they have no manifest. Clearing those is a separate, human-reviewed decision.
 *
 * Exit code is always 0 in dry-run. With --apply it is non-zero only if a delete errored,
 * so a CI pre-step can surface a broken sweep without failing the build on "nothing to do".
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
const val = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : dflt;
};
const APPLY = has("--apply");
const OLDER_THAN_H = Number(val("older-than", "0"));
const ONLY = String(val("entity", "")).split(",").filter(Boolean);

const LEDGER = path.join(apiTsDir, ".artifacts", "fixture-ledger.jsonl");
const B = process.env.API_BASE_URL;
const REGION = process.env.AWS_REGION ?? "us-east-1";

function readLedger() {
  if (!fs.existsSync(LEDGER)) return [];
  return fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

const H = { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth" };
async function mint(clientId, user, pass) {
  const r = await axios.post(`https://cognito-idp.${REGION}.amazonaws.com/`,
    { AuthFlow: "USER_PASSWORD_AUTH", ClientId: clientId, AuthParameters: { USERNAME: user, PASSWORD: pass } },
    { headers: H, validateStatus: () => true });
  if (r.status !== 200) throw new Error(`login ${user}: ${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);
  return r.data.AuthenticationResult.IdToken;
}

/** entity -> { url(entry), token: "po" | "admin" } */
const ROUTES = {
  contract:      { url: (e) => `${B}/contracts/${e.id}`, token: "po" },
  vendor:        { url: (e) => `${B}/vendors/${e.id}`, token: "po" },
  sourcingEvent: { url: (e) => `${B}/sourcing-events/${e.id}`, token: "po" },
  tenant:        { url: (e) => `${B}/admin/tenants/${e.id}`, token: "admin" },
  tenantUser:    { url: (e) => (e.parentId ? `${B}/admin/tenants/${e.parentId}/users/${e.id}` : null), token: "admin" },
};

const entries = readLedger();
const cutoff = Date.now() - OLDER_THAN_H * 3600_000;
const targets = entries.filter((e) => {
  if (ONLY.length && !ONLY.includes(e.entity)) return false;
  if (OLDER_THAN_H > 0 && new Date(e.at).getTime() > cutoff) return false;
  return true;
});

const byEntity = targets.reduce((a, e) => ((a[e.entity] = (a[e.entity] || 0) + 1), a), {});
console.log(`[sweep] target=${TEST_ENV}  ledger=${entries.length} entry(s)  selected=${targets.length}`);
console.log(`[sweep] by entity: ${JSON.stringify(byEntity)}`);
console.log(`[sweep] mode: ${APPLY ? "APPLY — records WILL be deleted" : "DRY RUN — nothing will be deleted"}`);

if (!targets.length) {
  console.log("[sweep] nothing to do.");
  process.exit(0);
}

if (!APPLY) {
  for (const e of targets.slice(0, 40)) {
    const u = ROUTES[e.entity]?.url(e);
    console.log(`   would DELETE ${e.entity.padEnd(14)} ${e.id}  (created ${e.at})${u ? "" : "  [NO ROUTE — needs parentId]"}`);
  }
  if (targets.length > 40) console.log(`   … and ${targets.length - 40} more`);
  console.log("\n[sweep] re-run with --apply to delete these.");
  process.exit(0);
}

const tokens = {};
tokens.po = await mint(process.env.COGNITO_TENANT_APP_CLIENT_ID, process.env.DEV_TENANT_USERNAME, process.env.DEV_TENANT_PASSWORD);
if (targets.some((e) => ROUTES[e.entity]?.token === "admin")) {
  tokens.admin = await mint(process.env.COGNITO_ADMIN_APP_CLIENT_ID, process.env.DEV_ADMIN_USERNAME, process.env.DEV_ADMIN_PASSWORD);
}

let deleted = 0, gone = 0, failed = 0;
const survivors = [];
for (const e of entries) {
  if (!targets.includes(e)) { survivors.push(e); continue; }
  const route = ROUTES[e.entity];
  const url = route?.url(e);
  if (!url) { console.log(`   SKIP  ${e.entity} ${e.id} — no delete route`); survivors.push(e); continue; }
  const r = await axios.delete(url, { headers: { Authorization: `Bearer ${tokens[route.token]}` }, validateStatus: () => true, timeout: 30000 });
  if (r.status >= 200 && r.status < 300) { deleted++; }
  else if (r.status === 404) { gone++; }            // already removed by its own teardown
  else {
    failed++; survivors.push(e);
    console.log(`   FAIL  ${e.entity} ${e.id} -> ${r.status} ${JSON.stringify(r.data?.error?.code ?? "")}`);
  }
}

// Keep only what we could not remove, so the next sweep retries exactly those.
fs.writeFileSync(LEDGER, survivors.map((e) => `${JSON.stringify(e)}\n`).join(""), "utf8");
console.log(`\n[sweep] deleted=${deleted}  already-gone=${gone}  failed=${failed}  ledger now=${survivors.length}`);
process.exit(failed > 0 ? 1 : 0);
