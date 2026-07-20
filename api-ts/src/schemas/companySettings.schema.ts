/**
 * Zod response schemas for CEIQ-FEAT-004 (Company Settings), per SPEC §3.2 payloads.
 * Validate the { success, data } envelope shape and field contracts used by
 * tests/companySettings.test.ts.
 */
import { z } from "zod";

export const sectionKeySchema = z.enum(["background", "introduction", "terms_and_conditions"]);

export const displayNameSchema = z.enum([
  "Company Background",
  "Company Introduction",
  "Company Terms and Conditions",
]);

/** A single section object as returned by GET (array item) and PUT (data.section). */
export const sectionObjectSchema = z.object({
  sectionKey: sectionKeySchema,
  displayName: displayNameSchema,
  // content: string when saved (incl. ""), null when never saved (§3.2 note).
  content: z.string().nullable(),
  // updatedAt: ISO string when saved, null when never saved.
  updatedAt: z.string().nullable(),
});

/** GET /company-settings — exactly three sections in fixed order. */
export const getAllDataSchema = z.object({
  sections: z.array(sectionObjectSchema).length(3),
});

/**
 * PUT /company-settings/:sectionKey — the saved section.
 * NOTE: the confirmation message lives at the ENVELOPE top level (`message`), not under
 * `data` — the backend's @ResponseMessage() hoists it per the standard F1 §9.2 envelope
 * (docs/contracts/company-settings.contract.md §2). Assert it via the envelope, not here.
 */
export const putSectionDataSchema = z.object({
  section: sectionObjectSchema,
});

// The standard success envelope always carries a top-level `message` ("Done" by default,
// or a route-specific string hoisted by @ResponseMessage()).
export const successEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ success: z.literal(true), data, message: z.string() });

export const getAllResponseSchema = successEnvelope(getAllDataSchema);
export const putSectionResponseSchema = successEnvelope(putSectionDataSchema);

export const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

/** displayName mapping the API is expected to return for each key (§3.2 note). */
export const DISPLAY_NAME_BY_KEY: Record<string, string> = {
  background: "Company Background",
  introduction: "Company Introduction",
  terms_and_conditions: "Company Terms and Conditions",
};
