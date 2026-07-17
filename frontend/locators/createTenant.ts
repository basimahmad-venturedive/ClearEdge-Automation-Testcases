/**
 * PLACEHOLDER selector contract — testcases/TC-CEIQ-FEAT-001.md §6.
 *
 * The admin portal frontend is not yet built; the spec defines no data-testid
 * attributes. Every selector below is the PROPOSED contract pending
 * confirmation by the frontend team (analogous to the kit's TODO_LOCATOR
 * policy). Entries explicitly marked TODO_LOCATOR are NOT part of §6.
 *
 * Convention: values without a `Name` suffix are `data-testid` values; values
 * with a `Name` suffix are accessible names for `getByRole('button', { name })`.
 */
export const CreateTenantLocators = {
  /** §6: data-testid="create-company-name" */
  companyNameInput: 'create-company-name',
  /** §6: data-testid="create-website-url" */
  websiteUrlInput: 'create-website-url',
  /** §6: data-testid="create-company-address" */
  companyAddressInput: 'create-company-address',
  /** §6: data-testid="create-owner-name" */
  ownerNameInput: 'create-owner-name',
  /** §6: data-testid="create-owner-email" */
  ownerEmailInput: 'create-owner-email',

  // §6: field inline error = data-testid="<field>-error"
  companyNameError: 'create-company-name-error',
  websiteUrlError: 'create-website-url-error',
  companyAddressError: 'create-company-address-error',
  ownerNameError: 'create-owner-name-error',
  ownerEmailError: 'create-owner-email-error',

  // ---- TODO_LOCATOR — NOT in §6; button labels pending frontend
  // confirmation (US-3.1 story text says "Submit" / "Cancel"). ----
  submitButtonName: 'Create Tenant',
  cancelButtonName: 'Cancel',
} as const;

/** Logical create-form field key used by page-object methods and data helpers. */
export type CreateField =
  | 'companyName'
  | 'websiteUrl'
  | 'companyAddress'
  | 'ownerName'
  | 'ownerEmail';
