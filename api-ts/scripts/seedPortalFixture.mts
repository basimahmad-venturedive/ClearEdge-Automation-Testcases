/**
 * Permanent, repeatable seeder for the frontend Vendor-Portal fixture.
 * Seeds every proposal state + a pool of fresh invited proposals on QA and writes
 * automation/frontend/portal-fixture.json (per-state tokens + the real data each resolves to).
 *
 * Run:  cd automation/api-ts && npx tsx scripts/seedPortalFixture.mts
 * Env:  loads envs/.env.qa (TEST_ENV=qa) so it uses the QA Cognito PO + api-qa base URL.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Load envs/.env.qa into process.env BEFORE importing anything that reads config.
process.env.TEST_ENV = process.env.TEST_ENV || "qa";
const envFile = resolve(process.cwd(), "envs", `.env.${process.env.TEST_ENV}`);
for (const line of readFileSync(envFile, "utf-8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { seedPortalStates, mintFreshInvited } = await import("../src/utils/portalSeed.js");
const { PortalClient } = await import("../src/clients/portalClient.js");

const pc = new PortalClient();
const mdy = (y?: string) => { if (!y) return ""; const [a, b, c] = y.split("-"); return `${b}/${c}/${a}`; };
async function display(token: string) {
  const r: any = await pc.resolve(token); const d = r.data?.data ?? {};
  return {
    token, eventType: d.event?.type ?? null, eventTitle: d.event?.title ?? null, deadlineMdy: mdy(d.event?.submissionDeadline),
    vendorName: d.vendor?.name ?? null, issuerName: d.issuer?.name ?? null, issuerEmail: d.issuer?.email ?? null, issuerCompany: d.issuer?.company ?? null,
    proposalStatus: d.proposal?.status ?? null, awarded: d.proposal?.awarded ?? null, isBlocked: d.isBlocked ?? null, blockedReason: d.blockedReason ?? null,
    questions: (d.event?.questions ?? []).map((q: any) => ({ id: q.id, text: q.questionText })),
  };
}

const POOL = Number(process.env.PORTAL_POOL_SIZE ?? "14");
const tokens = await seedPortalStates();
const out: Record<string, any> = { states: {}, invitedPool: [] };
for (const [state, token] of Object.entries(tokens)) out.states[state] = token ? await display(token as string) : { token: null };
for (let i = 0; i < POOL; i++) { const f = await mintFreshInvited(); out.invitedPool.push(await display(f.token)); }

const outPath = resolve(process.cwd(), "..", "frontend", "portal-fixture.json");
writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
console.log(`seeded portal-fixture.json — states: ${Object.keys(out.states).join(",")} | pool: ${out.invitedPool.length}`);
