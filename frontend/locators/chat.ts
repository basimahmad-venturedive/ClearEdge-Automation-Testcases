/**
 * CEIQ-FEAT-010 Contract Q&A Chat — locator contract.
 *
 * The `TESTID` block mirrors `clearedge-frontend/lib/constants/chatTestIds.ts` exactly
 * (pulled 2026-08-31, commit 8816aa3). Verified present on QA by recon before use.
 *
 * The `FALLBACK` block covers elements the frontend has NOT given a testid. Each is
 * located by role or by the spec's own mandated copy — which is legitimate here because
 * the spec fixes that copy verbatim, so the locator and the assertion are the same
 * requirement. These are listed explicitly rather than buried in specs so the frontend
 * team can see exactly which ids would still help.
 */

export const ChatTestIds = {
  launcherPill: 'chat-launcher-pill',
  launcherButton: 'chat-launcher-button',

  panelCard: 'chat-panel-card',
  minimise: 'chat-minimise-button',
  maximise: 'chat-maximise-button',
  close: 'chat-close-button',
  closeConfirmOk: 'chat-close-confirm-ok-button',
  closeConfirmCancel: 'chat-close-confirm-cancel-button',

  messagesContainer: 'chat-messages-scroll-container',
  thinking: 'chat-thinking-indicator',
  streamingCursor: 'streaming-cursor',

  scopeToggle: 'chat-scope-toggle-button',
  clearThread: 'chat-clear-thread-link',
  input: 'chat-input-textarea',
  send: 'chat-send-button',

  scopePicker: 'chat-scope-picker',
  scopeSearch: 'chat-scope-search-input',
  scopeGeneral: 'chat-scope-general-option',
  seeExamples: 'chat-see-examples-link',
} as const;

/** `chat-message-bubble-<messageId>` — prefix selector, ids are runtime-assigned. */
export const MESSAGE_BUBBLE_PREFIX = '[data-testid^="chat-message-bubble-"]';
/** `chat-citation-chip-<sourceId>` — prefix selector. */
export const CITATION_CHIP_PREFIX = '[data-testid^="chat-citation-chip-"]';
/** `chat-scope-contract-option-<familyId>` — prefix selector. */
export const SCOPE_CONTRACT_OPTION_PREFIX = '[data-testid^="chat-scope-contract-option-"]';

export const scopeContractOption = (familyId: string) => `chat-scope-contract-option-${familyId}`;

/**
 * Elements with no testid as of commit 8816aa3 — located by role/copy instead.
 * Requested from the frontend team; until they exist these locators are the contract.
 */
export const ChatFallback = {
  /** AC-3 header title / subtitle. */
  headerTitle: 'ClearEdgeIQ Agent',
  headerSubtitle: 'Analysis on risks, renewals, clauses etc.',
  /** AC-4 hint beside the scope pill — no testid; matched by its mandated wording. */
  hintGeneralPrefix: 'asks across all',
  hintContractOnly: 'this contract only',
  hintLimitReached: 'Maximum capacity reached — please clear chat to continue',
  /** AC-6 / AC-7 empty-state copy. */
  emptyGeneralHeadline: 'What are we looking at today?',
  emptyGeneralSubtitle: 'Ask all contracts, or scope to one. See examples.',
  examplesHeadline: 'What should I look into?',
  examplesSubtitle: 'Every answer cites the contract it came from',
  examplesLabel: 'EXAMPLE QUESTIONS',
  emptyContractHeadline: 'Ask about this contract',
  emptyContractLabel: 'ASK ABOUT THIS CONTRACT',
  /** CLRE-320 — the picker's minimize control; aria-label only, still no testid. */
  pickerMinimiseLabel: 'Minimize scope picker',
  /** AC-5 picker section labels. */
  scopeSectionLabel: 'SCOPE',
  contractsSectionLabel: 'CONTRACTS',
  scopeGeneralLabel: 'General questions',
  scopeCurrentMarker: 'Current',
  /** AC-10 input placeholder + footer hint. */
  inputPlaceholder: 'Ask about a clause, risk, expiry, or payment term…',
  inputFooterHint: 'Enter to send · Shift+Enter new line',
  /** AC-18 close-confirmation copy. */
  closeConfirmBody: 'Are you sure you want to close? The current session will end.',
  /** AC-11 thinking indicator copy (the testid exists; copy asserted too). */
  thinkingText: 'Thinking',
} as const;
