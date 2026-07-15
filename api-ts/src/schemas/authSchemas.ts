/**
 * Zod schemas for CEIQ-FEAT-002 (User Authentication) — the success envelopes for the
 * 5 /api/v1/auth endpoints and the shared error envelope, per
 * SPEC_CEIQ-FEAT-002-user-auth.md §3.2 response examples and the F1 §9.2 envelope
 * convention.
 */
import { z } from "zod";

// Error envelope is shared with F1/admin-portal — { success: false, error: { code, message, details? } }.
export { ErrorEnvelopeSchema } from "./identityRbacSchemas";

// --- Login (§3.2) ---

/** Normal login success — tokens present, challengeName explicitly null. */
export const LoginSuccessEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    challengeName: z.null(),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    idToken: z.string().min(1),
    expiresIn: z.number(),
  }),
});

/** NEW_PASSWORD_REQUIRED challenge — session token, no auth tokens issued. */
export const LoginChallengeEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    challengeName: z.literal("NEW_PASSWORD_REQUIRED"),
    session: z.string().min(1),
    challengeParameters: z.record(z.unknown()),
  }),
});

// --- Set-password (§3.2) — success carries a message only, never tokens (SR-006). ---

export const SetPasswordSuccessEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    message: z.string().min(1),
  }),
});

// --- Forgot-password (§3.2) — non-disclosure success carries a message only. ---

export const ForgotPasswordSuccessEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    message: z.string().min(1),
  }),
});

// --- Refresh (§3.2) — new access + id token, NO new refresh token per contract. ---

export const RefreshSuccessEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    accessToken: z.string().min(1),
    idToken: z.string().min(1),
    expiresIn: z.number(),
  }),
});

// --- Logout (§3.2) — success message only. ---

export const LogoutSuccessEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    message: z.string().min(1),
  }),
});

export type LoginSuccessEnvelope = z.infer<typeof LoginSuccessEnvelopeSchema>;
export type LoginChallengeEnvelope = z.infer<typeof LoginChallengeEnvelopeSchema>;
export type SetPasswordSuccessEnvelope = z.infer<typeof SetPasswordSuccessEnvelopeSchema>;
export type ForgotPasswordSuccessEnvelope = z.infer<typeof ForgotPasswordSuccessEnvelopeSchema>;
export type RefreshSuccessEnvelope = z.infer<typeof RefreshSuccessEnvelopeSchema>;
export type LogoutSuccessEnvelope = z.infer<typeof LogoutSuccessEnvelopeSchema>;
