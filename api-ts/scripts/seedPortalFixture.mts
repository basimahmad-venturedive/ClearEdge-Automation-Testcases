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

/** Retry a flaky QA call a few times — a transient timeout must not abort the whole fixture. */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const msg = (e as any)?.message ?? String(e);
      console.warn(`[seed] ${label} attempt ${i}/${attempts} failed: ${msg}`);
      if (i < attempts) await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  throw last;
}

async function display(token: string) {
  const r: any = await withRetry(`resolve ${token.slice(0, 8)}…`, () => pc.resolve(token)); const d = r.data?.data ?? {};
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
for (const [state, token] of Object.entries(tokens)) {
  try { out.states[state] = token ? await display(token as string) : { token: null }; }
  catch (e) { console.warn(`[seed] state '${state}' display failed after retries — recording token only:`, (e as any)?.message); out.states[state] = { token: token ?? null, displayFailed: true }; }
}
for (let i = 0; i < POOL; i++) {
  try { const f = await withRetry(`mintFreshInvited #${i + 1}`, () => mintFreshInvited()); out.invitedPool.push(await display(f.token)); }
  catch (e) { console.warn(`[seed] pool #${i + 1} failed after retries — skipping this entry:`, (e as any)?.message); }
}
if (out.invitedPool.length === 0) throw new Error("[seed] invitedPool is empty — QA unreachable; refusing to overwrite fixture with an unusable pool.");

const outPath = resolve(process.cwd(), "..", "frontend", "portal-fixture.json");
writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
console.log(`seeded portal-fixture.json — states: ${Object.keys(out.states).join(",")} | pool: ${out.invitedPool.length}`);
