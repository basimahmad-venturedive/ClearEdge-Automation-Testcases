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
export const TenantProfileLocators = {
  /** §6: data-testid="profile-company-section" (+ -edit / -save / -cancel) */
  companySection: 'profile-company-section',
  companyEditButton: 'profile-company-section-edit',
  companySaveButton: 'profile-company-section-save',
  companyCancelButton: 'profile-company-section-cancel',

  /** §6: data-testid="profile-owner-section" (+ -edit / -save / -cancel) */
  ownerSection: 'profile-owner-section',
  ownerEditButton: 'profile-owner-section-edit',
  ownerSaveButton: 'profile-owner-section-save',
  ownerCancelButton: 'profile-owner-section-cancel',

  /** §6: data-testid="profile-status-toggle" + "profile-status-label" */
  statusToggle: 'profile-status-toggle',
  statusLabel: 'profile-status-label',

  /** §6: data-testid="setup-password" + "setup-password-toggle" (show/hide) */
  setupPassword: 'setup-password',
  setupPasswordToggle: 'setup-password-toggle',

  /** §6: data-testid="setup-banner" (§8.6) */
  setupBanner: 'setup-banner',

  /** §6: role=button[name="Send Invite & Complete Handover"] */
  handoverButtonName: 'Send Invite & Complete Handover',

  // ---- TODO_LOCATOR — NOT in §6; proposed additions required by the
  // edit/handover cases (TC-ADMEDIT-*, TC-ADMHAND-002). Owner: CEIQ frontend
  // team. ----
  /** TODO_LOCATOR TC-ADMEDIT-002 — company name input in edit mode */
  companyNameInput: 'profile-company-name',
  /** TODO_LOCATOR TC-ADMEDIT-007 — website URL input in edit mode */
  websiteUrlInput: 'profile-website-url',
  /** TODO_LOCATOR TC-ADMEDIT-003 — company address input in edit mode */
  companyAddressInput: 'profile-company-address',
  /** TODO_LOCATOR TC-ADMEDIT-004 — owner name input in edit mode */
  ownerNameInput: 'profile-owner-name',
  /** TODO_LOCATOR TC-ADMEDIT-005 — owner email input in edit mode */
  ownerEmailInput: 'profile-owner-email',
  /** TODO_LOCATOR TC-ADMHAND-002 — handover-status badge inside the profile */
  profileBadge: 'profile-badge',
  /** TODO_LOCATOR TC-ADMEDIT-008 — close control of the profile overlay */
  closeButton: 'profile-close',
} as const;
