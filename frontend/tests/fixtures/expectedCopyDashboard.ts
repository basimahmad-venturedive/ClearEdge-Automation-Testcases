/**
 * CEIQ-FEAT-011 Dashboard — expected copy, routes and API path fragments.
 *
 * Every string here is quoted from the spec, not from the running app: the copy IS
 * the contract (US-DASH-001 AC-001/AC-008, US-DASH-002 AC-001/AC-007,
 * US-DASH-003 AC-003), and several of these strings double as the suite's locators
 * because the Dashboard ships no `data-testid` attributes (TC file §6, gap G-1).
 */
export const DashboardCopy = {
  route: '/dashboard',

  header: {
    title: 'Dashboard',
    subtitle: 'Snapshot of contracts and sourcing events.',
  },

  panels: {
    contracts: 'Contracts',
    sourcing: 'Sourcing',
    createNew: 'Create new',
    expiringTile: 'Expiring in 30 days',
    inReviewTile: 'In Review',
    closingTile: 'Closing in a week',
    deadlinesTile: 'Deadlines',
  },

  recentActivity: {
    title: 'Recent Activity',
    empty: 'No recent activity yet',
    tags: { contract: 'Contract', rfp: 'RFP', rfq: 'RFQ' },
  },

  calendar: {
    listHeader: 'Upcoming Events',
    legendContract: 'Contract expiry',
    legendSourcing: 'Sourcing deadline',
    emptyList: 'No upcoming events',
    weekdayHeaders: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    // `title` attributes on the AntD icon buttons — the only stable handle the
    // calendar's view controls expose today.
    expandToWeek: 'Expand to weekly view',
    collapseToList: 'Back to list view',
    expandToMonth: 'Expand to monthly view',
    compressToWeek: 'Back to weekly view',
  },

  renewals: {
    title: 'Upcoming Renewals & Expirations',
    viewAll: 'View All',
    empty: 'No contracts expiring in the next 30 days',
  },

  activeSourcing: {
    title: 'Active Sourcing Events',
    viewAll: 'View All',
    empty: 'No active sourcing events',
  },

  errors: {
    summary: { message: 'Failed to load dashboard', description: 'Could not fetch data. Please refresh the page.' },
    calendar: { message: 'Failed to load calendar', description: 'Could not retrieve event data. Please refresh the page.' },
    panel: { message: 'Failed to load data', description: 'Could not retrieve data. Please refresh the page.' },
  },

  /** The em-dash sentinel (U+2014). A hyphen-minus here would be a defect, so it is pinned. */
  dash: '—',

  /** Tech §6.6 — the sixteen navigation targets, as URL suffixes. */
  routes: {
    contractsAll: '/contracts?status=all',
    contractsExpiring: '/contracts?status=expiring_soon',
    contractsInReview: '/contracts?status=in_review',
    contractsUpload: '/contracts/upload',
    sourcingAll: '/sourcing?tab=all',
    sourcingExpiringSoon: '/sourcing?tab=expiringSoon',
    sourcingActive: '/sourcing?tab=active',
    contractDetail: (id: string) => `/contracts/${id}`,
    sourcingDetail: (id: string) => `/sourcing/${id}`,
  },
} as const;

/**
 * The shared sourcing create-event modal's own `data-testid` contract, owned by
 * CEIQ-FEAT-007 (`lib/constants/sourcingTestIds.ts`). The Dashboard mounts this
 * component rather than reimplementing it (BR-06), so the Dashboard suite uses the
 * component's real selectors instead of inventing text-based ones — that is also
 * what makes TC-DASHUI-018's "same component" assertion meaningful.
 */
export const SourcingModalTestIds = {
  modal: 'sourcing-ai-prompt-modal',
  eventTypeGroup: 'sourcing-ai-prompt-event-type-group',
  textarea: 'sourcing-ai-prompt-textarea',
  generateButton: 'sourcing-ai-prompt-generate-button',
  skipButton: 'sourcing-ai-prompt-skip-button',
} as const;

/** API path fragments used for response capture and route interception. */
export const DashboardApi = {
  summary: '**/dashboard/summary*',
  recentActivity: '**/dashboard/recent-activity*',
  calendarEvents: '**/dashboard/calendar-events*',
  renewals: '**/dashboard/renewals*',
  activeSourcing: '**/dashboard/active-sourcing*',
} as const;

/**
 * The `data-testid` contract requested from the frontend team (gap G-1). Nothing in
 * this suite uses it yet — it exists so the request is versioned alongside the tests
 * that would consume it, the same way the chat suite's contract was.
 */
export const ProposedDashboardTestIds = {
  headerTitle: 'dashboard-header-title',
  headerSubtitle: 'dashboard-header-subtitle',
  contractsPanel: 'dashboard-contracts-panel',
  contractsCount: 'dashboard-contracts-count',
  subtileExpiring: 'dashboard-subtile-expiring',
  subtileInReview: 'dashboard-subtile-inreview',
  contractsCreate: 'dashboard-contracts-create',
  sourcingPanel: 'dashboard-sourcing-panel',
  sourcingCount: 'dashboard-sourcing-count',
  subtileClosing: 'dashboard-subtile-closing',
  deadlinesTile: 'dashboard-deadlines-tile',
  deadlineRow: (type: 'rfp' | 'rfq') => `dashboard-deadline-${type}`,
  sourcingCreate: 'dashboard-sourcing-create',
  recentActivity: 'dashboard-recent-activity',
  activityItem: (i: number) => `dashboard-activity-item-${i}`,
  calendar: 'dashboard-calendar',
  calendarExpand: 'dashboard-calendar-expand',
  weekCollapse: 'dashboard-week-collapse',
  weekExpand: 'dashboard-week-expand',
  monthCompress: 'dashboard-month-compress',
  calendarPicker: 'dashboard-calendar-picker',
  weekRange: 'dashboard-week-range',
  monthCell: (date: string) => `dashboard-month-cell-${date}`,
  monthMore: (date: string) => `dashboard-month-more-${date}`,
  renewals: 'dashboard-renewals',
  renewalsViewAll: 'dashboard-renewals-viewall',
  activeSourcing: 'dashboard-active-sourcing',
  activeSourcingViewAll: 'dashboard-active-sourcing-viewall',
} as const;
