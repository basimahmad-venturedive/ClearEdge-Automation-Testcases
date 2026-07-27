/**
 * Spec-pinned copy for the Vendor Directory (CEIQ-FEAT-005) UI suite.
 * Every string is VERBATIM from the built tenant app (codebase/clearedge-frontend,
 * dev) so the specs assert exact text per the TC file ("Exact copy asserted
 * verbatim"). If the app copy changes, this file is the single place to update.
 *
 * Source components:
 *   app/(app)/vendors/_components/VendorsView.tsx        (page title/subtitle, empty/error)
 *   app/(app)/vendors/_components/VendorCreateModal.tsx  (Add vendor)
 *   app/(app)/vendors/_components/VendorEditModal.tsx     (Edit vendor, delete Popconfirm)
 *   app/(app)/vendors/_components/VendorFormFields.tsx    (validation copy)
 *   app/(app)/vendors/_components/vendorColumns.tsx       (column headers)
 *   hooks/shared/useVendorStatusToggle.ts                 (status confirm copy)
 *   hooks/useVendorForm.ts                                 (delete toast / blockers)
 *   app/(app)/vendors/_components/VendorComplianceUploadFields.tsx (PDF error)
 */
export const VendorCopy = {
  pageTitle: 'Vendors',
  subtitle: 'Lightweight vendor directory linked to contracts and sourcing events.',

  // Buttons / modal titles
  addButtonLabel: '+ Add vendor',
  createModalTitle: 'Add vendor',
  submitAddLabel: 'Add vendor',
  editModalTitle: 'Edit vendor',
  saveChangesLabel: 'Save changes',
  cancelLabel: 'Cancel',
  deleteVendorLabel: 'Delete vendor',
  secondaryExpandLabel: '⊕ Add secondary contact',

  // Overview table — 9 columns, left-to-right (star column header is empty).
  columnHeaders: [
    '',
    'Vendor',
    'Vendor ID',
    'Category',
    'Primary contact',
    'Contracts',
    'Upcoming Actions',
    'Status',
    'Date Added',
  ] as const,

  // Inline field validation (plain danger text, validate-on-save).
  requiredField: 'This field is required.',
  invalidEmail: 'Please enter a valid email address.',
  invalidPhone: 'Please enter a valid phone number.',

  // Delete flow
  deleteConfirmBody: 'All existing data for this vendor will be permanently deleted.',
  deleteConfirmOk: 'Delete',
  vendorDeletedToast: 'Vendor deleted.',
  deleteBlockedActiveContracts: 'A vendor with active contracts cannot be deleted.',
  deleteBlockedOpenParticipation:
    'This vendor is participating in an open sourcing event and cannot be deleted.',

  // Status toggle (active -> inactive requires confirm; inactive -> active immediate).
  statusConfirmTitle: 'Mark vendor as inactive?',
  statusConfirmBody:
    'Inactive vendors will not appear in Recommendations, cannot be invited to sourcing events, and cannot be awarded contracts. You can reactivate them at any time..',
  statusConfirmOk: 'Mark as Inactive',

  // Empty / error states
  emptyNoMatch: 'No vendors found matching your search.',
  emptyNoVendors: 'No vendors yet. Add your first vendor to get started.',
  errorTitle: 'Something went wrong. Please try again.',

  // Compliance uploads
  docTypeError: 'Only PDF files are accepted.',

  // Previous spend
  spendNotSet: 'Not set',

  // Category taxonomy used by the Add form (lib/constants/vendors.ts VENDOR_CATEGORIES).
  category: {
    technology: 'Technology',
    technologySub: 'Software / SaaS',
    marketing: 'Marketing & Sales',
  },
} as const;
