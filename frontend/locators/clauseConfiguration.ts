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
  // The clause library is a DELIBERATELY-native HTML <table> (see the app's
  // ClauseLibraryTable.tsx: "Deliberately a plain HTML <table>, not AntD Table"),
  // so it carries NO `.ant-table*` classes — locate it by its real data-testids.
  table: '[data-testid="clause-library-table"]',
  tableRows: '[data-testid="clause-library-table"] tbody tr',
  toast: '.ant-message-notice-content',
  tooltip: '.ant-tooltip-inner',
  confirmModal: '.ant-modal-confirm',
  dropdownMenu: '.ant-dropdown-menu:visible',
  skeleton: '.ant-skeleton',

  // row-scoped controls (within a `<tr data-testid="clause-row-…">`). The row
  // checkbox is an AntD Checkbox — its native `.ant-checkbox-input` is visually
  // hidden (opacity:0), so assert on the VISIBLE `.ant-checkbox-wrapper` label.
  rowCheckbox: '.ant-checkbox-wrapper',
  rowStandardClauseSelect: '.ant-select',
  rowRiskPill: '[data-risk], .ant-tag',
} as const;
