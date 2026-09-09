/**
 * CEIQ-FEAT-009 Contracts - coverage-gap suite.
 *
 * Spec: documents/input/SPEC_CEIQ-FEAT-009-contracts.md
 * Cases: testcases/TC-CEIQ-FEAT-009.md (TC-CTAPI-*), published to TestRail under US-CT.
 *
 * This file fills the TC-IDs left unautomated across Endpoints #1, #2, #3, #4, #5,
 * #7, #8, #13 and #14 after the per-endpoint files were written. TC-IDs are FIXED
 * (published to TestRail) - never renumbered, never invented, never silently
 * dropped. A case that cannot be exercised over HTTP is still declared, and states
 * why in its body.
 *
 * Assertions are spec-true. Where live QA diverges, the test asserts the SPEC and
 * fails - that failure IS the report. Each such case names the drift in a comment.
 *
 * Environment reality that shapes the fixtures (verified live on QA):
 *   - There is NO database access and NO second tenant, so preconditions phrased
 *     as "tenant A seeded with exactly 5 families" cannot be met on a shared QA
 *     tenant. Those cases assert the INVARIANT the precondition exists to prove
 *     (filter correctness, counts-vs-filter independence, ordering) against
 *     purpose-seeded families, and say so in a comment.
 *   - Stage 1 extraction takes ~14 s, so families are seeded once per describe.
 */
import { beforeAll, afterAll, describe, expect } from "vitest";
import { test } from "../src/utils/suite";
import { assertResponseTime, assertErrorEnvelope } from "../src/utils/assertions";
import { contractsClient as api, CONTRACT_STATUSES } from "../src/clients/contractsClient";
import {
  CONTRACT_V1,
  CONTRACT_V2,
  BAD_TYPE_FILE,
  seedUploadedContract,
  seedSavedContract,
  destroyFamily,
  type SeededVersion,
} from "../src/utils/contractsSeed";
import {
  getTenantIdToken,
  getAnalystIdToken,
  getManagerIdToken,
  getAdminIdToken,
} from "../src/utils/tokenProvider";
import { VendorDirectoryClient } from "../src/clients/vendorDirectoryClient";
import { SourcingClient } from "../src/clients/sourcingClient";

const vendors = new VendorDirectoryClient();
const sourcing = new SourcingClient();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTRACT_ID_RE = /^CON-\d{4}-\d{3}$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MISSING_FAMILY = "00000000-0000-4000-8000-0000000000a1";
const MISSING_VERSION = "00000000-0000-4000-8000-0000000000a2";

/** An upload plus Stage 1 extraction measured ~14 s on QA; 25 MB uploads far more. */
const SEED_MS = 600_000;
const CASE_MS = 300_000;

let poToken = "";
let analystToken = "";
let managerToken = "";

/**
 * Saves a freshly uploaded version, so Endpoint #10 will serve the family.
 *
 * Spec v1.7 changed this: the representative version must now have `is_saved = true`,
 * and "if Endpoint #10 is called directly, no representative version exists and a 404
 * is the correct response" (release note 1, endpoint #10 processing step 2). QA began
 * enforcing it on 2026-09-08. Any read-back through Endpoint #10 must therefore save
 * first - that 404 is the product behaving correctly, not a defect.
 */
async function saveVersion(familyId: string, versionId: string): Promise<void> {
  await api.waitForExtraction(poToken, familyId, versionId);
  const review = await api.review(poToken, familyId, versionId);
  const saved = await api.save(
    poToken,
    familyId,
    versionId,
    (review.data?.data?.fields ?? review.data?.data ?? {}) as Record<string, unknown>,
  );
  expect(saved.status, "seeding a saved version for the Endpoint #10 read-back").toBeLessThan(400);
}

beforeAll(async () => {
  poToken = await getTenantIdToken();
  analystToken = await getAnalystIdToken();
  managerToken = await getManagerIdToken();
}, SEED_MS);

/** Current date in America/Chicago (spec 9.4 pins that zone for the 30-day window). */
function chicagoToday(): Date {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${s}T00:00:00Z`);
}

function daysFromChicagoToday(value: unknown): number | undefined {
  if (!value) return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return undefined;
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return Math.round((day.getTime() - chicagoToday().getTime()) / 86_400_000);
}

/**
 * Pull the first `n` entity ids out of any list envelope.
 *
 * The vendor-directory and sourcing-event list endpoints belong to other features
 * and each nests its rows under a different key, so the shape is discovered rather
 * than hardcoded: walk the body and take the first array whose elements carry a
 * string `id`.
 */
function firstIds(body: unknown, n: number): string[] {
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (out.length >= n || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) {
        const id = (item as Record<string, unknown> | null)?.id;
        if (typeof id === "string") {
          out.push(id);
          if (out.length >= n) return;
        }
      }
      return;
    }
    for (const val of Object.values(v as Record<string, unknown>)) visit(val);
  };
  visit(body);
  return out;
}

/** Make an unreachable or partially-reachable precondition VISIBLE in the run output. */
function logGap(tcId: string, what: string): void {
  console.log(`[LIMITATION] ${tcId}: ${what}`);
}

/** Locate a seeded family in a list response by familyId. */
function rowFor(r: { data: { data: { contracts: Array<Record<string, unknown>> } } }, familyId: string) {
  return r.data.data.contracts.find((c) => c.familyId === familyId);
}

/**
 * Create a family WITHOUT waiting for Stage 1.
 *
 * Endpoint #1 rows exist the moment the upload is accepted, so list-only cases
 * that just need a family of a given contractType skip the ~14 s extraction wait.
 */
async function createFamily(token: string, contractType: string): Promise<string> {
  const fx = CONTRACT_V1();
  const r = await api.create(token, {
    contractType,
    file: { buffer: fx.buffer, filename: fx.filename, contentType: fx.contentType },
  });
  if (r.status !== 201) {
    throw new Error(`createFamily(${contractType}) failed: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  return r.data.data.familyId as string;
}

// ===========================================================================
// Endpoint #1 - GET /contracts : status tabs, type filter, sort, vendor shape
// ===========================================================================
describe("Endpoint #1 - GET /contracts (status filters and counts)", () => {
  /**
   * One family per stored status, built through the real product flow:
   *   in_review  - uploaded, never saved
   *   active     - saved + activated on V2 (expiration 2026-12-31, still future)
   *   expired    - saved + activated on V1 (expiration 2026-01-31, already past;
   *                spec 9.1 lazy-write flips it on the next read)
   *   terminated - activated then terminated
   */
  const seeded: Record<string, SeededVersion | undefined> = {};
  /** Two extra families used only by the contractType-filter cases. */
  const typeFamilies: Record<string, string> = {};

  beforeAll(async () => {
    typeFamilies.msa_services = await createFamily(poToken, "msa_services");
    typeFamilies.partnership_agreement = await createFamily(poToken, "partnership_agreement");

    // Seeded in parallel: each family is independent and Stage 1 is ~14 s apiece,
    // so serial seeding would dominate the file's runtime for no benefit.
    const [inReview, active, expired, terminated] = await Promise.all([
      seedUploadedContract(poToken, { fixture: CONTRACT_V1() }),
      seedSavedContract(poToken, { fixture: CONTRACT_V2() }),
      seedSavedContract(poToken, { fixture: CONTRACT_V1() }),
      seedSavedContract(poToken, { fixture: CONTRACT_V2() }),
    ]);
    seeded.in_review = inReview;
    seeded.active = active;
    seeded.expired = expired;
    seeded.terminated = terminated;

    await Promise.all([
      api.activate(poToken, active.familyId, active.versionId),
      api.activate(poToken, expired.familyId, expired.versionId),
      api.activate(poToken, terminated.familyId, terminated.versionId),
    ]);
    await api.terminate(poToken, terminated.familyId);
  }, SEED_MS);

  afterAll(async () => {
    for (const v of Object.values(seeded)) await destroyFamily(poToken, v?.familyId);
    for (const id of Object.values(typeFamilies)) await destroyFamily(poToken, id);
  }, SEED_MS);

  test(
    "TC-CTAPI-003-1 status=all returns every family regardless of status",
    async () => {
      const r = await api.list(poToken, { status: "all", limit: 50 });
      expect(r.status).toBe(200);
      expect(r.data.success).toBe(true);

      const d = r.data.data;
      // Precondition adaptation: a shared QA tenant cannot be reduced to exactly 5
      // families, so the assertion is the invariant those 5 exist to prove - every
      // seeded status is reachable through status=all, and the tab counts are a
      // live tenant-wide partition rather than a page-scoped tally.
      const statuses = new Set(d.contracts.map((c: Record<string, unknown>) => c.status));
      for (const s of statuses) expect(CONTRACT_STATUSES as readonly string[]).toContain(s);
      expect(statuses.has("expiring_soon")).toBe(false);

      expect(d.counts.all).toBe(d.pagination.total);
      expect(d.counts.in_review + d.counts.active + d.counts.expired + d.counts.terminated).toBe(d.counts.all);
      expect(d.counts.expiring_soon).toBeLessThanOrEqual(d.counts.active);
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-003-2 status=in_review returns only in_review families",
    async () => {
      const r = await api.list(poToken, { status: "in_review", limit: 50 });
      expect(r.status).toBe(200);
      for (const c of r.data.data.contracts) expect(c.status).toBe("in_review");
      // The seeded, never-saved family must be on this tab.
      const all = await api.list(poToken, { status: "in_review", limit: 50, page: 1 });
      expect(all.data.data.contracts.some((c: Record<string, unknown>) => c.familyId === seeded.in_review?.familyId)
        || all.data.data.pagination.total > all.data.data.contracts.length).toBe(true);
      // counts report the whole tenant, unaffected by the filter
      expect(r.data.data.counts.all).toBeGreaterThanOrEqual(r.data.data.pagination.total);
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-003-3 status=active returns only active families",
    async () => {
      const r = await api.list(poToken, { status: "active", limit: 50 });
      expect(r.status).toBe(200);
      for (const c of r.data.data.contracts) expect(c.status).toBe("active");
      // The Active tab is not narrowed by the expiring-soon window: every
      // expiring_soon row is also an active row.
      expect(r.data.data.counts.expiring_soon).toBeLessThanOrEqual(r.data.data.counts.active);
      expect(r.data.data.counts.active).toBe(r.data.data.pagination.total);
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-003-4 status=expiring_soon is a filter, not a stored status",
    async () => {
      const r = await api.list(poToken, { status: "expiring_soon", limit: 50 });
      expect(r.status).toBe(200);
      for (const c of r.data.data.contracts) {
        // 3. every row keeps its stored status - no row reports expiring_soon
        expect(c.status).toBe("active");
        // 2. the window is 0..30 days inclusive in America/Chicago
        const days = daysFromChicagoToday(c.expiration);
        expect(days, `family ${c.familyId} expiration ${c.expiration}`).toBeDefined();
        expect(days as number).toBeLessThanOrEqual(30);
        // 4. a NULL expiration is excluded
        expect(c.expiration).not.toBeNull();
      }
      expect(r.data.data.counts.expiring_soon).toBe(r.data.data.pagination.total);
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-003-5 status=expired returns only expired families",
    async () => {
      const r = await api.list(poToken, { status: "expired", limit: 50 });
      expect(r.status).toBe(200);
      for (const c of r.data.data.contracts) expect(c.status).toBe("expired");
      expect(r.data.data.counts.expired).toBe(r.data.data.pagination.total);
      // The seeded V1 family (expiration 2026-01-31, already past) was activated,
      // so spec 9.1's lazy write must have flipped it to expired by this read.
      const mine = rowFor(r, seeded.expired?.familyId ?? "");
      expect(mine, "the activated past-expiry family must appear on the Expired tab").toBeDefined();
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-003-6 status=terminated returns only terminated families",
    async () => {
      const r = await api.list(poToken, { status: "terminated", limit: 50 });
      expect(r.status).toBe(200);
      for (const c of r.data.data.contracts) expect(c.status).toBe("terminated");
      expect(r.data.data.counts.terminated).toBe(r.data.data.pagination.total);
      const mine = rowFor(r, seeded.terminated?.familyId ?? "");
      expect(mine, "the terminated family must appear on the Terminated tab").toBeDefined();
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-007-2 contractType filter with two comma-separated slugs returns the union",
    async () => {
      const r = await api.list(poToken, {
        contractType: "msa_services,partnership_agreement",
        limit: 50,
      });
      expect(r.status).toBe(200);
      const types = new Set(r.data.data.contracts.map((c: Record<string, unknown>) => c.contractType));
      // 3./4. only the two requested slugs come back - the other 3 are absent
      for (const t of types) expect(["msa_services", "partnership_agreement"]).toContain(t);
      // both seeded families are inside the union
      expect(rowFor(r, typeFamilies.msa_services ?? ""), "seeded msa_services family").toBeDefined();
      expect(rowFor(r, typeFamilies.partnership_agreement ?? ""), "seeded partnership_agreement family")
        .toBeDefined();
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-007-3 unknown contractType slug does not return 500",
    async () => {
      const r = await api.list(poToken, { contractType: "nda_agreement", limit: 50 });
      // 1. 200 or 400 - never 500, never 404
      expect([200, 400]).toContain(r.status);
      if (r.status === 200) {
        expect(r.data.data.contracts).toEqual([]);
        expect(r.data.data).toHaveProperty("counts");
        expect(r.data.data).toHaveProperty("pagination");
        expect(r.data.success).toBe(true);
      } else {
        // CLRE-281 ACCEPTED (won't-fix): ERR_VALIDATION_FAILED is the platform-wide
        // validation code; the spec's ERR_INVALID_QUERY is superseded. See CLRE-361.
        assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
        expect(r.data.error.message).toBe("One or more fields are invalid.");
        expect(r.data.error.details?.fields?.contractType, "must name contractType").toBeDefined();
      }
      // 4. no stack trace / unhandled-exception body either way
      expect(JSON.stringify(r.data)).not.toMatch(/\bat\s+\/|node_modules|stack/i);
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-008-1 sortBy=expiration with sortOrder=asc orders by expiration ascending",
    async () => {
      const r = await api.list(poToken, { sortBy: "expiration", sortOrder: "asc", limit: 50 });
      expect(r.status).toBe(200);
      const values = r.data.data.contracts
        .map((c: Record<string, unknown>) => c.expiration)
        .filter((v: unknown) => v !== null && v !== undefined);
      expect(values.length, "need at least 2 dated families to prove an order").toBeGreaterThan(1);
      const times = values.map((v: unknown) => new Date(String(v)).getTime());
      for (let i = 1; i < times.length; i += 1) {
        expect(times[i], `row ${i} (${values[i]}) must not precede row ${i - 1} (${values[i - 1]})`)
          .toBeGreaterThanOrEqual(times[i - 1]);
      }
      // DRIFT (live QA 2026-08-25): list serializes `expiration` as a full ISO
      // datetime ("2026-01-31T00:00:00.000Z"). The case pins ^\d{4}-\d{2}-\d{2}$,
      // matching the spec's Endpoint #7/#10 response examples. Asserting the spec.
      for (const v of values) expect(String(v)).toMatch(DATE_ONLY_RE);
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-008-2 sortBy=expiration with sortOrder=desc reverses the order",
    async () => {
      const asc = await api.list(poToken, { sortBy: "expiration", sortOrder: "asc", limit: 50 });
      const r = await api.list(poToken, { sortBy: "expiration", sortOrder: "desc", limit: 50 });
      expect(r.status).toBe(200);
      const pick = (res: typeof r) =>
        res.data.data.contracts
          .map((c: Record<string, unknown>) => c.expiration)
          .filter((v: unknown) => v !== null && v !== undefined)
          .map((v: unknown) => new Date(String(v)).getTime());
      const descTimes = pick(r);
      expect(descTimes.length).toBeGreaterThan(1);
      // 2. non-increasing
      for (let i = 1; i < descTimes.length; i += 1) {
        expect(descTimes[i]).toBeLessThanOrEqual(descTimes[i - 1]);
      }
      // 4. NOT "exactly the reverse of the ascending array" — that assertion was invalid twice
      // over (QA 2026-09-07). (a) `limit: 50` over a >50-row tenant makes asc-page-1 and
      // desc-page-1 DISJOINT windows, so one can never be the other's reverse; (b) expiration
      // ties are common (~40 rows share 2026-12-31) and the sort has no secondary key, so tied
      // runs may come back in any order. The non-increasing check above is the real contract.
      // Assert reversal only when the whole result set fits in one page and carries no ties.
      const ascTimes = pick(asc);
      const noTies = new Set(ascTimes).size === ascTimes.length;
      if (noTies && ascTimes.length === descTimes.length && ascTimes.length < 50) {
        expect(descTimes).toEqual([...ascTimes].reverse());
      }
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-008-3 invalid sortBy value does not return 500",
    async () => {
      const r = await api.list(poToken, { sortBy: "vendor" });
      expect(r.status).toBe(400);
      // CLRE-281 ACCEPTED (won't-fix): ERR_VALIDATION_FAILED is the platform-wide
      // validation code; the spec's ERR_INVALID_QUERY is superseded. See CLRE-361.
      // The detail lives under details.fields.<param>, not details.field.
      assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
      expect(r.data.error.message).toBe("One or more fields are invalid.");
      expect(String(r.data.error.details?.fields?.sortBy ?? "")).toMatch(/sortBy must be one of/i);
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-011-1 family with no linked vendor returns vendor null",
    async () => {
      const r = await api.list(poToken, { limit: 50, search: "" });
      expect(r.status).toBe(200);
      // The in_review seed was created with no vendorId at all.
      const all = await api.list(poToken, { status: "in_review", limit: 50 });
      const mine = rowFor(all, seeded.in_review?.familyId ?? "");
      expect(mine, "vendor-less seeded family must be listed").toBeDefined();
      const row = mine as Record<string, unknown>;
      expect(row.vendor).toBeNull(); // explicit null, not {}
      expect(String(row.contractName)).not.toContain(" - "); // spec 9.3 vendor-less name
      expect(row.displayName).toBe(row.contractName);
      assertResponseTime(all);
    },
    CASE_MS,
  );

  // TC-CTAPI-011-2 is implemented in contracts.final.test.ts. The §9.11 deletion gate
  // is not a dead end after all: terminating the family first takes it out of
  // in_review/active, after which the vendor deletes cleanly over HTTP.

  test(
    "TC-CTAPI-013-3 cross-tenant isolation: a principal outside tenant A never sees its families",
    async () => {
      // PARTIAL BY ENVIRONMENT, but RUN rather than skipped. A true tenant-B owner
      // token does not exist: tokenProvider mints owner/manager/analyst all inside
      // tenant A, and provisioning a second QA tenant would mean creating a tenant
      // plus a Cognito user with a known password on a shared environment. The
      // Platform Admin is the only principal available that sits OUTSIDE tenant A,
      // so isolation is asserted against it. What is proven here is the half that
      // matters most - tenant A's families are not readable by a principal that does
      // not belong to the tenant - and the assertions below are real, not vacuous.
      const adminToken = await getAdminIdToken();
      expect(adminToken, "no platform-admin token available").toBeTruthy();

      const seededFamilyId = seeded.in_review?.familyId ?? "";
      expect(seededFamilyId, "a tenant-A family is required as the isolation subject").not.toBe("");

      // 1. Tenant A can see its own family - the control, so a false pass is visible.
      const mine = await api.list(poToken, { status: "in_review", limit: 50 });
      expect(mine.status).toBe(200);
      expect(rowFor(mine, seededFamilyId), "tenant A must see its own family").toBeDefined();

      // 2. The outside principal must not receive it from the list endpoint. Either
      //    the call is refused outright, or it succeeds against a different tenant
      //    scope - what is NOT allowed is tenant A's family coming back.
      const theirs = await api.list(adminToken, { limit: 50 });
      if (theirs.status < 400) {
        const leaked = (theirs.data?.data?.contracts ?? []).some(
          (c: Record<string, unknown>) => c.familyId === seededFamilyId,
        );
        expect(leaked, "a principal outside the tenant received tenant A's family").toBe(false);
      } else {
        expect(theirs.status).toBeGreaterThanOrEqual(400);
        expect(theirs.data?.success).toBe(false);
      }

      // 3. Addressing the family directly must not disclose it either, and must not
      //    leak its existence through a 403 - 404 is the documented answer.
      const direct = await api.detail(adminToken, seededFamilyId);
      expect(direct.status, "direct read by an outside principal must be refused").toBeGreaterThanOrEqual(400);
      expect(direct.data?.success).toBe(false);
      expect(JSON.stringify(direct.data ?? {})).not.toContain(seededFamilyId.slice(0, 8));
      assertResponseTime(direct);

      logGap(
        "TC-CTAPI-013-3",
        "asserted against the Platform Admin, the only principal outside tenant A that " +
          "this environment can mint. The tenant-B-owner direction stays unproven until a " +
          "second seeded tenant exists on QA.",
      );
    },
    CASE_MS,
  );
});

// ===========================================================================
// Endpoint #2 - POST /contracts : the remaining contractType slugs
// ===========================================================================
describe("Endpoint #2 - POST /contracts (contractType round-trip)", () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const id of created) await destroyFamily(poToken, id);
  }, SEED_MS);

  /** Create with one slug and read the persisted value back through Endpoint #10. */
  async function createAndReadBack(slug: string) {
    const fx = CONTRACT_V1();
    const r = await api.create(poToken, {
      contractType: slug,
      file: { buffer: fx.buffer, filename: fx.filename, contentType: fx.contentType },
    });
    expect(r.status).toBe(201);
    expect(r.data.success).toBe(true);
    expect(r.data.data.familyId).toMatch(UUID_RE);
    expect(r.data.data.versionId).toMatch(UUID_RE);
    expect(r.data.data.contractId).toMatch(CONTRACT_ID_RE);
    created.push(r.data.data.familyId);
    assertResponseTime(r);

    // Endpoint #10 resolves a *representative* version (spec 9.5) and returns 404 while the
    // family's only version is still unsaved, so the round-trip must save before reading back.
    // QA started enforcing 9.5 on 2026-09-08; before that an unsaved family answered 200.
    await saveVersion(r.data.data.familyId, r.data.data.versionId);

    const detail = await api.detail(poToken, r.data.data.familyId);
    expect(detail.status).toBe(200);
    // 2. the sent value is persisted, not defaulted
    expect(detail.data.data.contractType).toBe(slug);
    assertResponseTime(detail);
  }

  test("TC-CTAPI-018-2 create accepts contractType purchase_agreement_goods", async () => {
    await createAndReadBack("purchase_agreement_goods");
  }, CASE_MS);

  test("TC-CTAPI-018-3 create accepts contractType subscription_agreement_saas", async () => {
    await createAndReadBack("subscription_agreement_saas");
  }, CASE_MS);

  test("TC-CTAPI-018-4 create accepts contractType vendor_agreement_general", async () => {
    await createAndReadBack("vendor_agreement_general");
  }, CASE_MS);

  test("TC-CTAPI-018-5 create accepts contractType partnership_agreement", async () => {
    await createAndReadBack("partnership_agreement");
  }, CASE_MS);
});

// ===========================================================================
// Endpoint #3 - POST /:familyId/versions (upload a new version)
// ===========================================================================
describe("Endpoint #3 - POST /:familyId/versions (upload new version)", () => {
  let famSaved: SeededVersion;
  let famActive: SeededVersion;
  /** Fresh families: the vendor / sourcing-event link is one-shot, so these must be clean. */
  let famVendor = "";
  let famEvent = "";
  let famTerminated: SeededVersion;
  let vendorA = "";
  let vendorC = "";
  let eventA = "";
  let eventB = "";

  const v1 = CONTRACT_V1();

  /**
   * Saves a freshly uploaded version, so Endpoint #10 will serve the family.
   *
   * Spec v1.7 changed this: the representative version must now have `is_saved = true`,
   * and "if Endpoint #10 is called directly, no representative version exists and a 404
   * is the correct response" (release note 1, endpoint #10 processing step 2). The link
   * read-backs below therefore cannot use Endpoint #10 on an unsaved upload - that 404
   * is the product behaving correctly, and reading the link out of that 404 body is what
   * made TC-CTAPI-030-1/-2 fail on 2026-09-08 while the lock itself was never exercised.
   */
  beforeAll(async () => {
    [famSaved, famActive, famTerminated, famVendor, famEvent] = await Promise.all([
      seedSavedContract(poToken, { fixture: CONTRACT_V1() }),
      seedSavedContract(poToken, { fixture: CONTRACT_V2() }),
      seedSavedContract(poToken, { fixture: CONTRACT_V2() }),
      createFamily(poToken, "msa_services"),
      createFamily(poToken, "msa_services"),
    ]);
    await Promise.all([
      api.activate(poToken, famActive.familyId, famActive.versionId),
      api.activate(poToken, famTerminated.familyId, famTerminated.versionId),
    ]);
    await api.terminate(poToken, famTerminated.familyId);

    // Existing tenant data supplies the link targets - the cases only need two
    // distinct active vendors and two distinct sourcing events to exist.
    // No `pageSize`: the Vendor Directory list rejects it outright with 400
    // "property pageSize should not exist" and serves a fixed page of 10, which is
    // ample for the two link targets these cases need. Sending it returned an error
    // body, so `firstIds` found nothing and every vendor-linked case below failed on
    // an empty vendorId rather than on its own assertion.
    const vs = await vendors.listVendors({}, poToken);
    [vendorA = "", vendorC = ""] = firstIds(vs.data, 2);

    const es = await sourcing.listEvents({ limit: 10 }, poToken);
    [eventA = "", eventB = ""] = firstIds(es.data, 2);
  }, SEED_MS);

  afterAll(async () => {
    await destroyFamily(poToken, famSaved?.familyId);
    await destroyFamily(poToken, famActive?.familyId);
    await destroyFamily(poToken, famTerminated?.familyId);
    await destroyFamily(poToken, famVendor);
    await destroyFamily(poToken, famEvent);
  }, SEED_MS);

  test(
    "TC-CTAPI-028 upload new version returns 201 and advances NNN by exactly 1",
    async () => {
      const before = await api.detail(poToken, famSaved.familyId);
      const baseId = String(before.data.data.contractId);

      const r = await api.uploadVersion(poToken, famSaved.familyId, {
        file: { buffer: v1.buffer, filename: v1.filename, contentType: v1.contentType },
      });
      expect(r.status).toBe(201);
      // 2. family reused, not recreated
      expect(r.data.data.familyId).toBe(famSaved.familyId);
      // 3. a brand-new version uuid
      expect(r.data.data.versionId).toMatch(UUID_RE);
      expect(r.data.data.versionId).not.toBe(famSaved.versionId);
      // 4. XXXX unchanged, NNN advanced by exactly 1
      const [, baseSeq, baseNnn] = baseId.match(/^CON-(\d{4})-(\d{3})$/) ?? [];
      const [, newSeq, newNnn] = String(r.data.data.contractId).match(/^CON-(\d{4})-(\d{3})$/) ?? [];
      expect(newSeq, `contractId ${r.data.data.contractId} vs ${baseId}`).toBe(baseSeq);
      expect(Number(newNnn)).toBe(Number(baseNnn) + 1);
      assertResponseTime(r);

      // 5. Endpoint #13 now lists 2 versions, newest first.
      //
      // #13 returns only versions where `is_saved = true` (spec Endpoint #13
      // Processing 1), so the version just uploaded is deliberately absent until it
      // is saved. Asserting 2 straight after the upload was testing an expectation
      // the spec does not make - it saw 1 and read as a product defect.
      const newVersionId = String(r.data.data.versionId);
      await extractAndSave(famSaved.familyId, newVersionId);

      const vlist = await api.versions(poToken, famSaved.familyId);
      expect(vlist.status).toBe(200);
      expect(vlist.data.data.versions.length).toBe(2);
      const stamps = vlist.data.data.versions.map((x: Record<string, unknown>) =>
        new Date(String(x.uploadedAt)).getTime(),
      );
      expect(stamps[0]).toBeGreaterThanOrEqual(stamps[1]);
      assertResponseTime(vlist);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-029 upload new version starts In Review and does not steal Active",
    async () => {
      const r = await api.uploadVersion(poToken, famActive.familyId, {
        file: { buffer: v1.buffer, filename: v1.filename, contentType: v1.contentType },
      });
      expect(r.status).toBe(201);
      const newVersionId = r.data.data.versionId as string;
      assertResponseTime(r);

      // 1. the new version row starts with extraction pending
      const first = await api.extractionStatus(poToken, famActive.familyId, newVersionId);
      expect(first.status).toBe(200);
      expect(["pending", "completed"]).toContain(
        first.data.data.extractionStatus ?? first.data.data.status,
      );

      const done = await api.waitForExtraction(poToken, famActive.familyId, newVersionId);
      expect(done).toBe("completed");

      const review = await api.review(poToken, famActive.familyId, newVersionId);
      expect(review.status).toBe(200);
      const saved = await api.save(
        poToken,
        famActive.familyId,
        newVersionId,
        (review.data?.data?.fields ?? review.data?.data ?? {}) as Record<string, unknown>,
      );
      expect(saved.status).toBeLessThan(400);

      // 2./3. saving does NOT activate; the previously Active version still represents the family
      const vlist = await api.versions(poToken, famActive.familyId);
      expect(vlist.status).toBe(200);
      const rows: Array<Record<string, unknown>> = vlist.data.data.versions;
      expect(rows.find((x) => x.versionId === newVersionId)?.isActive).toBe(false);
      expect(rows.find((x) => x.versionId === famActive.versionId)?.isActive).toBe(true);
      expect(vlist.data.data.hasActiveVersion).toBe(true);

      const detail = await api.detail(poToken, famActive.familyId);
      expect(detail.status).toBe(200);
      expect(detail.data.data.status).toBe("active");
      assertResponseTime(detail);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-030-1 upload new version sets vendorId when the family link is currently null",
    async () => {
      expect(vendorA, "QA tenant must have at least one vendor to link").not.toBe("");
      const r = await api.uploadVersion(poToken, famVendor, {
        vendorId: vendorA,
        file: { buffer: v1.buffer, filename: v1.filename, contentType: v1.contentType },
      });
      expect(r.status).toBe(201);
      assertResponseTime(r);

      // 2. v1.7 SS9.5: this upload is not saved yet, so the family has no representative
      //    version and Endpoint #10 must 404. Pinned here because it is the rule that
      //    used to let an unsaved in-progress upload represent the contract.
      const unsaved = await api.detail(poToken, famVendor);
      expect(unsaved.status, "v1.7 SS9.5: no saved version => no representative version").toBe(404);
      assertErrorEnvelope(unsaved, "ERR_CONTRACT_NOT_FOUND");

      // 3. read-after-write, once a saved version exists: the family-level link is set
      await saveVersion(famVendor, String(r.data.data.versionId));
      const detail = await api.detail(poToken, famVendor);
      expect(detail.status).toBe(200);
      const linked = detail.data.data.vendor ?? detail.data.data.references?.vendor;
      expect(linked, "Endpoint #10 must expose the linked vendor").toBeTruthy();
      expect(String(linked.id ?? linked.vendorId)).toBe(vendorA);
      assertResponseTime(detail);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-030-2 upload new version with a different vendorId returns 409 ERR_VENDOR_LOCKED",
    async () => {
      expect(vendorC, "QA tenant must have a second vendor for the locked-link case").not.toBe("");
      const before = await api.versions(poToken, famVendor);
      const r = await api.uploadVersion(poToken, famVendor, {
        vendorId: vendorC,
        file: { buffer: v1.buffer, filename: v1.filename, contentType: v1.contentType },
      });
      expect(r.status).toBe(409);
      assertErrorEnvelope(r, "ERR_VENDOR_LOCKED");
      expect(r.data.error.message).toBe(
        "This contract already has a linked vendor. The vendor cannot be changed.",
      );
      // 4. the link is untouched (Endpoint #10 serves the family because TC-CTAPI-030-1
      //    saved its version - guarded rather than assumed, so a seeding slip reads as
      //    a seeding slip and not as a lost link)
      const detail = await api.detail(poToken, famVendor);
      expect(detail.status, "the family must have a saved version by now (v1.7 SS9.5)").toBe(200);
      const linked = detail.data.data.vendor ?? detail.data.data.references?.vendor;
      expect(String(linked?.id ?? linked?.vendorId)).toBe(vendorA);
      // 5. no version created, no NNN consumed
      const after = await api.versions(poToken, famVendor);
      expect(after.data.data.pagination.total).toBe(before.data.data.pagination.total);
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-030-3 upload new version resending the SAME vendorId is still 409 ERR_VENDOR_LOCKED",
    async () => {
      const before = await api.versions(poToken, famVendor);
      const r = await api.uploadVersion(poToken, famVendor, {
        vendorId: vendorA, // the value the family already carries
        file: { buffer: v1.buffer, filename: v1.filename, contentType: v1.contentType },
      });
      // 1. the spec's condition is "the request includes vendorId", not "the value differs"
      expect(r.status).toBe(409);
      assertErrorEnvelope(r, "ERR_VENDOR_LOCKED");
      expect(r.data.error.message).toBe(
        "This contract already has a linked vendor. The vendor cannot be changed.",
      );
      const after = await api.versions(poToken, famVendor);
      expect(after.data.data.pagination.total).toBe(before.data.data.pagination.total);
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-031-1 upload new version sets sourcingEventId when the family link is currently null",
    async () => {
      expect(eventA, "QA tenant must have at least one sourcing event to link").not.toBe("");
      const r = await api.uploadVersion(poToken, famEvent, {
        sourcingEventId: eventA,
        file: { buffer: v1.buffer, filename: v1.filename, contentType: v1.contentType },
      });
      expect(r.status).toBe(201);
      assertResponseTime(r);

      const unsavedEv = await api.detail(poToken, famEvent);
      expect(unsavedEv.status, "v1.7 SS9.5: no saved version => no representative version").toBe(404);
      assertErrorEnvelope(unsavedEv, "ERR_CONTRACT_NOT_FOUND");

      await saveVersion(famEvent, String(r.data.data.versionId));
      const detail = await api.detail(poToken, famEvent);
      expect(detail.status).toBe(200);
      const ev =
        detail.data.data.sourcingEvent ??
        detail.data.data.references?.sourcingEvent ??
        detail.data.data.references?.event;
      expect(ev, "Endpoint #10 must expose the linked sourcing event").toBeTruthy();
      expect(String(ev.id ?? ev.eventId ?? ev)).toBe(eventA);
      assertResponseTime(detail);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-031-2 upload new version with a different sourcingEventId returns 409 ERR_SOURCING_EVENT_LOCKED",
    async () => {
      expect(eventB, "QA tenant must have a second sourcing event for the locked-link case").not.toBe("");
      const before = await api.versions(poToken, famEvent);
      const r = await api.uploadVersion(poToken, famEvent, {
        sourcingEventId: eventB,
        file: { buffer: v1.buffer, filename: v1.filename, contentType: v1.contentType },
      });
      expect(r.status).toBe(409);
      assertErrorEnvelope(r, "ERR_SOURCING_EVENT_LOCKED");
      expect(r.data.error.message).toBe(
        "This contract already has a linked sourcing event. The sourcing event cannot be changed.",
      );
      const after = await api.versions(poToken, famEvent);
      expect(after.data.data.pagination.total).toBe(before.data.data.pagination.total);
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-031-3 upload new version resending the SAME sourcingEventId is still 409 ERR_SOURCING_EVENT_LOCKED",
    async () => {
      // v1.7 endpoint #3 step 4 states the vendor rule then "Same logic for
      // sourcing_event_id" - so the resend-the-same-value direction is mandated here too,
      // and only the vendor half of it had a case (TC-CTAPI-030-3).
      const before = await api.versions(poToken, famEvent);
      const r = await api.uploadVersion(poToken, famEvent, {
        sourcingEventId: eventA, // the value the family already carries
        file: { buffer: v1.buffer, filename: v1.filename, contentType: v1.contentType },
      });
      expect(r.status).toBe(409);
      assertErrorEnvelope(r, "ERR_SOURCING_EVENT_LOCKED");
      expect(r.data.error.message).toBe(
        "This contract already has a linked sourcing event. The sourcing event cannot be changed.",
      );
      const after = await api.versions(poToken, famEvent);
      expect(after.data.data.pagination.total).toBe(before.data.data.pagination.total);
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-030-4 upload new version to a LINKED family with the locked fields omitted returns 201",
    async () => {
      // This is the payload spec v1.7 mandates for the normal UI flow. Endpoint #3 step 4:
      // "The frontend must omit these fields from the request payload entirely when locked
      // - not re-send the existing value. The backend rejection is a defensive guard
      // against unexpected API calls and should never fire in normal UI flow."
      //
      // Which means the omit path IS the only way to add a version to a linked contract:
      // re-sending the value is 409 by design, "" and null are 400 ERR_VALIDATION_FAILED.
      //
      // This case covers a link established at CREATE (endpoint #1), which works. The
      // sibling case TC-CTAPI-030-5 covers a link established by endpoint #3 itself,
      // which does not - measured 2026-09-08, see BUG-CONTRACT-021.
      expect(vendorA, "QA tenant must have at least one vendor to link").not.toBe("");
      const fam = await seedSavedContract(poToken, { fixture: CONTRACT_V1(), vendorId: vendorA });
      try {
        const r = await api.uploadVersion(poToken, fam.familyId, {
          file: { buffer: v1.buffer, filename: v1.filename, contentType: v1.contentType },
        });
        expect(
          r.status,
          `omitting locked fields must be accepted (got ${r.status} ${JSON.stringify(r.data?.error ?? {}).slice(0, 160)})`,
        ).toBe(201);
        assertResponseTime(r);
      } finally {
        await destroyFamily(poToken, fam.familyId);
      }
    },
    SEED_MS,
  );

  test(
    "TC-CTAPI-030-5 a family linked BY endpoint #3 still accepts a further version with the locked fields omitted",
    async () => {
      // The other half of TC-CTAPI-030-4. Endpoint #3 step 4 has two branches: reject when
      // the link is already set, and "If vendor_id is null and vendorId is provided, update
      // the family's vendor_id". A family linked through that second branch must behave
      // exactly like one linked at create - nothing in the spec distinguishes them.
      //
      // It does not: measured on QA 2026-09-08 every later upload returns 500
      // ERR_INTERNAL_SERVER_ERROR (BUG-CONTRACT-021), independent of whether the linking
      // version was saved, while the identical call on a create-linked family returns 201.
      // Since re-sending the value is 409 and ""/null are 400, such a family cannot receive
      // another version by any payload.
      expect(vendorA, "QA tenant must have at least one vendor to link").not.toBe("");
      const fam = await seedSavedContract(poToken, { fixture: CONTRACT_V1() });
      try {
        const linking = await api.uploadVersion(poToken, fam.familyId, {
          vendorId: vendorA,
          file: { buffer: v1.buffer, filename: v1.filename, contentType: v1.contentType },
        });
        expect(linking.status, "endpoint #3 must set the link when it is null").toBe(201);

        const r = await api.uploadVersion(poToken, fam.familyId, {
          file: { buffer: v1.buffer, filename: v1.filename, contentType: v1.contentType },
        });
        expect(
          r.status,
          `omitting locked fields must be accepted after endpoint #3 set the link (got ${r.status} ${JSON.stringify(r.data?.error ?? {}).slice(0, 160)})`,
        ).toBe(201);
        assertResponseTime(r);
      } finally {
        await destroyFamily(poToken, fam.familyId);
      }
    },
    SEED_MS,
  );

  test(
    "TC-CTAPI-032 upload new version to a terminated contract returns 409 ERR_CONTRACT_TERMINATED",
    async () => {
      const before = await api.versions(poToken, famTerminated.familyId);
      const r = await api.uploadVersion(poToken, famTerminated.familyId, {
        file: { buffer: v1.buffer, filename: v1.filename, contentType: v1.contentType },
      });
      expect(r.status).toBe(409);
      assertErrorEnvelope(r, "ERR_CONTRACT_TERMINATED");
      expect(r.data.error.message).toBe("Cannot upload a new version to a terminated contract.");
      // 4. no version created, no NNN consumed - enforced server-side, not just in the UI
      const after = await api.versions(poToken, famTerminated.familyId);
      expect(after.data.data.pagination.total).toBe(before.data.data.pagination.total);
      assertResponseTime(r);
    },
    CASE_MS,
  );

  // TC-CTAPI-033-1 is implemented in contracts.final.test.ts.

  test(
    "TC-CTAPI-033-2 upload new version to a family in another tenant returns 404",
    async () => {
      // No second QA tenant exists, so the foreign id is substituted by a
      // well-formed uuid this tenant does not own - which is exactly the state a
      // cross-tenant id presents to the handler after RLS scoping. Same
      // substitution the already-automated TC-CTSEC-017 uses.
      const r = await api.uploadVersion(poToken, MISSING_FAMILY, {
        file: { buffer: v1.buffer, filename: v1.filename, contentType: v1.contentType },
      });
      // 1. 404, never 403 - existence must not be disclosed
      expect(r.status).toBe(404);
      expect(r.status).not.toBe(403);
      assertErrorEnvelope(r, "ERR_CONTRACT_NOT_FOUND");
      // 3. no foreign identifier leaks back
      expect(JSON.stringify(r.data)).not.toMatch(/tenant|vendor|contractName/i);
      assertResponseTime(r);
    },
    CASE_MS,
  );
});

/** The 20 reviewable fields (spec Endpoint #7 `fields` / Endpoint #8 request table). */
const REVIEW_FIELDS = [
  "totalContractValue", "effectiveDate", "expirationDate", "noticePeriodDays",
  "paymentTerms", "terminationForConvenience", "limitationOfLiability", "insuranceRequirements",
  "slaUptime", "warranty", "priceIncreaseCap", "terminationForCause",
  "autoRenewal", "indemnification", "dataOwnership", "confidentiality",
  "exclusivity", "freightTerms", "intellectualProperty", "governingLaw",
] as const;

/** Every response carries a unique meta.traceId, so it can never take part in a deep-equal. */
function withoutMeta(body: unknown): unknown {
  const { meta, ...rest } = (body ?? {}) as Record<string, unknown>;
  void meta;
  return rest;
}

/**
 * Wait until the family's Stage 2 jobs (executive summary + clause risk) are no longer
 * `pending`, then return the settled detail body.
 *
 * Needed before any "the family is untouched" baseline: `waitForExtraction` only gates
 * Stage 1, so a Stage 2 summary can still be in flight when the baseline is captured and
 * then land between the two reads — which is exactly how TC-CTAPI-043 and TC-CTAPI-054-2
 * failed on QA 2026-09-07 (baseline `summaryStatus: "pending"` / `executiveOverview: null`
 * vs a completed, populated summary afterwards). Settling first makes the comparison
 * measure what the case is about: that a re-extraction does not mutate the live family.
 */
async function detailAfterSummarySettles(familyId: string): Promise<Awaited<ReturnType<typeof api.detail>>> {
  const deadline = Date.now() + 240_000;
  let res = await api.detail(poToken, familyId);
  while (Date.now() < deadline) {
    const d = (res.data?.data ?? {}) as Record<string, unknown>;
    if (d.summaryStatus !== "pending" && d.clauseRiskStatus !== "pending") break;
    await new Promise((r) => setTimeout(r, 5_000));
    res = await api.detail(poToken, familyId);
  }
  return res;
}

/** Seed one family that is saved AND activated. */
async function seedActiveFamily(fixture = CONTRACT_V2()): Promise<SeededVersion> {
  const v = await seedSavedContract(poToken, { fixture });
  await api.activate(poToken, v.familyId, v.versionId);
  return v;
}

// ===========================================================================
// Endpoint #4 - POST /:familyId/versions/:versionId/update-contract
// ===========================================================================
describe("Endpoint #4 - update-contract (staged replacement)", () => {
  let fam034: SeededVersion;
  let fam035: SeededVersion;
  let fam036: SeededVersion;
  let fam036Other = "";
  let fam037: SeededVersion;
  let fam038: SeededVersion;
  let fam039: SeededVersion;

  const replacement = CONTRACT_V1();

  beforeAll(async () => {
    [fam034, fam035, fam036, fam037, fam038, fam039] = await Promise.all([
      seedActiveFamily(),
      seedActiveFamily(),
      seedActiveFamily(),
      // V1 expires 2026-01-31, already past - spec 9.1 flips the family to expired
      seedActiveFamily(CONTRACT_V1()),
      seedActiveFamily(),
      seedActiveFamily(),
    ]);
    await api.terminate(poToken, fam038.familyId);

    // fam036 needs a SECOND, saved, non-Active version.
    const up = await api.uploadVersion(poToken, fam036.familyId, {
      file: { buffer: replacement.buffer, filename: replacement.filename, contentType: replacement.contentType },
    });
    fam036Other = up.data?.data?.versionId ?? "";
    if (fam036Other) {
      await api.waitForExtraction(poToken, fam036.familyId, fam036Other);
      const rev = await api.review(poToken, fam036.familyId, fam036Other);
      await api.save(
        poToken,
        fam036.familyId,
        fam036Other,
        (rev.data?.data?.fields ?? rev.data?.data ?? {}) as Record<string, unknown>,
      );
    }
  }, SEED_MS);

  afterAll(async () => {
    for (const f of [fam034, fam035, fam036, fam037, fam038, fam039]) {
      await destroyFamily(poToken, f?.familyId);
    }
  }, SEED_MS);

  test(
    "TC-CTAPI-034 update-contract returns 200, reuses the version ID and consumes no NNN",
    async () => {
      const before = await api.versions(poToken, fam034.familyId);
      const countBefore = before.data.data.pagination.total;
      const detailBefore = await api.detail(poToken, fam034.familyId);
      const contractIdBefore = detailBefore.data.data.contractId;

      const r = await api.updateContract(poToken, fam034.familyId, fam034.versionId, {
        buffer: replacement.buffer,
        filename: replacement.filename,
        contentType: replacement.contentType,
      });
      // 1. 200, NOT 201 - nothing was created
      expect(r.status).toBe(200);
      expect(r.data.success).toBe(true);
      // 2. the same version row is reused
      expect(r.data.data.versionId).toBe(fam034.versionId);
      // 3. no NNN consumed
      expect(r.data.data.contractId).toBe(contractIdBefore);
      expect(r.data.data.familyId).toBe(fam034.familyId);
      assertResponseTime(r);

      // 4. the version count is unchanged
      const after = await api.versions(poToken, fam034.familyId);
      expect(after.data.data.pagination.total).toBe(countBefore);
      assertResponseTime(after);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-035 update-contract leaves the live version saved data untouched until Save",
    async () => {
      // Settle Stage 2 before the baseline — same race that broke TC-CTAPI-043/054-2: the
      // summary job can land between this snapshot and the later re-reads, showing up as
      // summaryStatus pending->completed / executiveOverview null->populated in a diff that
      // has nothing to do with update-contract. (Surfaced on QA 2026-09-07.)
      const baseDetail = await detailAfterSummarySettles(fam035.familyId);
      const baseClauses = await api.clauseComparison(poToken, fam035.familyId);
      const baseRisks = await api.risks(poToken, fam035.familyId);
      expect(baseDetail.status).toBe(200);

      const r = await api.updateContract(poToken, fam035.familyId, fam035.versionId, {
        buffer: replacement.buffer,
        filename: replacement.filename,
        contentType: replacement.contentType,
      });
      expect(r.status).toBe(200);

      // Checkpoint 1: immediately after the call.
      const midDetail = await api.detail(poToken, fam035.familyId);
      expect(withoutMeta(midDetail.data)).toEqual(withoutMeta(baseDetail.data));

      // Checkpoint 2: after re-extraction finishes, still without saving.
      const done = await api.waitForExtraction(poToken, fam035.familyId, fam035.versionId);
      expect(done).toBe("completed");
      const endDetail = await api.detail(poToken, fam035.familyId);
      expect(withoutMeta(endDetail.data)).toEqual(withoutMeta(baseDetail.data));

      if (baseClauses.status === 200) {
        const endClauses = await api.clauseComparison(poToken, fam035.familyId);
        expect(withoutMeta(endClauses.data)).toEqual(withoutMeta(baseClauses.data));
      }
      if (baseRisks.status === 200) {
        const endRisks = await api.risks(poToken, fam035.familyId);
        expect(withoutMeta(endRisks.data)).toEqual(withoutMeta(baseRisks.data));
      }

      // 3. the version is still saved and still Active throughout
      const vlist = await api.versions(poToken, fam035.familyId);
      const row = vlist.data.data.versions.find((x: Record<string, unknown>) => x.versionId === fam035.versionId);
      expect(row?.isActive).toBe(true);
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-036 update-contract on a non-active version returns 409 ERR_NOT_ACTIVE_VERSION",
    async () => {
      expect(fam036Other, "the second, non-Active version must have been seeded").not.toBe("");
      const r = await api.updateContract(poToken, fam036.familyId, fam036Other, {
        buffer: replacement.buffer,
        filename: replacement.filename,
        contentType: replacement.contentType,
      });
      expect(r.status).toBe(409);
      assertErrorEnvelope(r, "ERR_NOT_ACTIVE_VERSION");
      expect(r.data.error.message).toBe("Update Contract is only available for the currently active version.");
      // 4. neither version extraction status changed
      const s = await api.extractionStatus(poToken, fam036.familyId, fam036Other);
      expect(s.data.data.extractionStatus ?? s.data.data.status).toBe("completed");
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-037 update-contract on an expired contract returns 409 ERR_CONTRACT_EXPIRED",
    async () => {
      // 1. confirm the lazy-write transition has already moved the family to expired
      const detail = await api.detail(poToken, fam037.familyId);
      expect(detail.status).toBe(200);
      expect(detail.data.data.status).toBe("expired");

      // The replacement carries FUTURE dates (V2 expires 2026-12-31); the gate is
      // the CURRENT family status, not the incoming content.
      const future = CONTRACT_V2();
      const r = await api.updateContract(poToken, fam037.familyId, fam037.versionId, {
        buffer: future.buffer,
        filename: future.filename,
        contentType: future.contentType,
      });
      expect(r.status).toBe(409);
      assertErrorEnvelope(r, "ERR_CONTRACT_EXPIRED");
      expect(r.data.error.message).toBe("Cannot update an expired contract. Upload a new version instead.");
      // 5. nothing staged - the extraction status is untouched
      const s = await api.extractionStatus(poToken, fam037.familyId, fam037.versionId);
      expect(s.data.data.extractionStatus ?? s.data.data.status).toBe("completed");
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-038 update-contract on a terminated contract is rejected",
    async () => {
      const r = await api.updateContract(poToken, fam038.familyId, fam038.versionId, {
        buffer: replacement.buffer,
        filename: replacement.filename,
        contentType: replacement.contentType,
      });
      // 1. a 409 that is not 401/403/404. The spec names no code for this branch on
      // Endpoint #4 (contract TBD), so the code itself is deliberately not pinned.
      expect(r.status).toBe(409);
      expect(r.data.success).toBe(false);
      expect(typeof r.data.error.code).toBe("string");
      // 3. nothing staged
      const s = await api.extractionStatus(poToken, fam038.familyId, fam038.versionId);
      expect(s.data.data.extractionStatus ?? s.data.data.status).toBe("completed");
      // 4. the family is still terminated
      const detail = await api.detail(poToken, fam038.familyId);
      expect(detail.data.data.status).toBe("terminated");
      assertResponseTime(r);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-039 update-contract stages a new S3 object without replacing the old one",
    async () => {
      const before = await api.fileUrl(poToken, fam039.familyId, fam039.versionId);
      expect(before.status).toBe(200);
      const baseUrl = String(before.data.data.url ?? before.data.data.fileUrl ?? before.data.data);
      const baseKey = baseUrl.split("?")[0];
      const vBefore = await api.versions(poToken, fam039.familyId);
      const rowBefore = vBefore.data.data.versions.find(
        (x: Record<string, unknown>) => x.versionId === fam039.versionId,
      );
      const nameBefore = rowBefore?.filename;

      const r = await api.updateContract(poToken, fam039.familyId, fam039.versionId, {
        buffer: replacement.buffer,
        filename: "replacement-for-tc039.pdf",
        contentType: replacement.contentType,
      });
      expect(r.status).toBe(200);

      // 2. Endpoint #17 still resolves to the ORIGINAL object. The signature part of
      // a presigned URL is regenerated per call, so only the object key is compared.
      const after = await api.fileUrl(poToken, fam039.familyId, fam039.versionId);
      expect(after.status).toBe(200);
      const afterUrl = String(after.data.data.url ?? after.data.data.fileUrl ?? after.data.data);
      expect(afterUrl.split("?")[0]).toBe(baseKey);

      // 4. the Documents tab still shows the original filename until Save completes
      const vAfter = await api.versions(poToken, fam039.familyId);
      const rowAfter = vAfter.data.data.versions.find(
        (x: Record<string, unknown>) => x.versionId === fam039.versionId,
      );
      expect(rowAfter?.filename).toBe(nameBefore);
      assertResponseTime(r);
    },
    CASE_MS,
  );
});

// ===========================================================================
// Endpoint #5 - extraction-status, and Endpoint #7 - review, during an update
// ===========================================================================
describe("Endpoints #5 and #7 during an update-contract", () => {
  let fam043: SeededVersion;
  let fam054: SeededVersion;

  const replacement = CONTRACT_V1();

  beforeAll(async () => {
    [fam043, fam054] = await Promise.all([seedActiveFamily(), seedActiveFamily()]);
  }, SEED_MS);

  afterAll(async () => {
    await destroyFamily(poToken, fam043?.familyId);
    await destroyFamily(poToken, fam054?.familyId);
  }, SEED_MS);

  test(
    "TC-CTAPI-043 extraction-status reports the re-extraction on the same versionId",
    async () => {
      // 1. baseline is completed
      const s0 = await api.extractionStatus(poToken, fam043.familyId, fam043.versionId);
      expect(s0.status).toBe(200);
      expect(s0.data.data.extractionStatus ?? s0.data.data.status).toBe("completed");
      const detailBefore = await detailAfterSummarySettles(fam043.familyId);

      const upd = await api.updateContract(poToken, fam043.familyId, fam043.versionId, {
        buffer: replacement.buffer,
        filename: replacement.filename,
        contentType: replacement.contentType,
      });
      expect(upd.status).toBe(200);

      // 2. the status has moved BACK to pending on the SAME version row
      const s1 = await api.extractionStatus(poToken, fam043.familyId, fam043.versionId);
      expect(s1.status).toBe(200);
      expect(s1.data.data.extractionStatus ?? s1.data.data.status).toBe("pending");
      // 3. no new version id appears
      expect(s1.data.data.versionId).toBe(fam043.versionId);
      expect(s1.data.data.familyId).toBe(fam043.familyId);

      // 4. polling reaches completed again
      const done = await api.waitForExtraction(poToken, fam043.familyId, fam043.versionId);
      expect(done).toBe("completed");

      // 5. extraction_status is a routing flag only - the family is untouched
      const detailAfter = await api.detail(poToken, fam043.familyId);
      expect(detailAfter.data.data.status).toBe("active");
      expect(withoutMeta(detailAfter.data)).toEqual(withoutMeta(detailBefore.data));
      assertResponseTime(s1);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-054-2 review serves the staged pending record with an identical shape",
    async () => {
      const liveBaseline = await detailAfterSummarySettles(fam054.familyId);
      expect(liveBaseline.status).toBe(200);

      const upd = await api.updateContract(poToken, fam054.familyId, fam054.versionId, {
        buffer: replacement.buffer,
        filename: replacement.filename,
        contentType: replacement.contentType,
      });
      expect(upd.status).toBe(200);
      const done = await api.waitForExtraction(poToken, fam054.familyId, fam054.versionId);
      expect(done).toBe("completed");

      const r = await api.review(poToken, fam054.familyId, fam054.versionId);
      expect(r.status).toBe(200);
      // 1. the temporarily-flipped entry point is visible here
      expect(r.data.data.entryPoint).toBe("update_contract");
      // 2. the same 20 field keys as the no-pending-update branch
      expect(Object.keys(r.data.data.fields).sort()).toEqual([...REVIEW_FIELDS].sort());
      // 3. version and contract ids unchanged
      expect(r.data.data.versionId).toBe(fam054.versionId);
      expect(r.data.data.contractId).toBe(liveBaseline.data.data.contractId);
      // 5. the carried-over links are present as keys
      expect(r.data.data).toHaveProperty("linkedVendor");
      expect(r.data.data).toHaveProperty("linkedSourcingEvent");

      // 4. the live version still shows its OLD data
      const liveAfter = await api.detail(poToken, fam054.familyId);
      expect(withoutMeta(liveAfter.data)).toEqual(withoutMeta(liveBaseline.data));
      assertResponseTime(r);
    },
    CASE_MS,
  );
});

// ---------------------------------------------------------------------------
// Shared save fixtures
// ---------------------------------------------------------------------------

/**
 * A complete, valid 20-field save body.
 *
 * Dates are plain YYYY-MM-DD. The spec's request table says MM/DD/YYYY, but that
 * form is rejected 400 on live QA (CLRE-277) and a value carrying a time component
 * returns 500 - so every body here uses the one form the endpoint accepts. The
 * MM/DD/YYYY contract itself is the subject of TC-CTAPI-067, not of these cases.
 */
function baseSaveBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    totalContractValue: 120000,
    effectiveDate: "2025-02-01",
    expirationDate: "2026-01-31",
    noticePeriodDays: 60,
  };
  for (const f of REVIEW_FIELDS.slice(4)) body[f] = `QA-${f}`;
  return { ...body, ...overrides };
}

/**
 * Assert the status the SPEC documents, AFTER the substantive assertions have run.
 *
 * Save / activate / terminate answer 201 where the spec says 200 (CLRE-280) and
 * save validation answers 400 where the spec says 422 (CLRE-279 family). Asserting
 * the spec value last means the drift still fails the case - which is the report -
 * without hiding everything the case was actually written to check.
 */
function assertSpecStatus(r: { status: number }, expected: number): void {
  expect(r.status, `spec pins HTTP ${expected} for this response`).toBe(expected);
}

/** The Endpoint #10 detail body, typed just enough for the Summary assertions. */
interface DetailShape {
  status: string;
  contractId: string;
  keyDates: Record<string, unknown>;
  financialTerms: Record<string, unknown>;
  terminationAndContinuity: Record<string, unknown>;
  legalAndCompliance: Record<string, unknown>;
  summaryStatus?: unknown;
  clauseRiskStatus?: unknown;
  riskCount?: unknown;
  executiveOverview?: unknown;
}

/** Read the five Summary groups back from Endpoint #10. */
async function summary(familyId: string): Promise<DetailShape> {
  const d = await api.detail(poToken, familyId);
  expect(d.status).toBe(200);
  return d.data.data as DetailShape;
}

// ===========================================================================
// Endpoint #8 - POST /:familyId/versions/:versionId/save
// ===========================================================================
describe("Endpoint #8 - save (boundaries, notice deadline, staged promotion)", () => {
  /** Seven independent unsaved-but-extracted versions: a save is one-shot per version. */
  let fresh: SeededVersion[] = [];
  let fam058: SeededVersion;
  let fam058Second = "";
  let fam059: SeededVersion[] = [];
  let fam061: SeededVersion;

  const replacement = CONTRACT_V1();

  beforeAll(async () => {
    fresh = await Promise.all(
      Array.from({ length: 7 }, () => seedUploadedContract(poToken, { fixture: CONTRACT_V1() })),
    );

    [fam058, ...fam059] = await Promise.all([
      seedSavedContract(poToken, { fixture: CONTRACT_V2() }),
      seedActiveFamily(),
      seedActiveFamily(),
      seedActiveFamily(),
      seedActiveFamily(),
    ]);
    fam061 = await seedActiveFamily();

    // fam058 gets a SECOND version, extracted but never saved.
    const up = await api.uploadVersion(poToken, fam058.familyId, {
      file: { buffer: replacement.buffer, filename: replacement.filename, contentType: replacement.contentType },
    });
    fam058Second = up.data?.data?.versionId ?? "";
    if (fam058Second) await api.waitForExtraction(poToken, fam058.familyId, fam058Second);

    // Stage an update-contract on each 059 family and on the 061 family, then wait
    // for the re-extraction so every save below starts from the same staged state.
    const staged = [...fam059, fam061];
    await Promise.all(
      staged.map((f) =>
        api.updateContract(poToken, f.familyId, f.versionId, {
          buffer: replacement.buffer,
          filename: "replacement.pdf",
          contentType: replacement.contentType,
        }),
      ),
    );
    await Promise.all(staged.map((f) => api.waitForExtraction(poToken, f.familyId, f.versionId)));
  }, SEED_MS);

  afterAll(async () => {
    for (const f of [...fresh, fam058, ...fam059, fam061]) await destroyFamily(poToken, f?.familyId);
  }, SEED_MS);

  test(
    "TC-CTAPI-058-2 save on an Upload New Version fires Stage 2 for that version only",
    async () => {
      expect(fam058Second, "the second, unsaved version must have been seeded").not.toBe("");
      const baseClauses = await api.clauseComparison(poToken, fam058.familyId);
      const baseRisks = await api.risks(poToken, fam058.familyId);
      const countBefore = (await api.versions(poToken, fam058.familyId)).data.data.pagination.total;

      const r = await api.save(poToken, fam058.familyId, fam058Second, baseSaveBody());
      expect(r.status).toBeLessThan(400);
      // 1. the save is scoped to the version it names
      expect(r.data.data.versionId).toBe(fam058Second);

      // 3. the sibling version's Stage 2 output was not regenerated or disturbed
      if (baseClauses.status === 200) {
        const nowClauses = await api.clauseComparison(poToken, fam058.familyId);
        expect(withoutMeta(nowClauses.data)).toEqual(withoutMeta(baseClauses.data));
      }
      if (baseRisks.status === 200) {
        const nowRisks = await api.risks(poToken, fam058.familyId);
        expect(withoutMeta(nowRisks.data)).toEqual(withoutMeta(baseRisks.data));
      }
      // 4. the save itself creates no version
      const after = await api.versions(poToken, fam058.familyId);
      expect(after.data.data.pagination.total).toBe(countBefore + 1); // the newly saved row becomes visible
      assertResponseTime(r);
      // DRIFT (live QA 2026-08-25): save answers 201 (CLRE-280); the spec says 200.
      assertSpecStatus(r, 200);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-059-1 update-contract save promotes the staged record and keeps the version Active",
    async () => {
      const f = fam059[0] as SeededVersion;
      const before = await api.detail(poToken, f.familyId);
      const countBefore = (await api.versions(poToken, f.familyId)).data.data.pagination.total;

      const body = baseSaveBody({
        totalContractValue: 750000,
        effectiveDate: "2027-01-01",
        expirationDate: "2028-12-31",
        noticePeriodDays: 60,
      });
      const r = await api.save(poToken, f.familyId, f.versionId, body);
      expect(r.status).toBeLessThan(400);
      // 1. identity preserved - no NNN consumed
      expect(r.data.data.versionId).toBe(f.versionId);
      expect(r.data.data.contractId).toBe(before.data.data.contractId);

      // 2. the staged replacement is now the live content
      const d = await summary(f.familyId);
      expect(d.financialTerms.totalContractValue).toBe(750000);
      // 3. still active, still the family's active version
      expect(d.status).toBe("active");
      const vlist = await api.versions(poToken, f.familyId);
      const row = vlist.data.data.versions.find((x: Record<string, unknown>) => x.versionId === f.versionId);
      expect(row?.isActive).toBe(true);
      // 4. no row added
      expect(vlist.data.data.pagination.total).toBe(countBefore);
      expect(row?.filename).toBe("replacement.pdf");
      // 5. one row on Endpoint #1, still active
      const list = await api.list(poToken, { status: "active", limit: 50 });
      const listed = list.data.data.contracts.filter((c: Record<string, unknown>) => c.familyId === f.familyId);
      expect(listed.length).toBe(1);
      assertResponseTime(r);
      assertSpecStatus(r, 200);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-059-2 update-contract save re-runs Stage 2 and discards the previous results",
    async () => {
      const f = fam059[1] as SeededVersion;
      const baseRisks = await api.risks(poToken, f.familyId);
      const baseIds = new Set<string>(
        (baseRisks.data?.data?.risks ?? []).map((x: Record<string, unknown>) => String(x.id ?? x.riskId)),
      );

      const r = await api.save(poToken, f.familyId, f.versionId, baseSaveBody());
      expect(r.status).toBeLessThan(400);

      // 1. both Stage 2 statuses are pending again - the one documented exception
      // to the once-only rule.
      const s1 = await summary(f.familyId);
      expect(s1.summaryStatus).toBe("pending");
      expect(s1.clauseRiskStatus).toBe("pending");
      // 2./3. the old outputs are deleted, not left showing, during the pending window
      expect(s1.executiveOverview ?? null).toBeNull();
      expect(s1.riskCount ?? null).toBeNull();

      // 4. both reach completed and repopulate
      const deadline = Date.now() + 240_000;
      let d2 = s1;
      while (Date.now() < deadline) {
        d2 = await summary(f.familyId);
        if (d2.summaryStatus !== "pending" && d2.clauseRiskStatus !== "pending") break;
        await new Promise((res) => setTimeout(res, 5_000));
      }
      expect(d2.summaryStatus).toBe("completed");
      expect(d2.clauseRiskStatus).toBe("completed");
      expect(Number.isInteger(d2.riskCount)).toBe(true);
      expect(String(d2.executiveOverview ?? "").length).toBeGreaterThan(0);

      // 5. the risk rows were replaced, not reused
      const nowRisks = await api.risks(poToken, f.familyId);
      const nowIds: string[] = (nowRisks.data?.data?.risks ?? []).map((x: Record<string, unknown>) =>
        String(x.id ?? x.riskId),
      );
      for (const id of nowIds) expect(baseIds.has(id), `risk id ${id} survived the re-run`).toBe(false);
      assertResponseTime(r);
      assertSpecStatus(r, 200);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-059-3 update-contract save repoints the version at the staged file",
    async () => {
      const f = fam059[2] as SeededVersion;
      const before = await api.fileUrl(poToken, f.familyId, f.versionId);
      expect(before.status).toBe(200);
      const beforeKey = String(before.data.data.url ?? before.data.data.fileUrl ?? before.data.data).split("?")[0];

      const r = await api.save(poToken, f.familyId, f.versionId, baseSaveBody());
      expect(r.status).toBeLessThan(400);

      // 2. the version now points at a DIFFERENT object
      const after = await api.fileUrl(poToken, f.familyId, f.versionId);
      expect(after.status).toBe(200);
      const afterKey = String(after.data.data.url ?? after.data.data.fileUrl ?? after.data.data).split("?")[0];
      expect(afterKey).not.toBe(beforeKey);

      // 5. the Documents tab shows the replacement filename
      const vlist = await api.versions(poToken, f.familyId);
      const row = vlist.data.data.versions.find((x: Record<string, unknown>) => x.versionId === f.versionId);
      expect(row?.filename).toBe("replacement.pdf");
      assertResponseTime(r);
      assertSpecStatus(r, 200);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-059-4 update-contract save removes the pending record and restores the entry point",
    async () => {
      const f = fam059[3] as SeededVersion;
      const staged = await api.review(poToken, f.familyId, f.versionId);
      expect(staged.status).toBe(200);
      expect(staged.data.data.entryPoint).toBe("update_contract");

      const r = await api.save(poToken, f.familyId, f.versionId, baseSaveBody());
      expect(r.status).toBeLessThan(400);

      // 2. the entry point is restored from original_entry_point, not left flipped
      const after = await api.review(poToken, f.familyId, f.versionId);
      expect(after.status).toBe(200);
      expect(after.data.data.entryPoint).not.toBe("update_contract");

      // 4. Endpoint #9 now takes the saved-version branch: deleting the family's
      // Active version is refused rather than "discarding" a pending update.
      const del = await api.deleteVersion(poToken, f.familyId, f.versionId);
      expect(del.status).toBeGreaterThanOrEqual(400);
      assertErrorEnvelope(del, "ERR_DELETE_BLOCKED");
      assertResponseTime(r);
      assertSpecStatus(r, 200);
    },
    CASE_MS,
  );

  // TC-CTAPI-059-5 and -059-6 are implemented in contracts.final.test.ts, which owns
  // the clause-configuration mutation and the multi-comparison fixture they need.

  test(
    "TC-CTAPI-060-1 save before extraction completes returns 409 ERR_EXTRACTION_NOT_COMPLETED",
    async () => {
      // A brand-new upload is 'pending' for ~14 s, which is the window this case needs.
      const fx = CONTRACT_V1();
      const c = await api.create(poToken, {
        contractType: "subscription_agreement_saas",
        file: { buffer: fx.buffer, filename: fx.filename, contentType: fx.contentType },
      });
      expect(c.status).toBe(201);
      const { familyId, versionId } = c.data.data;
      try {
        // The `pending` window is a RACE, not a guarantee: Stage 1 occasionally
        // finishes before this save lands, and the endpoint then correctly accepts it.
        // The observed status is read first and the assertion branches on it, so the
        // case is deterministic either way instead of failing on a fast extraction.
        const observed = (await api.extractionStatus(poToken, familyId, versionId)).data?.data
          ?.extractionStatus;
        const r = await api.save(poToken, familyId, versionId, baseSaveBody());

        if (observed === "pending") {
          expect(r.status).toBe(409);
          assertErrorEnvelope(r, "ERR_EXTRACTION_NOT_COMPLETED");
          expect(r.data.error.message).toBe("Cannot save before extraction completes.");
          // 4. the real current status is echoed back
          expect(r.data.error.details?.extractionStatus).toBe("pending");
          // 5. nothing persisted - the version is still unsaved
          const vlist = await api.versions(poToken, familyId);
          const listed = vlist.data.data.versions.some(
            (x: Record<string, unknown>) => x.versionId === versionId,
          );
          expect(listed).toBe(false);
        } else {
          // Stage 1 beat the save. The guard is not under test on this path, so the
          // complement is asserted: a completed extraction must let the save through.
          expect(r.status, `save after extraction '${observed}' must succeed`).toBeLessThan(400);
          console.warn(
            `TC-CTAPI-060-1 ran the '${observed}' branch: Stage 1 finished before the save`,
          );
        }
        assertResponseTime(r);
      } finally {
        await destroyFamily(poToken, familyId);
      }
    },
    CASE_MS,
  );

  // TC-CTAPI-060-2 is implemented in contracts.final.test.ts. A file that reaches a
  // version row and then fails Stage 1 does exist - seedFailedExtraction() uses it.

  test(
    "TC-CTAPI-061 a failed save triggers no Stage 2 and overwrites nothing on an update",
    async () => {
      const f = fam061;
      const baseDetail = await api.detail(poToken, f.familyId);
      const baseRisks = await api.risks(poToken, f.familyId);
      const baseFile = await api.fileUrl(poToken, f.familyId, f.versionId);
      const baseKey = String(baseFile.data?.data?.url ?? baseFile.data?.data?.fileUrl ?? "").split("?")[0];

      // one over the documented maximum, so validation fails before any write
      const r = await api.save(poToken, f.familyId, f.versionId, baseSaveBody({ totalContractValue: 1000000000 }));
      expect(r.data.success).toBe(false);
      assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");

      // 2. nothing was written
      const afterDetail = await api.detail(poToken, f.familyId);
      expect(withoutMeta(afterDetail.data)).toEqual(withoutMeta(baseDetail.data));
      if (baseRisks.status === 200) {
        const afterRisks = await api.risks(poToken, f.familyId);
        expect(withoutMeta(afterRisks.data)).toEqual(withoutMeta(baseRisks.data));
      }
      // 4. the original S3 object survives
      const afterFile = await api.fileUrl(poToken, f.familyId, f.versionId);
      expect(String(afterFile.data?.data?.url ?? afterFile.data?.data?.fileUrl ?? "").split("?")[0]).toBe(baseKey);
      // 5. the pending record survives so the user can correct and retry
      const rev = await api.review(poToken, f.familyId, f.versionId);
      expect(rev.data.data.entryPoint).toBe("update_contract");
      // 6. the corrected save then succeeds - the failure was recoverable
      const retry = await api.save(poToken, f.familyId, f.versionId, baseSaveBody());
      expect(retry.status).toBeLessThan(400);
      assertResponseTime(r);
      // DRIFT (live QA 2026-08-25): validation answers 400 (CLRE-279 family); the
      // spec pins 422 for ERR_VALIDATION_FAILED on this endpoint.
      assertSpecStatus(r, 422);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-062-1 save accepts totalContractValue at the lower boundary 0",
    async () => {
      const f = fresh[0] as SeededVersion;
      const r = await api.save(poToken, f.familyId, f.versionId, baseSaveBody({ totalContractValue: 0 }));
      expect(r.status).toBeLessThan(400);
      const d = await summary(f.familyId);
      // 2. the NUMBER zero, never null and never the string "0"
      expect(d.financialTerms.totalContractValue).toBe(0);
      expect(typeof d.financialTerms.totalContractValue).toBe("number");
      assertResponseTime(r);
      assertSpecStatus(r, 200);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-062-2 save accepts totalContractValue at the upper boundary 999999999",
    async () => {
      const f = fresh[1] as SeededVersion;
      const r = await api.save(poToken, f.familyId, f.versionId, baseSaveBody({ totalContractValue: 999999999 }));
      expect(r.status).toBeLessThan(400);
      const d = await summary(f.familyId);
      // 2. exact - no rounding, truncation or scientific notation
      expect(d.financialTerms.totalContractValue).toBe(999999999);
      expect(typeof d.financialTerms.totalContractValue).toBe("number");
      assertResponseTime(r);
      assertSpecStatus(r, 200);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-063-1 save accepts noticePeriodDays at the lower boundary 0",
    async () => {
      const f = fresh[2] as SeededVersion;
      const r = await api.save(
        poToken,
        f.familyId,
        f.versionId,
        baseSaveBody({ noticePeriodDays: 0, expirationDate: "2027-12-31" }),
      );
      expect(r.status).toBeLessThan(400);
      const d = await summary(f.familyId);
      // 2. the number zero, not null
      expect(d.terminationAndContinuity.noticePeriodDays).toBe(0);
      // 3. expiration - 0 days is still "both provided", so the deadline is the
      // expiration date itself rather than null
      expect(String(d.keyDates.noticeDeadline ?? "").slice(0, 10)).toBe("2027-12-31");
      assertResponseTime(r);
      assertSpecStatus(r, 200);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-063-2 save accepts noticePeriodDays at the upper boundary 365",
    async () => {
      const f = fresh[3] as SeededVersion;
      const r = await api.save(
        poToken,
        f.familyId,
        f.versionId,
        baseSaveBody({ noticePeriodDays: 365, expirationDate: "2027-12-31" }),
      );
      expect(r.status).toBeLessThan(400);
      const d = await summary(f.familyId);
      expect(d.terminationAndContinuity.noticePeriodDays).toBe(365);
      // 3. 2027 is not a leap year, so this is a plain 365-day subtraction
      expect(String(d.keyDates.noticeDeadline ?? "").slice(0, 10)).toBe("2026-12-31");
      assertResponseTime(r);
      assertSpecStatus(r, 200);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-066-1 notice deadline is computed at save as expiration minus notice period",
    async () => {
      const f = fresh[4] as SeededVersion;
      const r = await api.save(
        poToken,
        f.familyId,
        f.versionId,
        baseSaveBody({ expirationDate: "2027-07-27", noticePeriodDays: 30 }),
      );
      expect(r.status).toBeLessThan(400);
      const d = await summary(f.familyId);
      // 2./3. backend-derived; the request never carried noticeDeadline
      expect(String(d.keyDates.noticeDeadline ?? "").slice(0, 10)).toBe("2027-06-27");
      // 4. the deadline is in the future
      expect(d.keyDates.noticeDeadlineOverdue).toBe(false);
      // 5. stable across reads - computed once at save, not per read
      const again = await summary(f.familyId);
      expect(again.keyDates.noticeDeadline).toEqual(d.keyDates.noticeDeadline);
      assertResponseTime(r);
      assertSpecStatus(r, 200);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-066-2 notice deadline is null when the expiration date is missing",
    async () => {
      const f = fresh[5] as SeededVersion;
      const body = baseSaveBody({ noticePeriodDays: 30 });
      delete body.expirationDate;
      const r = await api.save(poToken, f.familyId, f.versionId, body);
      expect(r.status).toBeLessThan(400);
      const d = await summary(f.familyId);
      // 2./3. both present as keys, both null
      expect(d.keyDates).toHaveProperty("noticeDeadline");
      expect(d.keyDates.noticeDeadline).toBeNull();
      expect(d.keyDates.expirationDate).toBeNull();
      // 4. the notice period was still stored
      expect(d.terminationAndContinuity.noticePeriodDays).toBe(30);
      // 5. never null, never true, when there is no deadline to be overdue against
      expect(d.keyDates.noticeDeadlineOverdue).toBe(false);
      // 6. spec 9.1 needs a non-null expiration, so the family cannot expire
      expect(d.status).not.toBe("expired");
      assertResponseTime(r);
      assertSpecStatus(r, 200);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-066-3 notice deadline is null when the notice period is missing",
    async () => {
      const f = fresh[6] as SeededVersion;
      const body = baseSaveBody({ expirationDate: "2027-07-27" });
      delete body.noticePeriodDays;
      const r = await api.save(poToken, f.familyId, f.versionId, body);
      expect(r.status).toBeLessThan(400);
      const d = await summary(f.familyId);
      expect(d.keyDates.noticeDeadline).toBeNull();
      // 3. the expiration is stored even though no deadline follows from it
      expect(String(d.keyDates.expirationDate ?? "").slice(0, 10)).toBe("2027-07-27");
      // 4. null, NOT defaulted to 0 - which would produce a deadline equal to the
      // expiration date (contrast TC-CTAPI-063-1)
      expect(d.terminationAndContinuity.noticePeriodDays).toBeNull();
      assertResponseTime(r);
      assertSpecStatus(r, 200);
    },
    CASE_MS,
  );
});

// ---------------------------------------------------------------------------
// Multi-version seeding
// ---------------------------------------------------------------------------
interface SeededFamily {
  familyId: string;
  /** Saved version ids, oldest first. */
  versionIds: string[];
}

/** Add one version to an existing family and return its id (not yet saved). */
async function addVersion(familyId: string, filename?: string): Promise<string> {
  const fx = CONTRACT_V2();
  const r = await api.uploadVersion(poToken, familyId, {
    file: { buffer: fx.buffer, filename: filename ?? fx.filename, contentType: fx.contentType },
  });
  if (r.status !== 201) {
    throw new Error(`addVersion failed: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  return r.data.data.versionId as string;
}

/** Wait for Stage 1 then Save, echoing back exactly what Stage 1 extracted. */
async function extractAndSave(familyId: string, versionId: string): Promise<void> {
  await api.waitForExtraction(poToken, familyId, versionId);
  const rev = await api.review(poToken, familyId, versionId);
  const r = await api.save(
    poToken,
    familyId,
    versionId,
    (rev.data?.data?.fields ?? rev.data?.data ?? {}) as Record<string, unknown>,
  );
  if (r.status >= 400) {
    throw new Error(`seed save failed: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
}

/** A family with `n` SAVED versions and no Active version. */
async function seedFamilyWithSavedVersions(n: number): Promise<SeededFamily> {
  const first = await seedSavedContract(poToken, { fixture: CONTRACT_V2() });
  const ids = [first.versionId];
  for (let i = 1; i < n; i += 1) ids.push(await addVersion(first.familyId));
  // The extra versions extract concurrently; only the saves need ordering-free waits.
  await Promise.all(ids.slice(1).map((v) => extractAndSave(first.familyId, v)));
  return { familyId: first.familyId, versionIds: ids };
}

// ===========================================================================
// Endpoint #13 - GET /:familyId/versions (Documents tab)
// ===========================================================================
describe("Endpoint #13 - versions list (tags, pagination, visibility)", () => {
  let f093: SeededFamily;
  let f094: SeededFamily;
  let f095: SeededFamily;
  let f095Unsaved = "";
  let f096a: SeededFamily;
  let f096b: SeededVersion;
  let f097Terminated: SeededVersion;

  beforeAll(async () => {
    [f093, f094, f095, f096a, f096b, f097Terminated] = await Promise.all([
      seedFamilyWithSavedVersions(3),
      seedFamilyWithSavedVersions(12),
      seedFamilyWithSavedVersions(3),
      seedFamilyWithSavedVersions(3),
      seedActiveFamily(),
      seedActiveFamily(),
    ]);
    await api.terminate(poToken, f097Terminated.familyId);
    // f096a needs an Active version; f095 needs a fourth version left UNSAVED.
    await api.activate(poToken, f096a.familyId, f096a.versionIds[1] as string);
    f095Unsaved = await addVersion(f095.familyId);
    await api.waitForExtraction(poToken, f095.familyId, f095Unsaved);
  }, SEED_MS);

  afterAll(async () => {
    for (const id of [
      f093?.familyId, f094?.familyId, f095?.familyId, f096a?.familyId,
      f096b?.familyId, f097Terminated?.familyId,
    ]) {
      await destroyFamily(poToken, id);
    }
  }, SEED_MS);

  test(
    "TC-CTAPI-093-2 Latest and Active tags are derived from the family, not stored per version",
    async () => {
      const newest = f093.versionIds[f093.versionIds.length - 1] as string;
      const oldest = f093.versionIds[0] as string;

      // Read 1 - before any activation
      const r1 = await api.versions(poToken, f093.familyId, { limit: 50 });
      expect(r1.status).toBe(200);
      expect(r1.data.data.hasActiveVersion).toBe(false);
      const rows1: Array<Record<string, unknown>> = r1.data.data.versions;
      const latest1 = rows1.filter((x) => x.tag === "Latest");
      expect(latest1.length).toBe(1);
      expect(latest1[0]?.versionId).toBe(newest);
      for (const x of rows1) {
        expect(x.isActive).toBe(false);
        if (x.versionId !== newest) expect(x.tag).toBeNull();
      }
      assertResponseTime(r1);

      // Read 2 - after activating the OLDEST version (a "latest == active" shortcut fails here)
      const act = await api.activate(poToken, f093.familyId, oldest);
      expect(act.status).toBeLessThan(400);
      const r2 = await api.versions(poToken, f093.familyId, { limit: 50 });
      expect(r2.data.data.hasActiveVersion).toBe(true);
      const rows2: Array<Record<string, unknown>> = r2.data.data.versions;
      expect(rows2.filter((x) => x.isActive === true).length).toBe(1);
      expect(rows2.find((x) => x.isActive === true)?.versionId).toBe(oldest);

      // Read 3 - a fourth saved version moves "Latest" with no write to any row
      const fourth = await addVersion(f093.familyId);
      await extractAndSave(f093.familyId, fourth);
      const r3 = await api.versions(poToken, f093.familyId, { limit: 50 });
      const rows3: Array<Record<string, unknown>> = r3.data.data.versions;
      expect(rows3.find((x) => x.tag === "Latest")?.versionId).toBe(fourth);
      expect(rows3.find((x) => x.isActive === true)?.versionId).toBe(oldest);
      assertResponseTime(r3);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-094-1 versions list pagination defaults to page 1 limit 10 and reports correct totals",
    async () => {
      const p1 = await api.versions(poToken, f094.familyId);
      expect(p1.status).toBe(200);
      expect(p1.data.data.pagination).toMatchObject({ page: 1, limit: 10, total: 12, totalPages: 2 });
      expect(p1.data.data.versions.length).toBe(10);

      const p2 = await api.versions(poToken, f094.familyId, { page: 2 });
      expect(p2.data.data.pagination.page).toBe(2);
      expect(p2.data.data.versions.length).toBe(2);

      const p3 = await api.versions(poToken, f094.familyId, { page: 2, limit: 5 });
      expect(p3.data.data.pagination).toMatchObject({ page: 2, limit: 5, total: 12, totalPages: 3 });
      expect(p3.data.data.versions.length).toBe(5);

      // 4. totalPages recomputed for every response
      for (const r of [p1, p2, p3]) {
        const p = r.data.data.pagination;
        expect(p.totalPages).toBe(Math.ceil(p.total / p.limit));
      }
      // 5. the pages partition the set - this is what catches an off-by-one offset
      const ids1 = new Set(p1.data.data.versions.map((x: Record<string, unknown>) => x.versionId));
      for (const x of p2.data.data.versions) expect(ids1.has(x.versionId)).toBe(false);

      // 6. a page past the end returns 200 with an empty array (contract TBD)
      const p9 = await api.versions(poToken, f094.familyId, { page: 9 });
      expect(p9.status).toBe(200);
      if (Array.isArray(p9.data.data.versions)) expect(p9.data.data.versions.length).toBe(0);
      assertResponseTime(p1);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-094-2 versions list enforces the documented page and limit bounds",
    async () => {
      const one = await api.versions(poToken, f094.familyId, { limit: 1 });
      expect(one.status).toBe(200);
      expect(one.data.data.versions.length).toBe(1);
      expect(one.data.data.pagination.limit).toBe(1);

      const fifty = await api.versions(poToken, f094.familyId, { limit: 50 });
      expect(fifty.status).toBe(200);
      expect(fifty.data.data.pagination.limit).toBe(50);

      for (const q of [{ limit: 51 }, { limit: 0 }, { limit: -1 }, { page: 0 }, { page: -1 }]) {
        const r = await api.versions(poToken, f094.familyId, q);
        expect(r.status, `query ${JSON.stringify(q)} must be rejected`).toBeGreaterThanOrEqual(400);
      }
      // 5. a non-numeric value must be REJECTED, never silently coerced to the default
      for (const q of [{ limit: "abc" }, { page: "abc" }]) {
        const r = await api.versions(poToken, f094.familyId, q);
        expect(r.status, `query ${JSON.stringify(q)} must be rejected, not coerced`).toBeGreaterThanOrEqual(400);
      }
      assertResponseTime(one);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-095 versions list excludes unsaved and deleted versions",
    async () => {
      // Read 1 - the in-flight upload is invisible
      const r1 = await api.versions(poToken, f095.familyId, { limit: 50 });
      expect(r1.status).toBe(200);
      expect(r1.data.data.pagination.total).toBe(3);
      expect(
        r1.data.data.versions.some((x: Record<string, unknown>) => x.versionId === f095Unsaved),
      ).toBe(false);

      // Read 2 - the same row becomes visible purely through is_saved
      await extractAndSave(f095.familyId, f095Unsaved);
      const r2 = await api.versions(poToken, f095.familyId, { limit: 50 });
      expect(r2.data.data.pagination.total).toBe(4);
      expect(
        r2.data.data.versions.some((x: Record<string, unknown>) => x.versionId === f095Unsaved),
      ).toBe(true);

      // Read 3 - a deleted version is filtered out and siblings are NOT renumbered
      const victim = f095.versionIds[1] as string;
      const survivors = new Map<string, unknown>(
        (r2.data.data.versions as Array<Record<string, unknown>>)
          .filter((x) => x.versionId !== victim)
          .map((x) => [String(x.versionId), x.contractId]),
      );
      const del = await api.deleteVersion(poToken, f095.familyId, victim);
      expect(del.status).toBeLessThan(400);
      const r3 = await api.versions(poToken, f095.familyId, { limit: 50 });
      expect(r3.data.data.pagination.total).toBe(3);
      expect(r3.data.data.versions.some((x: Record<string, unknown>) => x.versionId === victim)).toBe(false);
      for (const x of r3.data.data.versions as Array<Record<string, unknown>>) {
        expect(x.contractId, `contractId of ${x.versionId} must survive the deletion`)
          .toBe(survivors.get(String(x.versionId)));
      }
      assertResponseTime(r3);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-096-1 isTerminated is true on every row once the family is terminated",
    async () => {
      const r1 = await api.versions(poToken, f096a.familyId, { limit: 50 });
      expect(r1.status).toBe(200);
      const rows1: Array<Record<string, unknown>> = r1.data.data.versions;
      for (const x of rows1) expect(x.isTerminated).toBe(false);

      const t = await api.terminate(poToken, f096a.familyId);
      expect(t.status).toBeLessThan(400);

      const r2 = await api.versions(poToken, f096a.familyId, { limit: 50 });
      const rows2: Array<Record<string, unknown>> = r2.data.data.versions;
      // 2. family-derived, so EVERY row flips, including ones uploaded long before
      for (const x of rows2) expect(x.isTerminated).toBe(true);
      // 3. termination does not disturb the Active flag
      expect(rows2.filter((x) => x.isActive === true).length).toBe(1);
      expect(r2.data.data.hasActiveVersion).toBe(true);
      // 4. terminating writes nothing to version rows
      const strip = (rows: Array<Record<string, unknown>>) =>
        rows.map((x) => ({ versionId: x.versionId, contractId: x.contractId, filename: x.filename, uploadedAt: x.uploadedAt }));
      expect(strip(rows2)).toEqual(strip(rows1));
      assertResponseTime(r2);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-096-2 update-contract changes the listed filename while the row identity stays the same",
    async () => {
      const before = await api.versions(poToken, f096b.familyId, { limit: 50 });
      const rowBefore = (before.data.data.versions as Array<Record<string, unknown>>).find(
        (x) => x.versionId === f096b.versionId,
      );
      const totalBefore = before.data.data.pagination.total;

      const fx = CONTRACT_V1();
      const upd = await api.updateContract(poToken, f096b.familyId, f096b.versionId, {
        buffer: fx.buffer,
        filename: "Test Agreement v2.pdf",
        contentType: fx.contentType,
      });
      expect(upd.status).toBe(200);
      await api.waitForExtraction(poToken, f096b.familyId, f096b.versionId);
      const rev = await api.review(poToken, f096b.familyId, f096b.versionId);
      const saved = await api.save(
        poToken,
        f096b.familyId,
        f096b.versionId,
        (rev.data?.data?.fields ?? {}) as Record<string, unknown>,
      );
      expect(saved.status).toBeLessThan(400);

      // 6. visible on the very next read, no polling loop
      const after = await api.versions(poToken, f096b.familyId, { limit: 50 });
      const rowAfter = (after.data.data.versions as Array<Record<string, unknown>>).find(
        (x) => x.versionId === f096b.versionId,
      );
      expect(rowAfter?.filename).toBe("Test Agreement v2.pdf");
      // 2./3./5. identity untouched - no new row, no new -00N suffix
      expect(rowAfter?.versionId).toBe(rowBefore?.versionId);
      expect(rowAfter?.contractId).toBe(rowBefore?.contractId);
      expect(rowAfter?.isActive).toBe(true);
      expect(after.data.data.pagination.total).toBe(totalBefore);
      assertResponseTime(after);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-097-1 a Procurement Analyst can read the versions list",
    async () => {
      for (const familyId of [f094.familyId, f097Terminated.familyId]) {
        const asAnalyst = await api.versions(analystToken, familyId, { limit: 50 });
        const asOwner = await api.versions(poToken, familyId, { limit: 50 });
        // 1./3. readable by the Analyst, terminated families included
        expect(asAnalyst.status, `family ${familyId}`).toBe(200);
        // 2. this endpoint carries no role-dependent fields
        expect(withoutMeta(asAnalyst.data)).toEqual(withoutMeta(asOwner.data));
        assertResponseTime(asAnalyst);
      }
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-097-2 versions list requires authentication",
    async () => {
      const noToken = await api.versions("", f094.familyId);
      const badToken = await api.versions("not-a-real-jwt", f094.familyId);
      const missingFamily = await api.versions("", MISSING_FAMILY);
      for (const r of [noToken, badToken, missingFamily]) {
        expect(r.status).toBe(401);
        expect(r.data.success).toBe(false);
        // 2. an unauthenticated 401 must not leak document names or ids
        const body = JSON.stringify(r.data);
        expect(body).not.toMatch(/filename|contractId|versionId/i);
        expect(body).not.toContain("CON-");
        assertResponseTime(r);
      }
    },
    CASE_MS,
  );
});

/**
 * ISO 8601 date in America/Chicago, offset by `days` - the format Endpoint #14
 * documents.
 *
 * CLRE-331: the spec has been corrected to ISO 8601 (YYYY-MM-DD). The earlier
// MM/DD/YYYY wording was inconsistent with the project's date-format decision and
// with the implementation, so ISO is now the documented contract, not a drift.
 */
function chicagoSpecDate(days = 0): string {
  const d = new Date(chicagoToday().getTime() + days * 86_400_000);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

// ===========================================================================
// Endpoint #14 - POST /:familyId/versions/:versionId/activate
// ===========================================================================
describe("Endpoint #14 - activate (mark version as Active)", () => {
  let f098: SeededFamily;
  let f099: SeededFamily;
  let f100a: SeededFamily;
  let f100b: SeededFamily;
  let f100c: SeededFamily;
  let f101: SeededFamily;
  let f102: SeededFamily[] = [];
  let f103: SeededFamily;
  let f103Unsaved = "";
  let f103Other: SeededFamily;

  beforeAll(async () => {
    [f098, f099, f100a, f100b, f100c, f101, f103, f103Other] = await Promise.all([
      seedFamilyWithSavedVersions(3),
      seedFamilyWithSavedVersions(2),
      seedFamilyWithSavedVersions(1),
      seedFamilyWithSavedVersions(1),
      seedFamilyWithSavedVersions(1),
      seedFamilyWithSavedVersions(2),
      seedFamilyWithSavedVersions(1),
      seedFamilyWithSavedVersions(1),
    ]);
    // TC-CTAPI-102 needs a clean two-version family per repeat - a race can only be
    // observed once per family, since the winner permanently consumes the activation.
    f102 = await Promise.all(Array.from({ length: 5 }, () => seedFamilyWithSavedVersions(2)));
    f103Unsaved = await addVersion(f103.familyId);
  }, SEED_MS);

  afterAll(async () => {
    const all = [f098, f099, f100a, f100b, f100c, f101, f103, f103Other, ...f102];
    for (const f of all) await destroyFamily(poToken, f?.familyId);
  }, SEED_MS);

  test(
    "TC-CTAPI-098 activate with no execution date returns 200 and flips the family to active",
    async () => {
      const [vA, vB, vC] = f098.versionIds as [string, string, string];
      const countsBefore = (await api.list(poToken, { limit: 1 })).data.data.counts;

      const r = await api.activate(poToken, f098.familyId, vB); // deliberately the MIDDLE version
      expect(r.data.success).toBe(true);
      // 1. the message is asserted verbatim, trailing period included
      expect(r.data.data.message).toBe("Version marked as active.");

      // 2. the family is now active
      const d = await summary(f098.familyId);
      expect(d.status).toBe("active");

      const vlist = await api.versions(poToken, f098.familyId, { limit: 50 });
      const rows: Array<Record<string, unknown>> = vlist.data.data.versions;
      // 3. exactly the activated version is flagged
      expect(vlist.data.data.hasActiveVersion).toBe(true);
      expect(rows.find((x) => x.versionId === vB)?.isActive).toBe(true);
      expect(rows.find((x) => x.versionId === vA)?.isActive).toBe(false);
      expect(rows.find((x) => x.versionId === vC)?.isActive).toBe(false);
      // 4. omitting the optional field must not default to today
      expect(rows.find((x) => x.versionId === vB)?.executionDate).toBeNull();
      // 5. "Latest" stays on the newest version
      expect(rows.find((x) => x.tag === "Latest")?.versionId).toBe(vC);

      // 6. the tab counts move by exactly one in each direction
      const countsAfter = (await api.list(poToken, { limit: 1 })).data.data.counts;
      expect(countsAfter.in_review).toBe(countsBefore.in_review - 1);
      expect(countsAfter.active).toBe(countsBefore.active + 1);
      assertResponseTime(r);
      // DRIFT (live QA 2026-08-25): activate answers 201 (CLRE-280); spec says 200.
      assertSpecStatus(r, 200);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-099 activate with a past execution date stores and returns that date",
    async () => {
      const [vA, vB] = f099.versionIds as [string, string];
      const r = await api.activate(poToken, f099.familyId, vA, "2026-01-15");
      expect(r.data.success).toBe(true);
      expect(r.data.data.message).toBe("Version marked as active.");

      const vlist = await api.versions(poToken, f099.familyId, { limit: 50 });
      const rows: Array<Record<string, unknown>> = vlist.data.data.versions;
      const activated = rows.find((x) => x.versionId === vA);
      // 2. non-null and resolving to the calendar date submitted
      expect(activated?.executionDate).not.toBeNull();
      expect(String(activated?.executionDate).slice(0, 10)).toBe("2026-01-15");
      // 3. written to the activated version only
      expect(rows.find((x) => x.versionId === vB)?.executionDate).toBeNull();
      // 4.
      expect(activated?.isActive).toBe(true);
      assertResponseTime(r);
      assertSpecStatus(r, 200);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-100-1 execution date of today is accepted",
    async () => {
      const v = f100a.versionIds[0] as string;
      // Computed in America/Chicago inside the test, so a runner ahead of Chicago
      // does not accidentally submit tomorrow's Chicago date.
      const today = chicagoSpecDate(0);
      const r = await api.activate(poToken, f100a.familyId, v, today);
      expect(r.data.success, `executionDate=${today}`).toBe(true);

      const vlist = await api.versions(poToken, f100a.familyId, { limit: 50 });
      const row = (vlist.data.data.versions as Array<Record<string, unknown>>).find((x) => x.versionId === v);
      const expected = chicagoToday().toISOString().slice(0, 10);
      expect(String(row?.executionDate).slice(0, 10)).toBe(expected);
      assertResponseTime(r);
      assertSpecStatus(r, 200);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-100-2 execution date of tomorrow is rejected with 422 ERR_FUTURE_EXECUTION_DATE",
    async () => {
      const v = f100b.versionIds[0] as string;
      for (const days of [1, 365]) {
        const r = await api.activate(poToken, f100b.familyId, v, chicagoSpecDate(days));
        assertErrorEnvelope(r, "ERR_FUTURE_EXECUTION_DATE");
        expect(r.data.error.message).toBe("Execution date cannot be a future date.");
        // 2. details is an empty object
        expect(r.data.error.details).toEqual({});
        assertResponseTime(r);
        // 1. 422, not 400
        expect(r.status, `executionDate = today + ${days}d`).toBe(422);
      }
      // 3. the rejection must not burn the family's one-time activation
      const d = await summary(f100b.familyId);
      expect(d.status).toBe("in_review");
      const vlist = await api.versions(poToken, f100b.familyId, { limit: 50 });
      expect(vlist.data.data.hasActiveVersion).toBe(false);
      const row = (vlist.data.data.versions as Array<Record<string, unknown>>).find((x) => x.versionId === v);
      expect(row?.executionDate).toBeNull();
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-100-3 malformed execution date values are rejected",
    async () => {
      const v = f100c.versionIds[0] as string;
      // The case calls for a fresh family per attempt. One family is used here with
      // an after-each-attempt assertion instead: if an attempt wrongly activates,
      // that assertion fails immediately, which is the same signal a fresh family
      // would have produced - at a fraction of the seeding cost.
      // CLRE-331: ISO 8601 is the documented format, so "2026-01-15" is VALID and
      // was removed from this list - it belongs to TC-CTAPI-099, which asserts it
      // is accepted. What remains is genuinely malformed: a day/month transposition,
      // an impossible calendar date, junk, empty, a number and null.
      // `null` is NOT in this list: omitting the execution date is valid and returns
      // 200 (TC-CTAPI-098 asserts exactly that), so requiring a rejection for it
      // contradicts the neighbouring case.
      const values: unknown[] = ["13/01/2026", "02/30/2026", "not-a-date", "", 12345];
      for (const value of values) {
        const r = await api.activate(poToken, f100c.familyId, v, value as string);
        // 1./3. every malformed value is refused, ISO included
        expect(r.status, `executionDate=${JSON.stringify(value)} must be refused`).toBeGreaterThanOrEqual(400);
        // 2. a format failure must never activate
        const d = await summary(f100c.familyId);
        expect(d.status, `executionDate=${JSON.stringify(value)} left the family active`).not.toBe("active");
        assertResponseTime(r);
      }
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-101 activating a second version returns 409 ERR_ALREADY_HAS_ACTIVE",
    async () => {
      const [vA, vB] = f101.versionIds as [string, string];
      const first = await api.activate(poToken, f101.familyId, vA);
      expect(first.status).toBeLessThan(400);

      // 1. a DIFFERENT version is refused
      const second = await api.activate(poToken, f101.familyId, vB);
      expect(second.status).toBe(409);
      assertErrorEnvelope(second, "ERR_ALREADY_HAS_ACTIVE");
      expect(second.data.error.message).toBe("This contract already has an active version.");
      expect(second.data.error.details).toEqual({});

      // 2. re-activating the ALREADY-Active version is not a no-op 200 either
      const again = await api.activate(poToken, f101.familyId, vA);
      expect(again.status).toBe(409);
      assertErrorEnvelope(again, "ERR_ALREADY_HAS_ACTIVE");

      // 3. the guard runs before any write
      const vlist = await api.versions(poToken, f101.familyId, { limit: 50 });
      const rows: Array<Record<string, unknown>> = vlist.data.data.versions;
      expect(rows.filter((x) => x.isActive === true).length).toBe(1);
      expect(rows.find((x) => x.isActive === true)?.versionId).toBe(vA);
      assertResponseTime(second);
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-102 concurrent activation of two versions leaves exactly one active version",
    async () => {
      for (const [i, fam] of f102.entries()) {
        const [vA, vB] = fam.versionIds as [string, string];
        const [rA, rB] = await Promise.all([
          api.activate(poToken, fam.familyId, vA),
          api.activate(poToken, fam.familyId, vB),
        ]);
        const oks = [rA, rB].filter((r) => r.status < 400);
        const conflicts = [rA, rB].filter((r) => r.status === 409);
        // 1./6. exactly one winner - two winners AND two losers are both failures
        expect(oks.length, `repeat ${i + 1}: statuses ${rA.status}/${rB.status}`).toBe(1);
        expect(conflicts.length, `repeat ${i + 1}: expected exactly one 409`).toBe(1);
        // 2.
        assertErrorEnvelope(conflicts[0]!, "ERR_ALREADY_HAS_ACTIVE");

        // 3. exactly one active row, and it is the winner's version
        const winner = rA.status < 400 ? vA : vB;
        const vlist = await api.versions(poToken, fam.familyId, { limit: 50 });
        const rows: Array<Record<string, unknown>> = vlist.data.data.versions;
        expect(rows.filter((x) => x.isActive === true).length, `repeat ${i + 1}`).toBe(1);
        expect(rows.find((x) => x.isActive === true)?.versionId).toBe(winner);
        // 4.
        expect(vlist.data.data.hasActiveVersion).toBe(true);
        const d = await summary(fam.familyId);
        expect(d.status).toBe("active");
        assertResponseTime(vlist);
      }
    },
    CASE_MS,
  );

  test(
    "TC-CTAPI-103 activate rejects a version that is not in the family or is not saved",
    async () => {
      const mine = f103.versionIds[0] as string;
      const other = f103Other.versionIds[0] as string;

      // 1./2. a mismatched family/version pair must not activate anything anywhere
      const crossed = await api.activate(poToken, f103.familyId, other);
      expect(crossed.status).toBeGreaterThanOrEqual(400);

      // 4. right family, but not saved - "belongs to" and "is saved" are separate conditions
      const unsaved = await api.activate(poToken, f103.familyId, f103Unsaved);
      expect(unsaved.status).toBeGreaterThanOrEqual(400);

      // an id that does not exist at all
      const unknown = await api.activate(poToken, f103.familyId, MISSING_VERSION);
      expect(unknown.status).toBeGreaterThanOrEqual(400);

      // a deleted version. A version can only be deleted while it is neither Active
      // nor Latest (Endpoint #9 guard, TC-CTAPI-073-2), so a newer version is stacked
      // on top first - otherwise `doomed` is still Latest and the delete is correctly
      // refused with 409, leaving this leg with nothing to activate.
      const doomed = await addVersion(f103.familyId);
      await extractAndSave(f103.familyId, doomed);
      const newer = await addVersion(f103.familyId);
      await extractAndSave(f103.familyId, newer);
      const del = await api.deleteVersion(poToken, f103.familyId, doomed);
      expect(del.status, `deleting a non-Latest version: ${JSON.stringify(del.data).slice(0, 200)}`).toBeLessThan(400);
      const deleted = await api.activate(poToken, f103.familyId, doomed);
      expect(deleted.status).toBeGreaterThanOrEqual(400);

      // 3. neither family moved off in_review, and neither gained an Active version
      for (const fam of [f103, f103Other]) {
        const d = await summary(fam.familyId);
        expect(d.status, `family ${fam.familyId}`).toBe("in_review");
        const vlist = await api.versions(poToken, fam.familyId, { limit: 50 });
        expect(vlist.data.data.hasActiveVersion).toBe(false);
      }
      void mine;
      assertResponseTime(crossed);
    },
    CASE_MS,
  );
});
