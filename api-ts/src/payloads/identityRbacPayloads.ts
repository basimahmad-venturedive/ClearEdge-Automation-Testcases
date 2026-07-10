/**
 * Payload factories for CEIQ-FOUND-001 (F1).
 *
 * Field names/shape confirmed against the real DTOs in codebase/clearedge-backend
 * (src/tenant/dto/create-tenant.dto.ts). As of the CEIQ-FEAT-001 admin-portal merge
 * (dev, 2026-07-10) CreateTenantDto now REQUIRES `address` ("Company address is required.")
 * — added to the factory below. Domain must match DOMAIN_HOSTNAME_REGEX in
 * src/tenant/utils/domain.util.ts and is normalized (protocol/www stripped, lowercased)
 * by the DTO's own @Transform.
 */
import { faker } from "@faker-js/faker";
import type { TenantCreationPayload, UserCreationPayload, UserRole } from "./types";

// Spec-pinned exact string — US-RBAC-001 AC-002 / SR-016.
export const TENANT_DOMAIN_DUPLICATE_MESSAGE = "A company with this domain already exists.";

const DOCUMENTED_NON_OWNER_ROLES: readonly UserRole[] = ["procurement_manager", "procurement_analyst"];
export const documentedNonOwnerRoles = (): UserRole[] => [...DOCUMENTED_NON_OWNER_ROLES];

export function tenantCreationPayload(overrides: Partial<TenantCreationPayload> = {}): TenantCreationPayload {
  const unique = faker.string.alphanumeric(8).toLowerCase();
  return {
    name: `Test Tenant ${unique}`,
    domain: `test${unique}.test`,
    address: `${unique} Test Street, Test City`,
    ownerName: `Test PO ${unique}`,
    ownerEmail: `po.${unique}@example.test`,
    ...overrides,
  };
}

export function userCreationPayload(overrides: Partial<UserCreationPayload> = {}): UserCreationPayload {
  const unique = faker.string.alphanumeric(8);
  return {
    name: `Test User ${unique}`,
    email: `user.${unique}@example.test`,
    role: "procurement_manager",
    ...overrides,
  };
}

/** For TC-TENANT-013 — 255/256-char boundary payloads (tenant name only — domain has its own, shorter regex limit). */
export function nameOfLength(length: number): string {
  return "A".repeat(length);
}
