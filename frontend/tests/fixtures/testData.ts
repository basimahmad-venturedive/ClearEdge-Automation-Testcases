/**
 * Test data — seeded tenant fixtures + factories for CEIQ-FEAT-001.
 *
 * TODO_FIXTURE: seeding is not yet wired — the backend environment and the
 * admin API suite (automation/api-ts) must exist first. Each spec states its
 * seed precondition in a comment; wire these constants to API-based seeding
 * fixtures (create/teardown) once available. Values below mirror the seed data
 * named in testcases/TC-CEIQ-FEAT-001.md preconditions; fields the TC file
 * leaves open (e.g. the Handed-Over tenant's owner name/address) are fixture
 * placeholders, not spec assertions.
 */
import type { TenantFormData } from '../../pages/CreateTenantPage';
import type { CreateField } from '../../locators/createTenant';

/** Tenant in `Setup` state (badge "Setup", toggle locked Inactive). */
export const SETUP_TENANT: TenantFormData = {
  companyName: 'Acme Logistics',
  websiteUrl: 'acmelogistics.com',
  companyAddress: '221B Baker Street, London, UK',
  ownerName: 'Sarah Chen',
  ownerEmail: 'sarah.chen@acmelogistics.com',
};

/** Tenant in `Handed Over` state (badge "Handed Over", toggle unlocked). */
export const HANDED_OVER_TENANT: TenantFormData = {
   
  companyName: 'demo tenant',
  websiteUrl: 'zenithfreight.com',
  companyAddress: 'lahore',
  ownerName: 'demo tenant',
  ownerEmail: 'demo.tenant@yopmail.com',
};

/**
 * Factory for a fresh, unique tenant payload (domain + owner email must be
 * globally unique — US-3.1 Business Rules). Namespaced per run via timestamp.
 */
export function uniqueTenant(overrides: Partial<TenantFormData> = {}): TenantFormData {
  const stamp = Date.now();
  return {
    companyName: `Zenith Freight ${stamp}`,
    websiteUrl: `zenithfreight-${stamp}.com`,
    companyAddress: '1 Harbour Front Avenue, Singapore',
    ownerName: 'Priya Nair',
    ownerEmail: `priya.nair+${stamp}@zenithfreight.com`,
    ...overrides,
  };
}

/**
 * Boundary-value generator (TC-ADMCREATE-003): produces a format-valid value
 * of EXACTLY the requested length for each field.
 */
export function valueOfLength(field: CreateField, length: number): string {
  if (field === 'websiteUrl') {
    const suffix = '.com';
    return `${'a'.repeat(length - suffix.length)}${suffix}`;
  }
  if (field === 'ownerEmail') {
    const suffix = '@x.co';
    return `${'a'.repeat(length - suffix.length)}${suffix}`;
  }
  return 'A'.repeat(length);
}
