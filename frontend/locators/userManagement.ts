/**
 * PROPOSED selector contract — testcases/TC-CEIQ-FEAT-003.md §5 (User Management).
 *
 * The User Management screen is not yet built and SPEC_CEIQ-FEAT-003 defines no
 * data-testid attributes. Every value below is the PROPOSED contract pending
 * confirmation by the frontend team (kit TODO_LOCATOR policy). Owner: CEIQ
 * frontend team.
 *
 * Convention: values without a `Name` suffix are `data-testid` values; values
 * with a `Name` suffix are accessible names for `getByRole(..., { name })`.
 */
export const UserManagementLocators = {
  // ---- Summary cards (US-UM-003 / §5.2) ----
  orgCard: 'um-org-card',
  orgCompanyName: 'um-org-company-name',
  orgWebsite: 'um-org-website',
  orgAddress: 'um-org-address',
  profileCard: 'um-profile-card',
  profileName: 'um-profile-name',
  profileEmail: 'um-profile-email',
  profileRole: 'um-profile-role',

  // ---- Managed Users controls (§5.2 / §5.4) ----
  createUserButtonName: 'Create User', // role=button
  searchBar: 'um-user-search',
  roleFilterAllName: 'All', // role=radio
  roleFilterManagerName: 'Procurement Manager',
  roleFilterAnalystName: 'Procurement Analyst',
  pagination: 'um-pagination',
  emptyStateNoUsers: 'um-empty-no-users',
  emptyStateNoMatch: 'um-empty-no-match',

  // ---- User card (§5.3) ----
  userCard: 'um-user-card', // repeated per card
  cardUserId: 'um-user-card-id',
  cardAvatar: 'um-user-card-avatar',
  cardName: 'um-user-card-name',
  cardEmail: 'um-user-card-email',
  cardRoleBadge: 'um-user-card-role-badge',
  cardPermissionSublabel: 'um-user-card-permission',
  cardStatusToggle: 'um-user-card-status-toggle',
  cardStatusLabel: 'um-user-card-status-label',
  cardEditButtonName: 'Edit', // role=button within a card

  // ---- Create / Edit modal (§5.5 / §5.6) ----
  modal: 'um-user-modal',
  modalTitle: 'um-user-modal-title',
  roleRadioManagerName: 'Procurement Manager',
  roleRadioAnalystName: 'Procurement Analyst',
  fullNameInput: 'um-user-name-input',
  emailInput: 'um-user-email-input',
  emailFieldError: 'um-user-email-error',
  submitCreateName: 'Create User', // role=button (modal)
  submitSaveName: 'Save Changes', // role=button (modal)
  cancelName: 'Cancel',
  modalCloseName: 'Close',

  // ---- Email-change confirmation dialog (§5.7) ----
  emailConfirmDialog: 'um-email-confirm-dialog',
  emailConfirmName: 'Confirm',
  emailConfirmCancelName: 'Cancel',

  // ---- Deactivation confirmation dialog (§5.8) ----
  deactivateDialog: 'um-deactivate-dialog',
  deactivateConfirmName: 'Deactivate',
  deactivateCancelName: 'Cancel',

  // ---- Global notifications (§9) ----
  toast: 'toast',
  banner: 'um-banner',
  bannerDismissName: 'Dismiss',
  loadingIndicator: 'loading-indicator',
} as const;
