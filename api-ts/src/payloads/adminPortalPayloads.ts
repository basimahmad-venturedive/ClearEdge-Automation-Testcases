/**
 * Payload factories and spec-pinned constants for CEIQ-FEAT-001 (Admin Portal).
 *
 * Field names/shapes taken verbatim from SPEC_CEIQ-FEAT-001-admin-portal.md §4.2
 * request tables and §5 (Consolidated Validation Rules). Unlike the F1 CreateTenantDto,
 * the admin-portal create contract DOES include `address` (§4.2 POST request table).
 * Domains and emails are unique per run (timestamp + random suffix) so parallel/
 * repeated runs never collide on the §5 uniqueness rules.
 */
import { faker } from "@faker-js/faker";

// ---------------------------------------------------------------------------
// Request/response types (spec §4.2)
// ---------------------------------------------------------------------------

export interface AdminTenantCreatePayload {
  name: string;
  domain: string;
  address: string;
  ownerName: string;
  ownerEmail: string;
}

export interface CompanyUpdatePayload {
  name: string;
  domain: string;
  address: string;
}

export interface OwnerUpdatePayload {
  name: string;
  email: string;
}

export type TenantStatus = "active" | "inactive";

export interface StatusUpdatePayload {
  status: TenantStatus;
}

/** Full tenant object as returned by create/detail/patch/handover responses (§4.2). */
export interface AdminTenant {
  id: string;
  displayId: string;
  name: string;
  domain: string;
  address: string;
  status: TenantStatus;
  setupStatus: "in_setup" | "handed_over";
  ownerName: string;
  ownerEmail: string;
  setupPassword?: string | null;
  setupCompletedAt: string | null;
  createdAt: string;
}

/** data payload of GET /admin/tenants (§4.2 list response). List items never carry setupPassword. */
export interface AdminTenantListData {
  tenants: Array<Omit<AdminTenant, "setupPassword" | "setupCompletedAt">>;
  pagination: { page: number; limit: number; totalCount: number; totalPages: number };
}

// ---------------------------------------------------------------------------
// Spec-pinned constants (§4.2 error examples, §5 validation table, §9 error codes)
// ---------------------------------------------------------------------------

export const LIST_PAGE_SIZE = 12; // §4.2 GET list — fixed, hardcoded server-side
export const DISPLAY_ID_PATTERN = /^TEN\d{4,}$/;

export const ERR_VALIDATION_FAILED = "ERR_VALIDATION_FAILED";
export const ERR_NOT_FOUND = "ERR_NOT_FOUND";
export const ERR_AUTH_INVALID_TOKEN = "ERR_AUTH_INVALID_TOKEN";
export const ERR_TENANT_DOMAIN_DUPLICATE = "ERR_TENANT_DOMAIN_DUPLICATE";
export const ERR_EMAIL_ALREADY_IN_USE = "ERR_EMAIL_ALREADY_IN_USE";
export const ERR_INVALID_STATE_TRANSITION = "ERR_INVALID_STATE_TRANSITION";

export const MSG_VALIDATION_FAILED = "One or more fields are invalid.";
export const MSG_TENANT_NOT_FOUND = "Tenant not found.";
export const MSG_DOMAIN_DUPLICATE = "This website domain is already being used by another tenant.";
export const MSG_EMAIL_IN_USE = "This email is already in use.";
export const MSG_CANNOT_ACTIVATE_IN_SETUP = "Cannot activate a tenant that is still in setup.";
export const MSG_ALREADY_HANDED_OVER = "Tenant has already been handed over.";

/** Exact per-field validation messages from §5. */
export const FIELD_MESSAGES = {
  nameRequired: "Company name is required.",
  nameMax: "Company name must not exceed 255 characters.",
  domainInvalid: "Please enter a valid website URL.",
  domainMax: "Website URL must not exceed 255 characters.",
  addressRequired: "Company address is required.",
  addressMax: "Company address must not exceed 500 characters.",
  ownerNameRequired: "Owner name is required.",
  ownerNameMax: "Owner name must not exceed 255 characters.",
  emailInvalid: "Please enter a valid email address.",
  emailMax: "Email must not exceed 320 characters.",
} as const;

/** §5 field length limits (post-normalization for domain). */
export const FIELD_LIMITS = {
  name: 255,
  domain: 255,
  address: 500,
  ownerName: 255,
  ownerEmail: 320,
} as const;

// TC-ADMCREATE-008 — unicode/special-character values (all within §5 limits).
export const UNICODE_COMPANY_NAME = "Müller & Söhne GmbH — 物流 🚚";
export const UNICODE_OWNER_NAME = "José O'Brien-Nováková";
export const UNICODE_ADDRESS = "Şişli, İstanbul — ул. Тверская 7";

// ---------------------------------------------------------------------------
// Unique-per-run factories
// ---------------------------------------------------------------------------

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${faker.string.alphanumeric(6).toLowerCase()}`;
}

export function uniqueDomain(prefix = "tenant"): string {
  return `${prefix}${uniqueSuffix()}.test`;
}

export function uniqueEmail(local = "po"): string {
  return `${local}.${uniqueSuffix()}@example.test`;
}

export function adminTenantCreatePayload(overrides: Partial<AdminTenantCreatePayload> = {}): AdminTenantCreatePayload {
  const unique = uniqueSuffix();
  return {
    name: `Acme Logistics ${unique}`,
    domain: `acme${unique}.test`,
    address: "221B Baker Street, London, UK",
    ownerName: `Sarah Chen ${unique}`,
    ownerEmail: `sarah.chen.${unique}@example.test`,
    ...overrides,
  };
}

export function companyUpdatePayload(overrides: Partial<CompanyUpdatePayload> = {}): CompanyUpdatePayload {
  const unique = uniqueSuffix();
  return {
    name: `Orbit Media Group ${unique}`,
    domain: `orbit${unique}.test`,
    address: "9 Harbour View, Sydney, NSW, Australia",
    ...overrides,
  };
}

export function ownerUpdatePayload(overrides: Partial<OwnerUpdatePayload> = {}): OwnerUpdatePayload {
  const unique = uniqueSuffix();
  return {
    name: `Tom Whitfield ${unique}`,
    email: `tom.${unique}@example.test`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Boundary-value builders (TC-ADMAPI-014, TC-ADMAPI-032)
// ---------------------------------------------------------------------------

/** Exact-length plain string with a unique prefix (so at-limit creates never collide). */
export function uniqueStringOfLength(length: number): string {
  const prefix = uniqueSuffix();
  if (prefix.length >= length) return prefix.slice(0, length);
  return prefix + "A".repeat(length - prefix.length);
}

/**
 * Exact-length syntactically valid domain (`label.label…label.test`), labels ≤ 60 chars.
 * First label carries a unique prefix so at-limit creates don't hit the §5 uniqueness rule.
 */
export function domainOfLength(totalLength: number): string {
  const tld = ".test";
  const bodyLength = totalLength - tld.length;
  if (bodyLength < 1) throw new Error(`domainOfLength: ${totalLength} is too short for a "<label>${tld}" domain`);
  const chunks: string[] = [];
  let remaining = bodyLength;
  while (remaining > 0) {
    const isFirst = chunks.length === 0;
    if (!isFirst && remaining === 1) {
      // A lone trailing char can't form "<dot><label>" — append it to the previous label instead.
      chunks[chunks.length - 1] += "a";
      remaining = 0;
      break;
    }
    const maxChunk = Math.min(60, isFirst ? remaining : remaining - 1);
    chunks.push("a".repeat(maxChunk));
    remaining -= isFirst ? maxChunk : maxChunk + 1;
  }
  const unique = uniqueSuffix();
  const first = chunks[0] ?? "";
  chunks[0] = first.length > unique.length ? unique + first.slice(unique.length) : first;
  return chunks.join(".") + tld;
}

/**
 * Exact-length email: local part capped at 64 chars (RFC), remainder pushed into the
 * domain part — a 320-char email is `64-char local` + `@` + `255-char domain`.
 */
export function emailOfLength(totalLength: number): string {
  const minDomain = "a.test".length;
  const localLength = Math.min(64, totalLength - 1 - minDomain);
  if (localLength < 1) throw new Error(`emailOfLength: ${totalLength} is too short for a valid email`);
  const domainLength = totalLength - 1 - localLength;
  const unique = uniqueSuffix();
  const local = (unique + "a".repeat(localLength)).slice(0, localLength);
  return `${local}@${domainOfLength(domainLength)}`;
}

/** Field-appropriate exact-length value for the create payload boundary matrix. */
export function boundaryValueFor(field: keyof AdminTenantCreatePayload, length: number): string {
  if (field === "domain") return domainOfLength(length);
  if (field === "ownerEmail") return emailOfLength(length);
  return uniqueStringOfLength(length);
}

export interface MaxLengthBoundaryCase {
  sub: string;
  field: keyof AdminTenantCreatePayload;
  length: number;
  expectAccept: boolean;
  overLimitMessage: string;
}

/** TC-ADMAPI-014 — at-limit (accept) and limit+1 (reject) per §5 field. */
export function maxLengthBoundaryMatrix(): MaxLengthBoundaryCase[] {
  const spec: Array<[keyof AdminTenantCreatePayload, number, string]> = [
    ["name", FIELD_LIMITS.name, FIELD_MESSAGES.nameMax],
    ["domain", FIELD_LIMITS.domain, FIELD_MESSAGES.domainMax],
    ["address", FIELD_LIMITS.address, FIELD_MESSAGES.addressMax],
    ["ownerName", FIELD_LIMITS.ownerName, FIELD_MESSAGES.ownerNameMax],
    ["ownerEmail", FIELD_LIMITS.ownerEmail, FIELD_MESSAGES.emailMax],
  ];
  return spec.flatMap(([field, limit, overLimitMessage]) => [
    { sub: `${field} at limit (${limit})`, field, length: limit, expectAccept: true, overLimitMessage },
    { sub: `${field} over limit (${limit + 1})`, field, length: limit + 1, expectAccept: false, overLimitMessage },
  ]);
}

// ---------------------------------------------------------------------------
// Invalid-input matrices (TC-ADMAPI-013) and normalization variants (TC-ADMAPI-011)
// ---------------------------------------------------------------------------

export interface CreateValidationCase {
  sub: string;
  overrides: Partial<AdminTenantCreatePayload>;
  invalidFields: Array<{ field: keyof AdminTenantCreatePayload; message: string }>;
}

/** TC-ADMAPI-013 sub-cases 13a–13g — each maps to the exact §5 message. */
export function createValidationMatrix(): CreateValidationCase[] {
  return [
    { sub: "13a name empty", overrides: { name: "" }, invalidFields: [{ field: "name", message: FIELD_MESSAGES.nameRequired }] },
    { sub: "13b domain empty", overrides: { domain: "" }, invalidFields: [{ field: "domain", message: FIELD_MESSAGES.domainInvalid }] },
    { sub: "13c domain invalid format", overrides: { domain: "::::" }, invalidFields: [{ field: "domain", message: FIELD_MESSAGES.domainInvalid }] },
    { sub: "13d address empty", overrides: { address: "" }, invalidFields: [{ field: "address", message: FIELD_MESSAGES.addressRequired }] },
    { sub: "13e ownerName empty", overrides: { ownerName: "" }, invalidFields: [{ field: "ownerName", message: FIELD_MESSAGES.ownerNameRequired }] },
    { sub: "13f ownerEmail invalid", overrides: { ownerEmail: "not-an-email" }, invalidFields: [{ field: "ownerEmail", message: FIELD_MESSAGES.emailInvalid }] },
    {
      sub: "13g multiple invalid fields",
      overrides: { name: "", ownerEmail: "not-an-email" },
      invalidFields: [
        { field: "name", message: FIELD_MESSAGES.nameRequired },
        { field: "ownerEmail", message: FIELD_MESSAGES.emailInvalid },
      ],
    },
  ];
}

export interface DomainVariant {
  sub: string;
  value: (baseDomain: string) => string;
}

/** TC-ADMAPI-011 sub-cases 11a–11e — every variant normalizes to the same bare domain (§5). */
export function domainNormalizationVariants(): DomainVariant[] {
  return [
    { sub: "11a bare domain", value: (d) => d },
    { sub: "11b https + www", value: (d) => `https://www.${d}` },
    { sub: "11c www prefix", value: (d) => `www.${d}` },
    { sub: "11d path + query", value: (d) => `${d}/about?x=1` },
    { sub: "11e port suffix", value: (d) => `${d}:8080` },
  ];
}
