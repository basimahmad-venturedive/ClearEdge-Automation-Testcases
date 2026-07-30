/**
 * Clause Configuration (CEIQ-FEAT-006) selectors.
 *
 * The clause-config components ship NO data-testids (verified on dev branch:
 * app/(app)/clause-configuration/_components/*), so this suite locates by antd
 * role/text — the same approach the vendor suite documents for antd internals:
 *  - buttons            → role=button by accessible name (Edit / Discard / Save Changes)
 *  - page title         → role=heading, name "Clause Configuration"
 *  - info banner        → antd Alert (`.ant-alert`) matched by its description text
 *  - table headers      → role=columnheader by text
 *  - table              → antd Table (`.ant-table`), rows `.ant-table-tbody tr`
 *  - success toast      → antd App.message (`.ant-message-notice`), matched by text
 *  - disabled-Save tip  → antd Tooltip (`.ant-tooltip`), matched by text
 *  - unsaved popup      → antd Modal.confirm (`.ant-modal-confirm`), Discard / Save Changes
 *  - risk pill / menu   → colored tag; menu is an antd Dropdown (`.ant-dropdown-menu`)
 *  - loading            → antd Skeleton (`.ant-skeleton`)
 */
export const ClauseLocators = {
  navItemName: 'Clause Configuration',

  alert: '.ant-alert',
  table: '.ant-table',
  tableRows: '.ant-table-tbody tr.ant-table-row',
  toast: '.ant-message-notice-content',
  tooltip: '.ant-tooltip-inner',
  confirmModal: '.ant-modal-confirm',
  dropdownMenu: '.ant-dropdown-menu:visible',
  skeleton: '.ant-skeleton',

  // row-scoped controls (within a `.ant-table-row`)
  rowCheckbox: '.ant-checkbox-input',
  rowStandardClauseSelect: '.ant-select',
  rowRiskPill: '[data-risk], .ant-tag',
} as const;
