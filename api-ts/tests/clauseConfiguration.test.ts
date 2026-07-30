/**
 * CEIQ-FEAT-006 Clause Configuration — API layer (Vitest api-ts).
 * Spec: SPEC_CEIQ-FEAT-006-clause-configuration.md §3.2 (GET + PUT), §4 error codes,
 * §7 security. Manual suite: testcases/TC-CEIQ-FEAT-006.md (CCAPI-* / CCSEC-*).
 *
 * LIVE against dev (https://api-dev.clearedgeiq.com/api/v1) via a real PO id token
 * (liveOwnerContext). PUT cases are made side-effect-free by capturing the tenant's
 * full 16-clause configuration in beforeAll and restoring it in afterAll.
 *
 * Skipped-with-reason (not fabricated): DB cases (CCDB-*) run local only (no dev DB);
 * tenant-isolation (2nd tenant) and fresh-tenant cases need provisioning; role-negative
 * cases require a token that lacks manage_clause_configuration (see TC §9).
 */
import { afterAll, beforeAll, describe, expect } from "vitest";
import { ClauseConfigClient, type ClausePutItem } from "../src/clients/clauseConfigClient";
import { isLiveEnv } from "../src/config/env";
import { liveOwnerContext, type OwnerContext } from "../src/utils/poContext";
import { assertResponseTime, assertErrorEnvelope } from "../src/utils/assertions";
// `liveOnly` (dev/live only) + `deferred` (blocked) come from the shared suite helper so
// the @regression/@smoke drop-mode (REGRESSION_ONLY/SMOKE_ONLY) applies — same as the
// other dev suites. See src/utils/suite.ts.
import { liveOnly, deferred } from "../src/utils/suite";
const FAKE_UUID = "00000000-0000-4000-8000-000000000000";

let client: ClauseConfigClient;
let po: OwnerContext;
let baseline: ClausePutItem[] = [];
let optionsByClause: Record<string, string[]> = {};

function toPutItems(clauses: any[]): ClausePutItem[] {
  return clauses.map((c) => ({
    clauseCatalogId: c.clauseCatalogId,
    selected: c.selected,
    standardClauseOptionId: c.standardClauseOptionId,
    riskLevel: c.riskLevel,
  }));
}

/** Deep clone the baseline so a test can mutate items without corrupting the restore copy. */
function cloneBaseline(): ClausePutItem[] {
  return baseline.map((c) => ({ ...c }));
}

beforeAll(async () => {
  if (!isLiveEnv()) return;
  client = new ClauseConfigClient();
  po = await liveOwnerContext();
  const res = await client.getConfig<any>(po.token);
  if (res.status === 200 && res.data?.data?.clauses) {
    const clauses = res.data.data.clauses;
    baseline = toPutItems(clauses);
    for (const c of clauses) {
      optionsByClause[c.clauseCatalogId] = (c.standardClauseOptions ?? []).map((o: any) => o.id);
    }
  }
});

afterAll(async () => {
  // Restore the tenant's original configuration — leave dev exactly as we found it.
  if (isLiveEnv() && baseline.length > 0) {
    await client.putConfig({ clauses: baseline }, po.token);
  }
});

describe("GET /api/v1/clause-configuration (Tech §3.2)", () => {
  liveOnly("TC-CCAPI-001 — GET returns 200 with 16 clauses in the exact §3.2 shape @smoke @regression", async () => {
    const res = await client.getConfig<any>(po.token);
    assertResponseTime(res);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    const clauses = res.data.data.clauses;
    expect(Array.isArray(clauses)).toBe(true);
    expect(clauses.length).toBe(16);
    for (const c of clauses) {
      expect(c).toHaveProperty("clauseCatalogId");
      expect(c).toHaveProperty("category");
      expect(c).toHaveProperty("name");
      expect(typeof c.selected).toBe("boolean");
      expect(c).toHaveProperty("standardClauseOptionId");
      expect(c).toHaveProperty("standardClauseOptionLabel");
      expect(c).toHaveProperty("riskLevel");
      expect(c).toHaveProperty("defaultRiskLevel");
      expect(Array.isArray(c.standardClauseOptions)).toBe(true);
    }
  });

  liveOnly("TC-CCAPI-002 — GET orders selected clauses first @regression", async () => {
    const res = await client.getConfig<any>(po.token);
    assertResponseTime(res);
    expect(res.status).toBe(200);
    const selectedFlags = res.data.data.clauses.map((c: any) => c.selected);
    const firstUnselected = selectedFlags.indexOf(false);
    if (firstUnselected !== -1) {
      // no selected clause may appear after the first unselected one
      expect(selectedFlags.slice(firstUnselected).some((s: boolean) => s === true)).toBe(false);
    }
  });

  liveOnly("TC-CCAPI-003 — unset standard clause returns null id + null label @regression", async () => {
    const res = await client.getConfig<any>(po.token);
    expect(res.status).toBe(200);
    for (const c of res.data.data.clauses) {
      if (c.standardClauseOptionId === null) {
        expect(c.standardClauseOptionLabel).toBeNull();
      }
    }
  });

  liveOnly("TC-CCAPI-004 — each clause carries 4 standardClauseOptions and a defaultRiskLevel @regression", async () => {
    const res = await client.getConfig<any>(po.token);
    expect(res.status).toBe(200);
    for (const c of res.data.data.clauses) {
      expect(c.standardClauseOptions.length).toBe(4);
      for (const o of c.standardClauseOptions) {
        expect(o).toHaveProperty("id");
        expect(o).toHaveProperty("optionLabel");
        expect(o).toHaveProperty("sortOrder");
      }
      expect(["low", "medium", "high"]).toContain(c.defaultRiskLevel);
    }
  });

  liveOnly("TC-CCAPI-006 — GET without a token → 401 ERR_AUTH_INVALID_TOKEN @smoke @regression", async () => {
    const res = await client.getConfig<any>(undefined);
    assertResponseTime(res);
    expect(res.status).toBe(401);
    assertErrorEnvelope(res, "ERR_AUTH_INVALID_TOKEN");
  });

  liveOnly("TC-CCAPI-009 — GET envelope + response-time contract (< 3 s) @regression", async () => {
    const res = await client.getConfig<any>(po.token);
    assertResponseTime(res);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.error).toBeUndefined();
  });
});

describe("PUT /api/v1/clause-configuration — happy path + persistence (Tech §3.2)", () => {
  liveOnly("TC-CCAPI-020 — PUT a valid full payload → 200, exact message, GET echoes the change @smoke @regression", async () => {
    const items = cloneBaseline();
    // flip the first clause: select it, give it a valid own-clause option, set risk high
    const first = items[0]!;
    const ownOptions = optionsByClause[first.clauseCatalogId] ?? [];
    first.selected = true;
    first.standardClauseOptionId = ownOptions[0] ?? null;
    first.riskLevel = "high";
    const put = await client.putConfig<any>({ clauses: items }, po.token);
    assertResponseTime(put);
    expect(put.status, JSON.stringify(put.data)).toBe(200);
    // NOTE (spec drift): §3.2 shows the message at `data.message`, but the backend returns
    // it at the envelope top level (`res.data.message`). Text is exact. Logged in TC §9.
    const successMessage = put.data.message ?? put.data.data?.message;
    expect(successMessage).toBe(
      "Your Clause Library has been updated successfully. Reflected changes will be shown in all future contracts.",
    );
    const get = await client.getConfig<any>(po.token);
    const echoed = get.data.data.clauses.find((c: any) => c.clauseCatalogId === first.clauseCatalogId);
    expect(echoed.selected).toBe(true);
    expect(echoed.riskLevel).toBe("high");
  });

  liveOnly("TC-CCAPI-040 — PUT is idempotent (same payload twice → same result) @regression", async () => {
    const a = await client.putConfig<any>({ clauses: baseline }, po.token);
    const b = await client.putConfig<any>({ clauses: baseline }, po.token);
    assertResponseTime(b);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.data.data.clauses.length).toBe(16);
  });

  liveOnly("TC-CCAPI-034 / CCSEC-004 — transaction integrity: one bad item rejects the whole payload, nothing persists @regression", async () => {
    const before = await client.getConfig<any>(po.token);
    const snapshot = JSON.stringify(toPutItems(before.data.data.clauses));
    const items = cloneBaseline();
    // 15 harmless riskLevel touches + 1 invalid risk on the last
    items.forEach((it, i) => { it.riskLevel = i === items.length - 1 ? "urgent" : it.riskLevel; });
    const put = await client.putConfig<any>({ clauses: items }, po.token);
    assertResponseTime(put);
    expect(put.status).toBe(400);
    const after = await client.getConfig<any>(po.token);
    expect(JSON.stringify(toPutItems(after.data.data.clauses))).toBe(snapshot);
  });
});

describe("PUT /api/v1/clause-configuration — validation (Tech §3.2 / §4)", () => {
  liveOnly("TC-CCAPI-024 — too few clauses (15) → 400 ERR_CLAUSE_COUNT_MISMATCH @smoke @regression", async () => {
    const put = await client.putConfig<any>({ clauses: cloneBaseline().slice(0, 15) }, po.token);
    assertResponseTime(put);
    expect(put.status).toBe(400);
    assertErrorEnvelope(put, "ERR_CLAUSE_COUNT_MISMATCH");
  });

  liveOnly("TC-CCAPI-025 — too many clauses (17) → 400 ERR_CLAUSE_COUNT_MISMATCH @regression", async () => {
    const items = cloneBaseline();
    items.push({ ...items[0]!, clauseCatalogId: FAKE_UUID });
    const put = await client.putConfig<any>({ clauses: items }, po.token);
    expect(put.status).toBe(400);
    assertErrorEnvelope(put, "ERR_CLAUSE_COUNT_MISMATCH");
  });

  liveOnly("TC-CCAPI-026 — duplicate clauseCatalogId → 400 ERR_DUPLICATE_CLAUSE @regression", async () => {
    const items = cloneBaseline();
    items[1]!.clauseCatalogId = items[0]!.clauseCatalogId; // dup id (count still 16)
    const put = await client.putConfig<any>({ clauses: items }, po.token);
    expect(put.status).toBe(400);
    assertErrorEnvelope(put, "ERR_DUPLICATE_CLAUSE");
  });

  liveOnly("TC-CCAPI-027 — unknown clauseCatalogId → 400 ERR_VALIDATION_FAILED @regression", async () => {
    const items = cloneBaseline();
    items[0]!.clauseCatalogId = FAKE_UUID;
    const put = await client.putConfig<any>({ clauses: items }, po.token);
    expect(put.status).toBe(400);
    assertErrorEnvelope(put, "ERR_VALIDATION_FAILED");
  });

  liveOnly("TC-CCAPI-028 — invalid riskLevel → 400 ERR_VALIDATION_FAILED @regression", async () => {
    const items = cloneBaseline();
    items[0]!.riskLevel = "urgent";
    const put = await client.putConfig<any>({ clauses: items }, po.token);
    expect(put.status).toBe(400);
    assertErrorEnvelope(put, "ERR_VALIDATION_FAILED");
  });

  liveOnly("TC-CCAPI-029 — standard clause option from a different clause → 400 ERR_INVALID_STANDARD_CLAUSE @regression", async () => {
    const items = cloneBaseline();
    const otherClauseOptions = optionsByClause[items[1]!.clauseCatalogId] ?? [];
    items[0]!.selected = true;
    items[0]!.standardClauseOptionId = otherClauseOptions[0] ?? FAKE_UUID;
    const put = await client.putConfig<any>({ clauses: items }, po.token);
    expect(put.status).toBe(400);
    assertErrorEnvelope(put, "ERR_INVALID_STANDARD_CLAUSE");
  });

  liveOnly("TC-CCAPI-030 — nonexistent standard clause option → 400 ERR_INVALID_STANDARD_CLAUSE @regression", async () => {
    const items = cloneBaseline();
    items[0]!.selected = true;
    items[0]!.standardClauseOptionId = FAKE_UUID;
    const put = await client.putConfig<any>({ clauses: items }, po.token);
    expect(put.status).toBe(400);
    assertErrorEnvelope(put, "ERR_INVALID_STANDARD_CLAUSE");
  });

  liveOnly("TC-CCAPI-031 — missing required field (selected) → 400 ERR_VALIDATION_FAILED @regression", async () => {
    const items: any[] = cloneBaseline();
    delete items[0]!.selected;
    const put = await client.putConfig<any>({ clauses: items }, po.token);
    expect(put.status).toBe(400);
    assertErrorEnvelope(put, "ERR_VALIDATION_FAILED");
  });

  liveOnly("TC-CCAPI-032 — missing clauses array → 400 (descriptive, never 500) @regression", async () => {
    const put = await client.putConfig<any>({}, po.token);
    assertResponseTime(put);
    expect(put.status).toBe(400);
    expect(put.data.success).toBe(false);
    expect(put.data.error?.code).toBeTruthy();
  });

  liveOnly("TC-CCAPI-036 — PUT without a token → 401 ERR_AUTH_INVALID_TOKEN @regression", async () => {
    const put = await client.putConfig<any>({ clauses: baseline }, undefined);
    assertResponseTime(put);
    expect(put.status).toBe(401);
    assertErrorEnvelope(put, "ERR_AUTH_INVALID_TOKEN");
  });

  liveOnly("TC-CCSEC-003 — validation happens before any write (invalid PUT leaves config unchanged) @regression", async () => {
    const before = await client.getConfig<any>(po.token);
    const snapshot = JSON.stringify(toPutItems(before.data.data.clauses));
    const items = cloneBaseline();
    items[0]!.riskLevel = "urgent";
    const put = await client.putConfig<any>({ clauses: items }, po.token);
    expect(put.status).toBe(400);
    const after = await client.getConfig<any>(po.token);
    expect(JSON.stringify(toPutItems(after.data.data.clauses))).toBe(snapshot);
  });
});

/**
 * Skipped-with-reason — see testcases/TC-CEIQ-FEAT-006.md §9. Declared 1:1 so the count
 * stays honest; not fabricated passes.
 */
describe("Clause Configuration — blocked this cycle (documented)", () => {
  deferred("TC-CCAPI-005 — fresh-tenant default [blocked: shared dev tenant already configured]", () => {});
  deferred("TC-CCAPI-007 — GET 403 for no-right token [blocked: no confirmed token lacking manage_clause_configuration]", () => {});
  deferred("TC-CCAPI-037 — PUT 403 for no-right token [blocked: same as CCAPI-007]", () => {});
  deferred("TC-CCAPI-008 — GET tenant isolation [blocked: needs a 2nd dev tenant]", () => {});
  deferred("TC-CCAPI-038 — PUT tenant isolation [blocked: needs a 2nd dev tenant]", () => {});
  deferred("TC-CCAPI-041 — updated_by/updated_at [blocked: not exposed in GET; needs DB/audit]", () => {});
  deferred("TC-CCSEC-002 — RLS isolation [blocked: needs a 2nd dev tenant]", () => {});
  deferred("TC-CCSEC-006 — non-Owner server-side rejection [blocked: needs a no-right token]", () => {});
});
