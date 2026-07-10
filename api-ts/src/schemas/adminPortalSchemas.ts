/**
 * Zod schemas for CEIQ-FEAT-001 (Admin Portal) — tenant object, list envelope with
 * pagination, and error envelope, per SPEC_CEIQ-FEAT-001-admin-portal.md §4.2
 * response examples and the F1 §9.2 envelope convention.
 */
import { z } from "zod";
import { DISPLAY_ID_PATTERN } from "../payloads/adminPortalPayloads";

// Error envelope is shared with F1 — same { success: false, error: { code, message, details? } } shape.
export { ErrorEnvelopeSchema } from "./identityRbacSchemas";

const adminTenantBaseShape = {
  id: z.string().uuid(),
  displayId: z.string().regex(DISPLAY_ID_PATTERN),
  name: z.string().min(1),
  domain: z.string().min(1),
  address: z.string().min(1),
  status: z.enum(["active", "inactive"]),
  setupStatus: z.enum(["in_setup", "handed_over"]),
  ownerName: z.string().min(1),
  ownerEmail: z.string().email(),
  createdAt: z.string().datetime(),
} as const;

/**
 * List item (§4.2 GET list) — `setupPassword` is deliberately excluded from list
 * responses; TC-ADMAPI-001 asserts its absence explicitly on top of this schema.
 */
export const AdminTenantListItemSchema = z.object(adminTenantBaseShape);

/** Full tenant (create/detail/patch/handover responses). `setupPassword` present only while in_setup. */
export const AdminTenantDetailSchema = z.object({
  ...adminTenantBaseShape,
  setupPassword: z.string().min(1).nullable().optional(),
  setupCompletedAt: z.string().datetime().nullable(),
});

export const PaginationSchema = z.object({
  page: z.number().int().min(1),
  limit: z.number().int().positive(),
  totalCount: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

/** GET /admin/tenants success envelope (§4.2). */
export const TenantListEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    tenants: z.array(AdminTenantListItemSchema),
    pagination: PaginationSchema,
  }),
});

/** Success envelope wrapping the full tenant object (create/detail/patch/handover). */
export const TenantDetailEnvelopeSchema = z.object({
  success: z.literal(true),
  data: AdminTenantDetailSchema,
});

export type AdminTenantDetail = z.infer<typeof AdminTenantDetailSchema>;
export type AdminTenantListItem = z.infer<typeof AdminTenantListItemSchema>;
export type TenantListEnvelope = z.infer<typeof TenantListEnvelopeSchema>;
export type TenantDetailEnvelope = z.infer<typeof TenantDetailEnvelopeSchema>;
