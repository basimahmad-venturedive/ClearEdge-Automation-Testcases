/**
 * Zod response schemas for CEIQ-FEAT-003 (User Management), per SPEC §4.2 payloads.
 * Used by tests to validate the { success, data } envelope shape and field contracts.
 */
import { z } from "zod";

export const permissionLabelSchema = z.enum(["Read/Write", "Read Only"]);
export const roleNameSchema = z.enum(["Procurement Manager", "Procurement Analyst"]);
export const statusSchema = z.enum(["active", "inactive"]);

/** A managed-user object as returned by list / detail / create / edit / status. */
export const userObjectSchema = z.object({
  id: z.string().uuid(),
  displayId: z.string().regex(/^USR-\d{4}$/, "display_id must be USR- + 4 digits"),
  name: z.string().min(1),
  email: z.string().email(),
  role: roleNameSchema,
  permissionLabel: permissionLabelSchema,
  status: statusSchema,
  initials: z.string().min(1).max(2),
  createdAt: z.string(),
});

export const paginationSchema = z.object({
  page: z.number().int().min(1),
  limit: z.number().int(),
  // Contract field is `totalCount` (PaginatedUsersResponseDto.UsersPaginationMetaDto),
  // not `totalRecords` — count of the filtered/searched set, not the tenant total.
  totalCount: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

export const listDataSchema = z.object({
  users: z.array(userObjectSchema),
  pagination: paginationSchema,
});

export const managementHomeDataSchema = z.object({
  organization: z.object({
    companyName: z.string().nullable(),
    website: z.string().nullable(),
    address: z.string().nullable(),
  }),
  profile: z.object({
    name: z.string(),
    email: z.string().email(),
    role: z.literal("Procurement Owner"),
  }),
});

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

export const createUserResponseSchema = successEnvelope(
  z.object({ user: userObjectSchema, message: z.string() }),
);
export const editUserResponseSchema = successEnvelope(
  z.object({ user: userObjectSchema, emailChanged: z.boolean().optional(), message: z.string().optional() }),
);
export const singleUserResponseSchema = successEnvelope(z.object({ user: userObjectSchema }));
export const statusResponseSchema = successEnvelope(z.object({ user: userObjectSchema }));
export const listResponseSchema = successEnvelope(listDataSchema);
export const managementHomeResponseSchema = successEnvelope(managementHomeDataSchema);
