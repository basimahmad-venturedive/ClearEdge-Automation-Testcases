/**
 * Zod response schemas for CEIQ-FEAT-008 (Vendor Submission Portal), per SPEC §4.2
 * (Endpoint #1 resolve, #1a presign, #2 submit, #3 withdraw) and the F1 §9.2
 * `{ success, data|error }` envelope. Consumed by tests/vendorPortal.test.ts.
 *
 * Objects use `.passthrough()` so the schema validates the documented, vendor-safe
 * contract without failing on spec-silent additions — the budget/procurement-only
 * EXCLUSION is asserted separately by a dedicated deep-scan (TC-VPAPI-002 / VPSEC-011),
 * not by schema strictness. Spec-silent shapes (e.g. `proposal.retainedAttachment`,
 * v1.2, undocumented) are modelled leniently and flagged `contract TBD`.
 */
import { z } from "zod";

// --- Envelopes (F1 §9.2) ---
export const successEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ success: z.literal(true), data, message: z.string().optional() });

export const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

/** The seven — and only seven — enumerated portal error codes (SPEC §4.2). */
export const PORTAL_ERROR_CODES = {
  TOKEN_NOT_FOUND: "ERR_PORTAL_TOKEN_NOT_FOUND",
  SUBMISSION_BLOCKED: "ERR_PORTAL_SUBMISSION_BLOCKED",
  NOT_SUBMITTED: "ERR_PORTAL_NOT_SUBMITTED",
  PROPOSAL_AWARDED: "ERR_PORTAL_PROPOSAL_AWARDED",
  FILE_TYPE_NOT_ALLOWED: "ERR_FILE_TYPE_NOT_ALLOWED",
  FILE_TOO_LARGE: "ERR_FILE_TOO_LARGE",
  // Spec v1.3 (2026-08-10) corrected the documented code to the platform-wide convention
  // ERR_VALIDATION_FAILED to match the (unchanged) implementation — "no behavior change".
  VALIDATION: "ERR_VALIDATION_FAILED",
} as const;

export const PROPOSAL_STATUSES = ["invited", "submitted", "withdrawn"] as const;
export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);

export const BLOCKED_REASONS = ["deadline_passed", "event_deleted", "vendor_deleted"] as const;
export const blockedReasonSchema = z.enum(BLOCKED_REASONS);

// --- Endpoint #1 (resolve) sub-schemas (SPEC §4.2 #1 Response 200) ---
export const categorySchema = z
  .object({ primaryCategoryId: z.string(), subcategoryId: z.string() })
  .passthrough();

export const visibleSectionSchema = z
  .object({
    sectionKey: z.string(),
    sectionLabel: z.string(),
    sortOrder: z.number().int(),
    content: z.string(),
  })
  .passthrough();

export const selectedQualificationSchema = z
  .object({ qualificationKey: z.string(), label: z.string() })
  .passthrough();

export const questionSchema = z
  .object({ id: z.string(), questionText: z.string(), sortOrder: z.number().int() })
  .passthrough();

export const eventSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    category: categorySchema.nullable(),
    timelineWeeks: z.number().nullable().optional(),
    submissionDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "submissionDeadline must be YYYY-MM-DD"),
    publishedAt: z.string(),
    scopeOfWork: z.string().nullable().optional(),
    visibleSections: z.array(visibleSectionSchema),
    selectedQualifications: z.array(selectedQualificationSchema),
    questions: z.array(questionSchema),
  })
  .passthrough();

export const issuerSchema = z
  .object({
    name: z.string(),
    roleTitle: z.string(),
    company: z.string(),
    email: z.string(),
  })
  .passthrough();

export const vendorSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    // Nullable in practice: a vendor with no primary contact (or a contact without an
    // email) resolves to null on QA — confirmed live (invited vendor "Herman and Sons").
    // Spec §9.2 implies a string but the directory does not guarantee one; see findings.
    primaryContactEmail: z.string().nullable(),
  })
  .passthrough();

export const proposalSchema = z
  .object({
    status: proposalStatusSchema,
    submittedAt: z.string().nullable(),
    awarded: z.boolean(),
    // contract TBD (v1.2): shape/usage of retainedAttachment is undocumented — modelled leniently.
    retainedAttachment: z.unknown().nullable().optional(),
  })
  .passthrough();

export const resolveDataSchema = z
  .object({
    event: eventSchema,
    issuer: issuerSchema,
    vendor: vendorSchema,
    proposal: proposalSchema,
    isBlocked: z.boolean(),
    blockedReason: blockedReasonSchema.nullable(),
  })
  .passthrough();

export const resolveResponseSchema = successEnvelope(resolveDataSchema);

// --- Endpoint #1a (presign) — SPEC §4.2 #1a Response 200 ---
export const presignDataSchema = z
  .object({
    uploadUrl: z.string().url(),
    s3Key: z.string(),
    filename: z.string(),
    contentType: z.string(),
    fileSizeBytes: z.number().int(),
  })
  .passthrough();

export const presignResponseSchema = successEnvelope(presignDataSchema);

// --- Endpoint #2 (submit) — SPEC §4.2 #2 Response 201 ---
export const submitDataSchema = z
  .object({
    submittedAt: z.string(),
    vendorName: z.string(),
    attachmentRetained: z.boolean(),
  })
  .passthrough();

export const submitResponseSchema = successEnvelope(submitDataSchema);

// --- Endpoint #3 (withdraw) — SPEC §4.2 #3 Response 200 ---
export const withdrawDataSchema = z.object({ status: z.literal("withdrawn") }).passthrough();

export const withdrawResponseSchema = successEnvelope(withdrawDataSchema);
