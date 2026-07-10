/**
 * Admin API path fragments (contract layer — SPEC_CEIQ-FEAT-001 §4.1/§4.2).
 * These are PATH TEMPLATES used only to match/mock network traffic in tests;
 * they are not base URLs (secrets-and-env.rules §1a — base URLs live in .env).
 */
export const AdminApiPaths = {
  /** GET (list) / POST (create) root. */
  tenants: '/api/v1/admin/tenants',
  /** PATCH /api/v1/admin/tenants/:id/status */
  statusSuffix: '/status',
  /** PATCH /api/v1/admin/tenants/:id/company */
  companySuffix: '/company',
  /** PATCH /api/v1/admin/tenants/:id/owner */
  ownerSuffix: '/owner',
  /** POST /api/v1/admin/tenants/:id/handover */
  handoverSuffix: '/handover',
} as const;
