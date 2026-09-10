/**
 * CEIQ-FEAT-010 — every user-facing string the spec fixes verbatim, plus the route
 * inventory from AC-1. Kept in one place so a copy change fails one fixture rather
 * than a dozen specs.
 */

export const ChatCopy = {
  launcherPill: 'Chat with ClearEdgeIQ Agent',
  headerTitle: 'ClearEdgeIQ Agent',
  headerSubtitle: 'Analysis on risks, renewals, clauses etc.',

  // AC-6 — General empty state
  emptyGeneralHeadline: 'What are we looking at today?',
  emptyGeneralSubtitle: 'Ask all contracts, or scope to one. See examples.',
  examplesHeadline: 'What should I look into?',
  examplesSubtitle: 'Every answer cites the contract it came from',
  examplesLabel: 'EXAMPLE QUESTIONS',

  // CLRE-320 — the scope picker's minimize control (aria-label; no testid yet)
  pickerMinimiseLabel: 'Minimize scope picker',

  // AC-7 — contract empty state
  emptyContractHeadline: 'Ask about this contract',
  emptyContractLabel: 'ASK ABOUT THIS CONTRACT',
  emptyContractSubtitleSuffix: '— answers cite the contract',

  // AC-8 — fixed example questions
  generalExamples: [
    'How many contracts are expiring in the next 30 days?',
    'Show contracts with upcoming renewal dates.',
    'Which contracts require termination notice within the next 90 days?',
  ],
  contractExamples: [
    'When does this contract expire, and does it auto-renew?',
    'What notice do we have to give to terminate?',
    'What are the payment terms and any price escalations?',
    'Summarise the liability and indemnity clauses.',
  ],

  // AC-10 — input
  inputPlaceholder: 'Ask about a clause, risk, expiry, or payment term…',
  inputFooterHint: 'Enter to send · Shift+Enter new line',

  // AC-4 — scope hint / limit
  hintContractOnly: 'this contract only',
  hintLimitReached: 'Maximum capacity reached — please clear chat to continue',

  // AC-18 — close confirmation
  closeConfirmBody: 'Are you sure you want to close? The current session will end.',

  // AC-5 — picker
  scopeGeneralLabel: 'General questions',
  currentMarker: 'Current',
  searchPlaceholder: 'Search contracts…',
} as const;

/**
 * AC-1 route inventory. `visible` and `hidden` are exact per AC-1; `absentModules`
 * comes from the US-CHAT-001 description (not from AC-1's bullet list — the easiest
 * rule in the spec to miss, hence its own case).
 */
export const ChatRoutes = {
  visible: ['/dashboard', '/contracts', '/sourcing', '/vendors'],
  hidden: ['/contracts/upload', '/sourcing/new'],
  /** Need a real id substituted at runtime. */
  hiddenTemplates: ['/contracts/{id}/draft', '/sourcing/{id}/edit'],
  absentModules: ['/user-management', '/clause-configuration', '/company-settings'],
} as const;
