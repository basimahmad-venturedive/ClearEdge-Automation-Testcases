/**
 * Exact user-facing copy quoted in testcases/TC-CEIQ-FEAT-001.md (spec-pinned
 * strings from SPEC_CEIQ-FEAT-001 §5 / §8 / §9 / §10). Specs assert these
 * VERBATIM — do not paraphrase; a copy change is a product change.
 */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const Copy = {
  // --- Login (US-1.1) ---
  invalidCredentials: 'Invalid email or password. Please try again.',
  invalidEmail: 'Please enter a valid email address.',
  passwordRequired: 'Password is required.',

  // --- Tenant list (US-2.1) ---
  noTenantsYet: 'No tenants yet.',
  /** TC-ADMLIST-006 expected result renders the search text single-quoted. */
  noTenantsMatch: (searchText: string): string => `No tenants match '${searchText}'.`,

  // --- Toggle dialogs (US-2.2) ---
  markActiveDialog: (companyName: string): string =>
    `Are you sure you want to mark '${companyName}' as Active?`,
  markInactiveDialog: (companyName: string): string =>
    `Are you sure you want to mark '${companyName}' as Inactive? All users within this tenant ` +
    'organisation will have their access revoked to the ClearEdge application until reactivated.',

  // --- Create Tenant (US-3.1 / §5 validation table) ---
  companyNameRequired: 'Company name is required.',
  websiteUrlInvalid: 'Please enter a valid website URL.',
  companyAddressRequired: 'Company address is required.',
  ownerNameRequired: 'Owner name is required.',
  companyNameMaxLength: 'Company name must not exceed 255 characters.',
  // App contract (schemas/tenant.schema.ts) caps the raw websiteUrl at 500 — the BE derives
  // the normalized bare domain from it. (The TC file's 255 referred to the domain; drift noted.)
  websiteUrlMaxLength: 'Website URL must not exceed 500 characters.',
  companyAddressMaxLength: 'Company address must not exceed 500 characters.',
  ownerNameMaxLength: 'Owner name must not exceed 255 characters.',
  ownerEmailMaxLength: 'Email must not exceed 320 characters.',
  duplicateDomain: 'This website domain is already being used by another tenant.',
  duplicateEmail: 'This email is already in use.',
  /** Success toast: "[Company Name] ([Tenant ID]) was created." with TEN#### id. */
  tenantCreatedToast: (companyName: string): RegExp =>
    new RegExp(`^${escapeRegExp(companyName)} \\(TEN\\d{4,}\\) was created\\.$`),

  // --- Edit / PO reassignment (US-2.3) ---
  ownerEmailChangeDialog:
    'Changing the email will deactivate the current Owner account and create a new one. ' +
    'The previous Owner will lose access immediately. Continue?',

  // --- Setup banner (§8.6) ---
  setupBannerHeading: 'Tenant is in Setup',
  setupBannerBody:
    'Send the Procurement Owner their invite to complete handover and unlock the Active/Inactive toggle.',

  // --- Handover (US-4.2) ---
  handoverDialog: (ownerName: string, companyName: string): string =>
    `This sends '${ownerName}' their invite email to set their own password, permanently removes ` +
    `the setup password, marks '${companyName}' as Handed Over, and sets it Active. This cannot be undone.`,
  handoverToast: 'Invite sent. Handover complete.',
  postHandoverInfoPattern:
    /Invite sent on .+\. The setup password no longer works — the owner has been invited to set their own password\./,

  // --- Generic error handling (§10) ---
  genericErrorToast: 'Something went wrong. Please try again.',
} as const;
