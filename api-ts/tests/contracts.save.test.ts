/**
 * CEIQ-FEAT-009 Contracts - Endpoint #8 POST
 * /api/v1/contracts/:familyId/versions/:versionId/save
 *
 * Spec: documents/input/SPEC_CEIQ-FEAT-009-contracts.md - 4.2 Endpoint #8 (lines
 * 1574-1670), US-CT-003 (field limits), 4.2 Endpoint #10 (read-after-write source
 * of truth for the Summary groups).
 * Cases: testcases/TC-CEIQ-FEAT-009.md - TC-CTAPI-056 .. TC-CTAPI-069-3,
 * published to TestRail under US-CT. TC-IDs are FIXED - never renumbered here.
 *
 * Why this endpoint gets its own file: Save does two things at once. It commits
 * the 20 reviewed fields AND it is the one and only trigger for Stage 2 analysis
 * ("it fires exactly once per version, on that version's first successful save").
 * A bug here is either silent data loss or a duplicated Bedrock spend, so the
 * negative paths carry read-after-write invariants, not just status assertions.
 *
 * Observability limit, stated once here rather than over-claimed per test: this
 * project has NO BullMQ/queue access and NO database access on QA. "Stage 2 fired"
 * and "Stage 2 did not re-fire" are therefore observed exclusively through
 * Endpoint #10's `summaryStatus` / `clauseRiskStatus` pair plus `riskCount` and
 * `executiveOverview`. That proxy cannot distinguish one job from two jobs that
 * both wrote the same status; it CAN prove a status left or did not leave its
 * prior state, which is the invariant the spec's "exactly once" rule reduces to
 * from outside the process.
 *
 * Assertions are spec-true. Where live QA diverges, the test asserts the SPEC and
 * fails - that failure IS the report. Each such case names the drift in a comment.
 */
import { beforeAll, afterAll, describe, expect } from "vitest";
import { test } from "../src/utils/suite";
import { assertResponseTime, assertErrorEnvelope } from "../src/utils/assertions";
import { contractsClient as api } from "../src/clients/contractsClient";
import {
  CONTRACT_V1,
  CONTRACT_V2,
  seedUploadedContract,
  seedSavedContract,
  destroyFamily,
  type SeededVersion,
} from "../src/utils/contractsSeed";
import { getTenantIdToken, getAnalystIdToken } from "../src/utils/tokenProvider";

const CONTRACT_ID_RE = /^CON-\d{4}-\d{3}$/;
/** The two ids TC-CTAPI-069-1 / -069-2 pin verbatim. */
const MISSING_FAMILY = "00000000-0000-0000-0000-0000000000ff";
const MISSING_VERSION = "00000000-0000-0000-0000-0000000000fe";

/** Generous budgets: an upload plus Stage 1 extraction measured ~14 s on QA. */
const SEED_MS = 240_000;
const CASE_MS = 240_000;
const STAGE2_BUDGET_MS = 180_000;

let poToken = "";
let analystToken = "";
const families: string[] = [];

// ---------------------------------------------------------------------------
// The 20-field save body. Values are TC-CTAPI-056's verbatim test data - every
// one well inside its documented limit - so every derived case is a named delta
// against a single published fixture rather than an ad-hoc payload.
// ---------------------------------------------------------------------------
const SCALAR_FIELDS = ["totalContractValue", "effectiveDate", "expirationDate", "noticePeriodDays"] as const;

/** The 16 clause-type fields, each "Max 500 chars", each Required: No. */
const FREE_TEXT_FIELDS = [
  "paymentTerms", "terminationForConvenience", "limitationOfLiability", "insuranceRequirements",
  "slaUptime", "warranty", "priceIncreaseCap", "terminationForCause",
  "autoRenewal", "indemnification", "dataOwnership", "confidentiality",
  "exclusivity", "freightTerms", "intellectualProperty", "governingLaw",
] as const;

/**
 * Which Endpoint #10 Summary group each field is read back from (spec 4.2
 * Endpoint #10 response example + its "Summary grid sources" field note). This
 * map is the whole point of TC-CTAPI-057: the 16 clause values round-trip through
 * `contract_clause_results` keyed by `clause_catalog_id`, which is the most
 * error-prone part of the endpoint - a swap here loses a term silently.
 */
const FIELD_GROUP: Record<string, string> = {
  totalContractValue: "financialTerms",
  paymentTerms: "financialTerms",
  limitationOfLiability: "financialTerms",
  insuranceRequirements: "financialTerms",
  priceIncreaseCap: "financialTerms",
  noticePeriodDays: "terminationAndContinuity",
  terminationForConvenience: "terminationAndContinuity",
  terminationForCause: "terminationAndContinuity",
  autoRenewal: "terminationAndContinuity",
  slaUptime: "terminationAndContinuity",
  warranty: "terminationAndContinuity",
  governingLaw: "legalAndCompliance",
  indemnification: "legalAndCompliance",
  dataOwnership: "legalAndCompliance",
  confidentiality: "legalAndCompliance",
  intellectualProperty: "legalAndCompliance",
  exclusivity: "legalAndCompliance",
  freightTerms: "legalAndCompliance",
  effectiveDate: "keyDates",
  expirationDate: "keyDates",
};

function body56(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    totalContractValue: 250000,
    effectiveDate: "2026-05-01",
    expirationDate: "2027-07-30",
    noticePeriodDays: 30,
    paymentTerms: "Net 30",
    terminationForConvenience: "30 days written notice",
    limitationOfLiability: "USD 500,000",
    insuranceRequirements: "USD 2,000,000 general liability",
    slaUptime: "99.90% monthly uptime",
    warranty: "12 months",
    priceIncreaseCap: "3% annually",
    terminationForCause: "Material breach unremedied after 30-day cure period",
    autoRenewal: "None",
    indemnification: "Mutual indemnification, standard terms",
    dataOwnership: "Customer retains all rights to customer data",
    confidentiality: "Mutual, 3-year post-termination",
    exclusivity: "None",
    freightTerms: "N/A",
    intellectualProperty: "Each party retains pre-existing IP",
    governingLaw: "Delaware, USA",
    ...overrides,
  };
}

/** Read a field out of whichever Endpoint #10 group owns it. */
function detailField(detailData: Record<string, any>, field: string): unknown {
  const group = FIELD_GROUP[field];
  return group ? detailData?.[group]?.[field] : detailData?.[field];
}

/**
 * Date part of an Endpoint #10 date value.
 *
 * Live QA returns a full ISO-8601 datetime where the spec's response examples
 * show `YYYY-MM-DD`. That format drift is already owned and asserted by
 * TC-CTAPI-013-2 in tests/contracts.test.ts; re-failing it in every date case
 * here would bury the arithmetic these cases actually exist to check, so the
 * date VALUE is compared and the format is left to its owning case.
 */
function datePart(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v).slice(0, 10);
}

/** Poll Endpoint #10 until both Stage 2 statuses leave `pending`. */
async function waitForStage2(
  familyId: string,
  budgetMs = STAGE2_BUDGET_MS,
  intervalMs = 3_000,
): Promise<{ summaryStatus?: string; clauseRiskStatus?: string; polls: string[] }> {
  const deadline = Date.now() + budgetMs;
  const polls: string[] = [];
  let d: Record<string, any> = {};
  while (Date.now() < deadline) {
    const r = await api.detail(poToken, familyId);
    d = r.data?.data ?? {};
    polls.push(`${d.summaryStatus}/${d.clauseRiskStatus}`);
    if (d.summaryStatus && d.summaryStatus !== "pending" && d.clauseRiskStatus && d.clauseRiskStatus !== "pending") {
      break;
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return { summaryStatus: d.summaryStatus, clauseRiskStatus: d.clauseRiskStatus, polls };
}

/** Seed an unsaved, extraction-completed version and register it for teardown. */
async function seedUnsaved(fixture = CONTRACT_V1()): Promise<SeededVersion> {
  const v = await seedUploadedContract(poToken, { fixture });
  families.push(v.familyId);
  return v;
}

/**
 * A family whose first version is already saved, so Endpoint #10 will serve it.
 *
 * Spec v1.7 Endpoint #10 step 2: the representative version must be a saved one, and
 * "if no representative version exists (the only version is unsaved), return 404
 * ERR_CONTRACT_NOT_FOUND". QA began enforcing this on 2026-09-08. Any block that
 * observes persisted state through Endpoint #10 must therefore seed a SAVED version -
 * the 404 on an unsaved family is the product behaving correctly.
 */
async function seedSaved(fixture = CONTRACT_V1()): Promise<SeededVersion> {
  const v = await seedSavedContract(poToken, { fixture });
  families.push(v.familyId);
  return v;
}

beforeAll(async () => {
  poToken = await getTenantIdToken();
  analystToken = await getAnalystIdToken();
}, 60_000);

afterAll(async () => {
  // Best-effort teardown of every family this file created. destroyFamily never
  // throws, so a cleanup problem can never mask a real assertion failure.
  for (const f of families) await destroyFamily(poToken, f);
}, SEED_MS);

// ===========================================================================
// Happy path, field persistence, and the Stage 2 trigger
// ===========================================================================
describe("Endpoint #8 - save happy path, persistence and the Stage 2 trigger", () => {
  let sAnchor: SeededVersion;
  let sMarkers: SeededVersion;
  let sStage2: SeededVersion;
  let sBlank: SeededVersion;
  /** Stage 1 values for sMarkers / sBlank, captured before any save overwrites them. */
  let markersStage1: Record<string, unknown> = {};
  let blankStage1: Record<string, unknown> = {};
  /** sStage2 pre-save observation, per TC-CTAPI-058-1 step 1. */
  let stage2PreSave: { status: number; summaryStatus?: unknown; clauseRiskStatus?: unknown; overview?: unknown } | undefined;

  beforeAll(async () => {
    // Seeded in parallel: each seed costs an upload plus a ~14 s Stage 1 wait, and
    // the waits overlap, so four seeds cost roughly one seed of wall time.
    [sAnchor, sMarkers, sStage2, sBlank] = await Promise.all([
      seedUnsaved(), seedUnsaved(), seedUnsaved(), seedUnsaved(),
    ]);
    const [rm, rb, preDetail] = await Promise.all([
      api.review(poToken, sMarkers.familyId, sMarkers.versionId),
      api.review(poToken, sBlank.familyId, sBlank.versionId),
      api.detail(poToken, sStage2.familyId),
    ]);
    markersStage1 = rm.data?.data?.fields ?? {};
    blankStage1 = rb.data?.data?.fields ?? {};
    stage2PreSave = {
      status: preDetail.status,
      summaryStatus: preDetail.data?.data?.summaryStatus,
      clauseRiskStatus: preDetail.data?.data?.clauseRiskStatus,
      overview: preDetail.data?.data?.executiveOverview,
    };
  }, SEED_MS);

  test("TC-CTAPI-056 save returns 200 with exactly familyId, versionId and contractId @smoke @regression", async () => {
    const r = await api.save(poToken, sAnchor.familyId, sAnchor.versionId, body56());
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    expect(r.data.error).toBeUndefined();

    // Exactly the 3 documented keys - save creates nothing new and leaks nothing.
    expect(Object.keys(r.data.data).sort()).toEqual(["contractId", "familyId", "versionId"]);
    expect(r.data.data.familyId).toBe(sAnchor.familyId);
    expect(r.data.data.versionId).toBe(sAnchor.versionId);
    expect(r.data.data.contractId).toMatch(CONTRACT_ID_RE);
    // The contract id is the one assigned at upload, not minted at save.
    expect(r.data.data.contractId).toBe(sAnchor.contractId);

    // The version is now reachable at CON-04 (Endpoint #10).
    const d = await api.detail(poToken, sAnchor.familyId);
    expect(d.status).toBe(200);
    assertResponseTime(r);
  }, CASE_MS);

  test("TC-CTAPI-057 save persists all 20 fields, verified read-after-write @regression", async () => {
    // 16 unique markers so a field-to-column swap is unmistakable; a copy of the
    // extracted values could not distinguish a swap from a correct write.
    const markers: Record<string, unknown> = {};
    FREE_TEXT_FIELDS.forEach((f, i) => {
      markers[f] = `QA-MARK-${String(i + 1).padStart(2, "0")}`;
    });
    const payload = body56(markers);

    const r = await api.save(poToken, sMarkers.familyId, sMarkers.versionId, payload);
    expect(r.status).toBe(200);
    assertResponseTime(r);

    const d = await api.detail(poToken, sMarkers.familyId);
    expect(d.status).toBe(200);
    const data = d.data.data;

    // 1. All 16 markers land in their correct group and field - none dropped, none swapped.
    for (const f of FREE_TEXT_FIELDS) {
      expect(detailField(data, f), `${FIELD_GROUP[f]}.${f} did not round-trip`).toBe(markers[f]);
    }
    // 2-4. The 4 scalars.
    expect(data.financialTerms.totalContractValue).toBe(250000);
    expect(datePart(data.keyDates.effectiveDate)).toBe("2026-05-01");
    expect(datePart(data.keyDates.expirationDate)).toBe("2027-07-30");
    expect(data.terminationAndContinuity.noticePeriodDays).toBe(30);

    // 5. No Stage 1 extracted value survives for a field the request supplied -
    // the reviewed value is authoritative (Endpoint #8 Processing 4b).
    for (const f of FREE_TEXT_FIELDS) {
      const stage1 = markersStage1[f];
      if (stage1 === undefined || stage1 === null || stage1 === "") continue;
      expect(detailField(data, f), `Stage 1 value survived for ${f}`).not.toBe(stage1);
    }
  }, CASE_MS);

  test("TC-CTAPI-058-1 save on a first upload fires Stage 2, each status transitioning once @regression", async () => {
    // 1. Pre-save: Stage 2 has produced nothing (US-CT-003 "Nothing before that
    // first successful Save has any ... data at all"). Captured in beforeAll.
    expect(stage2PreSave, "pre-save detail was not captured").toBeDefined();
    expect(stage2PreSave!.overview ?? null).toBeNull();
    expect(stage2PreSave!.summaryStatus ?? null).not.toBe("completed");
    expect(stage2PreSave!.clauseRiskStatus ?? null).not.toBe("completed");

    const r = await api.save(poToken, sStage2.familyId, sStage2.versionId, body56());
    expect(r.status).toBe(200);
    assertResponseTime(r);

    // 2. Immediately after the save BOTH statuses are `pending` - two jobs were
    // enqueued in parallel, not one (Endpoint #8 Processing 4c-4d).
    const immediate = await api.detail(poToken, sStage2.familyId);
    expect(immediate.status).toBe(200);
    expect(immediate.data.data.summaryStatus).toBe("pending");
    expect(immediate.data.data.clauseRiskStatus).toBe("pending");
    // riskCount is null while clause risk is pending (Endpoint #10 field note).
    expect(immediate.data.data.riskCount).toBeNull();

    // 3-4. Poll to terminal, then keep polling: no status may return to `pending`.
    const s2 = await waitForStage2(sStage2.familyId);
    expect(["completed", "failed"], `summaryStatus polls: ${s2.polls.join(",")}`).toContain(s2.summaryStatus);
    expect(["completed", "failed"]).toContain(s2.clauseRiskStatus);
    for (let i = 0; i < 5; i++) {
      const p = await api.detail(poToken, sStage2.familyId);
      expect(p.data.data.summaryStatus, "summaryStatus returned to pending").not.toBe("pending");
      expect(p.data.data.clauseRiskStatus, "clauseRiskStatus returned to pending").not.toBe("pending");
    }

    // 5. Once clause risk completes, riskCount is an integer (0 is valid, null is not).
    if (s2.clauseRiskStatus === "completed") {
      const fin = await api.detail(poToken, sStage2.familyId);
      expect(Number.isInteger(fin.data.data.riskCount), `riskCount was ${fin.data.data.riskCount}`).toBe(true);
    }
  }, CASE_MS);

  test("TC-CTAPI-058-3 a second save of an already-saved version does not re-trigger Stage 2 @regression", async () => {
    // Runs after TC-CTAPI-058-1, which saved this version and polled Stage 2 to
    // terminal (vitest executes a file's tests in declaration order).
    const before = await api.detail(poToken, sStage2.familyId);
    expect(before.status).toBe(200);
    const baseline = before.data.data;
    expect(baseline.summaryStatus, "precondition: first save's Stage 2 not terminal").not.toBe("pending");
    expect(baseline.clauseRiskStatus).not.toBe("pending");
    const baselineRisks = await api.risks(poToken, sStage2.familyId);
    const baselineClauses = await api.clauseComparison(poToken, sStage2.familyId);

    // Resend the identical body. The spec pins NO status for this - it documents
    // no error for a repeat save - so the code is RECORDED, never asserted
    // (TC-CTAPI-058-3 "Expected status: contract TBD"). The invariants below are
    // the actual contract and hold whichever status comes back.
    const r = await api.save(poToken, sStage2.familyId, sStage2.versionId, body56());
    // eslint-disable-next-line no-console
    console.log(`[TC-CTAPI-058-3] repeat save status = ${r.status} body = ${JSON.stringify(r.data).slice(0, 200)}`);
    expect([200, 400, 409, 422], `unexpected repeat-save status ${r.status}`).toContain(r.status);
    expect(r.status, "a repeat save must not 500").toBeLessThan(500);
    assertResponseTime(r);

    // 1. Neither status ever returns to `pending` across a 30 s observation window.
    for (let i = 0; i < 10; i++) {
      const p = await api.detail(poToken, sStage2.familyId);
      expect(p.data.data.summaryStatus, `summaryStatus re-entered pending on poll ${i}`).not.toBe("pending");
      expect(p.data.data.clauseRiskStatus, `clauseRiskStatus re-entered pending on poll ${i}`).not.toBe("pending");
      await new Promise((res) => setTimeout(res, 3_000));
    }

    const after = await api.detail(poToken, sStage2.familyId);
    // 2. The Executive Overview was not regenerated. Byte-identical, not "looks
    // similar" - AI prose is never asserted for content, only for identity here.
    expect(after.data.data.executiveOverview).toEqual(baseline.executiveOverview);
    // 3. riskCount and the risk list are unchanged.
    expect(after.data.data.riskCount).toEqual(baseline.riskCount);
    const afterRisks = await api.risks(poToken, sStage2.familyId);
    expect(afterRisks.data?.data).toEqual(baselineRisks.data?.data);
    // 4. The frozen clause snapshot was not rebuilt (the re-freeze in Processing
    // step 5e applies only to entry_point='update_contract').
    const afterClausesRes = await api.clauseComparison(poToken, sStage2.familyId);
    expect(afterClausesRes.data?.data).toEqual(baselineClauses.data?.data);
    // 5. The version stays saved and the family's status is unchanged.
    expect(after.data.data.status).toBe(baseline.status);
  }, CASE_MS);

  test("TC-CTAPI-065 save with every field omitted succeeds and blanks the extracted values @regression", async () => {
    // Spec: every one of the 20 fields is Required: No. US-CT-003: "Every field,
    // if left blank, saves as empty and displays '-' wherever shown".
    //
    // OPEN QUESTION Q12 (logged in Clarification Needed): the spec never
    // distinguishes an OMITTED key from an explicit null from an empty string.
    // Exactly ONE variant is authored here - the omitted-key variant, which is
    // what US-CT-003's "every field is submitted, blank or not" UI description
    // reduces to - and the observed behaviour is recorded below. The null and
    // empty-string variants are deliberately NOT guessed at.
    const stage1Populated = Object.entries(blankStage1)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k]) => k);

    const r = await api.save(poToken, sBlank.familyId, sBlank.versionId, {});
    expect(r.status, "an entirely empty body is a valid save - no field is required").toBe(200);
    expect(r.data.success).toBe(true);
    assertResponseTime(r);

    const d = await api.detail(poToken, sBlank.familyId);
    expect(d.status).toBe(200);
    const data = d.data.data;

    // 2. All five Summary groups are present with every documented key - the
    // labels still render even with no values.
    for (const g of ["keyDates", "references", "financialTerms", "terminationAndContinuity", "legalAndCompliance"]) {
      expect(data, `Summary group ${g} missing`).toHaveProperty(g);
    }
    for (const f of [...FREE_TEXT_FIELDS, ...SCALAR_FIELDS]) {
      expect(data[FIELD_GROUP[f]], `${FIELD_GROUP[f]}.${f} key missing`).toHaveProperty(f);
    }

    // 3. Every one of the 20 values is blank, INCLUDING the ones Stage 1 had
    // populated - the user's blank overwrites the extraction.
    const survived: string[] = [];
    for (const f of [...FREE_TEXT_FIELDS, ...SCALAR_FIELDS]) {
      const v = detailField(data, f);
      if (v !== null && v !== undefined && v !== "") survived.push(`${f}=${JSON.stringify(v)}`);
    }
    // eslint-disable-next-line no-console
    console.log(
      `[TC-CTAPI-065 / Q12] Stage 1 had populated: [${stage1Populated.join(", ")}]. ` +
        `After an omitted-key save, values still non-blank: [${survived.join(", ")}]`,
    );
    expect(survived, "omitted fields did not blank - the extraction survived the user's blank").toEqual([]);

    // 4. No deadline, since neither input was provided.
    expect(data.keyDates.noticeDeadline).toBeNull();
    // 5. Stage 2 still fires on an empty save. Both jobs are asynchronous and a fast
    //    one can already be `completed` by the time this reads back, so what is pinned
    //    is that each job was ENQUEUED - a null status would mean Stage 2 never fired,
    //    which is the regression this step exists to catch. Requiring `pending`
    //    exactly made the case fail whenever the clause job simply ran quickly.
    for (const [name, value] of [
      ["summaryStatus", data.summaryStatus],
      ["clauseRiskStatus", data.clauseRiskStatus],
    ] as const) {
      expect(value, `${name} must be set - Stage 2 did not fire on an empty save`).not.toBeNull();
      expect(["pending", "completed", "failed"], `unexpected ${name}`).toContain(value);
    }
  }, CASE_MS);
});

// ===========================================================================
// Validation rejections. A rejected save leaves the version untouched and
// therefore reusable, so the whole block shares ONE seed.
// ===========================================================================

/** The 422 envelope the spec pins for every validation failure on this endpoint. */
const VALIDATION_MESSAGE = "Failed to save. Please try again.";

/**
 * Assert the documented validation envelope and that `details.fields` names the
 * offending field and ONLY the offending field.
 *
 * Only ONE of the 20 per-field messages is specified - `totalContractValue`'s
 * "Must be between 0 and 999,999,999". For every other field the message is
 * `contract TBD`, so this asserts the envelope plus the presence of a non-empty
 * string under the offending key rather than inventing wording.
 */
function assertValidationRejected(r: any, field: string, expectedMessage?: string): void {
  expect(r.status, "spec 4.2 Endpoint #8 pins 422 for a validation failure, not 400").toBe(422);
  assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
  expect(r.data.error.message).toBe(VALIDATION_MESSAGE);
  const fields = r.data.error?.details?.fields;
  expect(fields, "error.details.fields is missing").toBeDefined();
  expect(fields, `details.fields does not name ${field}`).toHaveProperty(field);
  expect(typeof fields[field]).toBe("string");
  expect(String(fields[field]).length).toBeGreaterThan(0);
  if (expectedMessage !== undefined) expect(fields[field]).toBe(expectedMessage);
  // Only the offending field is named - the valid fields are absent.
  expect(Object.keys(fields)).toEqual([field]);
  expect(r.data.data).toBeUndefined();
  assertResponseTime(r);
}

/** The 20 field values plus the three Stage 2 observables, as a comparable snapshot. */
function snapshot(detailData: Record<string, any>): Record<string, unknown> {
  const snap: Record<string, unknown> = {
    summaryStatus: detailData?.summaryStatus ?? null,
    clauseRiskStatus: detailData?.clauseRiskStatus ?? null,
    riskCount: detailData?.riskCount ?? null,
    executiveOverview: detailData?.executiveOverview ?? null,
    status: detailData?.status ?? null,
    noticeDeadline: detailData?.keyDates?.noticeDeadline ?? null,
  };
  for (const f of [...FREE_TEXT_FIELDS, ...SCALAR_FIELDS]) snap[f] = detailField(detailData, f) ?? null;
  return snap;
}

describe("Endpoint #8 - validation rejections (one shared seed, every save expected to fail)", () => {
  let sReject: SeededVersion;
  let sDate: SeededVersion;
  let rejectBaseline: Record<string, unknown> = {};

  beforeAll(async () => {
    // Saved, not merely uploaded: assertNothingPersisted() and the date cases below read
    // state back through Endpoint #10, which 404s on an unsaved-only family (spec v1.7).
    [sReject, sDate] = await Promise.all([seedSaved(), seedSaved()]);
    // Seeding a SAVED version is itself the Stage 2 trigger, so both statuses start out
    // `pending`. Let Stage 2 settle before snapshotting, otherwise the baseline bakes in
    // `pending` and assertNothingPersisted() below reports the seed's own job as "Stage 2
    // was enqueued by a rejected save".
    await waitForStage2(sReject.familyId);
    const d = await api.detail(poToken, sReject.familyId);
    rejectBaseline = snapshot(d.data?.data ?? {});
  }, SEED_MS);

  /** Nothing was persisted and no Stage 2 was enqueued by the rejected save. */
  async function assertNothingPersisted(label: string): Promise<void> {
    const d = await api.detail(poToken, sReject.familyId);
    expect(d.status).toBe(200);
    expect(snapshot(d.data.data), `${label}: a rejected save changed persisted state`).toEqual(rejectBaseline);
    expect(d.data.data.summaryStatus, `${label}: Stage 2 was enqueued by a rejected save`).not.toBe("pending");
    expect(d.data.data.clauseRiskStatus, `${label}: Stage 2 was enqueued by a rejected save`).not.toBe("pending");
  }

  test("TC-CTAPI-062-3 save rejects totalContractValue at 1000000000 with 422 ERR_VALIDATION_FAILED @regression", async () => {
    const r = await api.save(poToken, sReject.familyId, sReject.versionId, body56({ totalContractValue: 1000000000 }));
    // The ONE per-field message the spec spells out, asserted verbatim including
    // the comma group separators (spec 4.2 Endpoint #8 Error 422 example).
    assertValidationRejected(r, "totalContractValue", "Must be between 0 and 999,999,999");
    await assertNothingPersisted("TC-CTAPI-062-3");
  }, CASE_MS);

  test("TC-CTAPI-062-4 save rejects a negative totalContractValue of -1 @regression", async () => {
    const r = await api.save(poToken, sReject.familyId, sReject.versionId, body56({ totalContractValue: -1 }));
    // Same documented range message - it covers both bounds ("No negatives.").
    assertValidationRejected(r, "totalContractValue", "Must be between 0 and 999,999,999");
    await assertNothingPersisted("TC-CTAPI-062-4");
    // The point of the case: rejected server-side, never silently coerced to 0 or
    // to its absolute value. If it had been coerced the save would have returned
    // 200 and the assertion above would already have failed.
  }, CASE_MS);

  test("TC-CTAPI-063-3 save rejects noticePeriodDays at 366 with 422 ERR_VALIDATION_FAILED @regression", async () => {
    const r = await api.save(poToken, sReject.familyId, sReject.versionId, body56({ noticePeriodDays: 366 }));
    // contract TBD on the per-field message - only totalContractValue's is pinned.
    assertValidationRejected(r, "noticePeriodDays");
    await assertNothingPersisted("TC-CTAPI-063-3");
  }, CASE_MS);

  test("TC-CTAPI-063-4 save rejects a negative noticePeriodDays of -1 @regression", async () => {
    const r = await api.save(
      poToken,
      sReject.familyId,
      sReject.versionId,
      body56({ noticePeriodDays: -1, expirationDate: "2027-12-31" }),
    );
    // contract TBD on the per-field message.
    assertValidationRejected(r, "noticePeriodDays");
    // Critically: no notice deadline AFTER the expiration date was ever computed.
    // A negative period would place the deadline past expiry and permanently
    // defeat the noticeDeadlineOverdue logic.
    await assertNothingPersisted("TC-CTAPI-063-4");
    // The seed is a SAVED version (Endpoint #10 404s on an unsaved-only family, spec v1.7), so
    // the family legitimately carries the notice deadline its OWN save computed. What the
    // rejected -1 must not do is move it - in particular it must never push it past expiry.
    const d = await api.detail(poToken, sReject.familyId);
    expect(d.data.data.keyDates.noticeDeadline).toBe(rejectBaseline.noticeDeadline);
    const deadline = d.data.data.keyDates.noticeDeadline;
    if (deadline) {
      expect(
        datePart(deadline)! <= datePart(d.data.data.keyDates.expirationDate ?? "9999-12-31")!,
        "a negative noticePeriodDays placed the notice deadline past expiry",
      ).toBe(true);
    }
  }, CASE_MS);

  test("TC-CTAPI-064-2 save rejects a free-text field at 501 characters @regression", async () => {
    const r = await api.save(
      poToken,
      sReject.familyId,
      sReject.versionId,
      body56({ paymentTerms: "B".repeat(501) }),
    );
    // 422, NOT a 200 with a truncated value - over-length input is rejected,
    // never silently trimmed. contract TBD on the per-field message.
    assertValidationRejected(r, "paymentTerms");
    await assertNothingPersisted("TC-CTAPI-064-2");
    // The 500-character accept half of the boundary is proven by TC-CTAPI-064-1
    // on its own seed, so it is not repeated here - saving this shared seed would
    // invalidate it for every other rejection case in this block.
  }, CASE_MS);

  test("TC-CTAPI-068-1 an Analyst attempting to save returns 403 and persists nothing @regression", async () => {
    const r = await api.save(poToken === "" ? "" : analystToken, sReject.familyId, sReject.versionId, body56());
    expect(r.status, "403, not 401 - the token is valid, only manage_contracts is missing").toBe(403);
    assertErrorEnvelope(r, "ERR_RBAC_FORBIDDEN");
    expect(r.status).not.toBe(401);
    assertResponseTime(r);

    // Nothing persisted and, critically, no Stage 2: an Analyst must not be able
    // to consume Bedrock capacity.
    await assertNothingPersisted("TC-CTAPI-068-1");
    // The same Analyst token still reads Endpoint #7, proving the rejection is
    // right-scoped rather than a blanket denial.
    const rv = await api.review(analystToken, sReject.familyId, sReject.versionId);
    expect(rv.status).toBe(200);
    assertResponseTime(rv);
  }, CASE_MS);

  test("TC-CTAPI-068-2 save without an Authorization header returns 401 @regression", async () => {
    const r = await api.save("", sReject.familyId, sReject.versionId, body56());
    expect(r.status).toBe(401);
    assertErrorEnvelope(r, "ERR_AUTH_INVALID_TOKEN");
    expect(r.data.data).toBeUndefined();
    // The body echoes none of the submitted values back.
    const raw = JSON.stringify(r.data);
    expect(raw).not.toContain("Delaware");
    expect(raw).not.toContain("250000");
    assertResponseTime(r);
    await assertNothingPersisted("TC-CTAPI-068-2");
  }, CASE_MS);

  test("TC-CTAPI-069-1 save with an unknown familyId returns 404, not a validation error @regression", async () => {
    const r = await api.save(poToken, MISSING_FAMILY, sReject.versionId, body56());
    // 404 not 422: the family check precedes field validation, so a bad family id
    // with a valid body must not surface as a validation error.
    expect(r.status).toBe(404);
    assertErrorEnvelope(r, "ERR_CONTRACT_NOT_FOUND");
    expect(r.status).not.toBe(422);
    assertResponseTime(r);
    await assertNothingPersisted("TC-CTAPI-069-1");
  }, CASE_MS);

  test("TC-CTAPI-069-2 save with an unknown versionId under a real family returns 404 @regression", async () => {
    const r = await api.save(poToken, sReject.familyId, MISSING_VERSION, body56());
    // contract TBD on the code - the spec never names a version-not-found code -
    // so only the status and the absence of a 500 are asserted.
    expect(r.status, "404, not 409 and not 422").toBe(404);
    expect(r.data.success).toBe(false);
    expect(typeof r.data.error?.code).toBe("string");
    assertResponseTime(r);
    await assertNothingPersisted("TC-CTAPI-069-2");
  }, CASE_MS);

  test("TC-CTAPI-067 save accepts an ISO date and round-trips it without transposition @regression", async () => {
    // RESOLVED by CLRE-331. This case previously hedged across a genuine spec
    // contradiction - Endpoint #8's request table said MM/DD/YYYY while the
    // Endpoint #7 and #10 response examples returned YYYY-MM-DD - and asserted only
    // the outcome both readings shared. The spec has since been corrected to ISO
    // 8601, so there is one documented format and the case asserts it directly.
    //
    // 2026-05-01 is deliberate: 05/01 and 01/05 are both valid dates, so a format
    // mismatch would corrupt the value silently rather than erroring.
    const r = await api.save(poToken, sDate.familyId, sDate.versionId, body56({ effectiveDate: "2026-05-01" }));
    expect(r.status, "the documented ISO 8601 format must be accepted").toBe(200);
    assertResponseTime(r);

    const d = await api.detail(poToken, sDate.familyId);
    // Must round-trip as 1 May 2026 - never as 5 January 2026.
    expect(datePart(d.data.data.keyDates.effectiveDate)).toBe("2026-05-01");

    // Step 4: the documented format always succeeds, bracketing the outcome.
    const ok = await api.save(poToken, sDate.familyId, sDate.versionId, body56({ effectiveDate: "2026-05-01" }));
    expect(ok.status, "the documented ISO 8601 format must be accepted").toBe(200);
    const d2 = await api.detail(poToken, sDate.familyId);
    expect(datePart(d2.data.data.keyDates.effectiveDate)).toBe("2026-05-01");
    assertResponseTime(ok);
  }, CASE_MS);

  // TC-CTAPI-069-3 is implemented in contracts.final.test.ts, against a well-formed
  // versionId this tenant does not own (the unowned-id proxy this suite uses in place
  // of a second tenant).
});
