/**
 * Exact user-facing copy quoted in testcases/TC-CEIQ-FEAT-003.md (spec-pinned
 * strings from SPEC_CEIQ-FEAT-003 §4 acceptance criteria / §5 / §9). Specs
 * assert these VERBATIM — a copy change is a product change.
 *
 * NOTE (org / spec discrepancy logged in the TC file Gaps): the product name is
 * "ClearEdgeIQ" in dialog/banner copy, but the page subtitle string (§5.2) reads
 * "…all users on ClearEdge." These are reproduced here EXACTLY as the spec pins
 * them — do not normalise. Design to reconcile (TC-UMHOME §6 discrepancy).
 */
export const UmCopy = {
  // --- Page header (§5.2) — subtitle intentionally quotes spec verbatim ---
  pageTitle: 'User Management',
  pageSubtitle: 'Manage your organization, your profile, and all users on ClearEdge.',
  profileRole: 'Procurement Owner',
  nullFieldPlaceholder: '—',

  // --- Empty states (US-UM-003 / §5.2) ---
  emptyNoUsers:
    "No users have been created yet. Click 'Create User' to add your first Procurement Manager or Analyst.",
  emptyNoMatch: 'No users match your search.',
  searchPlaceholder: 'Search users by name...',

  // --- Permission sublabels (§2 derivation) ---
  permissionReadWrite: 'Read/Write',
  permissionReadOnly: 'Read Only',

  // --- Create (US-UM-004 / §5.5) ---
  createModalTitle: 'Create User',
  roleManagerSublabel: 'Read/Write access',
  roleAnalystSublabel: 'Read Only access',
  createValidationError: 'Please fill in all fields with a valid email.',
  createEmailSameTenant: 'This email is already in use by another user in your organization.',
  createEmailCrossTenant: 'This email is already in use.',
  createSuccessBanner: (email: string): string =>
    `An email has been sent to ${email} with a temporary password and a link to log in.`,
  createSuccessToast: (name: string): string => `${name} has been added.`,

  // --- Edit (US-UM-005 / §5.6) ---
  editModalTitle: 'Edit User',
  saveChangesButton: 'Save Changes',
  editSuccessToast: (name: string): string => `Changes saved for ${name}.`,
  reLoginMessage: 'Please log in again to continue',

  // --- Email change (US-UM-006 / §5.7) ---
  emailChangeDialogTitle: 'Change email address?',
  emailChangeDialogBody: (name: string, oldEmail: string, newEmail: string): string =>
    `${name}'s current email (${oldEmail}) will no longer have access to ClearEdgeIQ. ` +
    `A new email will be sent to ${newEmail} with a temporary password and a link to log in.`,
  emailChangeBanner: (newEmail: string): string =>
    `A new email has been sent to ${newEmail} with a temporary password and a link to log in.`,

  // --- Activate / Deactivate (US-UM-007 / §5.8, §5.9) ---
  deactivateDialogTitle: (name: string): string => `Deactivate ${name}?`,
  deactivateDialogBody: (name: string): string =>
    `${name} will immediately lose access to ClearEdgeIQ. You can reactivate them at any time.`,
  deactivateToast: (name: string): string => `${name} has been deactivated.`,
  reactivateToast: (name: string): string => `${name} is now Active.`,

  // --- Generic (§9) ---
  genericError: 'Something went wrong. Please try again.',
} as const;
