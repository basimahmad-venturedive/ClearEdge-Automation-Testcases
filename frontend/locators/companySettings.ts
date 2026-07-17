/**
 * Company Settings screen selectors — PROPOSED contract (CEIQ-FEAT-004).
 *
 * The tenant `/company-settings` route is not yet built and the spec defines no
 * data-testid attributes. These follow the kit placeholder policy (analogous to
 * TODO_LOCATOR): a request to the frontend team. Playwright specs must not merge
 * against these until the real attributes exist or role/name fallbacks are
 * verified on the live screen. Source: testcases/TC-CEIQ-FEAT-004.md §6.
 *
 * Section keys align with the API slugs: 'background' | 'introduction' |
 * 'terms_and_conditions'.
 */
export type SectionKey = 'background' | 'introduction' | 'terms_and_conditions';

export const CompanySettingsLocators = {
  /** Account/profile dropdown trigger in the app shell. */
  accountMenuTrigger: 'account-menu-trigger',
  /** "Company Settings" menu item (Owner-only). role fallback: menuitem[name="Company Settings"]. */
  menuItem: 'menu-company-settings',
  menuItemName: 'Company Settings',
  /** Page heading — role=heading[name="Company Settings"]. */
  pageHeadingName: 'Company Settings',
  /** Page subtitle. */
  subtitle: 'company-settings-subtitle',
  /** Per-section testids are suffixed with the section key. */
  sectionCard: (key: SectionKey): string => `cs-section-${key}`,
  contentReadonly: (key: SectionKey): string => `cs-content-${key}`,
  textarea: (key: SectionKey): string => `cs-textarea-${key}`,
  saveTooltip: (key: SectionKey): string => `cs-save-tooltip-${key}`,
  /** Button accessible names (within a section card). */
  editButtonName: 'Edit',
  discardButtonName: 'Discard',
  saveButtonName: 'Save',
  /** Unsaved-changes popup. */
  unsavedPopup: 'cs-unsaved-popup',
  popupCancelName: 'Cancel',
  popupSaveChangesName: 'Save Changes',
  /** Save confirmation toast (top-right). */
  confirmation: 'cs-confirmation',
  confirmationDismiss: 'cs-confirmation-dismiss',
  /** Generic error message. */
  error: 'cs-error',
} as const;
