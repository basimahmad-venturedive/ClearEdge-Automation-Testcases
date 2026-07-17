/**
 * Spec-pinned, VERBATIM copy for CEIQ-FEAT-004 (Company Settings).
 * Isolated here so the exact-string assertions have a single source of truth to
 * re-review on any spec version bump (spec is Draft v1.0).
 * Source: SPEC_CEIQ-FEAT-004-company-settings.md §5, US-CS-003 ACs.
 */
export const CsCopy = {
  /** Page heading — exactly this, no company-name prefix (AC-003). */
  pageHeading: 'Company Settings',
  /** Page subtitle (§4.3 #2 / §5.2). */
  subtitle: 'Standing content reused across every sourcing event you create.',

  /** Section display names (§4.3 #1 — canonical UI labels). */
  sectionDisplayName: {
    background: 'Company Background',
    introduction: 'Company Introduction',
    terms_and_conditions: 'Company Terms and Conditions',
  } as const,

  /** Disabled-Save tooltip (AC-007). */
  disabledSaveTooltip: 'This button is enabled once the section info has changed.',

  /** Unsaved-changes popup body — `[Section Name]` is the display name (AC-010). */
  unsavedPopup: (sectionName: string): string =>
    `You have unsaved changes in '${sectionName}'. Do you want to save these changes?`,

  /** Save confirmation message — `[Section Name]` is the display name (AC-017). */
  saveConfirmation: (sectionName: string): string =>
    `'${sectionName}' has been updated. New sourcing events you create from now on will include this updated information.`,

  /** Generic error on unexpected API failure (§5.7 / §9). */
  genericError: 'Something went wrong. Please try again.',
} as const;
