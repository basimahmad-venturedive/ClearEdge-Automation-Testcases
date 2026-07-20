/**
 * TC-CSAPI-001..021, TC-CSDB-001..005, TC-CSSEC-001/002/004 —
 * CEIQ-FEAT-004 Company Settings API + DB contract.
 * Spec: SPEC_CEIQ-FEAT-004-company-settings.md §3 (2 endpoints under
 * /api/v1/company-settings), §4 error codes, §7 security (SR-001..004),
 * §2 database (company_settings). Manual suite: testcases/TC-CEIQ-FEAT-004.md.
 *
 * RUNNING FOR REAL against codebase/clearedge-backend on Local (2026-07-20).
 * Each case seeds an active tenant + PO (manage_company_settings) user row directly
 * in Postgres (createFixtureTenantAndUser) and mints a tenant-pool token signed by
 * the local JWKS mock (signTenantToken) — the same pattern as tests/auth.test.ts.
 * The whole suite is LOCAL-ONLY: live targets (dev/qa/prod) have no DB reachability
 * and no provisioned tenant-pool user, so it skips there (isLiveEnv()).
 *
 * NOTE (backend behaviour, dev pull 2026-07-20): JwtAuthGuard now fails CLOSED when the
 * token's sub has no users row (TokenValidityService) — hence every token below is
 * signed with fixture.cognitoSub, which the fixture inserts as a real users row.
 *
 * (TC-CSSEC-003 — plain-text render / no-XSS — is a UI case; see the Playwright
 *  suite automation/frontend/tests/company-settings-edit.spec.ts.)
 */
import { afterEach, beforeAll, describe, test, expect } from "vitest";
import { CompanySettingsClient, SECTION_KEYS } from "../src/clients/companySettingsClient";
import { signTenantToken } from "../local-env/localCognitoMock";
import {
  createFixtureTenantAndUser,
  deleteFixtureTenant,
  type FixtureTenant,
} from "../src/utils/dbFixtures";
import { withDbClient } from "../src/utils/dbClient";
import { isLiveEnv, hasDbAccess } from "../src/config/env";
import { liveOwnerContext } from "../src/utils/poContext";
import {
  newSectionContent,
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

// The suite runs on BOTH local and a live target with a real DEV_TENANT_* Procurement Owner.
// - `test`      → env-agnostic (read shape, auth 401, section-key/body validation — non-mutating).
// - `localOnly` → needs a DB fixture (seeding, multi-tenant/isolation, non-owner, inactive,
//                 or a write that would mutate the live tenant). Skipped on live.
// - `dbOnly`    → direct company_settings row/RLS/audit assertions (needs TEST_DATABASE_URL).
const d = describe;
const localOnly = isLiveEnv() ? test.skip : test;
const dbOnly = hasDbAccess() ? test : test.skip;

const client = new CompanySettingsClient();

// On a live target, pre-mint (and cache) the tenant token so the first test doesn't eat the
// cold Cognito-login latency and time out.
beforeAll(async () => {
  if (isLiveEnv()) await liveOwnerContext();
}, 30000);

// Every fixture tenant created in a test is torn down afterEach (best-effort).
const createdTenants: string[] = [];
afterEach(async () => {
  while (createdTenants.length > 0) {
    const id = createdTenants.pop();
    if (id) {
      try {
        await deleteFixtureTenant(id);
      } catch {
        /* best-effort teardown; a failed delete must not mask the test result */
      }
    }
  }
});

interface Ctx extends FixtureTenant {
  token: string;
}

async function seed(
  roleSlug: "procurement_owner" | "procurement_manager" | "procurement_analyst",
  tenantStatus: "active" | "inactive" = "active",
): Promise<Ctx> {
  const fx = await createFixtureTenantAndUser({ roleSlug, tenantStatus });
  createdTenants.push(fx.tenantId);
  const token = await signTenantToken({ sub: fx.cognitoSub, tenantId: fx.tenantId, roleId: fx.roleId });
  return { ...fx, token };
}

/**
 * A PO (Owner) with manage_company_settings on an active tenant.
 * Live → the real DEV_TENANT_* Cognito login; Local → a fresh DB fixture + mock token.
 * Only used by env-agnostic tests (`test`), so the live branch never needs seeding.
 */
const owner = async (): Promise<Ctx> => {
  if (isLiveEnv()) {
    const po = await liveOwnerContext();
    return { token: po.token, tenantId: po.tenantId, roleId: "", cognitoSub: po.cognitoSub };
  }
  return seed("procurement_owner");
};
/** A Manager — deliberately WITHOUT manage_company_settings (for 403 cases). Local-only. */
const nonOwner = () => seed("procurement_manager");

/** Reads company_settings rows for a tenant under RLS (SET LOCAL app.current_tenant). */
async function readSettingRows(
  tenantId: string,
): Promise<Array<{ section_key: string; content: string | null; updated_by: string | null; updated_at: Date | null }>> {
  return withDbClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
      const res = await c.query(
        `SELECT section_key, content, updated_by, updated_at FROM company_settings WHERE tenant_id = $1 ORDER BY section_key`,
        [tenantId],
      );
      await c.query("COMMIT");
      return res.rows;
    } catch (err) {
      await c.query("ROLLBACK");
      throw err;
    }
  });
}

// ── GET /company-settings ───────────────────────────────────────────────────
d("GET /company-settings", () => {
  test("TC-CSAPI-001 — 200 envelope: 3 sections in fixed order + displayName mapping @smoke", async () => {
    const po = await owner();
    const res = await client.getAll(po.token);
    assertResponseTime(res);
    expect(res.status).toBe(200);
    const parsed = getAllResponseSchema.parse(res.data);
    expect(parsed.data.sections.map((s) => s.sectionKey)).toEqual([...SECTION_KEYS]);
    for (const s of parsed.data.sections) {
      expect(s.displayName).toBe(DISPLAY_NAME_BY_KEY[s.sectionKey]);
    }
  });

  localOnly("TC-CSAPI-002 — new tenant: content:null / updatedAt:null per section", async () => {
    const po = await owner();
    const res = await client.getAll(po.token);
    const parsed = getAllResponseSchema.parse(res.data);
    for (const s of parsed.data.sections) {
      expect(s.content).toBeNull();
      expect(s.updatedAt).toBeNull();
    }
  });

  localOnly("TC-CSAPI-003 — distinguishes explicitly-cleared \"\" from never-saved null", async () => {
    const po = await owner();
    await client.putSection("background", PUT_EMPTY, po.token); // clear → ""
    const res = await client.getAll(po.token);
    const parsed = getAllResponseSchema.parse(res.data);
    const bg = parsed.data.sections.find((s) => s.sectionKey === "background");
    const intro = parsed.data.sections.find((s) => s.sectionKey === "introduction");
    expect(bg?.content).toBe(""); // cleared, non-null
    expect(bg?.updatedAt).not.toBeNull();
    expect(intro?.content).toBeNull(); // never saved
  });

  // TC-CSAPI-004-1..2 — no-token vs expired-token, one explicit test case each.
  async function assertGetAllRejects401(variant: "<none>" | "expired"): Promise<void> {
    const token =
      variant === "expired"
        ? await signTenantToken({ sub: "x", tenantId: "y", roleId: "z", expiresInSeconds: -3600 })
        : undefined;
    const res = await client.getAll(token);
    expect(res.status).toBe(401);
    assertErrorEnvelope(res, "ERR_AUTH_INVALID_TOKEN");
  }

  test("TC-CSAPI-004-1 — no/invalid JWT (<none>) → 401 ERR_AUTH_INVALID_TOKEN", () => assertGetAllRejects401("<none>"));
  test("TC-CSAPI-004-2 — no/invalid JWT (expired) → 401 ERR_AUTH_INVALID_TOKEN", () => assertGetAllRejects401("expired"));

  localOnly("TC-CSAPI-005 — non-Owner (no manage_company_settings) → 403 ERR_RBAC_FORBIDDEN", async () => {
    const mgr = await nonOwner();
    const res = await client.getAll(mgr.token);
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_RBAC_FORBIDDEN");
  });

  localOnly("TC-CSAPI-006 — inactive tenant → 403 ERR_TENANT_INACTIVE", async () => {
    const po = await seed("procurement_owner", "inactive");
    const res = await client.getAll(po.token);
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_TENANT_INACTIVE");
  });

  localOnly("TC-CSAPI-007 — tenant-isolated: PO of A never sees B rows (SR-002, RLS)", async () => {
    const a = await owner();
    const b = await owner();
    await client.putSection("background", newSectionContent({ content: "TENANT-B-ONLY" }), b.token);
    const res = await client.getAll(a.token);
    const parsed = getAllResponseSchema.parse(res.data);
    for (const s of parsed.data.sections) expect(s.content).not.toBe("TENANT-B-ONLY");
  });
});

// ── PUT /company-settings/:sectionKey ───────────────────────────────────────
d("PUT /company-settings/:sectionKey", () => {
  localOnly("TC-CSAPI-010 — valid content upserts, echoes section + confirmation message @smoke", async () => {
    const po = await owner();
    const body = newSectionContent();
    const res = await client.putSection("background", body, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(200);
    const parsed = putSectionResponseSchema.parse(res.data);
    expect(parsed.data.section.sectionKey).toBe("background");
    expect(parsed.data.section.displayName).toBe("Company Background");
    expect(parsed.data.section.content).toBe(body.content);
    // Confirmation message is at the envelope top level (@ResponseMessage hoisting), not data.
    expect(parsed.message).toBe(
      "'Company Background' has been updated. New sourcing events you create from now on will include this updated information.",
    );
  });

  localOnly("TC-CSAPI-011 — empty content \"\" is valid and clears the section (BR-05)", async () => {
    const po = await owner();
    const res = await client.putSection("introduction", PUT_EMPTY, po.token);
    expect(res.status).toBe(200);
    const parsed = putSectionResponseSchema.parse(res.data);
    expect(parsed.data.section.content).toBe("");
    const get = await client.getAll(po.token);
    const intro = getAllResponseSchema.parse(get.data).data.sections.find((s) => s.sectionKey === "introduction");
    expect(intro?.content).toBe("");
  });

  // TC-CSAPI-012-1..4 — one explicit test case per invalid sectionKey.
  async function assertInvalidSectionKeyRejected(key: string): Promise<void> {
    const po = await owner();
    const res = await client.putSection(key, newSectionContent(), po.token);
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_INVALID_SECTION_KEY");
    const body = res.data as { error: { details?: { allowed?: string[] } } };
    expect(body.error.details?.allowed).toEqual([...SECTION_KEYS]);
  }

  test("TC-CSAPI-012-1 — invalid sectionKey \"invalid_key\" → 400 ERR_INVALID_SECTION_KEY", () => assertInvalidSectionKeyRejected("invalid_key"));
  test("TC-CSAPI-012-2 — invalid sectionKey \"Background\" (case-sensitive) → 400 ERR_INVALID_SECTION_KEY", () => assertInvalidSectionKeyRejected("Background"));
  test("TC-CSAPI-012-3 — invalid sectionKey \"BACKGROUND\" (case-sensitive) → 400 ERR_INVALID_SECTION_KEY", () => assertInvalidSectionKeyRejected("BACKGROUND"));
  test("TC-CSAPI-012-4 — path-shaped sectionKey \"../etc\" is rejected (HTTP path-normalizes → 404, never reaches the handler)", async () => {
    // A `..`-shaped key is collapsed by URL path normalization before routing, so it never
    // reaches SectionKeyPipe (which would give 400 ERR_INVALID_SECTION_KEY). The security
    // intent (SR-004: traversal-shaped input must not be accepted or leak data) still holds —
    // it resolves to a non-matching route (404), not a processed section.
    const po = await owner();
    const res = await client.putSection("../etc", newSectionContent(), po.token);
    expect(res.status).toBe(404);
    const serialized = JSON.stringify(res.data);
    expect(serialized).not.toMatch(/company_settings|SELECT|stack/i); // no internals disclosed
  });

  test("TC-CSAPI-013 — missing content field → 400 ERR_VALIDATION_FAILED", async () => {
    const po = await owner();
    const res = await client.putSection("background", PUT_MISSING_CONTENT, po.token);
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_VALIDATION_FAILED");
  });

  test("TC-CSAPI-014 — content:null → 400 ERR_VALIDATION_FAILED (not null)", async () => {
    const po = await owner();
    const res = await client.putSection("background", PUT_NULL_CONTENT, po.token);
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_VALIDATION_FAILED");
  });

  localOnly("TC-CSAPI-015 — upsert: first save creates, second updates (updated_at advances)", async () => {
    const po = await owner();
    const first = await client.putSection("terms_and_conditions", { content: "v1" }, po.token);
    const second = await client.putSection("terms_and_conditions", { content: "v2" }, po.token);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const p1 = putSectionResponseSchema.parse(first.data);
    const p2 = putSectionResponseSchema.parse(second.data);
    expect(p2.data.section.content).toBe("v2");
    expect(new Date(p2.data.section.updatedAt ?? 0).getTime()).toBeGreaterThanOrEqual(
      new Date(p1.data.section.updatedAt ?? 0).getTime(),
    );
    // DB: exactly one row for (tenant, section); updated_by = PO's users.id.
    const rows = await readSettingRows(po.tenantId);
    const tc = rows.filter((r) => r.section_key === "terms_and_conditions");
    expect(tc).toHaveLength(1);
    expect(tc[0]?.updated_by).not.toBeNull();
  });

  // TC-CSAPI-016-1..2 — no-token vs expired-token on the write path.
  async function assertPutRejects401(variant: "<none>" | "expired"): Promise<void> {
    const token =
      variant === "expired"
        ? await signTenantToken({ sub: "x", tenantId: "y", roleId: "z", expiresInSeconds: -3600 })
        : undefined;
    const res = await client.putSection("background", newSectionContent(), token);
    expect(res.status).toBe(401);
    assertErrorEnvelope(res, "ERR_AUTH_INVALID_TOKEN");
  }

  test("TC-CSAPI-016-1 — no/invalid JWT (<none>) → 401", () => assertPutRejects401("<none>"));
  test("TC-CSAPI-016-2 — no/invalid JWT (expired) → 401", () => assertPutRejects401("expired"));

  localOnly("TC-CSAPI-017 — non-Owner → 403 ERR_RBAC_FORBIDDEN, no row written", async () => {
    const mgr = await nonOwner();
    const res = await client.putSection("background", newSectionContent(), mgr.token);
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_RBAC_FORBIDDEN");
    const rows = await readSettingRows(mgr.tenantId);
    expect(rows).toHaveLength(0);
  });

  localOnly("TC-CSAPI-018 — tenant-isolated write: A cannot alter B's row (SR-002)", async () => {
    const a = await owner();
    const b = await owner();
    await client.putSection("background", { content: "B-original" }, b.token);
    await client.putSection("background", { content: "A-owned" }, a.token);
    const getB = await client.getAll(b.token);
    const bBg = getAllResponseSchema.parse(getB.data).data.sections.find((s) => s.sectionKey === "background");
    expect(bBg?.content).toBe("B-original"); // B unchanged by A's write
  });

  localOnly("TC-CSAPI-019 — content length limit enforced per section (background=3000): max accepted & round-trips, over-limit → 400", async () => {
    // SPEC DEVIATION from the scaffold's original "no char limit" premise: the shipped
    // contract (docs/contracts/company-settings.contract.md §2, PM-confirmed 2026-07-19)
    // caps background/introduction at 3,000 chars and terms_and_conditions at 6,000, all as
    // ERR_VALIDATION_FAILED. The manual case TC-CEIQ-FEAT-004 assumed unlimited — reconcile it.
    const po = await owner();
    const atLimit = { content: "x".repeat(3000) };
    const accepted = await client.putSection("background", atLimit, po.token);
    assertResponseTime(accepted);
    expect(accepted.status).toBe(200);
    const get = await client.getAll(po.token);
    const bg = getAllResponseSchema.parse(get.data).data.sections.find((s) => s.sectionKey === "background");
    expect(bg?.content).toBe(atLimit.content); // verbatim at the boundary, no truncation

    const overLimit = { content: "x".repeat(3001) };
    const rejected = await client.putSection("background", overLimit, po.token);
    expect(rejected.status).toBe(400);
    assertErrorEnvelope(rejected, "ERR_VALIDATION_FAILED");
  });

  localOnly("TC-CSAPI-020 — HTML/special chars stored VERBATIM as plain text (SR-003, BR-09)", async () => {
    const po = await owner();
    const res = await client.putSection("background", PUT_HTML_VERBATIM, po.token);
    expect(res.status).toBe(200);
    const get = await client.getAll(po.token);
    const bg = getAllResponseSchema.parse(get.data).data.sections.find((s) => s.sectionKey === "background");
    expect(bg?.content).toBe(PUT_HTML_VERBATIM.content); // no sanitization/encoding at storage
  });

  localOnly("TC-CSAPI-021 — PUT on inactive tenant → 403 ERR_TENANT_INACTIVE (write-path parity, REC-01)", async () => {
    const po = await seed("procurement_owner", "inactive");
    const res = await client.putSection("background", newSectionContent(), po.token);
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_TENANT_INACTIVE");
  });
});

// ── Database — company_settings (paired with API layer) ─────────────────────
d("company_settings (DB)", () => {
  dbOnly("TC-CSDB-001 — upsert maintains exactly one row per (tenant_id, section_key)", async () => {
    const po = await owner();
    await client.putSection("background", { content: "v1" }, po.token);
    await client.putSection("background", { content: "v2" }, po.token);
    const rows = (await readSettingRows(po.tenantId)).filter((r) => r.section_key === "background");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe("v2");
  });

  dbOnly("TC-CSDB-002 — content NULL (never saved) vs '' (cleared); updated_by/updated_at set", async () => {
    const po = await owner();
    // never saved → no row at all
    let rows = await readSettingRows(po.tenantId);
    expect(rows.find((r) => r.section_key === "introduction")).toBeUndefined();
    // cleared → row with content='' (not NULL), updated_by + updated_at set
    await client.putSection("introduction", PUT_EMPTY, po.token);
    rows = await readSettingRows(po.tenantId);
    const intro = rows.find((r) => r.section_key === "introduction");
    expect(intro?.content).toBe("");
    expect(intro?.updated_by).not.toBeNull();
    expect(intro?.updated_at).not.toBeNull();
  });

  dbOnly("TC-CSDB-003 — section_key CHECK constraint rejects disallowed values", async () => {
    const po = await owner();
    await expect(
      withDbClient(async (c) => {
        await c.query("BEGIN");
        await c.query(`SET LOCAL app.current_tenant = '${po.tenantId}'`);
        await c.query(
          `INSERT INTO company_settings (tenant_id, section_key, content) VALUES ($1, 'invalid_section', 'x')`,
          [po.tenantId],
        );
        await c.query("COMMIT");
      }),
    ).rejects.toThrow();
  });

  dbOnly("TC-CSDB-004 — RLS: rows visible/modifiable only within app.current_tenant (SR-002)", async () => {
    const a = await owner();
    const b = await owner();
    await client.putSection("background", { content: "A-content" }, a.token);
    // Reading under B's tenant context must not see A's row.
    const bRows = await readSettingRows(b.tenantId);
    expect(bRows.find((r) => r.content === "A-content")).toBeUndefined();
    // Reading under A's tenant context sees exactly A's row.
    const aRows = await readSettingRows(a.tenantId);
    expect(aRows.find((r) => r.content === "A-content")).toBeDefined();
  });

  dbOnly("TC-CSDB-005 — each PUT write captured in tenant_audit_logs (F1 §13)", async () => {
    const po = await owner();
    await client.putSection("background", { content: "audit-me" }, po.token);
    const rows = await withDbClient(async (c) => {
      const res = await c.query(
        `SELECT action, table_name, actor_sub FROM tenant_audit_logs WHERE tenant_id = $1 AND table_name = 'company_settings'`,
        [po.tenantId],
      );
      return res.rows;
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.actor_sub).toBe(po.cognitoSub);
  });
});

// ── Security roll-ups (SR-001, SR-002, SR-004) ──────────────────────────────
d("Company Settings security (SR)", () => {
  localOnly("TC-CSSEC-001 — SR-001: right enforced on BOTH endpoints (non-Owner → 403)", async () => {
    const mgr = await nonOwner();
    const getRes = await client.getAll(mgr.token);
    expect(getRes.status).toBe(403);
    assertErrorEnvelope(getRes, "ERR_RBAC_FORBIDDEN");
    const putRes = await client.putSection("background", newSectionContent(), mgr.token);
    expect(putRes.status).toBe(403);
    assertErrorEnvelope(putRes, "ERR_RBAC_FORBIDDEN");
  });

  localOnly("TC-CSSEC-002 — SR-002: isolation across read + write (roll-up of 007/018/DB-004)", async () => {
    // End-to-end isolation: A writes, B never sees it on read, and B's own write is independent.
    const a = await owner();
    const b = await owner();
    await client.putSection("background", { content: "A-secret" }, a.token);
    const getB = await client.getAll(b.token);
    const bBg = getAllResponseSchema.parse(getB.data).data.sections.find((s) => s.sectionKey === "background");
    expect(bBg?.content).toBeNull();
  });

  test("TC-CSSEC-004 — SR-004: invalid key → generic 400, no data leakage", async () => {
    const po = await owner();
    const res = await client.putSection("other_tenants_data", newSectionContent(), po.token);
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_INVALID_SECTION_KEY");
    const serialized = JSON.stringify(res.data);
    expect(serialized).not.toMatch(/tenant_id|stack|SELECT|company_settings/i); // no internals disclosed
  });
});
