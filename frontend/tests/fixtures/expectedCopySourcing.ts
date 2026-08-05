/**
 * CEIQ-FEAT-007 Sourcing Events — exact UI copy (single source of truth).
 * Verified against codebase/clearedge-frontend (dev): app/(app)/sourcing/**.
 * antd UI — list uses tabs (text), a search box (placeholder), an empty-state,
 * and a "New sourcing" action that opens the AI-prompt modal.
 */
export const SourcingCopy = {
  navItemName: 'Sourcing',
  route: '/sourcing',

  tabs: ['All', 'Draft', 'Active', 'Expiring Soon', 'Closed', 'Awarded'] as const,
  searchPlaceholder: 'Search sourcing events by title or category',
  emptyState: 'No sourcing events found.',

  newButton: 'New sourcing',        // button label is "New sourcing event" — substring match
  skipToManual: 'Skip to create manually',

  testids: {
    promptModal: 'sourcing-ai-prompt-modal',
    eventTypeGroup: 'sourcing-ai-prompt-event-type-group',
    promptTextarea: 'sourcing-ai-prompt-textarea',
    generateButton: 'sourcing-ai-prompt-generate-button',
    skipButton: 'sourcing-ai-prompt-skip-button',
  },
} as const;
