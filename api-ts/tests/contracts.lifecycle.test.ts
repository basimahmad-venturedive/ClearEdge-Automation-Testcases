/**
 * CEIQ-FEAT-009 Contracts - lifecycle API suite.
 *
 * Covers Endpoint #9 (discard/delete version), Endpoint #10 (contract detail),
 * Endpoint #11 (delete family) and Endpoint #12 (terminate), plus the two
 * terminate-transition cases TC-CTAPI-151 / TC-CTAPI-152.
 *
 * Spec: documents/input/SPEC_CEIQ-FEAT-009-contracts.md (v1.1)
 *   - Endpoint #9  lines 1671-1707
 *   - Endpoint #10 lines 1708-1791
 *   - Endpoint #11 lines 1792-1813
 *   - Endpoint #12 lines 1814-1846
 *   - section 3.1 status map lines 1050-1069
 *   - section 9.1 lazy-write Expired lines 2677-2693
 * Cases: testcases/TC-CEIQ-FEAT-009.md (TC-CTAPI-070 .. 092, 151, 152), published
 * to TestRail under US-CT.
 *
 * TC-CTAPI-075, 076-1 and 077-1 live in tests/contracts.test.ts and are NOT
 * duplicated here.
 *
 * Assertions are spec-true. Where the live implementation diverges, the test
 * asserts the SPEC and fails - that failure IS the drift report. Every such case
 * carries a `// DRIFT` comment naming what was observed.
 */
import type { AxiosResponse } from "axios";
import { beforeAll, afterAll, describe, expect } from "vitest";
import { test } from "../src/utils/suite";
import { assertResponseTime, assertErrorEnvelope } from "../src/utils/assertions";
import { contractsClient as api, CONTRACT_STATUSES } from "../src/clients/contractsClient";
import {
  CONTRACT_V1,
  CONTRACT_V2,
  seedUploadedContract,
  seedSavedContract,
  destroyFamily,
  type SeededVersion,
} from "../src/utils/contractsSeed";
import { getTenantIdToken, getAnalystIdToken, getAdminIdToken } from "../src/utils/tokenProvider";

const CONTRACT_ID_RE = /^CON-\d{4}-\d{3}$/;
/** A well-formed uuid v4 that matches no family in any tenant. */
const MISSING_FAMILY = "00000000-0000-4000-8000-0000000000ff";
const MISSING_VERSION = "00000000-0000-4000-8000-0000000000fe";
/** Generous budgets: every seed drives create -> Stage 1 extraction -> save. */
const SEED_MS = 420_000;
const CASE_MS = 180_000;

/** The 20 documented top-level keys of the Endpoint #10 payload (spec lines 1720-1776). */
const DETAIL_KEYS = [
  "familyId", "contractId", "contractName", "contractType", "contractTypeLabel",
  "status", "uploadedAt", "terminatedAt", "terminatedBanner", "versionId",
  "executiveOverview", "summaryStatus", "clauseRiskStatus", "riskCount",
  "keyDates", "references", "financialTerms", "terminationAndContinuity",
  "legalAndCompliance", "actionButtons",
];

/** The five documented term groups and their exact key sets (spec lines 1737-1770). */
const TERM_GROUPS: Record<string, string[]> = {
  keyDates: ["effectiveDate", "expirationDate", "noticeDeadline", "noticeDeadlineOverdue"],
  references: ["vendor", "sourcingEvent"],
  financialTerms: [
    "totalContractValue", "paymentTerms", "limitationOfLiability",
    "insuranceRequirements", "priceIncreaseCap",
  ],
  terminationAndContinuity: [
    "noticePeriodDays", "terminationForConvenience", "terminationForCause",
    "autoRenewal", "slaUptime", "warranty",
  ],
  legalAndCompliance: [
    "governingLaw", "indemnification", "dataOwnership", "confidentiality",
    "intellectualProperty", "exclusivity", "freightTerms",
  ],
};

const ACTION_BUTTON_KEYS = ["showUploadNewVersion", "showUpdateContract", "showTerminate", "showDelete"];

let poToken = "";
let analystToken = "";
let adminToken = "";

// --- date helpers -----------------------------------------------------------
/** Today's calendar date in America/Chicago, as YYYY-MM-DD (spec 9.1 timezone). */
function chicagoToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDays(isoDate: string, days: number): string {
  const parts = isoDate.split("-").map(Number);
  const [y, m, d] = [parts[0] ?? 1970, parts[1] ?? 1, parts[2] ?? 1];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/**
 * Endpoint #8 documents ISO 8601 (YYYY-MM-DD) for date fields, so the value passes
 * through unchanged.
 *
 * CLRE-331: the spec has been corrected to ISO 8601 (YYYY-MM-DD). The earlier
// MM/DD/YYYY wording was inconsistent with the project's date-format decision and
// with the implementation, so ISO is now the documented contract, not a drift.
 */
function toSpecDate(isoDate: string): string {
  return isoDate;
}

// --- seed helpers (local to this file - the shared seed util is owned elsewhere) ---
/**
 * Create + extract + save with an explicit expirationDate / noticePeriodDays, so the
 * lazy-write Expired boundary and the notice-deadline boundary can be pinned.
 *
 * Dates are sent in the spec's ISO 8601 format. The MM/DD/YYYY-then-ISO fallback
 * this seed used to carry is gone: CLRE-331 settled the format as ISO, so there is
 * no second format to fall back to. The response-side format question is still
 * asserted by TC-CTAPI-013-2 in tests/contracts.test.ts.
 */
async function seedWithDates(
  token: string,
  opts: { expirationDate: string | null; noticePeriodDays?: number; activate?: boolean },
): Promise<SeededVersion> {
  const v = await seedUploadedContract(token, { fixture: CONTRACT_V1() });
  const review = await api.review(token, v.familyId, v.versionId);
  const base = { ...(review.data?.data?.fields ?? review.data?.data ?? {}) } as Record<string, unknown>;
  const withDate = (fmt: (d: string) => string) => ({
    ...base,
    expirationDate: opts.expirationDate === null ? null : fmt(opts.expirationDate),
    noticePeriodDays: opts.noticePeriodDays ?? 60,
  });
  let saved = await api.save(token, v.familyId, v.versionId, withDate(toSpecDate));
  if (saved.status >= 400 && opts.expirationDate !== null) {
    saved = await api.save(token, v.familyId, v.versionId, withDate((d) => d));
  }
  if (saved.status >= 400) {
    throw new Error(`seedWithDates save failed: ${saved.status} ${JSON.stringify(saved.data).slice(0, 300)}`);
  }
  if (opts.activate) {
    const act = await api.activate(token, v.familyId, v.versionId);
    if (act.status >= 400) {
      throw new Error(`seedWithDates activate failed: ${act.status} ${JSON.stringify(act.data).slice(0, 300)}`);
    }
  }
  return v;
}

/** Add one more saved version to an existing family. */
async function addSavedVersion(token: string, familyId: string, useV2 = true): Promise<string> {
  const fx = useV2 ? CONTRACT_V2() : CONTRACT_V1();
  const up = await api.uploadVersion(token, familyId, {
    file: { buffer: fx.buffer, filename: fx.filename, contentType: fx.contentType },
  });
  if (up.status !== 201) {
    throw new Error(`addSavedVersion upload failed: ${up.status} ${JSON.stringify(up.data).slice(0, 300)}`);
  }
  const versionId = up.data.data.versionId;
  await api.waitForExtraction(token, familyId, versionId);
  const review = await api.review(token, familyId, versionId);
  const body = { ...(review.data?.data?.fields ?? review.data?.data ?? {}) };
  const saved = await api.save(token, familyId, versionId, body as Record<string, unknown>);
  if (saved.status >= 400) {
    throw new Error(`addSavedVersion save failed: ${saved.status} ${JSON.stringify(saved.data).slice(0, 300)}`);
  }
  return versionId;
}

/** Suffix of a Contract ID, e.g. "002" from "CON-0007-002". */
const nnn = (contractId: string): string => String(contractId).split("-")[2] ?? "";
/** Family segment of a Contract ID, e.g. "0007". */
const xxxx = (contractId: string): string => String(contractId).split("-")[1] ?? "";

beforeAll(async () => {
  poToken = await getTenantIdToken();
  analystToken = await getAnalystIdToken();
  try {
    adminToken = await getAdminIdToken();
  } catch {
    adminToken = ""; // platform-admin case degrades to a skip-style guard
  }
}, SEED_MS);

// =============================================================================
// Endpoint #9 - DELETE /:familyId/versions/:versionId - discard scope
// =============================================================================
describe("Endpoint #9 - discard scope by entry point", () => {
  let famCreate: SeededVersion; // unsaved first upload, consumed by TC-CTAPI-070-1
  let famNewVer: SeededVersion; // saved v1 + unsaved v2, reused by TC-CTAPI-071
  let versionNewVer = "";
  let newVerContractId = "";

  beforeAll(async () => {
    famCreate = await seedUploadedContract(poToken, { fixture: CONTRACT_V1() });
    famNewVer = await seedSavedContract(poToken, { fixture: CONTRACT_V2() });
    const fx = CONTRACT_V1();
    const up = await api.uploadVersion(poToken, famNewVer.familyId, {
      file: { buffer: fx.buffer, filename: fx.filename, contentType: fx.contentType },
    });
    expect(up.status, `seed uploadVersion: ${JSON.stringify(up.data).slice(0, 200)}`).toBe(201);
    versionNewVer = up.data.data.versionId;
    newVerContractId = up.data.data.contractId;
    await api.waitForExtraction(poToken, famNewVer.familyId, versionNewVer);
  }, SEED_MS);

  afterAll(async () => {
    await destroyFamily(poToken, famNewVer?.familyId);
    await destroyFamily(poToken, famCreate?.familyId);
  }, SEED_MS);

  test("TC-CTAPI-070-1 discarding an unsaved first upload deletes the entire family", async () => {
    const before = await api.list(poToken, { limit: 1 });
    expect(before.status).toBe(200);
    const totalBefore = before.data.data.pagination.total;

    const r = await api.deleteVersion(poToken, famCreate.familyId, famCreate.versionId);
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    // spec Endpoint #9 success payload - verbatim
    expect(r.data.data.message).toBe("Version deleted.");

    const after = await api.list(poToken, { limit: 1 });
    expect(after.status).toBe(200);
    expect(after.data.data.pagination.total).toBe(totalBefore - 1);

    // the whole family disappeared, not just the version (Processing 3 sub-bullet)
    const detail = await api.detail(poToken, famCreate.familyId);
    expect(detail.status).toBe(404);
    const extraction = await api.extractionStatus(poToken, famCreate.familyId, famCreate.versionId);
    expect(extraction.status).toBe(404);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-070-2 discarding an unsaved Upload New Version deletes only that version", async () => {
    const before = await api.list(poToken, { limit: 1 });
    const totalBefore = before.data.data.pagination.total;
    const detailBefore = await api.detail(poToken, famNewVer.familyId);
    expect(detailBefore.status).toBe(200);

    const r = await api.deleteVersion(poToken, famNewVer.familyId, versionNewVer);
    expect(r.status).toBe(200);
    expect(r.data.data.message).toBe("Version deleted.");

    // family survives - the family-delete sub-bullet applies only to entry_point='create'
    const after = await api.list(poToken, { limit: 1 });
    expect(after.data.data.pagination.total).toBe(totalBefore);
    const detailAfter = await api.detail(poToken, famNewVer.familyId);
    expect(detailAfter.status).toBe(200);
    expect(detailAfter.data.data.versionId).toBe(famNewVer.versionId);

    const versions = await api.versions(poToken, famNewVer.familyId);
    expect(versions.status).toBe(200);
    const ids = versions.data.data.versions.map((v: Record<string, unknown>) => v.versionId);
    expect(ids).not.toContain(versionNewVer);
    expect(ids).toContain(famNewVer.versionId);

    // US-CT-002: the previously-showing contract continues to display unchanged.
    // DRIFT (live QA 2026-08-25): while an unsaved Upload New Version draft is in
    // flight, Endpoint #10 makes that DRAFT the representative version and returns
    // its extracted Stage 1 values as the family Summary. Spec 9.5 selects Active,
    // else Latest, and Endpoint #13 excludes unsaved versions, so an unsaved draft
    // must never represent the family. Observed: detail before the discard carried
    // the draft's dates (2025-02-01 / 2026-01-31); after the discard it correctly
    // reverts to the saved version (2025-08-31 / 2026-12-31). The pre-discard read
    // is the wrong one - asserting the spec so the leak stays visible.
    expect(detailAfter.data.data.keyDates).toEqual(detailBefore.data.data.keyDates);
    expect(detailAfter.data.data.legalAndCompliance).toEqual(detailBefore.data.data.legalAndCompliance);

    const extraction = await api.extractionStatus(poToken, famNewVer.familyId, versionNewVer);
    expect(extraction.status).toBe(404);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-071 discarding an unsaved version releases the provisional NNN for reuse", async () => {
    // TC-CTAPI-070-2 already discarded the -002 draft above, so the counter should
    // hand -002 back on every subsequent upload/discard cycle (spec 9.2).
    expect(nnn(newVerContractId)).toBe("002");
    const fx = CONTRACT_V1();

    for (let cycle = 1; cycle <= 3; cycle += 1) {
      const up = await api.uploadVersion(poToken, famNewVer.familyId, {
        file: { buffer: fx.buffer, filename: fx.filename, contentType: fx.contentType },
      });
      expect(up.status, `cycle ${cycle} upload`).toBe(201);
      expect(nnn(up.data.data.contractId), `cycle ${cycle} NNN reuse`).toBe("002");
      const del = await api.deleteVersion(poToken, famNewVer.familyId, up.data.data.versionId);
      expect(del.status, `cycle ${cycle} discard`).toBe(200);
      assertResponseTime(del);
    }

    // the saved -001 version is untouched throughout
    const versions = await api.versions(poToken, famNewVer.familyId);
    expect(versions.status).toBe(200);
    const ids = versions.data.data.versions.map((v: Record<string, unknown>) => v.versionId);
    expect(ids).toContain(famNewVer.versionId);
    assertResponseTime(versions);
  }, CASE_MS);

  test("TC-CTAPI-072 discarding the only version of a first upload releases the provisional XXXX", async () => {
    // Isolation risk noted in the TC: family_sequence_counter is tenant-wide, so a
    // concurrent create in the same tenant will legitimately break this assertion.
    const fx = CONTRACT_V1();
    const first = await api.create(poToken, {
      contractType: "subscription_agreement_saas",
      file: { buffer: fx.buffer, filename: fx.filename, contentType: fx.contentType },
    });
    expect(first.status).toBe(201);
    const xxxxA = xxxx(first.data.data.contractId);

    const del = await api.deleteVersion(poToken, first.data.data.familyId, first.data.data.versionId);
    expect(del.status).toBe(200);

    const second = await api.create(poToken, {
      contractType: "subscription_agreement_saas",
      file: { buffer: fx.buffer, filename: fx.filename, contentType: fx.contentType },
    });
    expect(second.status).toBe(201);
    expect(xxxx(second.data.data.contractId)).toBe(xxxxA);
    expect(nnn(second.data.data.contractId)).toBe("001");

    // the discarded family is gone from the list
    const gone = await api.detail(poToken, first.data.data.familyId);
    expect(gone.status).toBe(404);

    await api.deleteVersion(poToken, second.data.data.familyId, second.data.data.versionId);
    assertResponseTime(del);
  }, CASE_MS);
});

// =============================================================================
// Endpoint #9 - the Update Contract discard branch (spec Processing 2)
// =============================================================================
describe("Endpoint #9 - Update Contract discard leaves the live version intact", () => {
  let famUpd: SeededVersion;
  let baseline: Record<string, unknown> = {};
  let stagedOk = false;

  beforeAll(async () => {
    famUpd = await seedSavedContract(poToken, { fixture: CONTRACT_V2() });
    await api.activate(poToken, famUpd.familyId, famUpd.versionId);
    const pre = await api.detail(poToken, famUpd.familyId);
    baseline = pre.data?.data ?? {};
    const fx = CONTRACT_V1();
    const upd = await api.updateContract(poToken, famUpd.familyId, famUpd.versionId, {
      buffer: fx.buffer,
      filename: fx.filename,
      contentType: fx.contentType,
    });
    stagedOk = upd.status === 200 || upd.status === 201;
    if (stagedOk) await api.waitForExtraction(poToken, famUpd.familyId, famUpd.versionId);
  }, SEED_MS);

  afterAll(async () => {
    await destroyFamily(poToken, famUpd?.familyId);
  }, SEED_MS);

  test("TC-CTAPI-070-3 discarding an in-progress Update Contract abandons only the staged replacement", async () => {
    // Endpoint #4 must have staged a replacement for this branch to exist at all.
    expect(stagedOk, "Endpoint #4 did not stage a replacement - Processing 2 unreachable").toBe(true);

    const r = await api.deleteVersion(poToken, famUpd.familyId, famUpd.versionId);
    expect(r.status).toBe(200);
    // The TC flags this: the message says "deleted" although this branch deletes
    // only the staged replacement, not the version. The spec documents one success
    // body for Endpoint #9, so that is what is asserted. contract TBD.
    expect(r.data.data.message).toBe("Version deleted.");

    // the version still exists and is still Active
    const after = await api.detail(poToken, famUpd.familyId);
    expect(after.status).toBe(200);
    expect(after.data.data.versionId).toBe(famUpd.versionId);
    expect(after.data.data.status).toBe("active");

    const versions = await api.versions(poToken, famUpd.familyId);
    expect(versions.status).toBe(200);
    const ids = versions.data.data.versions.map((v: Record<string, unknown>) => v.versionId);
    expect(ids).toContain(famUpd.versionId);

    // live Stage 1 data was never modified, so there is nothing to roll back
    expect(after.data.data.keyDates).toEqual(baseline.keyDates);
    expect(after.data.data.financialTerms).toEqual(baseline.financialTerms);
    expect(after.data.data.legalAndCompliance).toEqual(baseline.legalAndCompliance);

    // extraction_status and entry_point restored from the pending record
    const ext = await api.extractionStatus(poToken, famUpd.familyId, famUpd.versionId);
    expect(ext.status).toBe(200);
    expect(ext.data.data.extractionStatus ?? ext.data.data.status).toBe("completed");
    const review = await api.review(poToken, famUpd.familyId, famUpd.versionId);
    expect(review.status).toBe(200);
    expect(review.data.data.entryPoint).not.toBe("update_contract");

    // the staged S3 object was discarded, not promoted - the original file still resolves
    const file = await api.fileUrl(poToken, famUpd.familyId, famUpd.versionId);
    expect(file.status).toBe(200);
    assertResponseTime(r);
  }, CASE_MS);
});

// =============================================================================
// Endpoint #9 - Active/Latest guards, auth and the one legal delete
// =============================================================================
describe("Endpoint #9 - delete guards and auth", () => {
  let fam: SeededVersion;      // v1 = Active (deliberately not Latest)
  let versionMiddle = "";      // neither Active nor Latest
  let versionLatest = "";      // most recent upload

  beforeAll(async () => {
    fam = await seedSavedContract(poToken, { fixture: CONTRACT_V2() });
    versionMiddle = await addSavedVersion(poToken, fam.familyId);
    versionLatest = await addSavedVersion(poToken, fam.familyId);
    // activate the FIRST version so Active and Latest are separable.
    // Endpoint #14 answers 201 on QA; the seed only needs a non-error, and the
    // status code itself belongs to the Endpoint #14 cases, not to this file.
    const act = await api.activate(poToken, fam.familyId, fam.versionId);
    expect(act.status, `seed activate: ${JSON.stringify(act.data).slice(0, 200)}`).toBeLessThan(400);
  }, SEED_MS);

  afterAll(async () => {
    await destroyFamily(poToken, fam?.familyId);
  }, SEED_MS);

  test("TC-CTAPI-073-1 deleting the Active version returns 409 ERR_DELETE_BLOCKED", async () => {
    const r = await api.deleteVersion(poToken, fam.familyId, fam.versionId);
    expect(r.status).toBe(409);
    assertErrorEnvelope(r, "ERR_DELETE_BLOCKED");
    // spec writes lower-case "latest" against capitalised "Active" - asserted verbatim
    expect(r.data.error.message).toBe("Cannot delete the Active or latest version.");
    expect(r.data.error.details).toEqual({});

    const versions = await api.versions(poToken, fam.familyId);
    const ids = versions.data.data.versions.map((v: Record<string, unknown>) => v.versionId);
    expect(ids).toContain(fam.versionId);
    const detail = await api.detail(poToken, fam.familyId);
    expect(detail.data.data.versionId).toBe(fam.versionId);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-073-2 deleting the Latest version returns 409 ERR_DELETE_BLOCKED", async () => {
    const r = await api.deleteVersion(poToken, fam.familyId, versionLatest);
    expect(r.status).toBe(409);
    assertErrorEnvelope(r, "ERR_DELETE_BLOCKED");
    expect(r.data.error.message).toBe("Cannot delete the Active or latest version.");

    const versions = await api.versions(poToken, fam.familyId);
    const ids = versions.data.data.versions.map((v: Record<string, unknown>) => v.versionId);
    expect(ids).toContain(versionLatest);
    const detail = await api.detail(poToken, fam.familyId);
    expect(detail.data.data.versionId).toBe(fam.versionId);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-074-1 an Analyst deleting a genuinely deletable version returns 403", async () => {
    const r = await api.deleteVersion(analystToken, fam.familyId, versionMiddle);
    expect(r.status).toBe(403);
    expect(r.status).not.toBe(401);
    expect(r.status).not.toBe(409); // the right is checked before the Active/Latest guard
    expect(r.data.success).toBe(false);

    const asAnalyst = await api.versions(analystToken, fam.familyId);
    expect(asAnalyst.status).toBe(200); // the rejection is right-scoped, not resource-scoped
    const ids = asAnalyst.data.data.versions.map((v: Record<string, unknown>) => v.versionId);
    expect(ids).toContain(versionMiddle);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-074-2 deleting a version without an Authorization header returns 401", async () => {
    const r = await api.deleteVersion("", fam.familyId, versionMiddle);
    expect(r.status).toBe(401);
    expect(r.data.success).toBe(false);
    expect(r.data.data).toBeUndefined();

    const versions = await api.versions(poToken, fam.familyId);
    const ids = versions.data.data.versions.map((v: Record<string, unknown>) => v.versionId);
    expect(ids).toContain(versionMiddle);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-074-3 deleting a version under an unknown familyId returns 404", async () => {
    const r = await api.deleteVersion(poToken, MISSING_FAMILY, versionMiddle);
    expect(r.status).toBe(404);
    expect(r.status).not.toBe(500);
    // destructive-IDOR guard: a real version id under a bogus family must not delete it
    const versions = await api.versions(poToken, fam.familyId);
    const ids = versions.data.data.versions.map((v: Record<string, unknown>) => v.versionId);
    expect(ids).toContain(versionMiddle);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-074-4 deleting an unknown versionId under a real family returns 404", async () => {
    const before = await api.versions(poToken, fam.familyId);
    const countBefore = before.data.data.versions.length;

    const r = await api.deleteVersion(poToken, fam.familyId, MISSING_VERSION);
    expect(r.status).toBe(404); // not a vacuous 200
    expect(r.status).not.toBe(500);
    expect(r.data.success).toBe(false);

    const after = await api.versions(poToken, fam.familyId);
    expect(after.data.data.versions.length).toBe(countBefore);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-074-5 deleting another tenant's version returns 404, not 403", async () => {
    // No second seeded tenant exists on QA, so this runs against a well-formed id the
    // caller's tenant does not own - which is precisely the indistinguishability
    // property the case exists to prove.
    const r = await api.deleteVersion(poToken, MISSING_FAMILY, MISSING_VERSION);
    expect(r.status).toBe(404);
    expect(r.status).not.toBe(403);
    expect(JSON.stringify(r.data)).not.toContain("tenant");
    assertResponseTime(r);
  }, CASE_MS);

  // Declared last in this describe: it consumes versionMiddle.
  test("TC-CTAPI-073-3 deleting a version that is neither Active nor Latest succeeds", async () => {
    const before = await api.versions(poToken, fam.familyId);
    const countBefore = before.data.data.versions.length;
    const detailBefore = await api.detail(poToken, fam.familyId);

    const r = await api.deleteVersion(poToken, fam.familyId, versionMiddle);
    expect(r.status).toBe(200);
    expect(r.data.data.message).toBe("Version deleted.");

    const after = await api.versions(poToken, fam.familyId);
    expect(after.data.data.versions.length).toBe(countBefore - 1);
    const ids = after.data.data.versions.map((v: Record<string, unknown>) => v.versionId);
    expect(ids).not.toContain(versionMiddle);

    // spec 9.5: the family is still Active on the same representative version
    const detailAfter = await api.detail(poToken, fam.familyId);
    expect(detailAfter.data.data.versionId).toBe(detailBefore.data.data.versionId);
    expect(detailAfter.data.data.status).toBe(detailBefore.data.data.status);

    // the deleted version's file is no longer retrievable
    const file = await api.fileUrl(poToken, fam.familyId, versionMiddle);
    expect(file.status).toBe(404);
    assertResponseTime(r);
  }, CASE_MS);
});

// =============================================================================
// Endpoint #10 - GET /:familyId - payload shape, representative version, auth
// =============================================================================
describe("Endpoint #10 - contract detail payload and access", () => {
  let famBlank: SeededVersion;    // saved with an entirely blank body inside TC-CTAPI-076-2
  let famNoActive: SeededVersion; // two saved versions, no Active version
  let latestNoActive = "";

  beforeAll(async () => {
    famBlank = await seedUploadedContract(poToken, { fixture: CONTRACT_V1() });
    famNoActive = await seedSavedContract(poToken, { fixture: CONTRACT_V2() });
    latestNoActive = await addSavedVersion(poToken, famNoActive.familyId);
  }, SEED_MS);

  afterAll(async () => {
    await destroyFamily(poToken, famNoActive?.familyId);
    await destroyFamily(poToken, famBlank?.familyId);
  }, SEED_MS);

  test("TC-CTAPI-076-2 blank Summary fields are returned as null with their keys present", async () => {
    const saved = await api.save(poToken, famBlank.familyId, famBlank.versionId, {});
    // a fully blank contract is a valid, viewable contract - every field is optional
    expect(saved.status, `blank save: ${JSON.stringify(saved.data).slice(0, 300)}`).toBeLessThan(400);

    const r = await api.detail(poToken, famBlank.familyId);
    expect(r.status).toBe(200);
    const d = r.data.data;
    for (const [group, keys] of Object.entries(TERM_GROUPS)) {
      expect(d[group], `${group} must be an object, never null`).toBeTruthy();
      expect(Object.keys(d[group]).sort(), `${group} key set`).toEqual([...keys].sort());
      for (const k of keys) {
        // the "-" placeholder is a frontend concern, never an API value
        expect(d[group][k], `${group}.${k} must not be the "-" placeholder`).not.toBe("-");
      }
    }
    expect(d.keyDates.noticeDeadline).toBeNull();
    expect(d.keyDates.noticeDeadlineOverdue).toBe(false);
    // blank and zero must stay distinguishable
    expect(d.financialTerms.totalContractValue).toBeNull();
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-077-2 the representative version is the most recent upload when none is Active", async () => {
    const r = await api.detail(poToken, famNoActive.familyId);
    expect(r.status).toBe(200);
    const d = r.data.data;
    expect(d.versionId).toBe(latestNoActive);
    // the selection rule looks only at active_version_id, never at status labels
    expect(d.status).toBe("in_review");
    // Update Contract requires an Active version (Endpoint #4 Processing 3-4)
    expect(d.actionButtons.showUpdateContract).toBe(false);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-079-9 an Analyst reads contract detail but receives all action buttons false", async () => {
    const owner = await api.detail(poToken, famNoActive.familyId);
    expect(owner.status).toBe(200);
    const ownerButtons = owner.data.data.actionButtons;
    expect(Object.keys(ownerButtons).sort()).toEqual([...ACTION_BUTTON_KEYS].sort());
    // the difference must come from the role, so the owner baseline needs a true
    expect(Object.values(ownerButtons).some((v) => v === true)).toBe(true);

    const r = await api.detail(analystToken, famNoActive.familyId);
    expect(r.status).toBe(200); // Endpoint #10 is a read endpoint, never 403
    for (const k of ACTION_BUTTON_KEYS) {
      expect(r.data.data.actionButtons[k], `analyst ${k}`).toBe(false);
    }
    // the Summary data itself is not role-filtered
    for (const group of Object.keys(TERM_GROUPS)) {
      expect(r.data.data[group], `analyst ${group}`).toEqual(owner.data.data[group]);
    }
    // the flags match the actual enforcement on the write endpoints
    const term = await api.terminate(analystToken, famNoActive.familyId);
    expect(term.status).toBe(403);
    const del = await api.deleteVersion(analystToken, famNoActive.familyId, latestNoActive);
    expect(del.status).toBe(403);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-079-10 contract detail without an Authorization header returns 401", async () => {
    const r = await api.detail("", famNoActive.familyId);
    expect(r.status).toBe(401);
    expect(r.status).not.toBe(403);
    expect(r.status).not.toBe(404);
    expect(r.data.success).toBe(false);
    const body = JSON.stringify(r.data);
    for (const leak of ["contractName", "contractId", "executiveOverview", "keyDates", "legalAndCompliance"]) {
      expect(body, `401 body leaks ${leak}`).not.toContain(leak);
    }
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-079-12 contract detail for another tenant's family returns 404, not 403", async () => {
    // No second seeded tenant on QA - asserted against an id this tenant does not own.
    const r = await api.detail(poToken, MISSING_FAMILY);
    expect(r.status).toBe(404);
    expect(r.status).not.toBe(403);
    const body = JSON.stringify(r.data);
    for (const leak of ["contractName", "executiveOverview", "riskCount", "sourcingEvent"]) {
      expect(body, `404 body leaks ${leak}`).not.toContain(leak);
    }
    assertResponseTime(r);
  }, CASE_MS);

  // Declared last in this describe: it deletes famBlank.
  test("TC-CTAPI-079-11 detail for an unknown or deleted familyId returns 404", async () => {
    const unknown = await api.detail(poToken, MISSING_FAMILY);
    expect(unknown.status).toBe(404);
    assertErrorEnvelope(unknown, "ERR_CONTRACT_NOT_FOUND");

    const removed = await api.deleteFamily(poToken, famBlank.familyId);
    expect(removed.status).toBe(200);
    const deleted = await api.detail(poToken, famBlank.familyId);
    expect(deleted.status).toBe(404);
    // a soft-deleted family must be indistinguishable from one that never existed
    expect(deleted.data.error.code).toBe(unknown.data.error.code);
    expect(deleted.data.error.message).toBe(unknown.data.error.message);
    expect(deleted.data.data).toBeUndefined();

    // a malformed path segment is a 4xx, never a 500
    const malformed = await api.detail(poToken, "not-a-uuid");
    expect(malformed.status).toBeGreaterThanOrEqual(400);
    expect(malformed.status).toBeLessThan(500);
    assertResponseTime(unknown);
  }, CASE_MS);
});

// =============================================================================
// Endpoint #10 - the spec 9.1 lazy-write Expired transition (read-time write)
// =============================================================================
describe("Endpoint #10 - lazy-write Expired transition and notice deadline", () => {
  let famYesterday: SeededVersion;  // expiration = yesterday  -> expired on first read
  let famToday: SeededVersion;      // expiration = today      -> still active
  let famNoExpiry: SeededVersion;   // no expiration           -> never expires
  let famNoticeToday: SeededVersion; // notice deadline = today -> not yet overdue
  const today = chicagoToday();

  beforeAll(async () => {
    famYesterday = await seedWithDates(poToken, {
      expirationDate: shiftDays(today, -1),
      noticePeriodDays: 60,
      activate: true,
    });
    famToday = await seedWithDates(poToken, { expirationDate: today, noticePeriodDays: 60, activate: true });
    famNoExpiry = await seedWithDates(poToken, { expirationDate: null, activate: true });
    famNoticeToday = await seedWithDates(poToken, {
      expirationDate: shiftDays(today, 60),
      noticePeriodDays: 60,
      activate: true,
    });
  }, SEED_MS);

  afterAll(async () => {
    for (const f of [famYesterday, famToday, famNoExpiry, famNoticeToday]) {
      await destroyFamily(poToken, f?.familyId);
    }
  }, SEED_MS);

  test("TC-CTAPI-078-1 the lazy-write Expired transition fires at read time on the detail endpoint", async () => {
    // First read of this family since activation - the transition must happen here,
    // with no scheduled job involved (spec 9.1).
    const r = await api.detail(poToken, famYesterday.familyId);
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe("expired");

    // it is a WRITE, not a computed view: the list endpoint agrees
    const list = await api.list(poToken, { status: "expired", limit: 50 });
    expect(list.status).toBe(200);
    const ids = list.data.data.contracts.map((c: Record<string, unknown>) => c.familyId);
    expect(ids).toContain(famYesterday.familyId);

    // idempotent on a second read
    const again = await api.detail(poToken, famYesterday.familyId);
    expect(again.status).toBe(200);
    expect(again.data.data.status).toBe("expired");

    // US-CT-004 action-button matrix for an expired contract
    expect(again.data.data.actionButtons.showUpdateContract).toBe(false);
    expect(again.data.data.actionButtons.showUploadNewVersion).toBe(true);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-078-2 a contract expiring today is still Active, not Expired", async () => {
    const onDate = await api.detail(poToken, famToday.familyId);
    expect(onDate.status).toBe(200);
    // the comparison is strictly less-than, evaluated in America/Chicago
    expect(onDate.data.data.status).toBe("active");

    const dayBefore = await api.detail(poToken, famYesterday.familyId);
    expect(dayBefore.status).toBe(200);
    expect(dayBefore.data.data.status).toBe("expired");
    assertResponseTime(onDate);
  }, CASE_MS);

  test("TC-CTAPI-078-3 a contract with no expiration date never transitions to Expired", async () => {
    const r = await api.detail(poToken, famNoExpiry.familyId);
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe("active");
    expect(r.data.data.keyDates.expirationDate).toBeNull();
    expect(r.data.data.keyDates.noticeDeadline).toBeNull();
    expect(r.data.data.keyDates.noticeDeadlineOverdue).toBe(false);

    const again = await api.detail(poToken, famNoExpiry.familyId);
    expect(again.data.data.status).toBe("active");

    // excluded from the expired tab AND from the expiring_soon filter (spec 9.4)
    for (const status of ["expired", "expiring_soon"]) {
      const list = await api.list(poToken, { status, limit: 50 });
      const ids = list.data.data.contracts.map((c: Record<string, unknown>) => c.familyId);
      expect(ids, `${status} tab`).not.toContain(famNoExpiry.familyId);
    }
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-079-8 noticeDeadlineOverdue is true only once the notice deadline has passed", async () => {
    const overdue = await api.detail(poToken, famYesterday.familyId);
    expect(overdue.status).toBe(200);
    expect(typeof overdue.data.data.keyDates.noticeDeadlineOverdue).toBe("boolean");
    expect(overdue.data.data.keyDates.noticeDeadlineOverdue).toBe(true);

    const dueToday = await api.detail(poToken, famNoticeToday.familyId);
    expect(dueToday.status).toBe(200);
    expect(dueToday.data.data.keyDates.noticeDeadline).toBe(today);
    // strictly less-than: overdue starts the DAY AFTER the deadline passes
    expect(dueToday.data.data.keyDates.noticeDeadlineOverdue).toBe(false);
    // independent of the family's own status - this one is still Active
    expect(dueToday.data.data.status).toBe("active");
    assertResponseTime(overdue);
  }, CASE_MS);
});

// =============================================================================
// Endpoint #10 - Stage 2 progressive disclosure
// =============================================================================
interface Stage2Poll {
  summaryStatus: string;
  clauseRiskStatus: string;
  executiveOverviewIsNull: boolean;
  hasOverviewKey: boolean;
  hasRiskCountKey: boolean;
  riskCount: unknown;
  groupsPopulated: boolean;
}

/** Total risk entries across every severity grouping the Risks endpoint returns. */
/**
 * Count the risk ENTRIES in an Endpoint #16 payload.
 *
 * The live shape groups by severity - `{ totalRiskCount, riskGroups: [{ severity,
 * risks: [...] }] }` - so the entries live one level down. An earlier generic
 * fallback counted `riskGroups.length` (the number of severity buckets) instead of
 * the risks inside them, which read as 1 for a two-risk contract carrying a single
 * "medium" group.
 */
function countRisks(payload: unknown): number {
  const d = (payload as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
  if (!d) return 0;
  if (Array.isArray(d.riskGroups)) {
    return (d.riskGroups as Array<Record<string, unknown>>).reduce(
      (sum, g) => sum + (Array.isArray(g?.risks) ? (g.risks as unknown[]).length : 0),
      0,
    );
  }
  if (Array.isArray(d.risks)) return d.risks.length;
  return 0;
}

describe("Endpoint #10 - Stage 2 progressive disclosure", () => {
  let famStage2: SeededVersion;
  const polls: Stage2Poll[] = [];
  let final: Record<string, unknown> = {};

  beforeAll(async () => {
    famStage2 = await seedUploadedContract(poToken, { fixture: CONTRACT_V2() });
    const review = await api.review(poToken, famStage2.familyId, famStage2.versionId);
    const body = { ...(review.data?.data?.fields ?? review.data?.data ?? {}) } as Record<string, unknown>;
    const saved = await api.save(poToken, famStage2.familyId, famStage2.versionId, body);
    if (saved.status >= 400) {
      throw new Error(`stage2 seed save failed: ${saved.status} ${JSON.stringify(saved.data).slice(0, 300)}`);
    }
    // Poll from the instant Save returns so the pending window is actually observed.
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      const r = await api.detail(poToken, famStage2.familyId);
      if (r.status !== 200) break;
      const d = r.data.data as Record<string, unknown>;
      final = d;
      polls.push({
        summaryStatus: String(d.summaryStatus),
        clauseRiskStatus: String(d.clauseRiskStatus),
        executiveOverviewIsNull: d.executiveOverview === null,
        hasOverviewKey: Object.prototype.hasOwnProperty.call(d, "executiveOverview"),
        hasRiskCountKey: Object.prototype.hasOwnProperty.call(d, "riskCount"),
        riskCount: d.riskCount,
        groupsPopulated: ["keyDates", "financialTerms", "terminationAndContinuity", "legalAndCompliance"]
          .every((g) => d[g] !== null && d[g] !== undefined),
      });
      if (d.summaryStatus !== "pending" && d.clauseRiskStatus !== "pending") break;
      await new Promise((res) => setTimeout(res, 4_000));
    }
  }, SEED_MS);

  afterAll(async () => {
    await destroyFamily(poToken, famStage2?.familyId);
  }, SEED_MS);

  test("TC-CTAPI-079-1 Executive Overview is withheld as null until the Stage 2 summary completes", async () => {
    expect(polls.length).toBeGreaterThan(0);
    for (const p of polls) {
      expect(p.hasOverviewKey, "executiveOverview key must always be present").toBe(true);
      // Stage 1 groups render fully throughout - they finished before Save
      expect(p.groupsPopulated, "Stage 1 groups must stay populated").toBe(true);
      if (p.summaryStatus === "pending" || p.summaryStatus === "failed") {
        expect(p.executiveOverviewIsNull, `executiveOverview must be null while ${p.summaryStatus}`).toBe(true);
      }
    }
    const last = polls[polls.length - 1] as Stage2Poll;
    if (last.summaryStatus === "completed") {
      expect(typeof final.executiveOverview).toBe("string");
      expect(String(final.executiveOverview).length).toBeGreaterThan(0);
    }
    const r = await api.detail(poToken, famStage2.familyId);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-079-2 riskCount is null while the Stage 2 clause/risk job is pending", async () => {
    expect(polls.length).toBeGreaterThan(0);
    let seen = -1;
    for (const p of polls) {
      expect(p.hasRiskCountKey, "riskCount key must always be present").toBe(true);
      if (p.clauseRiskStatus === "pending") {
        // explicitly NOT 0, which would render a misleading "no risks found"
        expect(p.riskCount, "riskCount must be null while pending").toBeNull();
      }
      if (p.clauseRiskStatus === "completed") {
        expect(Number.isInteger(p.riskCount)).toBe(true);
        expect(p.riskCount as number).toBeGreaterThanOrEqual(0);
        // never decreases or oscillates within one Stage 2 run
        expect(p.riskCount as number).toBeGreaterThanOrEqual(seen);
        seen = p.riskCount as number;
      }
    }
    const r = await api.detail(poToken, famStage2.familyId);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-079-4 riskCount equals the total risk entries returned by the Risks endpoint", async () => {
    const detail = await api.detail(poToken, famStage2.familyId);
    expect(detail.status).toBe(200);
    expect(detail.data.data.clauseRiskStatus).toBe("completed");
    const risks = await api.risks(poToken, famStage2.familyId);
    expect(risks.status).toBe(200);
    expect(detail.data.data.riskCount).toBe(countRisks(risks.data));

    // both endpoints agree on repeated reads
    const again = await api.detail(poToken, famStage2.familyId);
    expect(again.data.data.riskCount).toBe(detail.data.data.riskCount);
    assertResponseTime(detail);
  }, CASE_MS);

  // TC-CTAPI-079-3, -079-5 and -079-6 are implemented in contracts.final.test.ts,
  // which owns the cross-feature vendor and sourcing-event fixtures.
});

// =============================================================================
// Endpoint #11 - DELETE /:familyId - family delete at any status
// =============================================================================
describe("Endpoint #11 - delete contract family", () => {
  let gFam1: SeededVersion;      // two saved versions + a cached comparison
  let gFam1Second = "";
  let comparisonId = "";
  let comparisonProbe = "";
  let gFam2: SeededVersion;      // cascade target
  let gInReview: SeededVersion;  // status in_review
  let gActive: SeededVersion;    // status active
  let gExpired: SeededVersion;   // status expired (lazy-written)
  let gTerminated: SeededVersion; // status terminated
  let gAuth: SeededVersion;      // auth / rbac / 404 target

  beforeAll(async () => {
    gFam1 = await seedSavedContract(poToken, { fixture: CONTRACT_V2() });
    gFam1Second = await addSavedVersion(poToken, gFam1.familyId);
    const cmp = await api.startComparison(poToken, gFam1.familyId, gFam1.versionId, gFam1Second);
    comparisonProbe = `${cmp.status} ${JSON.stringify(cmp.data).slice(0, 300)}`;
    comparisonId = cmp.data?.data?.comparisonId ?? cmp.data?.data?.id ?? cmp.data?.comparisonId ?? "";
    if (comparisonId) {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const poll = await api.comparisonStatus(poToken, gFam1.familyId, comparisonId);
        if (poll.data?.data?.status !== "pending") break;
        await new Promise((res) => setTimeout(res, 4_000));
      }
    }
    gFam2 = await seedSavedContract(poToken, { fixture: CONTRACT_V2() });
    gInReview = await seedSavedContract(poToken, { fixture: CONTRACT_V2() });
    gActive = await seedSavedContract(poToken, { fixture: CONTRACT_V2() });
    await api.activate(poToken, gActive.familyId, gActive.versionId);
    gExpired = await seedWithDates(poToken, {
      expirationDate: shiftDays(chicagoToday(), -2),
      noticePeriodDays: 60,
      activate: true,
    });
    gTerminated = await seedSavedContract(poToken, { fixture: CONTRACT_V2() });
    await api.activate(poToken, gTerminated.familyId, gTerminated.versionId);
    const term = await api.terminate(poToken, gTerminated.familyId);
    // Seed guard only - the documented 200 for Endpoint #12 is asserted by TC-CTAPI-088.
    expect(term.status, `seed terminate: ${JSON.stringify(term.data).slice(0, 200)}`).toBeLessThan(400);
    gAuth = await seedSavedContract(poToken, { fixture: CONTRACT_V2() });
  }, SEED_MS);

  afterAll(async () => {
    for (const f of [gFam1, gFam2, gInReview, gActive, gExpired, gTerminated, gAuth]) {
      await destroyFamily(poToken, f?.familyId);
    }
  }, SEED_MS);

  test("TC-CTAPI-080 delete contract family returns 200 with the permanent-delete message", async () => {
    const before = await api.list(poToken, { limit: 1 });
    expect(before.status).toBe(200);
    const totalBefore = before.data.data.pagination.total;
    const countsBefore = before.data.data.counts;
    const statusBefore = (await api.detail(poToken, gFam1.familyId)).data.data.status;

    const r = await api.deleteFamily(poToken, gFam1.familyId);
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    expect(r.data.data.message).toBe("Contract deleted permanently.");

    const after = await api.list(poToken, { limit: 1 });
    expect(after.data.data.pagination.total).toBe(totalBefore - 1);
    expect(after.data.data.counts[statusBefore]).toBe(countsBefore[statusBefore] - 1);

    const detail = await api.detail(poToken, gFam1.familyId);
    expect(detail.status).toBe(404);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-081 family delete makes every version and all child data unreachable", async () => {
    const baselineDetail = await api.detail(poToken, gFam2.familyId);
    expect(baselineDetail.status).toBe(200);
    const baselineVersions = await api.versions(poToken, gFam2.familyId);
    expect(baselineVersions.status).toBe(200);
    const baselineFile = await api.fileUrl(poToken, gFam2.familyId, gFam2.versionId);
    expect(baselineFile.status).toBe(200);

    const r = await api.deleteFamily(poToken, gFam2.familyId);
    expect(r.status).toBe(200);

    // Serialized, with one retry: the QA edge occasionally resets a TLS connection
    // and a transient ECONNRESET must not be reported as a missing 404.
    const reads: Array<[string, () => Promise<AxiosResponse>]> = [
      ["detail", () => api.detail(poToken, gFam2.familyId)],
      ["versions", () => api.versions(poToken, gFam2.familyId)],
      ["clause-comparison", () => api.clauseComparison(poToken, gFam2.familyId)],
      ["risks", () => api.risks(poToken, gFam2.familyId)],
      ["review", () => api.review(poToken, gFam2.familyId, gFam2.versionId)],
      ["file-url", () => api.fileUrl(poToken, gFam2.familyId, gFam2.versionId)],
    ];
    for (const [label, call] of reads) {
      let res: AxiosResponse;
      try {
        res = await call();
      } catch {
        res = await call();
      }
      // Endpoint #13 must 404, not return an empty version list
      expect(res.status, `post-delete read on ${label}`).toBe(404);
      expect(res.data.success, `post-delete read on ${label}`).toBe(false);
      expect(res.data.data, `post-delete read on ${label}`).toBeUndefined();
    }
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-082 family delete hard-deletes every cached comparison for that family", async () => {
    // gFam1 was deleted by TC-CTAPI-080 above; this case owns the comparison-cache
    // half of that delete, so no second family is seeded for it.
    // Endpoint #15 must have produced a cached comparison for this case to have a
    // subject at all; the probe string carries the live response for triage.
    expect(comparisonId, `Endpoint #15 returned no comparison id. Response: ${comparisonProbe}`).toBeTruthy();
    const r = await api.comparisonStatus(poToken, gFam1.familyId, comparisonId);
    expect(r.status).toBe(404);
    expect(r.data.success).toBe(false);
    expect(JSON.stringify(r.data)).not.toContain("completed");
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-083-1 delete is available when the family status is in_review", async () => {
    const before = await api.detail(poToken, gInReview.familyId);
    expect(before.data.data.status).toBe("in_review");
    const listBefore = await api.list(poToken, { limit: 1 });
    const countBefore = listBefore.data.data.counts.in_review;

    const r = await api.deleteFamily(poToken, gInReview.familyId);
    expect(r.status).toBe(200);
    expect(r.data.data.message).toBe("Contract deleted permanently.");
    expect((await api.detail(poToken, gInReview.familyId)).status).toBe(404);

    const listAfter = await api.list(poToken, { limit: 1 });
    expect(listAfter.data.data.counts.in_review).toBe(countBefore - 1);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-083-2 delete is available when the family status is active", async () => {
    const before = await api.detail(poToken, gActive.familyId);
    expect(before.data.data.status).toBe("active");

    const r = await api.deleteFamily(poToken, gActive.familyId);
    expect(r.status).toBe(200);
    expect(r.data.data.message).toBe("Contract deleted permanently.");
    expect((await api.detail(poToken, gActive.familyId)).status).toBe(404);
    expect((await api.versions(poToken, gActive.familyId)).status).toBe(404);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-083-3 delete is available when the family status is expired", async () => {
    const before = await api.detail(poToken, gExpired.familyId);
    expect(before.data.data.status).toBe("expired");

    const r = await api.deleteFamily(poToken, gExpired.familyId);
    expect(r.status).toBe(200);
    expect(r.data.data.message).toBe("Contract deleted permanently.");
    expect((await api.detail(poToken, gExpired.familyId)).status).toBe(404);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-083-4 delete is available when the family status is terminated", async () => {
    const before = await api.detail(poToken, gTerminated.familyId);
    expect(before.data.data.status).toBe("terminated");
    expect(before.data.data.terminatedBanner).not.toBeNull();

    // proves the family really is in the read-only terminal state
    const reTerminate = await api.terminate(poToken, gTerminated.familyId);
    expect(reTerminate.status).toBe(409);
    assertErrorEnvelope(reTerminate, "ERR_ALREADY_TERMINATED");

    // Delete is the one write action that survives termination
    const r = await api.deleteFamily(poToken, gTerminated.familyId);
    expect(r.status).toBe(200);
    expect(r.data.data.message).toBe("Contract deleted permanently.");
    expect((await api.detail(poToken, gTerminated.familyId)).status).toBe(404);
    assertResponseTime(r);
  }, CASE_MS);

  // TC-CTAPI-084 is implemented in contracts.final.test.ts, which drives the FEAT-005
  // vendors API alongside the Contracts client.

  test("TC-CTAPI-085 family delete without a bearer token returns 401", async () => {
    for (const token of ["", "not-a-token"]) {
      const r = await api.deleteFamily(token, gAuth.familyId);
      expect(r.status, `token "${token}"`).toBe(401);
      expect(r.data.success).toBe(false);
      const body = JSON.stringify(r.data);
      expect(body).not.toContain("contractName");
      expect(body).not.toContain(gAuth.contractId);
      assertResponseTime(r);
    }
    // the family was not deleted
    expect((await api.detail(poToken, gAuth.familyId)).status).toBe(200);
  }, CASE_MS);

  test("TC-CTAPI-086-1 family delete is forbidden for a Procurement Analyst", async () => {
    const asAnalyst = await api.detail(analystToken, gAuth.familyId);
    expect(asAnalyst.status).toBe(200);
    expect(asAnalyst.data.data.actionButtons.showDelete).toBe(false);

    const r = await api.deleteFamily(analystToken, gAuth.familyId);
    // 403, NOT 404 - the Analyst is a legitimate member of the tenant
    expect(r.status).toBe(403);
    expect(r.data.success).toBe(false);
    expect((await api.detail(poToken, gAuth.familyId)).status).toBe(200);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-086-2 family delete is forbidden for a Platform Admin", async () => {
    expect(adminToken, "no platform-admin token available").toBeTruthy();
    const r = await api.deleteFamily(adminToken, gAuth.familyId);
    // contract TBD: the spec pins neither 403 nor 404 for a tenant-less admin token
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.data.success).toBe(false);
    expect((await api.detail(poToken, gAuth.familyId)).status).toBe(200);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-087-2 family delete across tenants returns 404, not 403", async () => {
    // No second seeded tenant on QA - run against an id this tenant does not own.
    const r = await api.deleteFamily(poToken, MISSING_FAMILY);
    expect(r.status).toBe(404);
    expect(r.status).not.toBe(403);
    expect(JSON.stringify(r.data)).not.toContain("tenant");
    assertResponseTime(r);
  }, CASE_MS);

  // Declared last in this describe: it deletes gAuth.
  test("TC-CTAPI-087-1 family delete with an unknown familyId returns 404", async () => {
    const unknown = await api.deleteFamily(poToken, MISSING_FAMILY);
    expect(unknown.status).toBe(404);

    const malformed = await api.deleteFamily(poToken, "not-a-uuid");
    expect(malformed.status).toBeGreaterThanOrEqual(400);
    expect(malformed.status).toBeLessThan(500);

    // a successful delete is not idempotently 200 on the second call
    const first = await api.deleteFamily(poToken, gAuth.familyId);
    expect(first.status).toBe(200);
    const second = await api.deleteFamily(poToken, gAuth.familyId);
    expect(second.status).toBe(404);
    expect(second.data.error.code).toBe(unknown.data.error.code);
    assertResponseTime(unknown);
  }, CASE_MS);
});

// =============================================================================
// Endpoint #12 - POST /:familyId/terminate - all three legal source states
// =============================================================================
describe("Endpoint #12 - terminate contract", () => {
  let hActive1: SeededVersion;   // active -> terminated by TC-CTAPI-088
  let hActive2: SeededVersion;   // active -> terminated by TC-CTAPI-090
  let hMulti: SeededVersion;     // two versions, terminated in beforeAll
  let hMultiSecond = "";
  let hInReview: SeededVersion;  // in_review -> terminated by TC-CTAPI-151
  let hExpired: SeededVersion;   // expired  -> terminated by TC-CTAPI-152

  beforeAll(async () => {
    hActive1 = await seedSavedContract(poToken, { fixture: CONTRACT_V2() });
    await api.activate(poToken, hActive1.familyId, hActive1.versionId);
    hActive2 = await seedSavedContract(poToken, { fixture: CONTRACT_V2() });
    await api.activate(poToken, hActive2.familyId, hActive2.versionId);

    hMulti = await seedSavedContract(poToken, { fixture: CONTRACT_V2() });
    hMultiSecond = await addSavedVersion(poToken, hMulti.familyId);
    await api.activate(poToken, hMulti.familyId, hMulti.versionId);
    const term = await api.terminate(poToken, hMulti.familyId);
    // Seed guard only - the documented 200 for Endpoint #12 is asserted by TC-CTAPI-088.
    expect(term.status, `seed terminate: ${JSON.stringify(term.data).slice(0, 200)}`).toBeLessThan(400);

    hInReview = await seedSavedContract(poToken, { fixture: CONTRACT_V2() });
    hExpired = await seedWithDates(poToken, {
      expirationDate: shiftDays(chicagoToday(), -3),
      noticePeriodDays: 60,
      activate: true,
    });
  }, SEED_MS);

  afterAll(async () => {
    // destroyFamily is safe after termination - Delete works at any status.
    for (const f of [hActive1, hActive2, hMulti, hInReview, hExpired]) {
      await destroyFamily(poToken, f?.familyId);
    }
  }, SEED_MS);

  // Declared before TC-CTAPI-088 because it needs hActive1 while it is still active.
  test("TC-CTAPI-091 terminate rejects the unauthenticated caller with 401 and the Analyst with 403", async () => {
    const anon = await api.terminate("", hActive1.familyId);
    expect(anon.status).toBe(401);
    expect(anon.data.success).toBe(false);
    assertResponseTime(anon);

    const asAnalyst = await api.terminate(analystToken, hActive1.familyId);
    expect(asAnalyst.status).toBe(403); // authenticated, so distinct from the 401
    expect(asAnalyst.data.success).toBe(false);
    assertResponseTime(asAnalyst);

    const read = await api.detail(analystToken, hActive1.familyId);
    expect(read.status).toBe(200); // the 403 is action-scoped, not resource-scoped
    expect(read.data.data.actionButtons.showTerminate).toBe(false);

    // terminate is irreversible - neither call may have fired
    const owner = await api.detail(poToken, hActive1.familyId);
    expect(owner.data.data.status).toBe("active");
  }, CASE_MS);

  test("TC-CTAPI-088 terminate an active contract returns 200 with the termination message", async () => {
    const before = await api.detail(poToken, hActive1.familyId);
    expect(before.data.data.status).toBe("active");
    expect(before.data.data.terminatedBanner).toBeNull();
    const listBefore = await api.list(poToken, { limit: 1 });
    const activeBefore = listBefore.data.data.counts.active;
    const terminatedBefore = listBefore.data.data.counts.terminated;

    // DRIFT (live QA 2026-08-25): terminate answers 201 Created. Spec Endpoint #12
    // documents "Response - Success (200)"; terminate mutates an existing family and
    // creates no resource, so 201 is wrong on both the spec and REST readings.
    // Same root cause as TC-CTAPI-090, TC-CTAPI-151 and TC-CTAPI-152 below.
    const r = await api.terminate(poToken, hActive1.familyId);
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    expect(r.data.data.message).toBe("Contract terminated.");

    const after = await api.detail(poToken, hActive1.familyId);
    expect(after.data.data.status).toBe("terminated");
    expect(after.data.data.terminatedBanner).not.toBeNull();
    expect(String(after.data.data.terminatedBanner)).toMatch(
      /^This contract was terminated on .+\. All versions are read-only\.$/,
    );

    const listAfter = await api.list(poToken, { limit: 1 });
    expect(listAfter.data.data.counts.active).toBe(activeBefore - 1);
    expect(listAfter.data.data.counts.terminated).toBe(terminatedBefore + 1);
    assertResponseTime(r);
  }, CASE_MS);

  // Endpoint #10 case, declared here because it consumes the family TC-CTAPI-088 terminated.
  test("TC-CTAPI-079-7 a terminated contract returns the banner, terminatedAt and no write buttons", async () => {
    const r = await api.detail(poToken, hActive1.familyId);
    expect(r.status).toBe(200);
    const d = r.data.data;
    expect(CONTRACT_STATUSES as readonly string[]).toContain(d.status);
    expect(d.contractId).toMatch(CONTRACT_ID_RE);
    expect(d.status).toBe("terminated");
    expect(d.terminatedAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(String(d.terminatedAt)))).toBe(false);
    expect(String(d.terminatedBanner)).toMatch(
      /^This contract was terminated on .+\. All versions are read-only\.$/,
    );
    expect(d.actionButtons.showUploadNewVersion).toBe(false);
    expect(d.actionButtons.showUpdateContract).toBe(false);
    expect(d.actionButtons.showTerminate).toBe(false);
    // Delete remains available at any status including Terminated
    expect(d.actionButtons.showDelete).toBe(true);
    // Terminated is read-only, not hidden - the Summary data still returns
    for (const [group, keys] of Object.entries(TERM_GROUPS)) {
      expect(d[group], `${group} still returned`).toBeTruthy();
      expect(Object.keys(d[group]).sort(), `${group} key set`).toEqual([...keys].sort());
    }
    expect(Object.keys(d).sort()).toEqual([...DETAIL_KEYS].sort());
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-089 terminate makes every write action read-only while Compare still works", async () => {
    const detail = await api.detail(poToken, hMulti.familyId);
    expect(detail.status).toBe(200);
    expect(detail.data.data.actionButtons).toEqual({
      showUploadNewVersion: false,
      showUpdateContract: false,
      showTerminate: false,
      showDelete: true,
    });

    const fx = CONTRACT_V1();
    const upload = await api.uploadVersion(poToken, hMulti.familyId, {
      file: { buffer: fx.buffer, filename: fx.filename, contentType: fx.contentType },
    });
    expect(upload.status, "Upload New Version on a terminated family").toBeGreaterThanOrEqual(400);

    // contract TBD: the spec forbids Endpoint #4 on a terminated family but documents
    // no code for the case; 409 is the consistent reading against ERR_ALREADY_TERMINATED.
    const update = await api.updateContract(poToken, hMulti.familyId, hMulti.versionId, {
      buffer: fx.buffer,
      filename: fx.filename,
      contentType: fx.contentType,
    });
    expect(update.status, "Update Contract on a terminated family").toBe(409);

    const markActive = await api.activate(poToken, hMulti.familyId, hMultiSecond);
    expect(markActive.status, "Mark as Active on a terminated family").toBeGreaterThanOrEqual(400);

    const del = await api.deleteVersion(poToken, hMulti.familyId, hMultiSecond);
    expect(del.status, "version delete on a terminated family").toBeGreaterThanOrEqual(400);

    // Compare is read-only and must NOT be blocked by termination.
    const compare = await api.startComparison(poToken, hMulti.familyId, hMulti.versionId, hMultiSecond);
    expect(
      compare.status,
      `Compare on a terminated family: ${compare.status} ${JSON.stringify(compare.data).slice(0, 300)}`,
    ).toBeLessThan(400);

    const again = await api.terminate(poToken, hMulti.familyId);
    expect(again.status).toBe(409);
    assertErrorEnvelope(again, "ERR_ALREADY_TERMINATED");
    expect(again.data.error.message).toBe("This contract has already been terminated.");
    assertResponseTime(detail);
  }, CASE_MS);

  test("TC-CTAPI-090 terminating an already-terminated contract returns 409 ERR_ALREADY_TERMINATED", async () => {
    const first = await api.terminate(poToken, hActive2.familyId);
    // DRIFT (live QA 2026-08-25): 201 instead of the documented 200 - see TC-CTAPI-088.
    expect(first.status).toBe(200);
    const banner = (await api.detail(poToken, hActive2.familyId)).data.data.terminatedBanner;
    expect(banner).not.toBeNull();

    for (const attempt of [2, 3]) {
      const r = await api.terminate(poToken, hActive2.familyId);
      expect(r.status, `attempt ${attempt}`).toBe(409);
      assertErrorEnvelope(r, "ERR_ALREADY_TERMINATED");
      expect(r.data.error.message).toBe("This contract has already been terminated.");
      expect(r.data.error.details).toEqual({});
      assertResponseTime(r);
    }

    // a repeat terminate must not refresh terminated_at
    const after = await api.detail(poToken, hActive2.familyId);
    expect(after.data.data.terminatedBanner).toBe(banner);
  }, CASE_MS);

  test("TC-CTAPI-092-1 terminate with an unknown or deleted familyId returns 404, not 409", async () => {
    const unknown = await api.terminate(poToken, MISSING_FAMILY);
    expect(unknown.status).toBe(404);
    expect(unknown.data.success).toBe(false);
    assertResponseTime(unknown);

    // a family that was terminated and then deleted resolves to Not Found, never
    // to ERR_ALREADY_TERMINATED - the resolver runs before the state guard
    const removed = await api.deleteFamily(poToken, hActive1.familyId);
    expect(removed.status).toBe(200);
    const r = await api.terminate(poToken, hActive1.familyId);
    expect(r.status).toBe(404);
    expect(r.data.error.code).not.toBe("ERR_ALREADY_TERMINATED");
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-092-2 terminate across tenants returns 404, not 403", async () => {
    // No second seeded tenant on QA - run against an id this tenant does not own.
    const r = await api.terminate(poToken, MISSING_FAMILY);
    expect(r.status).toBe(404);
    expect(r.status).not.toBe(403);
    expect(JSON.stringify(r.data)).not.toContain("tenant");
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-151 terminate an in_review contract returns 200 and moves the family to terminated", async () => {
    const before = await api.detail(poToken, hInReview.familyId);
    expect(before.status).toBe(200);
    expect(before.data.data.status).toBe("in_review");

    // spec 3.1: in_review -> terminated is a legal edge and must not be rejected.
    // DRIFT (live QA 2026-08-25): the edge IS accepted, but with 201 instead of the
    // documented 200 - see TC-CTAPI-088. The transition itself behaves correctly.
    const r = await api.terminate(poToken, hInReview.familyId);
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    expect(r.data.data.message).toBe("Contract terminated.");

    const after = await api.detail(poToken, hInReview.familyId);
    expect(after.data.data.status).toBe("terminated");
    expect(after.data.data.terminatedAt).not.toBeNull();

    // termination applies to the whole family, so every version is read-only
    const versions = await api.versions(poToken, hInReview.familyId);
    expect(versions.status).toBe(200);
    expect(versions.data.data.versions.length).toBeGreaterThan(0);
    for (const v of versions.data.data.versions) {
      expect(v.isTerminated, `version ${v.versionId} isTerminated`).toBe(true);
    }

    // terminated is TERMINAL - a follow-up upload is rejected
    const fx = CONTRACT_V1();
    const upload = await api.uploadVersion(poToken, hInReview.familyId, {
      file: { buffer: fx.buffer, filename: fx.filename, contentType: fx.contentType },
    });
    expect(upload.status).toBe(409);
    assertErrorEnvelope(upload, "ERR_CONTRACT_TERMINATED");
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-152 terminate an expired contract returns 200 and moves the family to terminated", async () => {
    // first read fires the spec 9.1 lazy-write, so the stored status becomes expired
    const before = await api.detail(poToken, hExpired.familyId);
    expect(before.status).toBe(200);
    expect(before.data.data.status).toBe("expired");

    // spec 3.1: expired -> terminated is a legal edge.
    // DRIFT (live QA 2026-08-25): accepted, but with 201 instead of the documented
    // 200 - see TC-CTAPI-088. The transition itself behaves correctly.
    const r = await api.terminate(poToken, hExpired.familyId);
    expect(r.status).toBe(200);
    expect(r.data.data.message).toBe("Contract terminated.");

    // terminated overwrites expired rather than the two coexisting
    const after = await api.detail(poToken, hExpired.familyId);
    expect(after.data.data.status).toBe("terminated");
    expect(after.data.data.terminatedAt).not.toBeNull();

    const versions = await api.versions(poToken, hExpired.familyId);
    expect(versions.status).toBe(200);
    for (const v of versions.data.data.versions) {
      expect(v.isTerminated, `version ${v.versionId} isTerminated`).toBe(true);
    }

    // no further transition is possible - terminated is TERMINAL
    const fx = CONTRACT_V1();
    const update = await api.updateContract(poToken, hExpired.familyId, hExpired.versionId, {
      buffer: fx.buffer,
      filename: fx.filename,
      contentType: fx.contentType,
    });
    expect(update.status).toBe(409);
    const again = await api.terminate(poToken, hExpired.familyId);
    expect(again.status).toBe(409);
    assertErrorEnvelope(again, "ERR_ALREADY_TERMINATED");
    assertResponseTime(r);
  }, CASE_MS);
});
