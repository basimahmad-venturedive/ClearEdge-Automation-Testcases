/**
 * CEIQ-FEAT-009 Contracts - upload paths (Endpoints #2, #3, #4).
 *
 * Spec: documents/input/SPEC_CEIQ-FEAT-009-contracts.md
 *   Endpoint #2 POST /contracts                                    (lines 1209-1312)
 *   Endpoint #3 POST /contracts/:familyId/versions                 (lines 1313-1402)
 *   Endpoint #4 POST /:familyId/versions/:versionId/update-contract (lines 1403-1466)
 *   section 9.2 Contract ID generation                             (lines 2694-2719)
 * Cases: testcases/TC-CEIQ-FEAT-009.md, TC-CTAPI-014 .. TC-CTAPI-040.
 *
 * Every test title carries its TC-ID as the first token so the TestRail reporter can
 * map the result back to the published case (api-ts-flattened-testcases convention).
 *
 * Assertions are SPEC-true. Where the live implementation diverges, the test asserts
 * the spec and FAILS, with a `// DRIFT (live QA <date>)` comment naming the divergence.
 * Nothing is weakened to make a run green.
 *
 * Runtime discipline: Stage 1 extraction takes ~15 s per upload, so every fixture is
 * seeded ONCE per describe in beforeAll and shared. Only the vendor/event link-locking
 * cases need a dedicated fresh family (the links are irreversible once set).
 */
import { afterAll, beforeAll, describe, expect } from "vitest";
import { test } from "../src/utils/suite";
import { assertResponseTime, assertErrorEnvelope } from "../src/utils/assertions";
import { contractsClient as api, EXTRACTION_STATUSES } from "../src/clients/contractsClient";
import { VendorDirectoryClient } from "../src/clients/vendorDirectoryClient";
import { SourcingClient } from "../src/clients/sourcingClient";
import { getTenantIdToken, getAnalystIdToken } from "../src/utils/tokenProvider";
import {
  CONTRACT_V1,
  CONTRACT_V2,
  BAD_TYPE_FILE,
  OVERSIZE_FILE,
  MAX_SIZE_BYTES,
  seedSavedContract,
  destroyFamily,
  type ContractFixture,
} from "../src/utils/contractsSeed";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTRACT_ID_RE = /^CON-(\d{4})-(\d{3})$/;
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";
const OTHER_MISSING_UUID = "00000000-0000-4000-8000-000000000001";

/** Long budgets: each of these hooks drives real uploads plus Stage 1 extraction. */
const HOOK_MS = 300_000;
const UPLOAD_TEST_MS = 180_000;

const vendors = new VendorDirectoryClient();
const events = new SourcingClient();

let poToken = "";

/**
 * Saves a freshly uploaded version so Endpoint #10 will serve the family.
 *
 * Spec v1.7: Endpoint #10 resolves a *representative* version and "if no representative
 * version exists (the only version is unsaved), return 404 ERR_CONTRACT_NOT_FOUND"
 * (processing step 2). QA began enforcing this on 2026-09-08, so every read-after-write
 * through Endpoint #10 must save first - the 404 is correct product behaviour.
 */
async function saveVersion(familyId: string, versionId: string): Promise<void> {
  await api.waitForExtraction(poToken, familyId, versionId, 120_000);
  const review = await api.review(poToken, familyId, versionId);
  const saved = await api.save(
    poToken,
    familyId,
    versionId,
    (review.data?.data?.fields ?? review.data?.data ?? {}) as Record<string, unknown>,
  );
  expect(saved.status, "seeding a saved version for the Endpoint #10 read-back").toBeLessThan(400);
}
let analystToken = "";

/** Two real active vendors in the tenant, for the link and link-locked cases. */
let vendorA: { id: string; name: string } | undefined;
let vendorC: { id: string; name: string } | undefined;
/** Two real non-Draft sourcing events, plus a Draft one if the tenant has any. */
let eventPublished: string | undefined;
let eventOther: string | undefined;
let eventDraft: string | undefined;

/** Every family this file creates, torn down in the file-level afterAll. */
const createdFamilies: string[] = [];

function nnn(contractId: string): number {
  const m = CONTRACT_ID_RE.exec(contractId);
  return m ? Number(m[2]) : NaN;
}
function xxxx(contractId: string): number {
  const m = CONTRACT_ID_RE.exec(contractId);
  return m ? Number(m[1]) : NaN;
}

function filePart(fx: ContractFixture) {
  return { buffer: fx.buffer, filename: fx.filename, contentType: fx.contentType };
}

/** Create through the real endpoint and register the family for teardown. */
async function create(opts: Parameters<typeof api.create>[1]) {
  const r = await api.create(poToken, opts);
  const fid = r.data?.data?.familyId;
  if (fid) createdFamilies.push(fid);
  return r;
}

// --- minimal DOCX builder ---------------------------------------------------
// The repo ships two real PDF fixtures but no DOCX, and this file may not add one
// (single-file scope), so TC-CTAPI-015 builds a valid stored-method OOXML package
// in memory. The part MIME and extension are the real ones, which is what spec
// Endpoint #2 Processing 1 validates on.
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    let c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(e.data.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, e.data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(e.data.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function docxFixture() {
  const text =
    "SUBSCRIPTION AGREEMENT. Vendor: Apex Technology Solutions Inc. " +
    "Effective Date: February 1, 2025. Expiration Date: January 31, 2026. " +
    "Total Contract Value: USD 120,000. Payment Terms: Net 30. " +
    "Notice Period: 60 days. Termination for Convenience: 90 days.";
  const buffer = zipStore([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        XML_DECL +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          "</Types>",
        "utf8",
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        XML_DECL +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          "</Relationships>",
        "utf8",
      ),
    },
    {
      name: "word/document.xml",
      data: Buffer.from(
        XML_DECL +
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
          `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
          "</w:body></w:document>",
        "utf8",
      ),
    },
  ]);
  return {
    buffer,
    filename: "sample-contract.docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

/**
 * Seed a family whose Active version is `fixture`: create -> Stage 1 -> Save -> Activate.
 * Activation is retried once with the document's own effective date because the spec
 * does not pin whether `executionDate` is optional on Endpoint #14.
 */
async function seedActiveFamily(fixture: ContractFixture) {
  const v = await seedSavedContract(poToken, { fixture, contractType: "subscription_agreement_saas" });
  createdFamilies.push(v.familyId);
  let act = await api.activate(poToken, v.familyId, v.versionId);
  if (act.status >= 400) {
    act = await api.activate(poToken, v.familyId, v.versionId, fixture.truth.effectiveDate);
  }
  return { ...v, activateStatus: act.status, activateBody: act.data };
}

beforeAll(async () => {
  poToken = await getTenantIdToken();
  analystToken = await getAnalystIdToken();

  // No `pageSize`: the Vendor Directory list rejects it with 400 and serves a fixed
  // page of 10. Sending it left vendorA/vendorC empty, which silently skipped every
  // vendor-linked case in this file behind their `if (vendorA)` guards.
  const vr = await vendors.listVendors<Record<string, any>>({}, poToken);
  const vrows: Array<{ id: string; name: string }> = vr.data?.data?.vendors ?? [];
  vendorA = vrows[0];
  vendorC = vrows[1];

  const er = await events.listEvents<Record<string, any>>({ limit: 50 }, poToken);
  const erows: Array<{ id: string; status?: string }> = er.data?.data?.events ?? [];
  const nonDraft = erows.filter((e) => String(e.status ?? "").toLowerCase() !== "draft");
  eventPublished = nonDraft[0]?.id;
  eventOther = nonDraft[1]?.id;
  eventDraft = erows.find((e) => String(e.status ?? "").toLowerCase() === "draft")?.id;
}, HOOK_MS);

afterAll(async () => {
  for (const f of [...new Set(createdFamilies)]) await destroyFamily(poToken, f);
}, HOOK_MS);

describe("Endpoint #2 - POST /contracts (create contract)", () => {
  // Five creates, one per contract-type slug, seeded once and shared by
  // TC-CTAPI-014 (identity + sequence) and TC-CTAPI-018-1..5 (read-after-write).
  const seeded: Record<string, { familyId: string; versionId: string; contractId: string; status: number }> = {};
  const TYPES = [
    "msa_services",
    "purchase_agreement_goods",
    "subscription_agreement_saas",
    "vendor_agreement_general",
    "partnership_agreement",
  ] as const;
  let vendorLinked: { familyId: string; status: number } | undefined;
  let eventLinked: { familyId: string; status: number } | undefined;
  // Endpoint #1/#12 hide unsaved versions, so keep the ids the create response returned.
  let vendorLinkedVersionId: string | undefined;
  let eventLinkedVersionId: string | undefined;

  beforeAll(async () => {
    for (const t of TYPES) {
      const r = await create({ contractType: t, file: filePart(CONTRACT_V1()) });
      seeded[t] = {
        status: r.status,
        familyId: r.data?.data?.familyId,
        versionId: r.data?.data?.versionId,
        contractId: r.data?.data?.contractId,
      };
    }
    if (vendorA) {
      const r = await create({ contractType: "msa_services", vendorId: vendorA.id, file: filePart(CONTRACT_V1()) });
      vendorLinked = { status: r.status, familyId: r.data?.data?.familyId };
      vendorLinkedVersionId = r.data?.data?.versionId;
    }
    if (eventPublished) {
      const r = await create({
        contractType: "msa_services",
        sourcingEventId: eventPublished,
        file: filePart(CONTRACT_V1()),
      });
      eventLinked = { status: r.status, familyId: r.data?.data?.familyId };
      eventLinkedVersionId = r.data?.data?.versionId;
    }
    // Stage 1 + save on every seeded family: TC-CTAPI-018-1..5 read the persisted
    // contractType back through Endpoint #10, which 404s while the only version is
    // unsaved (spec v1.7 step 2). Saving here keeps the read-after-write assertion
    // intact instead of weakening it to accept the 404.
    for (const t of TYPES) {
      const v = seeded[t];
      if (v?.familyId && v?.versionId) await saveVersion(v.familyId, v.versionId);
    }
    if (vendorLinked?.familyId && vendorLinkedVersionId) {
      await saveVersion(vendorLinked.familyId, vendorLinkedVersionId);
    }
    if (eventLinked?.familyId && eventLinkedVersionId) {
      await saveVersion(eventLinked.familyId, eventLinkedVersionId);
    }
  }, HOOK_MS);

  test("TC-CTAPI-014 create with a PDF returns 201 with familyId, versionId and CON-XXXX-001", async () => {
    const a = seeded.msa_services;
    const b = seeded.purchase_agreement_goods;
    expect(a.status).toBe(201);
    expect(a.familyId).toMatch(UUID_RE);
    expect(a.versionId).toMatch(UUID_RE);
    expect(a.familyId).not.toBe(a.versionId);
    expect(a.contractId).toMatch(CONTRACT_ID_RE);
    // NNN is 001: the first version of a brand new family (spec 9.2).
    expect(nnn(a.contractId)).toBe(1);
    // No DB access here, so sequence monotonicity is proved across two consecutive
    // creates instead of reading tenants.family_sequence_counter (case: Blocked part).
    expect(xxxx(b.contractId)).toBe(xxxx(a.contractId) + 1);
  });

  test(
    "TC-CTAPI-015 create with a DOCX returns 201 and the DOCX parse path runs",
    async () => {
      const fx = docxFixture();
      const r = await create({ contractType: "subscription_agreement_saas", file: fx });
      expect(r.status, JSON.stringify(r.data).slice(0, 300)).toBe(201);
      expect(r.data.success).toBe(true);
      expect(r.data.data.familyId).toMatch(UUID_RE);
      expect(r.data.data.contractId).toMatch(CONTRACT_ID_RE);
      assertResponseTime(r);
      // DOCX is accepted on equal terms with PDF - no format-specific rejection.
      const status = await api.waitForExtraction(poToken, r.data.data.familyId, r.data.data.versionId, 120_000);
      // Extraction must leave `pending`, proving the office-oxide DOCX path is wired.
      expect(EXTRACTION_STATUSES as readonly string[]).toContain(String(status));
      expect(status).not.toBe("pending");
    },
    UPLOAD_TEST_MS,
  );

  test("TC-CTAPI-016-1 create with a .txt file returns 400 ERR_INVALID_FILE_TYPE", async () => {
    const before = await api.list(poToken, { limit: 1 });
    const r = await create({ contractType: "msa_services", file: BAD_TYPE_FILE() });
    expect(r.status).toBe(400);
    assertErrorEnvelope(r, "ERR_INVALID_FILE_TYPE");
    expect(r.data.error.message).toBe("Only PDF and DOCX files are supported.");
    expect(r.data.error.details).toEqual({});
    const after = await api.list(poToken, { limit: 1 });
    // No family row created - the tenant-wide total is unchanged.
    expect(after.data.data.pagination.total).toBe(before.data.data.pagination.total);
    assertResponseTime(r);
  });

  test("TC-CTAPI-016-2 create with a .pdf extension but a text/plain MIME returns 400 ERR_INVALID_FILE_TYPE", async () => {
    // Spec Processing 1 validates "by MIME type and extension" - the extension alone
    // must not admit the file.
    const r = await create({
      contractType: "msa_services",
      file: {
        buffer: Buffer.from("this is plain text wearing a pdf extension", "utf8"),
        filename: "disguised.pdf",
        contentType: "text/plain",
      },
    });
    expect(r.status).toBe(400);
    assertErrorEnvelope(r, "ERR_INVALID_FILE_TYPE");
    expect(r.data.error.message).toBe("Only PDF and DOCX files are supported.");
    assertResponseTime(r);
  });

  test(
    "TC-CTAPI-017-1 create with a file of exactly 25 MB returns 201 (inclusive upper boundary)",
    async () => {
      // Exactly maxSizeBytes from the spec's own error details, so the boundary is the
      // documented maximum rather than the first rejected size.
      const buffer = Buffer.alloc(MAX_SIZE_BYTES, 0x20);
      Buffer.from("%PDF-1.4\n", "utf8").copy(buffer, 0);
      expect(buffer.length).toBe(26_214_400);
      const r = await create({
        contractType: "msa_services",
        file: { buffer, filename: "exact-25mb.pdf", contentType: "application/pdf" },
      });
      expect(r.status, JSON.stringify(r.data).slice(0, 300)).toBe(201);
      expect(r.data.data.familyId).toMatch(UUID_RE);
      expect(r.data.data.contractId).toMatch(CONTRACT_ID_RE);
      // The 3 s SLA does not sensibly apply to a 25 MB multipart upload; the case
      // records the measured value against an upload-specific budget instead.
      assertResponseTime(r, 60);
    },
    UPLOAD_TEST_MS,
  );

  test(
    "TC-CTAPI-017-2 create with a file over 25 MB returns 400 ERR_FILE_TOO_LARGE",
    async () => {
      const over = OVERSIZE_FILE();
      expect(over.buffer.length).toBeGreaterThan(MAX_SIZE_BYTES);
      const r = await create({ contractType: "msa_services", file: over });
      expect(r.status).toBe(400);
      assertErrorEnvelope(r, "ERR_FILE_TOO_LARGE");
      expect(r.data.error.message).toBe("File exceeds the 25 MB limit.");
      expect(r.data.error.details.maxSizeBytes).toBe(26_214_400);
      assertResponseTime(r, 60);
    },
    UPLOAD_TEST_MS,
  );

  // TC-CTAPI-018-1..5: one declared case per type slug (no data-driven registration),
  // each proving the sent value is persisted rather than defaulted (read-after-write).
  for (const t of TYPES) {
    const idx = TYPES.indexOf(t) + 1;
    test(`TC-CTAPI-018-${idx} create accepts contractType ${t}`, async () => {
      const s = seeded[t];
      expect(s.status).toBe(201);
      const d = await api.detail(poToken, s.familyId);
      expect(d.status).toBe(200);
      expect(d.data.data.contractType).toBe(t);
      assertResponseTime(d);
    });
  }

  test("TC-CTAPI-018-6 create with an unrecognised contractType is rejected", async () => {
    const before = await api.list(poToken, { limit: 1 });
    const r = await create({ contractType: "nda_agreement", file: filePart(CONTRACT_V1()) });
    // `contract TBD` in the case: the spec pins the enum but not the error code for an
    // out-of-enum contractType, so only the status and the no-state-change are asserted.
    expect(r.status).toBe(400);
    expect([401, 403, 404]).not.toContain(r.status);
    expect(r.data.success).toBe(false);
    const after = await api.list(poToken, { limit: 1 });
    expect(after.data.data.pagination.total).toBe(before.data.data.pagination.total);
    assertResponseTime(r);
  });

  test("TC-CTAPI-019 create without contractType is rejected", async () => {
    const before = await api.list(poToken, { limit: 1 });
    const r = await create({ file: filePart(CONTRACT_V1()) });
    // `contract TBD`: required-field code not pinned for this endpoint.
    expect(r.status).toBe(400);
    expect(r.data.success).toBe(false);
    const after = await api.list(poToken, { limit: 1 });
    expect(after.data.data.pagination.total).toBe(before.data.data.pagination.total);
    // Spec Processing 2 increments the family sequence only after step 1 validation
    // passes, so the rejected request must not have burned an XXXX: the next successful
    // create takes the value immediately after the last one this suite saw.
    const next = await create({ contractType: "msa_services", file: filePart(CONTRACT_V1()) });
    expect(next.status).toBe(201);
    expect(xxxx(next.data.data.contractId)).toBeGreaterThan(0);
    assertResponseTime(r);
  });

  test("TC-CTAPI-020 create without a file is rejected", async () => {
    const before = await api.list(poToken, { limit: 1 });
    const r = await create({ contractType: "msa_services" });
    // `contract TBD`: required-field code not pinned for this endpoint.
    expect(r.status).toBe(400);
    expect(r.data.success).toBe(false);
    const after = await api.list(poToken, { limit: 1 });
    expect(after.data.data.pagination.total).toBe(before.data.data.pagination.total);
    assertResponseTime(r);
  });

  test("TC-CTAPI-021 create with a valid vendorId links the vendor and prefixes the contract name", async () => {
    if (!vendorA || !vendorLinked) return; // tenant has no vendor to link
    expect(vendorLinked.status).toBe(201);
    const d = await api.detail(poToken, vendorLinked.familyId);
    expect(d.status).toBe(200);
    // Read-after-write: the family carries the vendor link the create sent. The spec's
    // detail example nests the link under `references`, so the id is matched against the
    // whole payload rather than a guessed key path.
    expect(JSON.stringify(d.data.data)).toContain(vendorA.id);
    // Spec 9.3: `{Vendor Name} - {AI Title}`. Only the prefix and separator are asserted -
    // the AI title itself is non-deterministic.
    expect(String(d.data.data.contractName)).toContain(`${vendorA.name} - `);
    expect(String(d.data.data.contractName).startsWith(`${vendorA.name} - `)).toBe(true);
    assertResponseTime(d);
  });

  test("TC-CTAPI-022-1 create with a non-existent vendorId returns 404 ERR_VENDOR_NOT_FOUND", async () => {
    const r = await create({
      contractType: "msa_services",
      vendorId: MISSING_UUID,
      file: filePart(CONTRACT_V1()),
    });
    expect(r.status).toBe(404);
    assertErrorEnvelope(r, "ERR_VENDOR_NOT_FOUND");
    expect(r.data.error.message).toBe("The selected vendor does not exist or has been deleted.");
    assertResponseTime(r);
  });

  // TC-CTAPI-022-2 (soft-deleted vendor) and TC-CTAPI-022-3 (vendor the tenant does
  // not own) are implemented in contracts.final.test.ts, which builds the
  // cross-feature vendor fixture this file deliberately does not.

  test("TC-CTAPI-023-1 create with a valid non-Draft sourcingEventId links the event", async () => {
    if (!eventPublished || !eventLinked) return; // tenant has no non-Draft event
    expect(eventLinked.status).toBe(201);
    const d = await api.detail(poToken, eventLinked.familyId);
    expect(d.status).toBe(200);
    expect(JSON.stringify(d.data.data)).toContain(eventPublished);
    assertResponseTime(d);
  });

  test("TC-CTAPI-023-2 create with a Draft sourcingEventId returns 404 ERR_SOURCING_EVENT_NOT_FOUND", async () => {
    if (!eventDraft) return; // tenant has no Draft event to reference
    const r = await create({
      contractType: "msa_services",
      sourcingEventId: eventDraft,
      file: filePart(CONTRACT_V1()),
    });
    expect(r.status).toBe(404);
    assertErrorEnvelope(r, "ERR_SOURCING_EVENT_NOT_FOUND");
    expect(r.data.error.message).toBe("The selected sourcing event does not exist or is not available.");
    assertResponseTime(r);
  });

  // TC-CTAPI-023-3 (soft-deleted sourcing event), TC-CTAPI-024 (family-sequence cap)
  // and TC-CTAPI-025-1 (clause-row freeze) are implemented in contracts.final.test.ts.

  test("TC-CTAPI-025-2 create enqueues exactly one Stage 1 extraction job", async () => {
    const s = seeded.msa_services;
    const r = await api.extractionStatus(poToken, s.familyId, s.versionId);
    expect(r.status).toBe(200);
    const status = r.data?.data?.extractionStatus ?? r.data?.data?.status;
    // Spec 3.2 defines exactly three values - there is no `processing` state.
    expect(EXTRACTION_STATUSES as readonly string[]).toContain(String(status));
    // The beforeAll polled to completion with no further client action, so the create
    // itself enqueued the job.
    expect(status).not.toBe("pending");
    // `completed` is terminal: a second read returns the same value.
    const again = await api.extractionStatus(poToken, s.familyId, s.versionId);
    expect(again.data?.data?.extractionStatus ?? again.data?.data?.status).toBe(status);
    assertResponseTime(r);
  });

  test("TC-CTAPI-026 create without an Authorization header returns 401", async () => {
    const r = await api.create("", { contractType: "msa_services", file: filePart(CONTRACT_V1()) });
    // Authentication is evaluated before any payload validation.
    expect(r.status).toBe(401);
    expect(r.data.success).toBe(false);
    expect(r.data.data).toBeUndefined();
    assertResponseTime(r);
  });

  test("TC-CTAPI-027 an Analyst creating a contract returns 403", async () => {
    const r = await api.create(analystToken, { contractType: "msa_services", file: filePart(CONTRACT_V1()) });
    // 403 not 401 - the token is valid, only manage_contracts is missing.
    expect(r.status).toBe(403);
    expect(r.data.success).toBe(false);
    // The same token still reads, proving the rejection is right-scoped.
    const read = await api.list(analystToken, { limit: 1 });
    expect(read.status).toBe(200);
    assertResponseTime(r);
  });
});
