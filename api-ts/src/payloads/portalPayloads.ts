/**
 * Request payloads + factories for CEIQ-FEAT-008 (Vendor Submission Portal).
 * SPEC §4.2 #1a (presign upload-url body) and #2 (submit body: price / deliveryWeeks /
 * answers / optional pending-attachment metadata). No secrets, no base URLs, no real
 * portal tokens live here — tokens come from the env accessor (config/env.ts).
 *
 * Spec-pinned constants use UPPER_SNAKE_CASE; factories return fresh objects so tests
 * stay independent. Every negative/boundary shape is a named factory/const so no
 * request-body literal is inlined in the test file (api-automation.rules §Test data).
 */

// --- Allowed content types (SPEC §4.2 #1a: PDF or DOCX pair only) ---
export const CONTENT_TYPE_PDF = "application/pdf";
export const CONTENT_TYPE_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Upper attachment-size bound: 10 MB = 10,485,760 bytes (SPEC §4.2 #1a step 3). */
export const MAX_FILE_SIZE_BYTES = 10_485_760;

// ===========================================================================
// Endpoint #1a — presign request bodies
// ===========================================================================
export interface PresignRequestBody {
  filename: string;
  contentType: string;
  fileSizeBytes: number;
}

/** A fresh, valid DOCX presign request (5 MB) — the presign happy path (TC-VPAPI-014). */
export function presignRequest(overrides: Partial<PresignRequestBody> = {}): PresignRequestBody {
  return {
    filename: "meridian-proposal.docx",
    contentType: CONTENT_TYPE_DOCX,
    fileSizeBytes: 5_242_880,
    ...overrides,
  };
}

/** Valid PDF presign request (1 MB) — used by the presign-contract case (TC-VPAPI-021). */
export const PRESIGN_PDF_VALID: PresignRequestBody = presignRequest({
  filename: "meridian-proposal.pdf",
  contentType: CONTENT_TYPE_PDF,
  fileSizeBytes: 1_048_576,
});

/** Path-traversal filename — key must be server-generated, raw name excluded (TC-VPAPI-015 / VPSEC-008). */
export const PRESIGN_TRAVERSAL_FILENAME: PresignRequestBody = presignRequest({
  filename: "../../evil/../secret payload.docx",
  fileSizeBytes: 1024,
});

/** Disallowed type (.exe) → 400 ERR_FILE_TYPE_NOT_ALLOWED (TC-VPAPI-016). */
export const PRESIGN_DISALLOWED_TYPE: PresignRequestBody = {
  filename: "malware.exe",
  contentType: "application/x-msdownload",
  fileSizeBytes: 2048,
};

/** Exactly at the 10 MB limit — accepted (TC-VPAPI-017 boundary, in). */
export const PRESIGN_AT_LIMIT: PresignRequestBody = presignRequest({
  filename: "big.pdf",
  contentType: CONTENT_TYPE_PDF,
  fileSizeBytes: MAX_FILE_SIZE_BYTES,
});

/** One byte over the 10 MB limit → 400 ERR_FILE_TOO_LARGE (TC-VPAPI-017 boundary, out). */
export const PRESIGN_OVER_LIMIT: PresignRequestBody = presignRequest({
  filename: "big.pdf",
  contentType: CONTENT_TYPE_PDF,
  fileSizeBytes: MAX_FILE_SIZE_BYTES + 1,
});

/** fileSizeBytes = 0 (must be > 0) → 400, reject code TBD (TC-VPAPI-018 boundary). */
export const PRESIGN_ZERO_SIZE: PresignRequestBody = presignRequest({
  filename: "empty.pdf",
  contentType: CONTENT_TYPE_PDF,
  fileSizeBytes: 0,
});

// ===========================================================================
// Endpoint #2 — submit request bodies
// ===========================================================================
export interface SubmitAnswer {
  questionId: string;
  answerText: string;
}

export interface SubmitAttachment {
  s3Key: string;
  filename: string;
  contentType: string;
  fileSizeBytes: number;
}

export interface SubmitRequestBody {
  price: number;
  deliveryWeeks: number;
  answers: SubmitAnswer[];
  attachment?: SubmitAttachment | null;
}

/** Placeholder vendor-question IDs used when a fixture has not supplied real ones. */
export const PLACEHOLDER_QUESTION_IDS = ["uuid-1", "uuid-2"] as const;

/** One answer per supplied question ID (SPEC §4.2 #2: exactly one entry per event question). */
export function newAnswers(questionIds: readonly string[] = PLACEHOLDER_QUESTION_IDS): SubmitAnswer[] {
  return questionIds.map((questionId, i) => ({
    questionId,
    answerText: `Answer ${i + 1}: our company proposes a compliant delivery plan.`,
  }));
}

/** A fresh, valid pending-attachment metadata block (issued by #1a). */
export function newAttachment(overrides: Partial<SubmitAttachment> = {}): SubmitAttachment {
  return {
    s3Key: "tenants/tenant-a/sourcing-events/event-a/proposals/proposal-a/uploads/upload-a.pdf",
    filename: "meridian-proposal.pdf",
    contentType: CONTENT_TYPE_PDF,
    fileSizeBytes: 245000,
    ...overrides,
  };
}

/** A fresh, valid submit body (no attachment by default) — the submit happy path. */
export function submitRequest(overrides: Partial<SubmitRequestBody> = {}): SubmitRequestBody {
  return {
    price: 85000,
    deliveryWeeks: 12,
    answers: newAnswers(),
    ...overrides,
  };
}

/** Valid submit WITH a pending attachment (TC-VPAPI-022 attachment branch). */
export function submitRequestWithAttachment(
  overrides: Partial<SubmitRequestBody> = {},
): SubmitRequestBody {
  return submitRequest({ attachment: newAttachment(), ...overrides });
}

// --- Negative / boundary submit variants (returned loosely so bad shapes are expressible) ---

/** price is a non-integer string → "Please enter a valid number" (TC-VPAPI-033 A). */
export const SUBMIT_PRICE_NON_INTEGER: Record<string, unknown> = {
  price: "abc",
  deliveryWeeks: 12,
  answers: newAnswers(),
};

/** price omitted → "Please provide a price" (TC-VPAPI-033 B). */
export const SUBMIT_PRICE_MISSING: Record<string, unknown> = {
  deliveryWeeks: 12,
  answers: newAnswers(),
};

/** deliveryWeeks omitted → "This field is required." (TC-VPAPI-034). */
export const SUBMIT_DELIVERY_MISSING: Record<string, unknown> = {
  price: 85000,
  answers: newAnswers(),
};

/** deliveryWeeks non-integer → "Please enter a valid number" (TC-VPAPI-034 variant). */
export const SUBMIT_DELIVERY_NON_INTEGER: Record<string, unknown> = {
  price: 85000,
  deliveryWeeks: "ten",
  answers: newAnswers(),
};

/** answers missing one required question ID (TC-VPAPI-035 A). */
export const SUBMIT_ANSWERS_MISSING: Record<string, unknown> = {
  price: 85000,
  deliveryWeeks: 12,
  answers: [{ questionId: "uuid-1", answerText: "only one" }],
};

/** answers with a duplicate question ID (TC-VPAPI-035 B). */
export const SUBMIT_ANSWERS_DUPLICATE: Record<string, unknown> = {
  price: 85000,
  deliveryWeeks: 12,
  answers: [
    { questionId: "uuid-1", answerText: "first" },
    { questionId: "uuid-1", answerText: "dup" },
    { questionId: "uuid-2", answerText: "second" },
  ],
};

/** answers referencing a question ID not on the event (TC-VPAPI-035 C). */
export const SUBMIT_ANSWERS_UNRELATED: Record<string, unknown> = {
  price: 85000,
  deliveryWeeks: 12,
  answers: [
    { questionId: "uuid-1", answerText: "ok" },
    { questionId: "uuid-99", answerText: "unrelated" },
  ],
};

/** first answerText empty → "This field is required." at answers[0].answerText (TC-VPAPI-036). */
export const SUBMIT_ANSWER_EMPTY_TEXT: Record<string, unknown> = {
  price: 85000,
  deliveryWeeks: 12,
  answers: [
    { questionId: "uuid-1", answerText: "" },
    { questionId: "uuid-2", answerText: "ok" },
  ],
};

/** price/deliveryWeeks just inside the >0 bound — accepted (TC-VPAPI-037 A). */
export const SUBMIT_JUST_INSIDE: SubmitRequestBody = submitRequest({ price: 1, deliveryWeeks: 1 });
/** price 0 — rejected (TC-VPAPI-037 B). */
export const SUBMIT_PRICE_ZERO: SubmitRequestBody = submitRequest({ price: 0 });
/** price negative — rejected (TC-VPAPI-037 C). */
export const SUBMIT_PRICE_NEGATIVE: SubmitRequestBody = submitRequest({ price: -100 });
/** deliveryWeeks 0 — rejected (TC-VPAPI-037 D). */
export const SUBMIT_DELIVERY_ZERO: SubmitRequestBody = submitRequest({ deliveryWeeks: 0 });

/** attachment s3Key pointing at a DIFFERENT proposal's prefix (TC-VPAPI-027). */
export const SUBMIT_FOREIGN_PREFIX_ATTACHMENT: SubmitRequestBody = submitRequestWithAttachment({
  attachment: newAttachment({
    s3Key: "tenants/tenant-a/sourcing-events/event-b/proposals/proposal-b/uploads/x.pdf",
  }),
});

/** attachment metadata that will not match the stored object's tag/type/size (TC-VPAPI-028). */
export const SUBMIT_MISMATCHED_ATTACHMENT: SubmitRequestBody = submitRequestWithAttachment({
  attachment: newAttachment({ fileSizeBytes: 999999 }),
});

/** attachment s3Key = arbitrary/absolute bucket (IDOR/SSRF-shaped) (TC-VPAPI-029 / VPSEC-005). */
export const SUBMIT_ARBITRARY_BUCKET_ATTACHMENT: SubmitRequestBody = submitRequestWithAttachment({
  attachment: newAttachment({ s3Key: "s3://attacker-bucket/anything.pdf" }),
});

/** valid body PLUS an unexpected client-supplied currency — must NOT be honored (TC-VPAPI-057). */
export const SUBMIT_WITH_CURRENCY: Record<string, unknown> = {
  ...submitRequest(),
  currency: "EUR",
};

/** valid body PLUS injected foreign IDs — must be ignored; vendorSession is authoritative (TC-VPSEC-003). */
export function submitWithInjectedIds(foreignId: string, foreignTenantId: string): Record<string, unknown> {
  return {
    ...submitRequest(),
    proposalId: foreignId,
    vendorId: foreignId,
    eventId: foreignId,
    tenantId: foreignTenantId,
  };
}

/** valid body whose attachment references a foreign TENANT prefix (cross-tenant, TC-VPSEC-005). */
export function submitCrossTenantAttachment(foreignTenantId: string): SubmitRequestBody {
  return submitRequestWithAttachment({
    attachment: newAttachment({
      s3Key: `tenants/${foreignTenantId}/sourcing-events/event-b/proposals/proposal-b/uploads/x.pdf`,
    }),
  });
}
