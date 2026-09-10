/**
 * CEIQ-FEAT-008 — Vendor Portal (`/portal/:token`) selectors + exact AC copy.
 *
 * The spec pins NO `data-testid`s for the portal (SPEC §6 leaves the testid
 * contract open), and the surface is a public, client-rendered React app. So
 * every locator here anchors on the spec-pinned VISIBLE COPY via role/text, and
 * each carries a `// TODO_LOCATOR: data-testid TBD` marker where a real testid
 * should replace the text/role locator once the frontend team ships them.
 *
 * This is the single source of truth for portal copy AND locators:
 *  - `VendorPortalLocators` — role/name/text descriptors the Page Object turns
 *    into Playwright locators (no raw locators live in the spec file).
 *  - `VendorPortalCopy` — verbatim AC strings (banners, tooltips, errors,
 *    confirmation) asserted by the Page Object. Interpolated strings are exposed
 *    as pure helper functions so `{vendorName}` / `{MM/DD/YYYY}` / `{RFP|RFQ}` are
 *    filled from test data, never hardcoded per case.
 *
 * Budget non-disclosure (ASM-07): there is intentionally NO budget locator — the
 * PDF/document assertions prove the budget value never appears.
 */

/** Event type tag text (AC-02.1 — RFP geekblue / RFQ cyan; assert TEXT, not colour). */
export type EventTypeTag = 'RFP' | 'RFQ';

export const VendorPortalLocators = {
  /** Route template — the portal is a single route with internal view states (§8.1). */
  routeTemplate: '/portal/:token',

  // ── Portal shell / header (§8.2, AC-01.1) ──────────────────────────────────
  // NO data-testid for the logo (portalTestIds.ts ships none) — the brand renders
  // as the text "ClearEdge" inside the banner; anchor to the banner brand text.
  // NOTE: the live UI renders "ClearEdge", NOT "ClearEdgeIQ" — never assert the latter.
  logoText: 'ClearEdge',
  // NO data-testid for the theme toggle either — matched by its accessible name.
  themeToggleName: /toggle theme/i,
  /** Fallback role when the toggle exposes no matching accessible name. */
  themeToggleFallbackRole: 'switch' as const,
  /** localStorage key the theme persists to (§8.2). */
  themeStorageKey: 'ceiq-portal-theme',

  // ── View-state anchors (§8.3) ──────────────────────────────────────────────
  // TODO_LOCATOR: data-testid TBD — Loading is an antd Spin; matched by its role.
  spinnerRole: 'progressbar',
  // TODO_LOCATOR: data-testid TBD — document heading is the event title (role=heading).
  documentHeadingRole: 'heading',

  // ── Document view controls (US-02 / US-03) ─────────────────────────────────
  // TODO_LOCATOR: data-testid TBD — CTAs/buttons matched by accessible name.
  respondCta: 'Respond to this Request',
  downloadPdfCta: 'Download as PDF',
  tableOfContentsHeading: 'Table of Contents',
  contactInfoHeading: 'Contact Information',

  // ── Response form (US-04) ──────────────────────────────────────────────────
  // TODO_LOCATOR: data-testid TBD — fields matched by their visible labels.
  totalPriceLabel: /Total price/i,
  deliveryWeeksLabel: /Delivery \(weeks\)/i,
  proposalDocumentLabel: 'Proposal document',
  clickToUploadButton: 'Click to upload',
  submitProposalButton: 'Submit proposal',
  backToDocumentControl: 'Back to Document',

  // ── Submitted-state control + withdraw flow (US-06) ────────────────────────
  // TODO_LOCATOR: data-testid TBD — submitted control + caret + menu item.
  submittedButton: 'Proposal has been submitted',
  withdrawMenuItem: 'Withdraw Proposal',
  withdrawConfirmButton: 'Yes, Withdraw',
  withdrawCancelButton: 'Cancel',
  withdrawModalTitle: 'Withdraw Proposal',
} as const;

/**
 * Canonical `data-testid`s shipped by the product (`lib/constants/portalTestIds.ts`),
 * verified present in the live QA DOM (31 `portal-*` ids render). This is now the
 * PRIMARY locator contract. Role/text is kept ONLY for the two elements that ship no
 * testid — the header logo and the theme toggle (see VendorPortalLocators above) — and
 * for VISIBLE COPY, which is still asserted verbatim but scoped INSIDE the testid'd
 * element it lives in (so a copy bug still fails, but on the real element).
 */
export const PORTAL_TESTIDS = {
  // View-state results
  invalidResult: 'portal-invalid-result',
  loadingSkeleton: 'portal-loading-skeleton',
  successResult: 'portal-success-result',
  successBackButton: 'portal-success-back-button',

  // Document view controls
  downloadPdfButton: 'portal-download-pdf-button',
  respondButton: 'portal-respond-button',
  bottomRespondButton: 'portal-bottom-respond-button',
  submittedButton: 'portal-submitted-button',

  // Withdraw flow
  withdrawOptionsButton: 'portal-withdraw-options-button',
  withdrawMenuItem: 'portal-withdraw-menu-item',
  withdrawModal: 'portal-withdraw-modal',
  withdrawModalCancelButton: 'portal-withdraw-modal-cancel-button',
  withdrawModalConfirmButton: 'portal-withdraw-modal-confirm-button',

  // Banners / countdown
  closedAlert: 'portal-closed-alert',
  openAlert: 'portal-open-alert',
  countdownTimer: 'portal-countdown-timer',

  // Document content
  documentCard: 'portal-document-card',
  documentTitle: 'portal-document-title',
  eventTypeBadge: 'portal-event-type-badge',
  issuerContactCard: 'portal-issuer-contact-card',
  issuerEmailLink: 'portal-issuer-email-link',
  issuerContactEmailLink: 'portal-issuer-contact-email-link',
  tableOfContents: 'portal-table-of-contents',

  // Response form
  formBackButton: 'portal-form-back-button',
  formHeaderCard: 'portal-form-header-card',
  formClosedAlert: 'portal-form-closed-alert',
  formCard: 'portal-form-card',
  formTotalPriceInput: 'portal-form-total-price-input',
  formDeliveryWeeksInput: 'portal-form-delivery-weeks-input',
  formUploadButton: 'portal-form-upload-button',
  formFileError: 'portal-form-file-error',
  formSubmitButton: 'portal-form-submit-button',

  // ── Builders (dynamic by section key / question UUID / qualification key) ──
  tocLink: (sectionKey: string): string => `portal-toc-link-${sectionKey}`,
  section: (sectionKey: string): string => `portal-section-${sectionKey}`,
  qualificationItem: (qualificationKey: string): string => `portal-qualification-item-${qualificationKey}`,
  questionItem: (questionId: string): string => `portal-question-item-${questionId}`,
  answerInput: (questionId: string): string => `portal-answer-input-${questionId}`,
  /** Prefix shared by all per-question answer inputs — lets the POM fill answers by index. */
  answerInputPrefix: 'portal-answer-input-',
} as const;

/**
 * Section display name → live DOM section key. The spec/tests refer to sections by
 * their human names ("Scope of Work"); the shipped testids key on a slug
 * (`portal-section-scope`). Keys observed live: scope, introduction,
 * company_background, terms_conditions, questions. `qualification` is inferred from
 * the `portal-qualification-item-*` builder. Unmapped names fall back to a slug.
 */
// Live DOM keys carry a `section-` prefix (e.g. portal-section-section-scope,
// portal-toc-link-section-scope) — the component's sectionId is `section-<slug>`.
export const PORTAL_SECTION_KEYS: Record<string, string> = {
  'Scope of Work': 'section-scope',
  'Vendor Questions': 'section-questions',
  'Company Background': 'section-company_background',
  'Terms & Conditions': 'section-terms_conditions',
  'Terms and Conditions': 'section-terms_conditions',
  Introduction: 'section-introduction',
  'Vendor Qualification Requirements': 'section-qualification',
};

/** Resolve a section display name to its live testid key (slug fallback for unmapped names). */
export const sectionKeyFor = (sectionName: string): string =>
  PORTAL_SECTION_KEYS[sectionName] ??
  'section-' +
    sectionName
      .trim()
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

export const VendorPortalCopy = {
  // ── US-01 Access / Error state ─────────────────────────────────────────────
  notFoundTitle: 'Invitation not found',
  notFoundSubtitle: 'This link may be invalid or the sourcing event has been closed.',

  // ── US-02 Document banners + helper text ───────────────────────────────────
  countdownLabel: 'Time remaining to submit',
  closedBanner: 'This event is now closed. Submissions are no longer accepted.',
  bottomHelperOpen:
    'On the next screen you will upload your proposal document and answer any questions the client has for you.',
  /** Appended to the bottom red deadline line when submission is closed (AC-02.8). */
  closedDeadlineSuffix: ' — This event is now closed.',

  // ── US-04 Response form validation + tooltips + toasts ─────────────────────
  invalidNumberError: 'Please enter a valid number',
  priceRequiredError: 'Please provide a price',
  fileFieldHelper:
    'Attach your full proposal document. Accepted formats: PDF or DOCX. Max 10 MB.',
  fileTypeRejected: 'Only PDF or DOCX files are accepted.',
  fileSizeRejected: 'File must be under 10 MB.',
  submitFailedToast: 'Submission failed.',
  priceTooltip: 'Your proposed total cost for this project in USD.',
  deliveryTooltip: 'Your estimated time to complete and deliver this project.',
  /** EC-04.1 / §8.5 banner shown on the response form + withdraw modal when the deadline passes. */
  formClosedBanner: 'This sourcing event has closed',

  // ── US-05 Confirmation ─────────────────────────────────────────────────────
  confirmationSubtitleLine1:
    'Your response has been received. A confirmation has been sent to your email.',
  /** BR-05.2 — em dash rendered when the submission timestamp is absent. */
  emDash: '—',

  // ── US-06 Withdraw modal ───────────────────────────────────────────────────
  withdrawModalBody:
    'Are you sure you want to withdraw your proposal? This will delete your submitted proposal and you will need to resubmit.',

  // ── Interpolated copy (filled from test data — never hardcoded per case) ────
  /** AC-02.2 — "Open for submissions — Deadline: {MM/DD/YYYY}". */
  openBanner: (deadlineMMDDYYYY: string): string => `Open for submissions — Deadline: ${deadlineMMDDYYYY}`,
  /** AC-02.8 / §8.5 — bottom red deadline line "Submission deadline: {MM/DD/YYYY} CT"
   *  (the app appends the CT timezone label to every deadline-bearing date — FE commit 57042bc). */
  bottomDeadlineLine: (deadlineMMDDYYYY: string): string => `Submission deadline: ${deadlineMMDDYYYY} CT`,
  /** AC-02.4 — italic issuer closing line (type-aware RFP/RFQ). */
  contactClosingLine: (type: EventTypeTag, issuerName: string, issuerEmail: string): string =>
    `For any questions regarding this ${type}, please contact ${issuerName} directly at ${issuerEmail}.`,
  /** AC-04.2 — response form title "Proposal Submission for {vendorName}". */
  responseFormTitle: (vendorName: string): string => `Proposal Submission for ${vendorName}`,
  /** AC-05.1 — confirmation success title "Thank you for your response, {vendorName}.". */
  confirmationTitle: (vendorName: string): string => `Thank you for your response, ${vendorName}.`,
  /**
   * AC-05.2 — "Submitted on: {MM/DD/YYYY at h:mm A} CT" (server-generated value →
   * assert its SHAPE, not a frozen minute). Anchored to the "Submitted on:" prefix.
   */
  submittedOnPattern:
    /Submitted on:\s+\d{2}\/\d{2}\/\d{4}\s+at\s+\d{1,2}:\d{2}\s+(AM|PM)\s+CT/,
} as const;
