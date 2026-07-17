/**
 * PLACEHOLDER selector contract — testcases/TC-CEIQ-FEAT-001.md §6.
 *
 * The admin portal frontend is not yet built; the spec defines no data-testid
 * attributes. Every selector below is the PROPOSED contract pending
 * confirmation by the frontend team (analogous to the kit's TODO_LOCATOR
 * policy). Entries explicitly marked TODO_LOCATOR are NOT part of §6 — they
 * are additional proposals required to automate the tagged cases.
 *
 * Convention: values without a `Name` suffix are `data-testid` values; values
 * with a `Name` suffix are accessible names for `getByRole('button', { name })`.
 */
export const TenantListLocators = {
  /** §6: data-testid="tenant-card" (repeated per card) */
  tenantCard: 'tenant-card',
  /** §6: data-testid="tenant-card-badge" — top-right handover-status badge */
  cardBadge: 'tenant-card-badge',
  /** §6: data-testid="tenant-card-status-toggle" */
  cardStatusToggle: 'tenant-card-status-toggle',
  /** §6: data-testid="tenant-card-status-label" — plain text beside the toggle */
  cardStatusLabel: 'tenant-card-status-label',
  /** §6: role=button[name="Edit"] within a card */
  cardEditButtonName: 'Edit',
  /** §6: data-testid="tenant-search" */
  searchBar: 'tenant-search',
  /** §6: data-testid="tenant-count" — running total */
  tenantCount: 'tenant-count',
  /** §6: data-testid="tenant-pagination" */
  pagination: 'tenant-pagination',
  /** data-testid="create-tenant-button" — primary CTA in the list header (added to clearedge-admin) */
  createTenantButton: 'create-tenant-button',

  // ---- App-level elements (§6) — rendered above the Tenant List root and
  // shared by the profile / create flows; kept here as the single source. ----
  /** §6: data-testid="toast" */
  toast: 'toast',
  /** role=dialog confirm button — antd Modal.confirm default okText is "OK". */
  dialogConfirmName: 'OK',
  /** §6: role=dialog cancel button — exact label TBD (TC file Gaps) */
  dialogCancelName: 'Cancel',

  // ---- TODO_LOCATOR — NOT in §6; proposed additions required by
  // TC-ADMLIST-001/006/007 and TC-ADMUX-002. Owner: CEIQ frontend team. ----
  /** TODO_LOCATOR TC-ADMLIST-001 — tenant id text (format TEN####) */
  cardTenantId: 'tenant-card-tenant-id',
  /** TODO_LOCATOR TC-ADMLIST-001 — company name text within a card */
  cardCompanyName: 'tenant-card-company-name',
  /** TODO_LOCATOR TC-ADMLIST-001 — website URL anchor (opens new tab) */
  cardWebsiteLink: 'tenant-card-website-link',
  /** TODO_LOCATOR TC-ADMLIST-001 — company address text */
  cardAddress: 'tenant-card-address',
  /** TODO_LOCATOR TC-ADMLIST-001 — owner name text */
  cardOwnerName: 'tenant-card-owner-name',
  /** TODO_LOCATOR TC-ADMLIST-001 — owner email mailto anchor */
  cardOwnerEmail: 'tenant-card-owner-email',
  /** TODO_LOCATOR TC-ADMLIST-006/007 — empty grid message container */
  emptyState: 'tenant-empty-state',
  /** TODO_LOCATOR TC-ADMUX-002 / §10 — loading indicator on a pending button */
  loadingIndicator: 'loading-indicator',
} as const;
