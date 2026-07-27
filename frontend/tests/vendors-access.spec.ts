/**
 * CEIQ-FEAT-005 — Vendor Directory access control (US-VD RBAC).
 * Source: testcases/TC-CEIQ-FEAT-005.md — TC-VDACCESS-001…012.
 *
 * BLOCKED THIS CYCLE — not a development gap. Every access case needs a NON-PO
 * session on the dev tenant:
 *   • TC-VDACCESS-001…009  → Procurement ANALYST (view_vendors, no manage_vendors)
 *   • TC-VDACCESS-012      → Procurement MANAGER (manage_vendors write parity)
 *   • TC-VDACCESS-010      → PLATFORM ADMIN (no tenant Vendor tab at all)
 *   • TC-VDACCESS-011      → EXTERNAL VENDOR role (no directory access)
 *
 * Only the Procurement OWNER (PO_EMAIL/PO_PASSWORD) is provisioned in
 * automation/frontend/.env.dev, and the setup project writes only the PO
 * storageState. Provisioning Analyst/Manager/PlatformAdmin/ExternalVendor test
 * users + their storageStates on dev is the prerequisite (readiness report
 * blocker #3: view/manage rights + single/dual-right tokens not provisionable).
 *
 * These are kept as explicit `test.skip` so the suite records the coverage gap
 * honestly rather than silently omitting it. Un-skip once the extra role
 * sessions are seeded (add an `analyst`/`manager` project + storageState, mirror
 * the `po` project in playwright.config.ts).
 */
import { test } from '@playwright/test';

const ANALYST_BLOCKER =
  '[blocked: no Procurement Analyst session on dev — only PO provisioned in .env.dev]';
const MANAGER_BLOCKER =
  '[blocked: no Procurement Manager session on dev — only PO provisioned in .env.dev]';
const ADMIN_BLOCKER =
  '[blocked: no Platform Admin tenant-app session wired for the Vendor tab check]';
const EXTERNAL_BLOCKER =
  '[blocked: no External Vendor role session on dev]';

test.describe('Vendor Directory — access control (RBAC)', () => {
  test.skip(`TC-VDACCESS-001 Analyst cannot create a vendor (no "+ Add vendor"; API 403) ${ANALYST_BLOCKER}`, () => {});
  test.skip(`TC-VDACCESS-002 Analyst cannot edit a vendor (no edit action; API 403) ${ANALYST_BLOCKER}`, () => {});
  test.skip(`TC-VDACCESS-003 Analyst cannot delete a vendor (delete never renders; API 403) ${ANALYST_BLOCKER}`, () => {});
  test.skip(`TC-VDACCESS-004 Analyst cannot toggle status (control non-interactive; API 403) ${ANALYST_BLOCKER}`, () => {});
  test.skip(`TC-VDACCESS-005 Analyst cannot star/unstar (star visible, non-interactive; API 403) ${ANALYST_BLOCKER}`, () => {});
  test.skip(`TC-VDACCESS-006 Analyst cannot invite to sourcing (button not visible; API 403) ${ANALYST_BLOCKER}`, () => {});
  test.skip(`TC-VDACCESS-007 Analyst can view directory, profile, search, filter, sort, history ${ANALYST_BLOCKER}`, () => {});
  test.skip(`TC-VDACCESS-008 Analyst can view/download documents but cannot upload/replace/delete ${ANALYST_BLOCKER}`, () => {});
  test.skip(`TC-VDACCESS-009 Analyst cannot edit previous spend (view-only; API 403) ${ANALYST_BLOCKER}`, () => {});
  test.skip(`TC-VDACCESS-010 Platform Admin has no access to the Vendor tab ${ADMIN_BLOCKER}`, () => {});
  test.skip(`TC-VDACCESS-011 External Vendor role has no access to the Vendor Directory ${EXTERNAL_BLOCKER}`, () => {});
  test.skip(`TC-VDACCESS-012 Procurement Manager has full write parity with Owner ${MANAGER_BLOCKER}`, () => {});
});
