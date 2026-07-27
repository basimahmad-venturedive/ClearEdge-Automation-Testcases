/**
 * Zod response schemas for CEIQ-FEAT-005 (Vendor Directory), per SPEC §5.2 payloads.
 * Validate the { success, data } envelope shape and field contracts used by
 * tests/vendorDirectory.test.ts.
 *
 * Fields derived from the STUBBED Contracts/Sourcing services (contractCount,
 * upcomingActionsCount, deletionEligibility) are modelled as optional/nullable — the profile
 * endpoint is real, but those values come from not-built modules (§1.2), so the schema asserts
 * the vendor-owned shape without over-constraining the stubbed additions.
 */
import { z } from "zod";

export const statusSchema = z.enum(["active", "inactive"]);

export const addressSchema = z
  .object({
    streetAddress: z.string().nullable().optional(),
    streetAddressLine2: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    zipCode: z.string().nullable().optional(),
  })
  .passthrough();

export const contactSchema = z
  .object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable().optional(),
    address: addressSchema.nullable().optional(),
  })
  .passthrough();

/** Primary/subcategory reference object (id + name). */
export const categoryRefSchema = z.object({ id: z.string(), name: z.string() }).passthrough();

/** display_id shape: VEN- + 6 digits (US-VD-023 BR-02). */
export const displayIdSchema = z.string().regex(/^VEN-\d{6}$/, "display_id must be VEN- + 6 digits");

/** A row in the paginated list (§5.2 GET list). */
export const vendorListItemSchema = z
  .object({
    id: z.string().uuid(),
    displayId: displayIdSchema,
    name: z.string().min(1),
    primaryCategory: categoryRefSchema,
    subcategory: categoryRefSchema,
    primaryContact: z.object({ name: z.string().nullable(), email: z.string().nullable() }).passthrough(),
    contractCount: z.number().int().optional(),
    upcomingActionsCount: z.number().int().optional(),
    status: statusSchema,
    isPrimary: z.boolean(),
    createdAt: z.string(),
  })
  .passthrough();

export const paginationSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int(),
  totalItems: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

export const listDataSchema = z.object({
  vendors: z.array(vendorListItemSchema),
  pagination: paginationSchema,
});

/** Compliance-document metadata object (§5.2 GET profile / PATCH confirm). */
export const complianceDocSchema = z
  .object({
    id: z.string().optional(),
    originalFilename: z.string(),
    fileSizeBytes: z.number().int(),
    uploadedAt: z.string().optional(),
  })
  .passthrough();

/** Deletion eligibility (stub-derived — Contracts/Sourcing, §1.2). */
export const deletionEligibilitySchema = z
  .object({
    eligible: z.boolean(),
    reason: z.union([z.literal("active_contracts"), z.literal("open_participation"), z.null()]),
  })
  .passthrough();

/** Full vendor profile (§5.2 GET /vendors/:id). Stub fields optional. */
export const vendorProfileSchema = z
  .object({
    id: z.string().uuid(),
    displayId: displayIdSchema,
    name: z.string().min(1),
    primaryCategory: categoryRefSchema,
    subcategory: categoryRefSchema,
    website: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    status: statusSchema,
    isPrimary: z.boolean(),
    previousSpend: z.union([z.number(), z.string(), z.null()]).optional(),
    primaryContact: contactSchema,
    secondaryContact: contactSchema.nullable(),
    complianceDocuments: z
      .object({ w9: complianceDocSchema.nullable(), coi: complianceDocSchema.nullable() })
      .passthrough()
      .optional(),
    contractCount: z.number().int().optional(),
    upcomingActionsCount: z.number().int().optional(),
    deletionEligibility: deletionEligibilitySchema.optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();

/** Create response summary (§5.2 POST — data is the created vendor). */
export const vendorCoreSchema = z
  .object({
    id: z.string().uuid(),
    displayId: displayIdSchema,
    name: z.string().min(1),
    status: statusSchema,
    isPrimary: z.boolean(),
  })
  .passthrough();

// --- Document flow responses ---
export const uploadUrlDataSchema = z
  .object({
    uploadUrl: z.string(),
    s3Key: z.string(),
    filename: z.string(),
    fileSizeBytes: z.number().int(),
  })
  .passthrough();

export const documentUrlDataSchema = z
  .object({
    downloadUrl: z.string(),
    originalFilename: z.string(),
    fileSizeBytes: z.number().int(),
  })
  .passthrough();

export const confirmDataSchema = z.object({
  document: z
    .object({
      id: z.string(),
      documentType: z.enum(["w9", "coi"]),
      originalFilename: z.string(),
      fileSizeBytes: z.number().int(),
      uploadedAt: z.string(),
    })
    .passthrough(),
});

// --- Category taxonomy (§5.2 GET /vendor-categories) ---
export const subcategoryNodeSchema = z.object({ id: z.string(), name: z.string(), slug: z.string() }).passthrough();
export const primaryCategoryNodeSchema = z
  .object({ id: z.string(), name: z.string(), slug: z.string(), subcategories: z.array(subcategoryNodeSchema) })
  .passthrough();
export const categoriesDataSchema = z.object({ categories: z.array(primaryCategoryNodeSchema) });

// --- Envelopes ---
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

export const listResponseSchema = successEnvelope(listDataSchema);
export const profileResponseSchema = successEnvelope(vendorProfileSchema);
export const createResponseSchema = successEnvelope(vendorCoreSchema);
export const uploadUrlResponseSchema = successEnvelope(uploadUrlDataSchema);
export const documentUrlResponseSchema = successEnvelope(documentUrlDataSchema);
export const confirmResponseSchema = successEnvelope(confirmDataSchema);
export const categoriesResponseSchema = successEnvelope(categoriesDataSchema);

/** The 9 primary category display names, in §4.1 seed order (TC-VDAPI-105 / TC-VDDB-007). */
export const PRIMARY_CATEGORY_NAMES = [
  "Technology",
  "Professional Services",
  "Facilities & Operations",
  "Logistics & Transportation",
  "Marketing & Sales",
  "Human Resources",
  "Finance & Banking",
  "Manufacturing & Industrial",
  "Real Estate",
] as const;

/** Technology's seeded subcategories (§4.1) — used for the per-primary count spot-check. */
export const TECHNOLOGY_SUBCATEGORIES = [
  "Software / SaaS",
  "Hardware",
  "Telecommunications",
  "Cloud Services",
  "Managed Services",
  "Cybersecurity",
  "IT Consulting",
] as const;
