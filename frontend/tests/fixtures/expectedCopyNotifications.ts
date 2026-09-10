/**
 * CEIQ-FEAT-012 Notification Centre — mandated copy, the closed relative-label
 * set, the forbidden phrasings, the BR-03 kind→colour/glyph map, and the as-built
 * locator constants.
 *
 * Source of truth for every string here is the SPEC/testcase file
 * (testcases/TC-CEIQ-FEAT-012.md — validation rules, BR-02, BR-03, AC-002/005/006)
 * and its §6 UI locator contract, NOT the running app. The copy IS the contract,
 * so it lives here and never inline in a spec: one change, one edit.
 *
 * The one exception is `NotificationsAsBuilt` at the bottom — strings the code
 * ships that the spec does NOT mandate. They are quarantined there deliberately so
 * no case can assert them as a requirement (clarifications Q-E1 / Q-F1).
 */

/** Copy the spec mandates. Every string is asserted verbatim by at least one case. */
export const NotificationsCopy = {
  /** AC-002 — the panel header, strong text, exact casing, no count suffix. */
  panelHeader: 'Notifications',
  /** AC-002 / AC-006 — the link-style action in the panel header. */
  clearAll: 'Clear all',
  /** AC-006 / EC-02 — the AntD `Empty` description, apostrophe and full stop included. */
  empty: "You're all caught up. No notifications right now.",
  /** AC-004 deleted-record branch — rendered IN PLACE OF the relative-label pill. */
  unavailableRecord: 'This record is no longer available',
} as const;

/**
 * BR-02 / validation rules — the closed set of relative-time labels. `N` is a bare
 * integer ≥ 2: distance 0 and 1 are always the word forms, so `In 1 days` and
 * `1 days ago` are defects, not members of the set.
 */
export const RelativeLabel = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
  inNDays: /^In (?:[2-9]|[1-9]\d+) days$/,
  nDaysAgo: /^(?:[2-9]|[1-9]\d+) days ago$/,
} as const;

/** The five permitted label forms, as matchers. */
export const CLOSED_LABEL_SET: readonly RegExp[] = [
  /^Today$/,
  /^Tomorrow$/,
  /^Yesterday$/,
  RelativeLabel.inNDays,
  RelativeLabel.nDaysAgo,
];

/** True when `text` is one of the five permitted relative-time labels. */
export function isPermittedRelativeLabel(text: string): boolean {
  const trimmed = text.trim();
  return CLOSED_LABEL_SET.some((pattern) => pattern.test(trimmed));
}

/**
 * Validation rules — phrasings a label must NEVER use ("never 'Nd left',
 * 'N days remaining', or anything prefixed with 'passed'"). Scoped to the LABEL:
 * the word "passed" is legitimate inside a kind-6 message
 * (`Notice deadline passed on MM/DD/YYYY CT`).
 */
export const ForbiddenLabelPhrasing = {
  /** `5d left`, `5 d left`. */
  dayShorthandLeft: /\d+\s*d\s+left/i,
  /** `3 days remaining`, `1 day remaining`. */
  daysRemaining: /days? remaining/i,
  /** A label that BEGINS with "passed" — `passed 3 days ago`. */
  passedPrefix: /^passed\b/i,
  /** Urgency wording that has no place in a label at all. */
  strayUrgencyWord: /\b(left|remaining|overdue|due in)\b/i,
} as const;

/**
 * BR-03 — "all 'how long until / how long since' lives in the label, never the
 * message". These are the leaks a message line must not contain.
 */
export const ForbiddenMessagePhrasing = {
  reminderQualifier: /\(\d+-day reminder\)/i,
  dayCount: /\b\d+\s*days?\b/i,
  inNumber: /\bin \d+\b/i,
  dayShorthand: /\b\d+d\b/i,
  tMinus: /\bT-\d+\b/i,
  /** The label's own wording must not be duplicated into the message. */
  relativeWord: /\b(Today|Tomorrow|Yesterday)\b/,
} as const;

/** Global assumption — every date in a row reads `MM/DD/YYYY CT`, never bare. */
export const DateFormat = {
  /** The one permitted form. */
  usDateWithCt: /\b\d{2}\/\d{2}\/\d{4} CT\b/,
  /** Every US-style date occurrence in a string (for the "never bare" sweep). */
  anyUsDate: /\d{1,2}\/\d{1,2}\/\d{4}/g,
  /** ISO (`2026-09-04`) — forbidden in a rendered row. */
  isoDate: /\d{4}-\d{2}-\d{2}/,
  /** Long form (`September 4, 2026`) — forbidden in a rendered row. */
  longDate:
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/,
  /** A UTC offset standing in for the literal `CT`. */
  utcOffset: /[+-]\d{2}:\d{2}\b/,
} as const;

/**
 * BR-03 colour rule — kinds 1/2/5 amber, kinds 3/4/6/8 red, kind 7 teal. The API
 * returns this as `iconColor`; the UI maps the SERVER value (amber → colorWarning,
 * red → colorError, teal → colorInfo) rather than deciding colour from the kind, so
 * a case asserts BOTH that the API's kind→colour agrees with this table AND that
 * rows sharing an `iconColor` render the same colour while different ones differ.
 * No hex is pinned anywhere — the theme token is free to change.
 */
export type IconColour = 'amber' | 'red' | 'teal';

export const KIND_ICON_COLOUR: Readonly<Record<number, IconColour>> = {
  1: 'amber',
  2: 'amber',
  5: 'amber',
  3: 'red',
  4: 'red',
  6: 'red',
  8: 'red',
  7: 'teal',
};

/**
 * §6 locator contract — one glyph per kind, as the AntD icon class the glyph
 * renders with. Kinds 3, 4 and 6 deliberately share a glyph AND a colour; they are
 * told apart by their message text (TC-NOTUI-051 note).
 */
export const KIND_GLYPH_CLASS: Readonly<Record<number, string>> = {
  1: 'anticon-warning',
  2: 'anticon-warning',
  3: 'anticon-field-time',
  4: 'anticon-field-time',
  5: 'anticon-bell',
  6: 'anticon-field-time',
  7: 'anticon-check-circle',
  8: 'anticon-close-circle',
};

/** BR-03 message templates for the real-time kinds (the only kinds live on dev). */
export const ProposalMessageTemplate = {
  /** Kind 7 — `<Vendor name> submitted a proposal for <Event title> on MM/DD/YYYY CT`. */
  submitted: /^.+ submitted a proposal for .+ on \d{2}\/\d{2}\/\d{4} CT$/,
  /** Kind 8 — `<Vendor name> withdrew their proposal for <Event title> on MM/DD/YYYY CT`. */
  withdrawn: /^.+ withdrew their proposal for .+ on \d{2}\/\d{2}\/\d{4} CT$/,
} as const;

/** BR-03 message templates for the daily-job kinds (no fixture on dev — TC-NOTUI-050). */
export const DeadlineMessageTemplate: Readonly<Record<number, RegExp>> = {
  1: /^.+: Contract expires on \d{2}\/\d{2}\/\d{4} CT$/,
  2: /^.+: Submission deadline on \d{2}\/\d{2}\/\d{4} CT$/,
  3: /^.+: Contract expired on \d{2}\/\d{2}\/\d{4} CT$/,
  4: /^.+: Submission window closed on \d{2}\/\d{2}\/\d{4} CT$/,
  5: /^.+: Notice deadline on \d{2}\/\d{2}\/\d{4} CT$/,
  6: /^.+: Notice deadline passed on \d{2}\/\d{2}\/\d{4} CT$/,
};

/** The em dash (U+2014) the contract display-name convention mandates — pinned so a hyphen reads as a defect. */
export const EM_DASH = '—';

/**
 * §6 UI locator contract (as-built — `clearedge-frontend@origin/dev` `5201250`,
 * 2026-09-04). Selectors only; behaviour lives in pages/NotificationCentre.ts.
 */
export const NotificationSelectors = {
  bell: 'button[aria-label="Notifications"]',
  dismiss: 'button[aria-label="Dismiss notification"]',
  row: '[data-testid="notification-row"]',
  unreadDot: '[data-testid="notification-unread-dot"]',
  typeIcon: '[data-testid="notification-type-icon"]',
  /** AntD Badge wrapper — present ONLY when unreadCount > 0 (absence == "badge hidden"). */
  badge: '.ant-badge',
  /** The popover the panel renders into; AntD marks a closed one `ant-popover-hidden`. */
  popover: '.ant-popover:not(.ant-popover-hidden)',
  /** Tech §6.2 — the row list's own scroll container. */
  scrollContainer: 'div[style*="overflow-y: auto"]',
  empty: '.ant-empty',
  emptyDescription: '.ant-empty-description',
  /** The as-built error state renders as AntD danger text (see NotificationsAsBuilt). */
  dangerText: '.ant-typography-danger',
} as const;

/** Tech §6.2 — the panel's fixed geometry. */
export const PanelGeometry = {
  widthPx: 400,
  listMaxHeightPx: 380,
  /** BR-01 — the visible window; the 21st row must be absent from the DOM, not hidden. */
  visibleWindow: 20,
} as const;

/**
 * API path fragments. Base URLs never appear here (secrets-and-env.rules §1a) —
 * these are matched against `URL.pathname` so they work on any environment.
 * The app calls `<APP_API_BASE_URL>/v1/notifications`, i.e. `/api/v1/notifications`.
 */
export const NotificationsApiPaths = {
  /** Endpoint #1 GET / #4 DELETE — the EXACT path, no suffix. */
  list: '/v1/notifications',
  /** Endpoint #2 — PATCH `/v1/notifications/:id/read`. */
  readSuffix: '/read',
  /** Endpoint #5 — the SSE stream (POST as-built; 404 on dev). Excluded from every list-call count. */
  stream: '/v1/notifications/stream',
} as const;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AS-BUILT ONLY — NOT SPEC-MANDATED.
 *
 * The panel renders this danger text when `GET /notifications` fails. The spec
 * defines no panel error state and no error copy, so this string is developer-chosen
 * placeholder copy pending clarifications Q-E1 / Q-F1. It is kept here so an
 * interception-based case can RECOGNISE the state, and it must never be asserted as
 * a requirement: no TC-NOTUI case claims coverage of it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const NotificationsAsBuilt = {
  panelErrorText: "Couldn't load notifications. Try again shortly.",
} as const;

/** Tech §6.4 — the two navigation destinations the hook builds (as-built `?tab=` mechanism, Q-E5). */
export const NotificationRoutes = {
  contract: (referenceId: string): string => `/contracts/${referenceId}?tab=summary`,
  sourcing: (referenceId: string, destinationTab: string): string => `/sourcing/${referenceId}?tab=${destinationTab}`,
} as const;
