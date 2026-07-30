/**
 * CEIQ-FEAT-006 Clause Configuration — exact UI copy (single source of truth).
 * Verified against codebase/clearedge-frontend (dev): app/(app)/clause-configuration/
 * _components/ClauseConfigurationView.tsx + ClauseLibraryTable.tsx. antd UI (Alert
 * banner, App.message toast, Tooltip, Modal.confirm unsaved-changes popup).
 */
export const ClauseCopy = {
  navItemName: 'Clause Configuration',
  route: '/clause-configuration',

  title: 'Clause Configuration',
  subtitle: 'Manage the clause library used for automated contract comparison.',
  banner:
    'All selected clauses will be used for Clause Comparison on all future contracts. Previously uploaded contracts will not reflect any changes made to the clause library.',

  columns: ['Clause Category', 'Clause Name', 'Standard Clause', 'Risk Level'] as const,

  editButton: 'Edit',
  discardButton: 'Discard',
  saveButton: 'Save Changes',

  saveDisabledTooltip: 'This button is enabled once the clause library info has changed.',
  successToast:
    'Your Clause Library has been updated successfully. Reflected changes will be shown in all future contracts.',
  unsavedPopup:
    'You have unsaved changes in your clause library. Would you like to proceed without saving your changes?',

  notSpecified: 'Not Specified',
  riskLevels: ['Low', 'Medium', 'High'] as const,
} as const;
