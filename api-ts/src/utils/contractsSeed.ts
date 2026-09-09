/**
 * Seeding + fixture helpers for CEIQ-FEAT-009 (Contracts).
 *
 * Everything past Endpoint #1 needs a real uploaded document, so these helpers
 * drive the actual product flow (create -> Stage 1 extraction -> review -> save)
 * rather than faking state. There is no QA database access, so seeding is done
 * exclusively through the public API - which also means the seed path itself is
 * exercised on every run.
 *
 * Fixtures are two REAL contract PDFs supplied by the QA lead, living in
 * `tests/fixtures/contracts/`. They carry a machine-readable text layer
 * (ASCII85 + Flate encoded), which is what the backend's pdfexcavator parser
 * needs - spec 2.3 puts scanned image-only PDFs out of scope.
 */
import fs from "node:fs";
import path from "node:path";
import { contractsClient as api } from "../clients/contractsClient";
import { resetTokenCache } from "./tokenProvider";

/**
 * Resolved from the package root rather than `__dirname`, which is not defined in
 * ES module scope. Vitest runs with cwd at the api-ts package root, and so do the
 * npm scripts, so this is stable for both.
 */
const FIXTURE_DIR = path.resolve(process.cwd(), "tests/fixtures/contracts");

export interface ContractFixture {
  buffer: Buffer;
  filename: string;
  contentType: string;
  /** Ground-truth values readable from the document's own text. */
  truth: {
    vendorName: string;
    effectiveDate: string;
    expirationDate: string;
    totalContractValue: number;
    paymentTermsDays: number;
    noticePeriodDays: number;
    terminationForConvenienceDays: number;
  };
}

function load(filename: string): Buffer {
  const p = path.join(FIXTURE_DIR, filename);
  if (!fs.existsSync(p)) {
    throw new Error(
      `Contract fixture not found: ${p}. Both sample PDFs must be present in tests/fixtures/contracts/.`,
    );
  }
  return fs.readFileSync(p);
}

/**
 * Version 1 of the sample subscription agreement.
 *
 * Note the expiration date is 2026-01-31, which is in the PAST - so once this
 * version is Active, the spec 9.1 lazy-write transition moves the family to
 * `expired` on the next read. That makes it the right fixture for the
 * expired-state cases (and the wrong one for anything needing a live Active
 * contract - use V2 for that).
 */
export const CONTRACT_V1 = (): ContractFixture => ({
  buffer: load("subscription_agreement_review_dummy_data.pdf"),
  filename: "subscription_agreement_review_dummy_data.pdf",
  contentType: "application/pdf",
  truth: {
    vendorName: "Apex Technology Solutions Inc.",
    effectiveDate: "2025-02-01",
    expirationDate: "2026-01-31",
    totalContractValue: 120000,
    paymentTermsDays: 30,
    noticePeriodDays: 60,
    terminationForConvenienceDays: 90,
  },
});

/**
 * Version 2 - the same agreement with updated dates. Expiration 2026-12-31 is in
 * the FUTURE, so a family whose Active version is this one stays `active`.
 * The date deltas against V1 are what the version-comparison job should surface.
 */
export const CONTRACT_V2 = (): ContractFixture => ({
  buffer: load("subscription_agreement_review_dummy_data_updated_dates.pdf"),
  filename: "subscription_agreement_review_dummy_data_updated_dates.pdf",
  contentType: "application/pdf",
  truth: {
    vendorName: "Apex Technology Solutions Inc.",
    effectiveDate: "2025-08-31",
    expirationDate: "2026-12-31",
    totalContractValue: 120000,
    paymentTermsDays: 30,
    noticePeriodDays: 60,
    terminationForConvenienceDays: 90,
  },
});

/** A non-PDF/DOCX payload, for the ERR_INVALID_FILE_TYPE path. */
export const BAD_TYPE_FILE = () => ({
  buffer: Buffer.from("this is not a contract", "utf8"),
  filename: "notes.txt",
  contentType: "text/plain",
});

/**
 * A file 1 byte over the documented 25 MB limit, for ERR_FILE_TOO_LARGE.
 * Built in memory so no 25 MB blob is committed to the repo.
 */
export const OVERSIZE_FILE = () => ({
  buffer: Buffer.alloc(26 * 1024 * 1024 + 1, 0x20),
  filename: "oversize.pdf",
  contentType: "application/pdf",
});

export const MAX_SIZE_BYTES = 26_214_400; // 25 * 1024 * 1024, per spec error details


/**
 * Retry a seeding step once through a transient auth or connection failure.
 *
 * Long runs against QA intermittently see `ECONNRESET` and a follow-on 401
 * `ERR_AUTH_INVALID_TOKEN` even though the id token is a full 60 minutes old at
 * most. Without a retry a single blip in a `beforeAll` aborts the whole describe
 * and vitest reports every case in it as SKIPPED - which reads like coverage we
 * do not have, and hides whatever the tests would actually have found.
 *
 * The retry refreshes the token cache first, so a genuinely stale token is
 * replaced rather than replayed. A second failure is rethrown: seeding that
 * cannot succeed twice is a real problem and must not be swallowed.
 */
async function withSeedRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // The CODE matters as much as the message: axios surfaces a dropped TLS
    // handshake as "Client network socket disconnected before secure TLS connection
    // was established", whose text contains none of the tokens below while
    // err.code is still ECONNRESET. Matching on message alone let that one through
    // un-retried and skipped an entire describe.
    const msg = String((err as Error)?.message ?? err);
    const code = String((err as { code?: unknown })?.code ?? "");
    const transient =
      /401|ERR_AUTH_INVALID_TOKEN|ECONNRESET|ETIMEDOUT|ECONNABORTED|EAI_AGAIN|socket hang up|socket disconnected|network/i.test(msg) ||
      /ECONNRESET|ETIMEDOUT|ECONNABORTED|EAI_AGAIN|ERR_NETWORK/i.test(code);
    if (!transient) throw err;
    resetTokenCache();
    await new Promise((r) => setTimeout(r, 2000));
    return await fn();
  }
}

export interface SeededVersion {
  familyId: string;
  versionId: string;
  contractId: string;
  extractionStatus?: string;
  /** True when this is a PRE-EXISTING QA family handed back by the reuse fallback. */
  reused?: boolean;
}

/**
 * Families the reuse fallback handed out. They are real QA data that this run did NOT
 * create, so destroyFamily() must never delete them - see the guard there.
 */
const reusedFamilies = new Set<string>();

/**
 * Find an existing, already-extracted, SAVED family to read against.
 *
 * Only Endpoint #10-servable families qualify: a family is servable exactly when it has a
 * saved representative version (spec v1.7 SS9.5), which also means Stage 1 completed on it.
 * The newest-first default listing is useless for this during a Stage 1 outage - every recent
 * family is a stranded `in_review` upload - so this queries by lifecycle status instead, where
 * the healthy fixtures live (measured on QA 2026-09-09: 12 active / 20 expired / 16 terminated,
 * all detail-200). Returns null when nothing qualifies, so callers can fail with a real reason.
 *
 * NOTE: everything it returns has exactly ONE version on QA today, so it cannot satisfy a
 * multi-version need (comparisons, version lists, activate-another-version).
 */
export async function findReusableSavedFamily(
  token: string,
  statuses: string[] = ["active", "expired", "terminated", "expiring_soon"],
): Promise<SeededVersion | null> {
  for (const status of statuses) {
    const list = await api.list(token, { page: 1, limit: 20, status });
    if (list.status !== 200) continue;
    for (const row of (list.data?.data?.contracts ?? []) as Array<Record<string, string>>) {
      const familyId = row.familyId;
      if (!familyId) continue;
      const detail = await api.detail(token, familyId);
      if (detail.status !== 200) continue;
      const versions = await api.versions(token, familyId);
      const v = (versions.data?.data?.versions ?? [])[0] as Record<string, string> | undefined;
      const versionId = v?.versionId ?? v?.id ?? (detail.data?.data?.versionId as string | undefined);
      if (!versionId) continue;
      reusedFamilies.add(familyId);
      return {
        familyId,
        versionId,
        contractId: row.contractId ?? (detail.data?.data?.contractId as string),
        extractionStatus: "completed",
        reused: true,
      };
    }
  }
  return null;
}

/** Create a contract and wait for Stage 1 to finish. Does NOT save. */
export async function seedUploadedContract(
  token: string,
  opts: { fixture?: ContractFixture; contractType?: string; vendorId?: string; sourcingEventId?: string } = {},
): Promise<SeededVersion> {
  const fx = opts.fixture ?? CONTRACT_V1();
  return withSeedRetry("seedUploadedContract", async () => {
  const created = await api.create(token, {
    contractType: opts.contractType ?? "subscription_agreement_saas",
    vendorId: opts.vendorId,
    sourcingEventId: opts.sourcingEventId,
    file: { buffer: fx.buffer, filename: fx.filename, contentType: fx.contentType },
  });
  if (created.status !== 201) {
    throw new Error(`seed create failed: ${created.status} ${JSON.stringify(created.data).slice(0, 300)}`);
  }
  const { familyId, versionId, contractId } = created.data.data;
  const extractionStatus = await api.waitForExtraction(token, familyId, versionId);
  return { familyId, versionId, contractId, extractionStatus };
  });
}

/**
 * Create, wait for extraction, then Save - which is the one and only trigger for
 * Stage 2 (spec US-CT-003). Returns once Save returns, not once Stage 2 finishes.
 */
export async function seedSavedContract(
  token: string,
  opts: Parameters<typeof seedUploadedContract>[1] & {
    review?: Record<string, unknown>;
    /**
     * READ-ONLY CALLERS ONLY. When a fresh family cannot reach the saved state because
     * Stage 1 is unavailable (CLRE-398: `ai_provider_error` on every upload), fall back to an
     * existing saved family instead of throwing and taking the whole describe down with it.
     *
     * Do NOT set this on a block that activates, terminates, deletes, versions or saves over
     * the family - the fallback hands back real QA data shared with every other test.
     * destroyFamily() refuses to delete anything borrowed this way.
     */
    reuseIfStage1Unavailable?: boolean;
  } = {},
): Promise<SeededVersion> {
  if (opts.reuseIfStage1Unavailable) {
    try {
      return await seedSavedContractStrict(token, opts);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      // Only Stage 1 unavailability earns the fallback. A validation or auth failure is a
      // real defect and must still surface.
      if (!/ERR_EXTRACTION_NOT_COMPLETED|ERR_EXTRACTION_FAILED|ai_provider_error|extraction/i.test(msg)) throw err;
      const reused = await findReusableSavedFamily(token);
      if (!reused) throw err;
      console.warn(
        `[seed] Stage 1 unavailable (${msg.slice(0, 120)}) - reusing existing saved family ` +
          `${reused.contractId} / ${reused.familyId}. READ-ONLY: this family is shared QA data.`,
      );
      return reused;
    }
  }
  return seedSavedContractStrict(token, opts);
}

/** The real create -> extract -> save path. Throws when any step fails. */
async function seedSavedContractStrict(
  token: string,
  opts: Parameters<typeof seedUploadedContract>[1] & { review?: Record<string, unknown> } = {},
): Promise<SeededVersion> {
  const v = await seedUploadedContract(token, opts);
  return withSeedRetry("seedSavedContract", async () => {
  const review = await api.review(token, v.familyId, v.versionId);
  // Save back exactly what Stage 1 extracted unless the caller overrides fields,
  // so the saved values stay traceable to the document.
  const body = { ...(review.data?.data?.fields ?? review.data?.data ?? {}), ...(opts.review ?? {}) };
  const saved = await api.save(token, v.familyId, v.versionId, body as Record<string, unknown>);
  if (saved.status >= 400) {
    throw new Error(`seed save failed: ${saved.status} ${JSON.stringify(saved.data).slice(0, 300)}`);
  }
  return v;
  });
}


/**
 * A PDF the Stage 1 parser cannot read, for the `extraction_status = 'failed'` path.
 *
 * Verified on QA 2026-08-27: a valid `%PDF-1.4` header followed by NUL padding is
 * accepted by the upload endpoint (201) and then fails extraction, giving a real
 * `failed` version to test against. This is the only way found to induce a Stage 1
 * failure through the public API - there is no fault-injection hook - and it
 * unblocks the retry, review-after-failure and save-after-failure cases.
 *
 * Note a structurally valid PDF with NO text layer extracts to `completed`, so it
 * is NOT a route to a failure; only a corrupt body is.
 */
export const UNPARSEABLE_PDF = () => ({
  buffer: Buffer.concat([
    Buffer.from("%PDF-1.4", "latin1"),
    Buffer.from([0x0a]),
    Buffer.alloc(400, 0),
  ]),
  filename: "unparseable-contract.pdf",
  contentType: "application/pdf",
});

/** Create a contract whose Stage 1 extraction FAILS, and wait for that state. */
export async function seedFailedExtraction(token: string): Promise<SeededVersion> {
  return withSeedRetry("seedFailedExtraction", async () => {
    const fx = UNPARSEABLE_PDF();
    const created = await api.create(token, {
      contractType: "msa_services",
      file: { buffer: fx.buffer, filename: fx.filename, contentType: fx.contentType },
    });
    if (created.status !== 201) {
      throw new Error(`seedFailedExtraction create failed: ${created.status}`);
    }
    const { familyId, versionId, contractId } = created.data.data;
    const extractionStatus = await api.waitForExtraction(token, familyId, versionId, 150_000, 4_000);
    if (extractionStatus !== "failed") {
      throw new Error(`expected extraction to fail, got '${extractionStatus}' - the unparseable fixture may no longer trigger it`);
    }
    return { familyId, versionId, contractId, extractionStatus };
  });
}

/**
 * Best-effort teardown. Never throws - cleanup must not mask a real failure - but it
 * is no longer SILENT.
 *
 * This helper used to discard the response entirely. That hid a live 500 on
 * Endpoint #11 for an unknown period: every teardown "succeeded" while the endpoint
 * was failing on its success path. A warning costs nothing and keeps a broken
 * cleanup visible in the run output without failing the test that owns the verdict.
 */
export async function destroyFamily(token: string, familyId?: string): Promise<void> {
  if (!familyId) return;
  // NEVER delete a family the reuse fallback borrowed - this run did not create it, and
  // deleting it would silently destroy the very pool the fallback depends on.
  if (reusedFamilies.has(familyId)) {
    console.warn(`[teardown] skipping delete of REUSED family ${familyId} (pre-existing QA data)`);
    return;
  }
  try {
    const r = await api.deleteFamily(token, familyId);
    if (r.status >= 400) {
      console.warn(`[teardown] delete family ${familyId} -> ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    }
  } catch (e) {
    console.warn(`[teardown] delete family ${familyId} threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}
