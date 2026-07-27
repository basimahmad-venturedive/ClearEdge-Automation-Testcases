/**
 * Request payloads + factories for CEIQ-FEAT-005 (Vendor Directory).
 * SPEC Technical §5.2 (create/update body, status/primary/previous-spend, document
 * upload/confirm, invite). Category IDs are NOT hard-coded — they are fetched at runtime
 * from `GET /api/v1/vendor-categories` and passed into the factories, since the taxonomy is
 * a system-wide seed whose UUIDs are environment-specific.
 *
 * Spec-pinned constants use UPPER_SNAKE_CASE; factories return fresh objects with Faker
 * content so tests stay independent. No inline request-body literals in test files, and every
 * negative/boundary shape is a named export or factory helper (api-automation.rules §Test data).
 */
import { faker } from "@faker-js/faker";

// --- Category reference passed into the vendor factories ---
export interface CategoryPair {
  primaryCategoryId: string;
  subcategoryId: string;
}

// --- Body shapes (SPEC §5.2 create/update) ---
export interface VendorAddress {
  streetAddress?: string | null;
  streetAddressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}

export interface VendorContact {
  name: string;
  email: string;
  phone: string;
  address?: VendorAddress;
}

export interface CreateVendorBody {
  name: string;
  primaryCategoryId: string;
  subcategoryId: string;
  website?: string;
  notes?: string;
  primaryContact: VendorContact;
  secondaryContact?: VendorContact | null;
}

/** A well-known well-formed UUID that matches no seeded row (404 / ERR_CATEGORY_NOT_FOUND cases). */
export const NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000";

/** Format-invalid contact fields (US-VD-001 AC-003/AC-004; exact server regex is contract TBD). */
export const INVALID_EMAIL = "not-an-email";
export const INVALID_PHONE = "abc";

/** 5 MB compliance-document size limit (§5.2 POST documents Processing 4). */
export const MAX_FILE_SIZE_BYTES = 5_242_880;

/** A fresh, valid free-text 5-field address (all sub-fields optional per US-VD-019 BR-03). */
export function newAddress(overrides: Partial<VendorAddress> = {}): VendorAddress {
  return {
    streetAddress: faker.location.streetAddress(),
    streetAddressLine2: `Suite ${faker.number.int({ min: 100, max: 999 })}`,
    city: faker.location.city(),
    state: faker.location.state({ abbreviated: true }),
    zipCode: faker.location.zipCode(),
    ...overrides,
  };
}

/** A fresh, valid contact (primary requires name/email/phone; §5.2 Processing 1). */
export function newContact(overrides: Partial<VendorContact> = {}): VendorContact {
  const first = faker.person.firstName();
  const last = faker.person.lastName();
  return {
    name: `${first} ${last}`,
    email: faker.internet.email({ firstName: first, lastName: last }).toLowerCase(),
    phone: "+1 555 000 0000",
    address: newAddress(),
    ...overrides,
  };
}

/** A fresh, valid create body (no secondary contact). Category IDs come from the taxonomy. */
export function newVendor(cat: CategoryPair, overrides: Partial<CreateVendorBody> = {}): CreateVendorBody {
  return {
    name: `${faker.company.name()} ${faker.string.alphanumeric(5)}`,
    primaryCategoryId: cat.primaryCategoryId,
    subcategoryId: cat.subcategoryId,
    website: `https://${faker.internet.domainName()}`,
    notes: faker.company.catchPhrase(),
    primaryContact: newContact(),
    ...overrides,
  };
}

/** Valid body WITH a secondary contact (US-VD-003). */
export function newVendorWithSecondary(
  cat: CategoryPair,
  secondaryOverrides: Partial<VendorContact> = {},
): CreateVendorBody {
  return newVendor(cat, { secondaryContact: newContact(secondaryOverrides) });
}

/** Create body missing the mandatory `name` field → 400 ERR_VALIDATION_FAILED (TC-VDAPI-002-1). */
export function newVendorMissingName(cat: CategoryPair): Omit<CreateVendorBody, "name"> {
  const { name: _name, ...rest } = newVendor(cat);
  void _name;
  return rest;
}

/** Create body whose primary contact omits the mandatory email → 400 (TC-VDAPI-002-2). */
export function newVendorMissingPrimaryEmail(cat: CategoryPair): CreateVendorBody {
  const contact = newContact();
  const { email: _email, ...restContact } = contact;
  void _email;
  return newVendor(cat, { primaryContact: restContact as VendorContact });
}

/** Create body whose primary contact email is malformed → 400 (TC-VDAPI-003). */
export function newVendorInvalidPrimaryEmail(cat: CategoryPair): CreateVendorBody {
  return newVendor(cat, { primaryContact: newContact({ email: INVALID_EMAIL }) });
}

/** Create body whose primary contact phone is malformed → 400 (TC-VDAPI-004). */
export function newVendorInvalidPrimaryPhone(cat: CategoryPair): CreateVendorBody {
  return newVendor(cat, { primaryContact: newContact({ phone: INVALID_PHONE }) });
}

/** Create body whose (provided) secondary contact email is malformed → 400 (TC-VDAPI-010). */
export function newVendorInvalidSecondaryEmail(cat: CategoryPair): CreateVendorBody {
  return newVendor(cat, { secondaryContact: newContact({ email: INVALID_EMAIL }) });
}

// --- Status / primary / previous-spend bodies (SPEC §5.2) ---
export const STATUS_INACTIVE = { status: "inactive" } as const;
export const STATUS_ACTIVE = { status: "active" } as const;
export const STATUS_INVALID = { status: "archived" } as const;

export const PRIMARY_TRUE = { isPrimary: true } as const;
export const PRIMARY_FALSE = { isPrimary: false } as const;

export const SPEND_VALID = { previousSpend: 75000.0 } as const;
export const SPEND_NULL = { previousSpend: null } as const;
export const SPEND_NEGATIVE = { previousSpend: -100 } as const;
export const SPEND_TOO_MANY_DECIMALS = { previousSpend: 100.999 } as const;

// --- Compliance-document bodies (SPEC §5.2 POST/PATCH documents) ---
export interface UploadRequestBody {
  filename: string;
  contentType: string;
  fileSizeBytes: number;
}

export function newUploadRequest(overrides: Partial<UploadRequestBody> = {}): UploadRequestBody {
  return {
    filename: "brightbeam-w9-2026.pdf",
    contentType: "application/pdf",
    fileSizeBytes: 245000,
    ...overrides,
  };
}

/** Non-PDF content type → 400 ERR_FILE_TYPE_NOT_ALLOWED (TC-VDAPI-061 / SR-005). */
export const UPLOAD_NON_PDF: UploadRequestBody = {
  filename: "scan.png",
  contentType: "image/png",
  fileSizeBytes: 1000,
};

/** At the 5 MB boundary — accepted (TC-VDAPI-062). */
export const UPLOAD_AT_LIMIT: UploadRequestBody = newUploadRequest({ fileSizeBytes: MAX_FILE_SIZE_BYTES });

/** One byte over the 5 MB boundary → 400 ERR_FILE_TOO_LARGE (TC-VDAPI-062 / SR-005). */
export const UPLOAD_OVER_LIMIT: UploadRequestBody = newUploadRequest({ fileSizeBytes: MAX_FILE_SIZE_BYTES + 1 });

export interface ConfirmUploadBody {
  s3Key: string;
  filename: string;
  fileSizeBytes: number;
}

export function newConfirmBody(s3Key: string, overrides: Partial<ConfirmUploadBody> = {}): ConfirmUploadBody {
  return { s3Key, filename: "brightbeam-w9-2026.pdf", fileSizeBytes: 245000, ...overrides };
}

// --- Invite bodies (SPEC §5.2 POST invite) ---
export const INVITE_EMPTY = { eventIds: [] as string[] } as const;

export function newInvite(eventIds: string[]): { eventIds: string[] } {
  return { eventIds };
}
