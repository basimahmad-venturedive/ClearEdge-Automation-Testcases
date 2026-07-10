/**
 * PLACEHOLDER route contract — the CEIQ-FEAT-001 admin portal frontend is not
 * yet built and the spec does not pin route paths.
 *
 * TODO_ROUTE (analogous to the kit's TODO_LOCATOR policy): confirm the real
 * paths with the frontend team before first live run. Owner: CEIQ frontend
 * team. Source: testcases/TC-CEIQ-FEAT-001.md (US-1.1 session gating,
 * US-2.1 list, US-3.1 create).
 *
 * All paths are RELATIVE — they resolve against `baseURL` (E2E_BASE_URL from
 * .env) in playwright.config.ts. No absolute URLs live in code.
 */
export const AppRoutes = {
  /** Login screen (US-1.1). */
  login: '/login',
  /** Tenant List — the landing screen after login (US-2.1). */
  tenantList: '/tenants',
  /** Create Tenant form (US-3.1). */
  createTenant: '/tenants/create',
} as const;
