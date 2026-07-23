/**
 * Company Settings screen selectors — VERIFIED against the built tenant app
 * (codebase/clearedge-frontend, dev). Source of truth for the data-testids:
 *   lib/constants/companySettingsTestIds.ts
 *   app/(app)/company-settings/_components/*
 *
 * The screen shipped on dev (PR #26). These ids are the real attributes emitted
 * by CompanySettingsView / CompanySettingsSectionCard / UnsavedChangesModal —
 * no longer a proposed contract. Per-section ids are suffixed with the API slug
 * ('background' | 'introduction' | 'terms_and_conditions').
 *
 * Note the antd realities the POM relies on (no testids of their own):
 *  - section heading  → antd Card title (`.ant-card-head-title`), NOT role=heading.
 *  - save confirmation → antd notification (`.ant-notification-notice`), top-right.
 *  - save error (5xx)  → antd message (`.ant-message-notice`).
 *  - field validation  → antd Form.Item explain (`.ant-form-item-explain-error`).
 */
export type SectionKey = 'background' | 'introduction' | 'terms_and_conditions';

export const CompanySettingsLocators = {
  /** Page-shell view container. */
  view: 'company-settings-view',
  /** Route-guard loading spinner while the right check is in flight. */
  loading: 'company-settings-loading',

  /** "Company Settings" avatar-dropdown item (rendered only when the PO holds
   *  `manage_company_settings`). role fallback: menuitem[name="Company Settings"]. */
  menuItemName: 'Company Settings',
  /** Page heading — PageHeader renders Typography.Title level=3 → role=heading. */
  pageHeadingName: 'Company Settings',

  /** Per-section testids (companySettingsSectionTestIds in the app). */
  sectionCard: (key: SectionKey): string => `company-settings-section-${key}-card`,
  contentReadonly: (key: SectionKey): string => `company-settings-section-${key}-content`,
  textarea: (key: SectionKey): string => `company-settings-section-${key}-textarea`,
  editButton: (key: SectionKey): string => `company-settings-section-${key}-edit-button`,
  discardButton: (key: SectionKey): string => `company-settings-section-${key}-discard-button`,
  saveButton: (key: SectionKey): string => `company-settings-section-${key}-save-button`,

  /** Button accessible names (fallback within a section card). */
  editButtonName: 'Edit',
  discardButtonName: 'Discard',
  saveButtonName: 'Save',

  /** Unsaved-changes popup (antd Modal). */
  unsavedPopup: 'company-settings-unsaved-changes-modal',
  popupCancel: 'company-settings-unsaved-changes-modal-cancel-button',
  popupSaveChanges: 'company-settings-unsaved-changes-modal-save-button',
  popupCancelName: 'Cancel',
  popupSaveChangesName: 'Save Changes',

  /** antd portals without testids — matched by class. The save confirmation is a
   *  SUCCESS notification; scope to it so unrelated (e.g. error) notices on the
   *  page don't collide with `.last()`. */
  confirmationNotice: '.ant-notification-notice-success',
  confirmationClose: '.ant-notification-notice-close',
  messageNotice: '.ant-message-notice',
  fieldError: '.ant-form-item-explain-error',
  cardTitle: '.ant-card-head-title',
} as const;
