#!/usr/bin/env node
/**
 * Tag api-ts vitest suites for Regression / Smoke selection.
 *
 * Rules (per user):
 *  - Regression = tests that RUN on the dev/live target. Only `test` (env-agnostic,
 *    runs everywhere) and `liveOnly`/`liveTest` (dev/live) get ` @regression`.
 *  - LOCAL-ONLY tests get NO tag: `localOnly`, `dbOnly` (need the Docker Postgres /
 *    JWKS mock) and `test.skipIf(isLiveEnv())` (locally-signed JWT). They skip on dev,
 *    so they must NOT be in the regression suite.
 *  - The ~20% highest-priority regression tests per spec  -> ` @smoke @regression`
 *  - SKIPPED tests (test.skip) and under-development specs -> NO tags (strip any)
 *
 * Tags live inside the test title (first string arg). Reporters strip ` @\S+`
 * tokens before extracting TC-ids, so titles stay reporter-safe.
 *
 * Idempotent: strips all trailing @smoke/@regression tokens first, then re-adds.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] || ".";
// Excluded from every run (see vitest.config.ts UNDER_DEVELOPMENT). These never
// execute, so they carry NO regression/smoke tag — strip anything present.
const UNDER_DEV = new Set([
  "tests/admin.test.ts",
  "tests/audit.test.ts",
  "tests/auth.forgot-refresh-logout.test.ts",
  "tests/auth.login-setpw.test.ts",
  "tests/cache.test.ts",
  "tests/rbac.test.ts",
  "tests/tenant.test.ts",
  "tests/user.test.ts",
  "tests/vendor.test.ts",
]);
const files = [
  "tests/admin.test.ts",
  "tests/adminPortal.owner-handover.test.ts",
  "tests/adminPortal.tenants.test.ts",
  "tests/audit.test.ts",
  "tests/auth.forgot-refresh-logout.test.ts",
  "tests/auth.login-setpw.test.ts",
  "tests/auth.test.ts",
  "tests/cache.test.ts",
  "tests/companySettings.test.ts",
  "tests/rbac.test.ts",
  "tests/tenant.test.ts",
  "tests/user.test.ts",
  "tests/userManagement.test.ts",
  "tests/vendor.test.ts",
  "tests/vendorDirectory.test.ts",
  "tests/clauseConfiguration.test.ts",
];

// ~20% highest-priority cases per spec, counted over the DEV-RUNNABLE (regression)
// set only. Every smoke id below is a `test` or `liveOnly` case (never local-only).
const SMOKE = new Set([
  // adminPortal.owner-handover (8 dev-runnable -> 2)
  "TC-ADMAPI-050", "TC-ADMAPI-060",
  // adminPortal.tenants (60 dev-runnable -> 12; one representative per flattened group)
  "TC-ADMAPI-001", "TC-ADMAPI-002", "TC-ADMAPI-010", "TC-ADMAPI-020", "TC-ADMAPI-021",
  "TC-ADMAPI-030", "TC-ADMAPI-040", "TC-ADMAPI-041", "TC-ADMAPI-012",
  "TC-ADMAPI-011-1", "TC-ADMAPI-004-1", "TC-ADMAPI-013-1",
  // auth (3 dev-runnable plain tests -> 1; the 5 test.skipIf are local-only, untagged)
  "TC-AUTH-006",
  // companySettings (12 dev-runnable plain tests -> 2; all happy-path writes are localOnly)
  "TC-CSAPI-001", "TC-CSAPI-016-1",
  // userManagement (36 dev-runnable: 16 test + 20 liveOnly -> 7)
  "TC-UMAPI-001", "TC-UMAPI-010", "TC-UMAPI-050", "TC-UMAPI-090",
  "TC-UMAPI-030", "TC-UMAPI-062", "TC-UMAPI-080",
  // vendorDirectory (64 dev-runnable -> 13; one flagship per operation + auth)
  "TC-VDAPI-001", "TC-VDAPI-002-1", "TC-VDAPI-015", "TC-VDAPI-016", "TC-VDAPI-030",
  "TC-VDAPI-035", "TC-VDAPI-040", "TC-VDAPI-045", "TC-VDAPI-050", "TC-VDAPI-055",
  "TC-VDAPI-060", "TC-VDAPI-095", "TC-VDSEC-014",
  // clauseConfiguration (20 dev-runnable liveOnly -> 4; read / write / auth / validation)
  "TC-CCAPI-001", "TC-CCAPI-020", "TC-CCAPI-006", "TC-CCAPI-024",
]);

// Aliases whose tests RUN on the dev/live target (regression). Everything else that
// declares a test (localOnly, dbOnly, test.skipIf, test.runIf, test.skip) is local-only
// or skipped and gets NO tag.
// `analystOnly`/`managerParity` (vendorDirectory) = hasLive{Analyst,Manager}User() ? test : deferred
// — they RUN on a target that has DEV_ANALYST_*/DEV_PM_* creds (e.g. QA), so they belong to
// regression; without those creds they resolve to `deferred` and drop (no skip).
const DEV_RUNNING = new Set(["test", "liveOnly", "liveTest", "analystOnly", "managerParity"]);

// Longest-id-wins so TC-ADMAPI-011-1 is not read as TC-ADMAPI-011.
const TC_ID = /TC-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+(?:-\d+)?/;
// A test declaration head, capturing the invoker name and the title's opening quote.
// Handles conditional forms: test.skipIf(COND)(`title`, ...) / test.runIf(COND)(...).
// Classification (regression vs not) is decided by DEV_RUNNING above.
// Longer alternatives first so `test.skipIf` wins over `test.skip`/`test`.
const HEAD =
  /^(\s*)(test\.skipIf|test\.runIf|test\.skip|test|localOnly|dbOnly|liveOnly|liveTest|analystOnly|managerParity)(?:\([^)]*\))?\s*\((["'`])/;

function stripTags(title) {
  // remove any trailing/inner ` @smoke` / ` @regression` tokens
  return title.replace(/\s+@(?:smoke|regression)\b/g, "").replace(/\s+$/, "");
}

let summary = [];

for (const rel of files) {
  const abs = path.join(ROOT, rel);
  let src;
  try { src = readFileSync(abs, "utf-8"); } catch { continue; }
  const lines = src.split(/\r?\n/);
  let reg = 0, smoke = 0, stripped = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const head = HEAD.exec(line);
    if (!head) continue;
    const fn = head[2], quote = head[3];
    const prefix = head[0];            // full head incl. any (COND) and the opening quote
    const startInner = prefix.length;  // index just after opening quote

    // Find the matching closing quote for the FIRST string literal (handles \" escapes).
    let end = -1;
    for (let j = startInner; j < line.length; j++) {
      const c = line[j];
      if (c === "\\") { j++; continue; }
      if (c === quote) { end = j; break; }
    }
    if (end === -1) continue; // multi-line title: none exist in this suite, skip defensively

    const rawTitle = line.slice(startInner, end);
    const rest = line.slice(end); // includes closing quote + ", async () => {" etc.

    let title = stripTags(rawTitle);
    const idMatch = TC_ID.exec(title);
    const id = idMatch ? idMatch[0] : null;

    if (!UNDER_DEV.has(rel) && DEV_RUNNING.has(fn)) {
      // runs on dev/live -> @regression, plus @smoke if allowlisted
      if (id && SMOKE.has(id)) { title += " @smoke @regression"; smoke++; }
      else { title += " @regression"; }
      reg++;
    } else {
      // local-only, skipped, or under-development -> no tags (already stripped)
      if (rawTitle !== title) stripped++;
    }

    lines[i] = prefix + title + rest;
  }

  const out = lines.join("\n");
  if (out !== src) writeFileSync(abs, out);
  summary.push({ rel, regression: reg, smoke, strippedSkips: stripped });
}

console.table(summary);
const totals = summary.reduce((a, s) => ({ regression: a.regression + s.regression, smoke: a.smoke + s.smoke }), { regression: 0, smoke: 0 });
console.log("TOTAL running(@regression):", totals.regression, " smoke:", totals.smoke,
  ` (${((totals.smoke / totals.regression) * 100).toFixed(1)}%)`);
