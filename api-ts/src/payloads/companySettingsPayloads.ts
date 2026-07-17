/**
 * Request payloads + factories for CEIQ-FEAT-004 (Company Settings).
 * SPEC Technical §3.2 (PUT body: `{ content: string }`, empty allowed, not null).
 *
 * Spec-pinned constants use UPPER_SNAKE_CASE; factories return fresh objects with
 * Faker-generated content so tests stay independent. No inline request-body
 * literals in test files (api-automation.rules §Test data).
 */
import { faker } from "@faker-js/faker";

export interface PutSectionBody {
  content: string;
}

/** Fresh valid body with unique multi-line plain-text content. */
export function newSectionContent(overrides: Partial<PutSectionBody> = {}): PutSectionBody {
  return {
    content: `${faker.company.name()} — ${faker.lorem.paragraph()}\n${faker.lorem.sentence()}`,
    ...overrides,
  };
}

/** Empty content — a VALID saved state (BR-05, AC-005). */
export const PUT_EMPTY: PutSectionBody = { content: "" };

/** Whitespace-only content — distinct dirty state under exact-match (BR-04). */
export const PUT_WHITESPACE_ONLY: PutSectionBody = { content: "   " };

/** Missing `content` field entirely → ERR_VALIDATION_FAILED (§3.2 step 2). */
export const PUT_MISSING_CONTENT: Record<string, never> = {};

/** Explicit null content → ERR_VALIDATION_FAILED (§3 request table: "Not null"). */
export const PUT_NULL_CONTENT: { content: null } = { content: null };

/**
 * HTML / special-character payload — stored VERBATIM as plain text (SR-003, BR-09).
 * The API neither interprets nor strips; output-encoding is the consumer's job.
 */
export const PUT_HTML_VERBATIM: PutSectionBody = {
  content: `<script>alert(1)</script> & "quotes" 'apos' <b>bold</b>`,
};

/** Large content — §2.1 says TEXT with no character limit (boundary). */
export function newLargeContent(sizeBytes = 100_000): PutSectionBody {
  const line = "The quick brown fox jumps over the lazy dog.\n";
  const repeats = Math.ceil(sizeBytes / line.length);
  return { content: line.repeat(repeats) };
}

/** Invalid section-key path params for the negative allow-list cases (§3.2, SR-004). */
export const INVALID_SECTION_KEYS = ["invalid_key", "Background", "BACKGROUND", "../etc"] as const;
