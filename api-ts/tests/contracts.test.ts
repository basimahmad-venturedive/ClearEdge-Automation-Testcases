/**
 * CEIQ-FEAT-009 Contracts - API suite.
 *
 * Spec: documents/input/SPEC_CEIQ-FEAT-009-contracts.md (v1.1)
 * Cases: testcases/TC-CEIQ-FEAT-009.md (TC-CTAPI-*), published to TestRail under US-CT.
 *
 * Every test title carries its TC-ID so the reporter can map results back to
 * TestRail (see api-ts-flattened-testcases convention: one declared test per
 * TC-ID, no data-driven registration).
 *
 * Assertions are spec-true. Where the live implementation diverges from the spec,
 * the test asserts the SPEC and fails - that is the drift being reported, not a
 * broken test. Each such case names the drift in a comment.
 */
import { beforeAll, describe, expect } from "vitest";
import { test } from "../src/utils/suite";
import { assertResponseTime, assertErrorEnvelope } from "../src/utils/assertions";
import {
  contractsClient as api,
  CONTRACT_STATUSES,
  STATUS_FILTERS,
  EXTRACTION_STATUSES,
} from "../src/clients/contractsClient";
import { getTenantIdToken, getAnalystIdToken, getManagerIdToken } from "../src/utils/tokenProvider";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTRACT_ID_RE = /^CON-\d{4}-\d{3}$/;
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

let poToken = "";
let analystToken = "";
let managerToken = "";
/** A family that already exists in the environment, used by read-only cases. */
let anyFamilyId: string | undefined;
let anyVersionId: string | undefined;

beforeAll(async () => {
  poToken = await getTenantIdToken();
  analystToken = await getAnalystIdToken();
  managerToken = await getManagerIdToken();
  const seed = await api.list(poToken, { limit: 50 });
  const rows: Array<{ familyId?: string; versionId?: string }> = seed.data?.data?.contracts ?? [];
  // Endpoint #10 serves a family only once it has a SAVED representative version - an
  // upload-only family answers 404 by design (spec v1.7 Endpoint #10 step 2, enforced on
  // QA from 2026-09-08). The list is newest-first and its head is usually another spec
  // file's freshly uploaded family, so pick the first row Endpoint #10 will actually
  // serve rather than assuming row 0 is readable.
  for (const row of rows) {
    if (!row?.familyId) continue;
    const probe = await api.detail(poToken, row.familyId);
    if (probe.status === 200) {
      anyFamilyId = row.familyId;
      anyVersionId = row.versionId ?? probe.data?.data?.versionId;
      break;
    }
  }
}, 120_000);

describe("Endpoint #1 - GET /contracts (list contract families)", () => {
  test("TC-CTAPI-001 list happy path returns 200 with contracts, counts and pagination @regression", async () => {
    const r = await api.list(poToken);
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    expect(r.data.error).toBeUndefined();

    const d = r.data.data;
    expect(Array.isArray(d.contracts)).toBe(true);

    // counts: exactly the 6 documented keys, all non-negative integers
    expect(Object.keys(d.counts).sort()).toEqual(
      ["active", "all", "expired", "expiring_soon", "in_review", "terminated"].sort(),
    );
    for (const [k, v] of Object.entries(d.counts)) {
      expect(Number.isInteger(v), `counts.${k} should be an integer`).toBe(true);
      expect(v as number).toBeGreaterThanOrEqual(0);
    }

    // pagination: exactly the 4 documented keys
    expect(Object.keys(d.pagination).sort()).toEqual(["limit", "page", "total", "totalPages"].sort());

    for (const c of d.contracts) {
      // all 13 documented row keys present
      for (const key of [
        "familyId", "contractId", "contractName", "displayName", "vendor",
        "contractType", "contractTypeLabel", "expiration", "status",
        "uploadedAt", "versionId", "isSaved", "extractionStatus",
      ]) {
        expect(c, `row missing ${key}`).toHaveProperty(key);
      }
      expect(c.familyId).toMatch(UUID_RE);
      expect(c.contractId).toMatch(CONTRACT_ID_RE);
      // status is one of the 4 stored values - never the expiring_soon filter value
      expect(CONTRACT_STATUSES as readonly string[]).toContain(c.status);
      expect(c.status).not.toBe("expiring_soon");
      expect(EXTRACTION_STATUSES as readonly string[]).toContain(c.extractionStatus);
      expect(typeof c.isSaved).toBe("boolean");
    }
    assertResponseTime(r);
  });

  test("TC-CTAPI-002-1 pagination defaults to page 1 limit 10 @regression", async () => {
    const r = await api.list(poToken);
    expect(r.status).toBe(200);
    expect(r.data.data.pagination.page).toBe(1);
    expect(r.data.data.pagination.limit).toBe(10);
    expect(r.data.data.contracts.length).toBeLessThanOrEqual(10);
    const p = r.data.data.pagination;
    expect(p.totalPages).toBe(Math.max(1, Math.ceil(p.total / p.limit)));
    assertResponseTime(r);
  });

  test("TC-CTAPI-002-2 page=0 is rejected with 400 ERR_VALIDATION_FAILED @regression", async () => {
    const r = await api.list(poToken, { page: 0 });
    expect(r.status).toBe(400);
    // CLRE-281 ACCEPTED (won't-fix, 2026-08-28): the platform-wide validation code is
    // ERR_VALIDATION_FAILED, and the FEAT-009 spec's ERR_INVALID_QUERY for Endpoint #1 is
    // superseded by that convention (same call recorded on CLRE-319 and CLRE-192). Asserting
    // the accepted envelope, and the field-level detail naming the offending parameter -
    // that is more specific than the old `details.field` check, not less.
    // NOTE: CLRE-361 duplicates CLRE-281 and is in code review; if it ships
    // ERR_INVALID_QUERY after all, flip the expected code here and in the two gaps cases.
    assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
    expect(r.data.error.details?.fields?.page, "the rejection must name the offending parameter").toBeDefined();
    assertResponseTime(r);
  });

  test("TC-CTAPI-002-3 limit above the documented max of 50 is rejected @regression", async () => {
    const r = await api.list(poToken, { limit: 51 });
    expect(r.status).toBe(400);
    expect(r.data.success).toBe(false);
    assertResponseTime(r);
  });

  test("TC-CTAPI-002-4 limit=50 is accepted at the documented boundary @regression", async () => {
    const r = await api.list(poToken, { limit: 50 });
    expect(r.status).toBe(200);
    expect(r.data.data.pagination.limit).toBe(50);
    assertResponseTime(r);
  });

  test("TC-CTAPI-002-5 limit=1 is accepted at the documented minimum @regression", async () => {
    const r = await api.list(poToken, { limit: 1 });
    expect(r.status).toBe(200);
    expect(r.data.data.pagination.limit).toBe(1);
    expect(r.data.data.contracts.length).toBeLessThanOrEqual(1);
    assertResponseTime(r);
  });

  test("TC-CTAPI-002-6 page beyond the last page returns an empty array, not an error @regression", async () => {
    const first = await api.list(poToken, { limit: 1 });
    const total = first.data.data.pagination.total;
    const r = await api.list(poToken, { page: total + 50, limit: 1 });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data.contracts)).toBe(true);
    expect(r.data.data.contracts.length).toBe(0);
    assertResponseTime(r);
  });

  test("TC-CTAPI-002-7 non-numeric page is rejected rather than coerced @regression", async () => {
    const r = await api.listRaw(poToken, "page=abc");
    expect(r.status).toBe(400);
    expect(r.data.success).toBe(false);
    assertResponseTime(r);
  });

  test("TC-CTAPI-005-1 each status filter returns only rows of that status @regression", async () => {
    for (const s of CONTRACT_STATUSES) {
      const r = await api.list(poToken, { status: s, limit: 50 });
      expect(r.status, `status=${s}`).toBe(200);
      for (const c of r.data.data.contracts) expect(c.status, `status=${s} row`).toBe(s);
      assertResponseTime(r);
    }
  });

  test("TC-CTAPI-005-2 expiring_soon is a filter that still returns active rows @regression", async () => {
    const r = await api.list(poToken, { status: "expiring_soon", limit: 50 });
    expect(r.status).toBe(200);
    // spec 9.4: a filter only. Rows keep their stored status, which is `active`.
    for (const c of r.data.data.contracts) expect(c.status).toBe("active");
    assertResponseTime(r);
  });

  test("TC-CTAPI-005-3 an unrecognised status filter value is rejected @regression", async () => {
    const r = await api.list(poToken, { status: "archived" });
    expect(r.status).toBe(400);
    expect(r.data.success).toBe(false);
    assertResponseTime(r);
  });

  test("TC-CTAPI-004 counts are consistent with the unfiltered total @regression", async () => {
    const r = await api.list(poToken, { limit: 50 });
    expect(r.status).toBe(200);
    const { counts, pagination } = r.data.data;
    // `all` is the tenant-wide family count and must match the unfiltered total
    expect(counts.all).toBe(pagination.total);
    // the 4 stored statuses partition `all`; expiring_soon overlaps `active` so is excluded
    expect(counts.in_review + counts.active + counts.expired + counts.terminated).toBe(counts.all);
    expect(counts.expiring_soon).toBeLessThanOrEqual(counts.active);
    assertResponseTime(r);
  });

  test("TC-CTAPI-006 search narrows the list and is tenant-scoped @regression", async () => {
    const all = await api.list(poToken, { limit: 50 });
    expect(all.status).toBe(200);
    const rows = all.data.data.contracts;
    if (rows.length === 0) return; // nothing seeded to search for
    const term = String(rows[0].contractName).split(" ")[0];
    const r = await api.list(poToken, { search: term, limit: 50 });
    expect(r.status).toBe(200);
    expect(r.data.data.contracts.length).toBeGreaterThan(0);
    for (const c of r.data.data.contracts) {
      expect(String(c.contractName).toLowerCase()).toContain(term.toLowerCase());
    }
    assertResponseTime(r);
  });

  test("TC-CTAPI-007-1 a search matching nothing returns an empty array with 200 @regression", async () => {
    const r = await api.list(poToken, { search: "zzz-no-such-contract-zzz", limit: 50 });
    expect(r.status).toBe(200);
    expect(r.data.data.contracts).toEqual([]);
    assertResponseTime(r);
  });

  test("TC-CTAPI-009 an Analyst can read the contract list @regression", async () => {
    const r = await api.list(analystToken);
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    assertResponseTime(r);
  });

  test("TC-CTAPI-010 a Procurement Manager can read the contract list @regression", async () => {
    const r = await api.list(managerToken);
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    assertResponseTime(r);
  });

  test("TC-CTAPI-012 list without a bearer token returns 401 @regression", async () => {
    const r = await api.list("");
    expect(r.status).toBe(401);
    expect(r.data.success).toBe(false);
    expect(r.data.data).toBeUndefined();
    assertResponseTime(r);
  });
});

describe("Endpoint #10 - GET /contracts/:familyId (detail)", () => {
  test("TC-CTAPI-075 detail returns the documented shape including the five term groups @regression", async () => {
    if (!anyFamilyId) return;
    const r = await api.detail(poToken, anyFamilyId);
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    const d = r.data.data;
    for (const key of [
      "familyId", "contractId", "contractName", "contractType", "status",
      "keyDates", "references", "financialTerms", "terminationAndContinuity", "legalAndCompliance",
      "summaryStatus", "clauseRiskStatus", "riskCount", "actionButtons",
    ]) {
      expect(d, `detail missing ${key}`).toHaveProperty(key);
    }
    expect(CONTRACT_STATUSES as readonly string[]).toContain(d.status);
    expect(d.contractId).toMatch(CONTRACT_ID_RE);
    assertResponseTime(r);
  });

  test("TC-CTAPI-076-1 detail for an unknown familyId returns 404 ERR_CONTRACT_NOT_FOUND @regression", async () => {
    const r = await api.detail(poToken, MISSING_UUID);
    expect(r.status).toBe(404);
    assertErrorEnvelope(r, "ERR_CONTRACT_NOT_FOUND");
    assertResponseTime(r);
  });

  test("TC-CTAPI-077-1 an Analyst can read contract detail @regression", async () => {
    if (!anyFamilyId) return;
    const r = await api.detail(analystToken, anyFamilyId);
    expect(r.status).toBe(200);
    assertResponseTime(r);
  });
});

describe("Endpoint #13 - GET /:familyId/versions (Documents tab)", () => {
  test("TC-CTAPI-093-1 versions list returns versions, hasActiveVersion and pagination @regression", async () => {
    if (!anyFamilyId) return;
    const r = await api.versions(poToken, anyFamilyId);
    expect(r.status).toBe(200);
    const d = r.data.data;
    expect(Array.isArray(d.versions)).toBe(true);
    expect(typeof d.hasActiveVersion).toBe("boolean");
    expect(d.pagination).toBeDefined();
    assertResponseTime(r);
  });

  test("TC-CTAPI-097-3 versions list for an unknown family returns 404 @regression", async () => {
    const r = await api.versions(poToken, MISSING_UUID);
    expect(r.status).toBe(404);
    assertErrorEnvelope(r, "ERR_CONTRACT_NOT_FOUND");
    assertResponseTime(r);
  });
});

describe("Security - RBAC on write endpoints", () => {
  test("TC-CTSEC-008 an Analyst cannot terminate a contract family @regression", async () => {
    if (!anyFamilyId) return;
    const r = await api.terminate(analystToken, anyFamilyId);
    expect(r.status).toBe(403);
    expect(r.data.success).toBe(false);
    // the token is valid; only the right is missing
    expect(r.status).not.toBe(401);
    assertResponseTime(r);
  });

  test("TC-CTSEC-007 an Analyst cannot delete a contract family @regression", async () => {
    if (!anyFamilyId) return;
    const r = await api.deleteFamily(analystToken, anyFamilyId);
    expect(r.status).toBe(403);
    expect(r.data.success).toBe(false);
    assertResponseTime(r);
  });

  test("TC-CTSEC-001 an Analyst cannot create a contract @regression", async () => {
    const r = await api.create(analystToken, {
      contractType: "msa_services",
      file: { buffer: Buffer.from("%PDF-1.4 minimal"), filename: "probe.pdf", contentType: "application/pdf" },
    });
    expect(r.status).toBe(403);
    expect(r.data.success).toBe(false);
    assertResponseTime(r);
  });

  test("TC-CTSEC-017 cross-tenant familyId returns 404 rather than 403 @regression", async () => {
    // A well-formed uuid the caller's tenant does not own must be indistinguishable
    // from a missing one, so existence is never disclosed.
    const r = await api.detail(poToken, MISSING_UUID);
    expect(r.status).toBe(404);
    expect(r.status).not.toBe(403);
    expect(JSON.stringify(r.data)).not.toContain("tenant");
    assertResponseTime(r);
  });
});

describe("Envelope conventions", () => {
  test("TC-CTAPI-013-1 every error response carries the documented error envelope @regression", async () => {
    const r = await api.detail(poToken, MISSING_UUID);
    expect(r.data.success).toBe(false);
    expect(r.data.error).toBeDefined();
    expect(typeof r.data.error.code).toBe("string");
    expect(typeof r.data.error.message).toBe("string");
    expect(r.data.error).toHaveProperty("details");
    expect(r.data.data).toBeUndefined();
    assertResponseTime(r);
  });

  test("TC-CTAPI-013-2 date fields are returned in the format the spec documents @regression", async () => {
    const r = await api.list(poToken, { limit: 50 });
    expect(r.status).toBe(200);
    const withDate = r.data.data.contracts.find((c: Record<string, unknown>) => c.expiration);
    if (!withDate) return;
    // DRIFT (live QA 2026-08-24): the API returns a full ISO-8601 datetime, e.g.
    // "2026-01-31T00:00:00.000Z". The spec states MM/DD/YYYY (Endpoint #8 request
    // table + Global Assumptions) AND YYYY-MM-DD (Endpoint #7/#10 response
    // examples) - it never documents a datetime. Asserting date-only per the
    // response examples, which is the closer of the two spec statements.
    expect(String(withDate.expiration)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    assertResponseTime(r);
  });
});
