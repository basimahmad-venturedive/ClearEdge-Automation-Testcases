/**
 * Typed payload/response interfaces.
 *
 * TenantCreationPayload / TenantResponse confirmed against the real DTOs in
 * codebase/clearedge-backend as of 2026-07-08 (src/tenant/dto/*.ts) — camelCase,
 * no `address` or `displayId` in the API contract (present in the DB schema per
 * spec §5.2, but not yet exposed by CreateTenantDto/TenantResponseDto).
 */

export interface TenantCreationPayload {
  name: string;
  domain: string;
  // Required by CreateTenantDto since the CEIQ-FEAT-001 admin-portal merge (dev, 2026-07-10):
  // "Company address is required." (was not part of the earlier FOUND-001 contract).
  address: string;
  ownerName: string;
  ownerEmail: string;
}

export interface TenantResponse {
  id: string;
  name: string;
  domain: string;
  status: "active" | "inactive";
  setupStatus: "in_setup" | "handed_over";
  setupCompletedAt: string | null;
  createdAt: string;
  ownerName: string | null;
  ownerEmail: string | null;
}

export type UserRole = "procurement_owner" | "procurement_manager" | "procurement_analyst";

export interface UserCreationPayload {
  name: string;
  email: string;
  role: UserRole;
}

export interface UserResponse {
  id: string;
  tenant_id: string;
  role_id: string;
  name: string;
  email: string;
  status: "active" | "inactive";
}

export interface UserProfileResponse {
  userId: string;
  tenantId: string;
  email?: string;
  roleId: string;
  rights: string[];
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  message?: string;
  meta?: { traceId?: string };
}
