/**
 * Zod schemas — response shapes confirmed against codebase/clearedge-backend DTOs
 * (src/tenant/dto/tenant-response.dto.ts, src/user/dto/user-profile-response.dto.ts)
 * as of 2026-07-08, and the response envelope convention (spec §9.2, CLAUDE.md).
 */
import { z } from "zod";

export const ErrorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export const TenantResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  domain: z.string().min(1),
  status: z.enum(["active", "inactive"]),
  setupStatus: z.enum(["in_setup", "handed_over"]),
  setupCompletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  ownerName: z.string().nullable(),
  ownerEmail: z.string().email().nullable(),
});

export const UserProfileResponseSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  email: z.string().email().optional(),
  roleId: z.string().uuid(),
  rights: z.array(z.string()),
});

export const SuccessEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({ success: z.literal(true), data: dataSchema, message: z.string().optional(), meta: z.record(z.unknown()).optional() });
