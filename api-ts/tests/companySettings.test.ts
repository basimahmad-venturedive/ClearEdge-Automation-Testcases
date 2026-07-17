/**
 * TC-CSAPI-001..021, TC-CSDB-001..005, TC-CSSEC-001/002/004 —
 * CEIQ-FEAT-004 Company Settings API + DB contract.
 * Spec: SPEC_CEIQ-FEAT-004-company-settings.md §3 (2 endpoints under
 * /api/v1/company-settings), §4 error codes, §7 security (SR-001..004),
 * §2 database (company_settings). Manual suite: testcases/TC-CEIQ-FEAT-004.md.
 *
 * SCAFFOLDED — every test is `test.skip` because no environment, PO token, or
 * deployed Company Settings controllers / migration exist yet (§5/§9 TBD).
 * Matches the FEAT-003 pattern (tests/userManagement.test.ts). Un-skip once a live
 * env + a real PO JWT (manage_company_settings) + tenant-scoped test DB are wired.
 *
 * (TC-CSSEC-003 — plain-text render / no-XSS — is a UI case; see the Playwright
 *  suite automation/frontend/tests/company-settings-edit.spec.ts.)
 */
import { describe, test, expect } from "vitest";
import { CompanySettingsClient, SECTION_KEYS } from "../src/clients/companySettingsClient";
import { JwtFactory } from "../src/utils/jwtHelpers";
import {
  newSectionContent,
  newLargeContent,
  PUT_EMPTY,
  PUT_MISSING_CONTENT,
  PUT_NULL_CONTENT,
  PUT_HTML_VERBATIM,
} from "../src/payloads/companySettingsPayloads";
import {
  getAllResponseSchema,
  putSectionResponseSchema,
  DISPLAY_NAME_BY_KEY,
} from "../src/schemas/companySettings.schema";
import { assertResponseTime, assertErrorEnvelope } from "../src/utils/assertions";

const NO_ENV_REASON =
  "no environment / deployed Company Settings controllers / PO token yet — see TC-CEIQ-FEAT-004.md";
const DB_REASON = `${NO_ENV_REASON}; also needs tenant-scoped DB access to assert the persisted row / RLS / audit`;
const TWO_TENANT_REASON = `${NO_ENV_REASON}; also needs two seeded tenants (A/B) for isolation`;

const jwtFactory = new JwtFactory();
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const PO_ROLE = "role-po"; // holds manage_company_settings (F1 §4)
const NON_OWNER_ROLE = "role-manager"; // Manager/Analyst — no manage_company_settings
const PO_SUB = "po-sub-0001";

const poToken = () => jwtFactory.tenantToken({ tenantId: TENANT_A, roleId: PO_ROLE, sub: PO_SUB });
const poTokenB = () => jwtFactory.tenantToken({ tenantId: TENANT_B, roleId: PO_ROLE, sub: "po-sub-b" });
const nonOwnerToken = () =>
  jwtFactory.tenantToken({ tenantId: TENANT_A, roleId: NON_OWNER_ROLE, sub: "mgr-sub-1" });

// ── GET /company-settings ───────────────────────────────────────────────────
describe("GET /company-settings", () => {
  test.skip(`TC-CSAPI-001 — 200 envelope: 3 sections in fixed order + displayName mapping [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new CompanySettingsClient();
    const res = await client.getAll(await poToken());
    assertResponseTime(res);
    expect(res.status).toBe(200);
    const parsed = getAllResponseSchema.parse(res.data);
    expect(parsed.data.sections.map((s) => s.sectionKey)).toEqual([...SECTION_KEYS]);
    for (const s of parsed.data.sections) {
      expect(s.displayName).toBe(DISPLAY_NAME_BY_KEY[s.sectionKey]);
    }
  });

  test.skip(`TC-CSAPI-002 — new tenant: content:null / updatedAt:null per section [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new CompanySettingsClient();
    const res = await client.getAll(await poToken());
    const parsed = getAllResponseSchema.parse(res.data);
    for (const s of parsed.data.sections) {
      expect(s.content).toBeNull();
      expect(s.updatedAt).toBeNull();
    }
  });

  test.skip(`TC-CSAPI-003 — distinguishes explicitly-cleared "" from never-saved null [blocked: ${DB_REASON}]`, async () => {
    const client = new CompanySettingsClient();
    await client.putSection("background", PUT_EMPTY, await poToken()); // clear → ""
    const res = await client.getAll(await poToken());
    const parsed = getAllResponseSchema.parse(res.data);
    const bg = parsed.data.sections.find((s) => s.sectionKey === "background");
    const intro = parsed.data.sections.find((s) => s.sectionKey === "introduction");
    expect(bg?.content).toBe(""); // cleared, non-null
    expect(bg?.updatedAt).not.toBeNull();
    expect(intro?.content).toBeNull(); // never saved
  });

  // TC-CSAPI-004-1..2 — no-token vs expired-token, one explicit test case each.
  async function assertGetAllRejects401(variant: "<none>" | "expired"): Promise<void> {
    const client = new CompanySettingsClient();
    const token =
      variant === "expired" ? await jwtFactory.expiredTenantToken({ tenantId: TENANT_A }) : undefined;
    const res = await client.getAll(token);
    expect(res.status).toBe(401);
    assertErrorEnvelope(res, "ERR_AUTH_INVALID_TOKEN");
  }

  test.skip(`TC-CSAPI-004-1 — no/invalid JWT (<none>) → 401 ERR_AUTH_INVALID_TOKEN [blocked: ${NO_ENV_REASON}]`, () => assertGetAllRejects401("<none>"));
  test.skip(`TC-CSAPI-004-2 — no/invalid JWT (expired) → 401 ERR_AUTH_INVALID_TOKEN [blocked: ${NO_ENV_REASON}]`, () => assertGetAllRejects401("expired"));

  test.skip(`TC-CSAPI-005 — non-Owner (no manage_company_settings) → 403 ERR_RBAC_FORBIDDEN [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new CompanySettingsClient();
    const res = await client.getAll(await nonOwnerToken());
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_RBAC_FORBIDDEN");
  });

  test.skip(`TC-CSAPI-006 — inactive tenant → 403 ERR_TENANT_INACTIVE [blocked: ${NO_ENV_REASON}]`, async () => {
    // Precondition (TODO_FIXTURE): PO JWT whose tenant status is inactive.
    const client = new CompanySettingsClient();
    const res = await client.getAll(await poToken());
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_TENANT_INACTIVE");
  });

  test.skip(`TC-CSAPI-007 — tenant-isolated: PO of A never sees B rows (SR-002, RLS) [blocked: ${TWO_TENANT_REASON}]`, async () => {
    const client = new CompanySettingsClient();
    // Seed B with recognizable content (TODO_FIXTURE), then read as A.
    await client.putSection("background", newSectionContent({ content: "TENANT-B-ONLY" }), await poTokenB());
    const res = await client.getAll(await poToken());
    const parsed = getAllResponseSchema.parse(res.data);
    for (const s of parsed.data.sections) expect(s.content).not.toBe("TENANT-B-ONLY");
  });
});

// ── PUT /company-settings/:sectionKey ───────────────────────────────────────
describe("PUT /company-settings/:sectionKey", () => {
  test.skip(`TC-CSAPI-010 — valid content upserts, echoes section + confirmation message [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new CompanySettingsClient();
    const body = newSectionContent();
    const res = await client.putSection("background", body, await poToken());
    assertResponseTime(res);
    expect(res.status).toBe(200);
    const parsed = putSectionResponseSchema.parse(res.data);
    expect(parsed.data.section.sectionKey).toBe("background");
    expect(parsed.data.section.displayName).toBe("Company Background");
    // Echo assertion (api-automation.rules): the sent content is reflected back in data.section.
    expect(parsed.data.section.content).toBe(body.content);
    expect(parsed.data.message).toBe(
      "'Company Background' has been updated. New sourcing events you create from now on will include this updated information.",
    );
  });

  test.skip(`TC-CSAPI-011 — empty content "" is valid and clears the section (BR-05) [blocked: ${DB_REASON}]`, async () => {
    const client = new CompanySettingsClient();
    const res = await client.putSection("introduction", PUT_EMPTY, await poToken());
    expect(res.status).toBe(200);
    const parsed = putSectionResponseSchema.parse(res.data);
    expect(parsed.data.section.content).toBe("");
    const get = await client.getAll(await poToken());
    const intro = getAllResponseSchema.parse(get.data).data.sections.find((s) => s.sectionKey === "introduction");
    expect(intro?.content).toBe("");
  });

  // TC-CSAPI-012-1..4 — one explicit test case per invalid sectionKey (see INVALID_SECTION_KEYS).
  async function assertInvalidSectionKeyRejected(key: string): Promise<void> {
    const client = new CompanySettingsClient();
    const res = await client.putSection(key, newSectionContent(), await poToken());
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_INVALID_SECTION_KEY");
    // details.allowed lists the three valid keys; no internal/tenant info leaked (SR-004).
    const body = res.data as { error: { details?: { allowed?: string[] } } };
    expect(body.error.details?.allowed).toEqual([...SECTION_KEYS]);
  }

  test.skip(`TC-CSAPI-012-1 — invalid sectionKey "invalid_key" → 400 ERR_INVALID_SECTION_KEY [blocked: ${NO_ENV_REASON}]`, () => assertInvalidSectionKeyRejected("invalid_key"));
  test.skip(`TC-CSAPI-012-2 — invalid sectionKey "Background" (case-sensitive) → 400 ERR_INVALID_SECTION_KEY [blocked: ${NO_ENV_REASON}]`, () => assertInvalidSectionKeyRejected("Background"));
  test.skip(`TC-CSAPI-012-3 — invalid sectionKey "BACKGROUND" (case-sensitive) → 400 ERR_INVALID_SECTION_KEY [blocked: ${NO_ENV_REASON}]`, () => assertInvalidSectionKeyRejected("BACKGROUND"));
  test.skip(`TC-CSAPI-012-4 — invalid sectionKey "../etc" (path-shaped) → 400 ERR_INVALID_SECTION_KEY [blocked: ${NO_ENV_REASON}]`, () => assertInvalidSectionKeyRejected("../etc"));

  test.skip(`TC-CSAPI-013 — missing content field → 400 ERR_VALIDATION_FAILED [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new CompanySettingsClient();
    const res = await client.putSection("background", PUT_MISSING_CONTENT, await poToken());
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_VALIDATION_FAILED");
  });

  test.skip(`TC-CSAPI-014 — content:null → 400 ERR_VALIDATION_FAILED (not null) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new CompanySettingsClient();
    const res = await client.putSection("background", PUT_NULL_CONTENT, await poToken());
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_VALIDATION_FAILED");
  });

  test.skip(`TC-CSAPI-015 — upsert: first save creates, second updates (updated_at advances) [blocked: ${DB_REASON}]`, async () => {
    const client = new CompanySettingsClient();
    const first = await client.putSection("terms_and_conditions", { content: "v1" }, await poToken());
    const second = await client.putSection("terms_and_conditions", { content: "v2" }, await poToken());
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const p1 = putSectionResponseSchema.parse(first.data);
    const p2 = putSectionResponseSchema.parse(second.data);
    expect(p2.data.section.content).toBe("v2");
    // DB assertion (TODO_FIXTURE): exactly one row; updated_at(p2) > updated_at(p1); updated_by = PO id.
    expect(new Date(p2.data.section.updatedAt ?? 0).getTime()).toBeGreaterThanOrEqual(
      new Date(p1.data.section.updatedAt ?? 0).getTime(),
    );
  });

  // TC-CSAPI-016-1..2 — no-token vs expired-token on the write path, one explicit test case each.
  async function assertPutRejects401(variant: "<none>" | "expired"): Promise<void> {
    const client = new CompanySettingsClient();
    const token =
      variant === "expired" ? await jwtFactory.expiredTenantToken({ tenantId: TENANT_A }) : undefined;
    const res = await client.putSection("background", newSectionContent(), token);
    expect(res.status).toBe(401);
    assertErrorEnvelope(res, "ERR_AUTH_INVALID_TOKEN");
  }

  test.skip(`TC-CSAPI-016-1 — no/invalid JWT (<none>) → 401 [blocked: ${NO_ENV_REASON}]`, () => assertPutRejects401("<none>"));
  test.skip(`TC-CSAPI-016-2 — no/invalid JWT (expired) → 401 [blocked: ${NO_ENV_REASON}]`, () => assertPutRejects401("expired"));

  test.skip(`TC-CSAPI-017 — non-Owner → 403 ERR_RBAC_FORBIDDEN, no row written [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new CompanySettingsClient();
    const res = await client.putSection("background", newSectionContent(), await nonOwnerToken());
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_RBAC_FORBIDDEN");
  });

  test.skip(`TC-CSAPI-018 — tenant-isolated write: A cannot alter B's row (SR-002) [blocked: ${TWO_TENANT_REASON}]`, async () => {
    const client = new CompanySettingsClient();
    await client.putSection("background", { content: "B-original" }, await poTokenB());
    await client.putSection("background", { content: "A-owned" }, await poToken());
    const getB = await client.getAll(await poTokenB());
    const bBg = getAllResponseSchema.parse(getB.data).data.sections.find((s) => s.sectionKey === "background");
    expect(bBg?.content).toBe("B-original"); // B unchanged by A's write
  });

  test.skip(`TC-CSAPI-019 — large content accepted (no char limit), round-trips [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new CompanySettingsClient();
    const body = newLargeContent(100_000);
    const res = await client.putSection("background", body, await poToken());
    assertResponseTime(res);
    expect(res.status).toBe(200);
    const get = await client.getAll(await poToken());
    const bg = getAllResponseSchema.parse(get.data).data.sections.find((s) => s.sectionKey === "background");
    expect(bg?.content).toBe(body.content); // verbatim, no truncation
  });

  test.skip(`TC-CSAPI-020 — HTML/special chars stored VERBATIM as plain text (SR-003, BR-09) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new CompanySettingsClient();
    const res = await client.putSection("background", PUT_HTML_VERBATIM, await poToken());
    expect(res.status).toBe(200);
    const get = await client.getAll(await poToken());
    const bg = getAllResponseSchema.parse(get.data).data.sections.find((s) => s.sectionKey === "background");
    expect(bg?.content).toBe(PUT_HTML_VERBATIM.content); // no sanitization/encoding at storage
  });

  test.skip(`TC-CSAPI-021 — PUT on inactive tenant → 403 ERR_TENANT_INACTIVE (write-path parity, REC-01) [blocked: ${NO_ENV_REASON}]`, async () => {
    // Precondition (TODO_FIXTURE): PO JWT whose tenant status is fully inactive (not setup-phase).
    const client = new CompanySettingsClient();
    const res = await client.putSection("background", newSectionContent(), await poToken());
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_TENANT_INACTIVE");
  });
});

// ── Database — company_settings (paired with API layer) ─────────────────────
describe("company_settings (DB)", () => {
  test.skip(`TC-CSDB-001 — upsert maintains exactly one row per (tenant_id, section_key) [blocked: ${DB_REASON}]`, async () => {
    // 1. PUT background twice. 2. SELECT count(*) WHERE tenant_id AND section_key='background' === 1.
    expect(true).toBe(true); // TODO_DB: assert row count via dbClient with SET LOCAL app.current_tenant.
  });

  test.skip(`TC-CSDB-002 — content NULL (never saved) vs '' (cleared); updated_by/updated_at set [blocked: ${DB_REASON}]`, async () => {
    expect(true).toBe(true); // TODO_DB: never-saved → no row; after PUT "" → content='' (not NULL), updated_by=PO, updated_at not null.
  });

  test.skip(`TC-CSDB-003 — section_key CHECK constraint rejects disallowed values [blocked: ${DB_REASON}]`, async () => {
    expect(true).toBe(true); // TODO_DB: direct INSERT with section_key='invalid' raises a CHECK violation.
  });

  test.skip(`TC-CSDB-004 — RLS: rows visible/modifiable only within app.current_tenant (SR-002) [blocked: ${TWO_TENANT_REASON}]`, async () => {
    expect(true).toBe(true); // TODO_DB: SET LOCAL app.current_tenant=A sees only A; cross-tenant UPDATE affects 0 rows.
  });

  test.skip(`TC-CSDB-005 — each PUT write captured in tenant_audit_logs (F1 §13) [blocked: ${DB_REASON}]`, async () => {
    expect(true).toBe(true); // TODO_DB: audit count increases by 1, attributable to the PO principal, after a PUT.
  });
});

// ── Security roll-ups (SR-001, SR-002, SR-004) ──────────────────────────────
describe("Company Settings security (SR)", () => {
  test.skip(`TC-CSSEC-001 — SR-001: right enforced on BOTH endpoints (non-Owner → 403) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new CompanySettingsClient();
    const token = await nonOwnerToken();
    const getRes = await client.getAll(token);
    expect(getRes.status).toBe(403);
    assertErrorEnvelope(getRes, "ERR_RBAC_FORBIDDEN");
    const putRes = await client.putSection("background", newSectionContent(), token);
    expect(putRes.status).toBe(403);
    assertErrorEnvelope(putRes, "ERR_RBAC_FORBIDDEN");
  });

  test.skip(`TC-CSSEC-002 — SR-002: isolation across read + write (roll-up of 007/018/DB-004) [blocked: ${TWO_TENANT_REASON}]`, async () => {
    // Covered end-to-end by TC-CSAPI-007 (read), TC-CSAPI-018 (write), TC-CSDB-004 (RLS).
    expect(true).toBe(true);
  });

  test.skip(`TC-CSSEC-004 — SR-004: invalid key → generic 400, no data leakage [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new CompanySettingsClient();
    const res = await client.putSection("other_tenants_data", newSectionContent(), await poToken());
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_INVALID_SECTION_KEY");
    const serialized = JSON.stringify(res.data);
    expect(serialized).not.toMatch(/tenant_id|stack|SELECT|company_settings/i); // no internals disclosed
  });
});
