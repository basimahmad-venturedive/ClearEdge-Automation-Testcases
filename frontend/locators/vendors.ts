/**
 * Vendor Directory (CEIQ-FEAT-005) screen selectors — VERIFIED against the built
 * tenant app (codebase/clearedge-frontend, dev branch). Source of truth for the
 * data-testids:
 *   lib/constants/vendorTestIds.ts
 *   app/(app)/vendors/** (list, detail, shared create/edit form)
 *
 * The screen shipped on dev (feat/ceiq-feat-005 + the data-testid coverage PR
 * "test: add data-testid coverage to vendor and company-settings features"), so
 * these ids are the REAL emitted attributes, no longer a proposed contract.
 *
 * Form-field ids are built from the modal prefix (create vs. edit share
 * VendorFormFields): pass 'vendor-create-form' or 'vendor-edit-form'.
 *
 * antd realities this suite relies on (no testids of their own):
 *  - column headers      → antd Table `th` text (role=columnheader).
 *  - category / subcat   → antd Select; option list renders in a body portal
 *                          (`.ant-select-item-option`), matched by text.
 *  - toasts              → antd App.message (`.ant-message-notice`), top-center.
 *  - status confirm      → antd Modal.confirm (`.ant-modal-confirm`).
 *  - delete confirm      → antd Popconfirm (`.ant-popover` / `.ant-popconfirm`).
 *  - inline field errors → plain Typography.Text[type=danger] under the field
 *                          (NOT a Form.Item explain), so matched by text.
 */
export type VendorFormPrefix = 'vendor-create-form' | 'vendor-edit-form';
export type VendorDocType = 'w9' | 'coi';

export const VendorLocators = {
  // ---------------------------------------------------------------- navigation
  navItemName: 'Vendors',
  pageTitle: 'Vendors',

  // ----------------------------------------------------------------- list view
  listView: 'vendor-list-view',
  listCard: 'vendor-list-card',
  addButton: 'vendor-list-add-button',
  emptyAddButton: 'vendor-list-empty-add-button',
  errorResult: 'vendor-list-error-result',
  loadingSkeleton: 'vendor-list-loading-skeleton',
  emptyState: 'vendor-list-empty-state',
  table: 'vendor-list-table',
  pagination: 'vendor-list-pagination',

  // ------------------------------------------------------------------- toolbar
  searchInput: 'vendor-toolbar-search-input',
  categorySelect: 'vendor-toolbar-category-select',
  primaryOnlySwitch: 'vendor-toolbar-primary-only-switch',

  // ------------------------------------------------- table rows (per vendorId)
  row: (vendorId: string): string => `vendor-row-${vendorId}`,
  rowName: (vendorId: string): string => `vendor-row-name-${vendorId}`,
  rowStarToggle: (vendorId: string): string => `vendor-row-star-toggle-${vendorId}`,
  rowStatusToggle: (vendorId: string): string => `vendor-row-status-toggle-${vendorId}`,
  rowUpcomingActionsButton: (vendorId: string): string =>
    `vendor-row-upcoming-actions-button-${vendorId}`,
  rowContactEmailLink: (vendorId: string): string => `vendor-row-contact-email-link-${vendorId}`,
  upcomingActionsPopoverList: 'vendor-upcoming-actions-popover-list',
  upcomingActionRow: (contractId: string): string => `vendor-upcoming-action-row-${contractId}`,

  // ----------------------------------------------------------- create modal
  createModal: 'vendor-create-modal',
  createModalCancel: 'vendor-create-modal-cancel-button',
  createModalSave: 'vendor-create-modal-save-button',
  createFormPrefix: 'vendor-create-form' as VendorFormPrefix,

  // ------------------------------------------------------------- edit modal
  editModal: 'vendor-edit-modal',
  editModalCancel: 'vendor-edit-modal-cancel-button',
  editModalSave: 'vendor-edit-modal-save-button',
  editModalDelete: 'vendor-edit-modal-delete-button',
  editFormPrefix: 'vendor-edit-form' as VendorFormPrefix,

  // ------------------------------------------------- shared form-field builders
  formName: (p: VendorFormPrefix): string => `${p}-name-input`,
  formWebsite: (p: VendorFormPrefix): string => `${p}-website-input`,
  formNotes: (p: VendorFormPrefix): string => `${p}-notes-input`,
  formPrimaryCategory: (p: VendorFormPrefix): string => `${p}-primary-category-select`,
  formSubcategory: (p: VendorFormPrefix): string => `${p}-subcategory-select`,
  formPrimaryContactName: (p: VendorFormPrefix): string => `${p}-primary-contact-name-input`,
  formPrimaryContactEmail: (p: VendorFormPrefix): string => `${p}-primary-contact-email-input`,
  formPrimaryContactPhone: (p: VendorFormPrefix): string => `${p}-primary-contact-phone-input`,
  // primary contact address sub-fields (prefix-primary-address-<suffix>)
  formPrimaryAddressStreet: (p: VendorFormPrefix): string =>
    `${p}-primary-address-street-address-input`,
  formPrimaryAddressLine2: (p: VendorFormPrefix): string =>
    `${p}-primary-address-street-address-line2-input`,
  formPrimaryAddressCity: (p: VendorFormPrefix): string => `${p}-primary-address-city-input`,
  formPrimaryAddressState: (p: VendorFormPrefix): string => `${p}-primary-address-state-input`,
  formPrimaryAddressZip: (p: VendorFormPrefix): string => `${p}-primary-address-zip-code-input`,
  // secondary contact (collapsed by default)
  formSecondaryExpand: (p: VendorFormPrefix): string => `${p}-secondary-contact-expand-button`,
  formSecondaryCollapse: (p: VendorFormPrefix): string => `${p}-secondary-contact-collapse-button`,
  formSecondaryName: (p: VendorFormPrefix): string => `${p}-secondary-contact-name-input`,
  formSecondaryEmail: (p: VendorFormPrefix): string => `${p}-secondary-contact-email-input`,
  formSecondaryPhone: (p: VendorFormPrefix): string => `${p}-secondary-contact-phone-input`,
  // compliance uploads
  formDocFileInput: (p: VendorFormPrefix, type: VendorDocType): string => `${p}-${type}-file-input`,
  formDocUploadButton: (p: VendorFormPrefix, type: VendorDocType): string =>
    `${p}-${type}-upload-button`,
  formDocRemoveButton: (p: VendorFormPrefix, type: VendorDocType): string =>
    `${p}-${type}-remove-button`,

  // ---------------------------------------------------------------- detail view
  detailView: 'vendor-detail-view',
  detailHeader: 'vendor-detail-header',
  detailBackButton: 'vendor-detail-back-button',
  detailEditButton: 'vendor-detail-edit-button',
  detailInviteButton: 'vendor-detail-invite-button',
  detailErrorResult: 'vendor-detail-error-result',
  detailLoadingSkeleton: 'vendor-detail-loading-skeleton',
  detailStarToggle: 'vendor-detail-star-toggle',
  detailStatusToggle: 'vendor-detail-status-toggle',

  // ------------------------------------------------------------- profile cards
  profileCard: 'vendor-profile-card',
  spendEditButton: 'vendor-profile-spend-edit-button',
  spendInput: 'vendor-profile-spend-input',
  spendSaveButton: 'vendor-profile-spend-save-button',
  spendCancelButton: 'vendor-profile-spend-cancel-button',
  complianceCard: 'vendor-compliance-card',
  contractsCard: 'vendor-contracts-card',
  historyCard: 'vendor-history-card',
  awardsCard: 'vendor-awards-card',
  docPreviewModal: 'vendor-doc-preview-modal',

  // --------------------------------------------------------------- invite modal
  inviteModal: 'vendor-invite-modal',
  inviteModalCancel: 'vendor-invite-modal-cancel-button',
  inviteModalSend: 'vendor-invite-modal-send-button',
  inviteEventRow: (eventId: string): string => `vendor-invite-event-row-${eventId}`,

  // --------------------------------------------------- compliance doc builders
  complianceViewButton: (type: VendorDocType): string => `vendor-compliance-${type}-view-button`,
  complianceUploadButton: (type: VendorDocType): string =>
    `vendor-compliance-${type}-upload-button`,
  complianceDeleteButton: (type: VendorDocType): string =>
    `vendor-compliance-${type}-delete-button`,

  // -------------------------------------------------- antd portals (no testid)
  toastNotice: '.ant-message-notice',
  confirmModal: '.ant-modal-confirm',
  popconfirm: '.ant-popconfirm, .ant-popover',
  selectOption: '.ant-select-item-option',
  columnHeader: '.ant-table-thead th',
} as const;
