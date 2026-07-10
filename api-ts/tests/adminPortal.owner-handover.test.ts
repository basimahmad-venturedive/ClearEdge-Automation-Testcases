/**
 * TC-ADMAPI-050..055, 060..063, 066 — CEIQ-FEAT-001 Admin Portal:
 * PATCH /api/v1/admin/tenants/:id/owner and POST /api/v1/admin/tenants/:id/handover.
 * Spec: SPEC_CEIQ-FEAT-001-admin-portal.md §4.2, §5, §9; cases: testcases/TC-CEIQ-FEAT-001.md (Module: API).
 * List/create/detail/company/status live in tests/adminPortal.tenants.test.ts.
 *
 * DEFERRED (fault-injection PARTIAL — no black-box fault-injection harness exists; execute
 * manually with engineering support or as backend integration tests in clearedge-backend):
 *   - TC-ADMAPI-056 — reassignment compensation paths (SendGrid failure; old-PO-deactivation failure; DB failure).
 *   - TC-ADMAPI-064 — handover retry-safety after DB failure.
 *   - TC-ADMAPI-065 — handover compensation on SendGrid failure restores the setup password.
 * Same constraint family: TC-ADMAPI-016 (see the tenants suite header).
 */
import { describe, test, expect } from "vitest";
import { randomUUID } from "crypto";
import type { AxiosResponse } from "axios";
import { AdminPortalClient } from "../src/clients/adminPortalClient";
import { JwtFactory } from "../src/utils/jwtHelpers";
import { withDbClient } from "../src/utils/dbClient";
import { createSetupTenant, createHandedOverTenant, teardownTenant } from "../src/utils/adminPortalFixtures";
import {
  ownerUpdatePayload,
  uniqueEmail,
  ERR_VALIDATION_FAILED,
  ERR_NOT_FOUND,
  ERR_EMAIL_ALREADY_IN_USE,
  ERR_INVALID_STATE_TRANSITION,
  MSG_TENANT_NOT_FOUND,
  MSG_EMAIL_IN_USE,
  MSG_ALREADY_HANDED_OVER,
  FIELD_MESSAGES,
} from "../src/payloads/adminPortalPayloads";
import { TenantDetailEnvelopeSchema, ErrorEnvelopeSchema } from "../src/schemas/adminPortalSchemas";
import { assertResponseTime, assertErrorEnvelope } from "../src/utils/assertions";
import type { ErrorEnvelope } from "../src/payloads/types";

const SKIP_REASON =
  "CEIQ-FEAT-001 /api/v1/admin/tenants endpoints not implemented in local backend as of 2026-07-08";
const jwtFactory = new JwtFactory();

/** Pulls `error.details.fields` out of a 400 ERR_VALIDATION_FAILED body. */
function validationFields(response: AxiosResponse): Record<string, string> {
  const err = response.data as ErrorEnvelope;
  return ((err.error.details as { fields?: Record<string, string> } | undefined)?.fields ?? {});
}

describe("Admin Portal — PATCH /admin/tenants/:id/owner", () => {
  test.skip(`TC-ADMAPI-050 — name-only change: users.name + tenants.owner_name updated; no Cognito/email side effects [blocked: ${SKIP_REASON}]`, async () => {
    // Arrange
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant, payload } = await createSetupTenant(client, adminToken);
    const newName = `Thomas Whitfield ${Date.now().toString(36)}`;

    try {
      // Act — email unchanged routes to the name-only branch (§4.2).
      const response = await client.updateOwner(tenant.id, { name: newName, email: payload.ownerEmail }, adminToken);

      // Assert
      assertResponseTime(response);
      expect(response.status).toBe(200);
      const body = TenantDetailEnvelopeSchema.parse(response.data);
      expect(body.data.ownerName).toBe(newName);
      expect(body.data.ownerEmail).toBe(payload.ownerEmail);

      await withDbClient(async (db) => {
        // Same user row updated — no new user row.
        const users = await db.query("SELECT name, email, status FROM users WHERE tenant_id = $1", [tenant.id]);
        expect(users.rows).toHaveLength(1);
        expect(users.rows[0]).toMatchObject({ name: newName, email: payload.ownerEmail, status: "active" });
        const tenants = await db.query("SELECT owner_name, owner_email FROM tenants WHERE id = $1", [tenant.id]);
        expect(tenants.rows[0]).toMatchObject({ owner_name: newName, owner_email: payload.ownerEmail });
      });
      // TODO(qa, TC-ADMAPI-050 step 3): Cognito account must be untouched (still enabled, same
      // username — name is not a Cognito attribute). Needs a Cognito admin helper not yet in this kit.
    } finally {
      await teardownTenant(tenant.id);
    }
  });

  test.skip(`TC-ADMAPI-051 — email change on handed-over tenant: full reassignment chain [blocked: ${SKIP_REASON}]`, async () => {
    // Arrange — disposable handed-over tenant.
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant, payload } = await createHandedOverTenant(client, adminToken);
    const newEmail = uniqueEmail("new-owner");

    try {
      // Act
      const response = await client.updateOwner(tenant.id, { name: payload.ownerName, email: newEmail }, adminToken);

      // Assert — 200 with the new owner; setupPassword stays null after handover.
      assertResponseTime(response);
      expect(response.status).toBe(200);
      const body = TenantDetailEnvelopeSchema.parse(response.data);
      expect(body.data.ownerEmail).toBe(newEmail);
      expect(body.data.setupPassword ?? null).toBeNull();

      await withDbClient(async (db) => {
        const oldPo = await db.query("SELECT status FROM users WHERE tenant_id = $1 AND email = $2", [tenant.id, payload.ownerEmail]);
        expect(oldPo.rows[0].status).toBe("inactive");
        const newPo = await db.query(
          "SELECT u.status, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.tenant_id = $1 AND u.email = $2",
          [tenant.id, newEmail],
        );
        expect(newPo.rows).toHaveLength(1);
        expect(newPo.rows[0]).toMatchObject({ status: "active", role_name: "procurement_owner" });
        const tenants = await db.query("SELECT owner_email FROM tenants WHERE id = $1", [tenant.id]);
        expect(tenants.rows[0].owner_email).toBe(newEmail);
      });
      // TODO(qa, TC-ADMAPI-051 steps 3–4): Cognito legs need a tenant-pool auth/admin helper —
      //   (3) old PO auth must be REJECTED (AdminDisableUser + AdminUserGlobalSignOut);
      //   (4) new PO account exists in FORCE_CHANGE_PASSWORD state (Permanent: false ⇒ NEW_PASSWORD_REQUIRED).
      // Invite-email dispatch content is manual (TC-ADMMAIL-002) — no SendGrid sandbox.
    } finally {
      await teardownTenant(tenant.id);
    }
  });

  test.skip(`TC-ADMAPI-052 — email change during Setup: new setup password issued and re-encrypted; no email [blocked: ${SKIP_REASON}]`, async () => {
    // Arrange — Setup tenant; original setup password known from creation.
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant, payload } = await createSetupTenant(client, adminToken);
    const originalPassword = tenant.setupPassword;
    expect(originalPassword).toBeTruthy();
    const previousEnc = await withDbClient(async (db) => {
      const { rows } = await db.query("SELECT setup_password_enc FROM tenants WHERE id = $1", [tenant.id]);
      return rows[0].setup_password_enc as string;
    });
    const newEmail = uniqueEmail("new-setup");

    try {
      // Act
      const response = await client.updateOwner(tenant.id, { name: payload.ownerName, email: newEmail }, adminToken);

      // Assert — §4.2: when setup_status='in_setup' and email changed, setupPassword is returned (decrypted).
      assertResponseTime(response);
      expect(response.status).toBe(200);
      const body = TenantDetailEnvelopeSchema.parse(response.data);
      expect(body.data.setupPassword).toBeTruthy();
      expect(body.data.setupPassword).not.toBe(originalPassword);
      expect(body.data.ownerEmail).toBe(newEmail);

      // Column re-encrypted: new ciphertext, never the plaintext.
      await withDbClient(async (db) => {
        const { rows } = await db.query("SELECT setup_password_enc FROM tenants WHERE id = $1", [tenant.id]);
        const enc = rows[0].setup_password_enc as string;
        expect(enc).not.toBeNull();
        expect(enc).not.toBe(previousEnc);
        expect(enc).not.toBe(body.data.setupPassword);
        expect(String(enc)).not.toContain(String(body.data.setupPassword));
      });
      // TODO(qa, TC-ADMAPI-052 steps 3–4): Cognito legs need a tenant-pool auth helper —
      //   (3) old setup password / old PO account rejected;
      //   (4) new PO + new returned password authenticates with NO challenge (Permanent: true).
      // No email is sent for in_setup (SendGrid step skipped) — no observable dispatch in this env.
    } finally {
      await teardownTenant(tenant.id);
    }
  });

  test.skip(`TC-ADMAPI-053 — nothing changed: no-op returns current state, no side effects [blocked: ${SKIP_REASON}]`, async () => {
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant, payload } = await createSetupTenant(client, adminToken);
    const usersBefore = await withDbClient(async (db) => {
      const { rows } = await db.query("SELECT id, name, email, status FROM users WHERE tenant_id = $1 ORDER BY id", [tenant.id]);
      return rows;
    });

    try {
      // Act — identical current name + email routes to the no-op branch before any Cognito call (§4.2/§5).
      const response = await client.updateOwner(tenant.id, { name: payload.ownerName, email: payload.ownerEmail }, adminToken);

      // Assert — current state returned, nothing mutated.
      assertResponseTime(response);
      expect(response.status).toBe(200);
      const body = TenantDetailEnvelopeSchema.parse(response.data);
      expect(body.data.ownerName).toBe(payload.ownerName);
      expect(body.data.ownerEmail).toBe(payload.ownerEmail);

      await withDbClient(async (db) => {
        const { rows } = await db.query("SELECT id, name, email, status FROM users WHERE tenant_id = $1 ORDER BY id", [tenant.id]);
        expect(rows).toEqual(usersBefore); // no new rows, no status changes
      });
      // TODO(qa, TC-ADMAPI-053 step 2): Cognito untouched + no email — needs a Cognito admin helper.
    } finally {
      await teardownTenant(tenant.id);
    }
  });

  test.skip(`TC-ADMAPI-054 — owner update negatives: duplicate email (no partial side effects), validation 400, 404 [blocked: ${SKIP_REASON}]`, async () => {
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const a = await createSetupTenant(client, adminToken);
    const b = await createSetupTenant(client, adminToken);

    try {
      // 54a — B's owner email set to A's PO email → 409; Cognito step 1 fails first ⇒ nothing else touched.
      const conflict = await client.updateOwner(
        b.tenant.id,
        { name: b.payload.ownerName, email: a.payload.ownerEmail },
        adminToken,
      );
      assertResponseTime(conflict);
      expect(conflict.status).toBe(409);
      ErrorEnvelopeSchema.parse(conflict.data);
      assertErrorEnvelope(conflict, ERR_EMAIL_ALREADY_IN_USE);
      expect((conflict.data as ErrorEnvelope).error.message).toBe(MSG_EMAIL_IN_USE);
      await withDbClient(async (db) => {
        const users = await db.query("SELECT email, status FROM users WHERE tenant_id = $1", [b.tenant.id]);
        expect(users.rows).toHaveLength(1); // no new user row
        expect(users.rows[0]).toMatchObject({ email: b.payload.ownerEmail, status: "active" }); // no deactivation
      });

      // 54b — invalid email format
      const badEmail = await client.updateOwner(b.tenant.id, { name: b.payload.ownerName, email: "bad-email" }, adminToken);
      assertResponseTime(badEmail);
      expect(badEmail.status).toBe(400);
      assertErrorEnvelope(badEmail, ERR_VALIDATION_FAILED);
      expect(validationFields(badEmail).email).toBe(FIELD_MESSAGES.emailInvalid);

      // 54c — empty name
      const emptyName = await client.updateOwner(b.tenant.id, { name: "", email: b.payload.ownerEmail }, adminToken);
      assertResponseTime(emptyName);
      expect(emptyName.status).toBe(400);
      assertErrorEnvelope(emptyName, ERR_VALIDATION_FAILED);
      expect(validationFields(emptyName).name).toBe(FIELD_MESSAGES.ownerNameRequired);

      // 54d — unknown tenant UUID
      const notFound = await client.updateOwner(randomUUID(), ownerUpdatePayload(), adminToken);
      assertResponseTime(notFound);
      expect(notFound.status).toBe(404);
      assertErrorEnvelope(notFound, ERR_NOT_FOUND);
      expect((notFound.data as ErrorEnvelope).error.message).toBe(MSG_TENANT_NOT_FOUND);
    } finally {
      await teardownTenant(a.tenant.id);
      await teardownTenant(b.tenant.id);
    }
  });

  test.skip(`TC-ADMAPI-055 — missing active PO → 500 generic error, no partial writes (data-integrity precondition) [blocked: ${SKIP_REASON} — isolated/local env only, never shared QA data]`, async () => {
    // Arrange — corrupt-state fixture: deactivate the PO row directly in the DB.
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant } = await createSetupTenant(client, adminToken);

    try {
      await withDbClient((db) => db.query("UPDATE users SET status = 'inactive' WHERE tenant_id = $1", [tenant.id]));

      // Act
      const response = await client.updateOwner(tenant.id, ownerUpdatePayload(), adminToken);

      // Assert — generic 500, no internal detail leaked, no partial writes.
      assertResponseTime(response);
      expect(response.status).toBe(500);
      const rawBody = JSON.stringify(response.data ?? {});
      expect(rawBody).not.toMatch(/stack|trace|at\s+\w+\.\w+/i);
      await withDbClient(async (db) => {
        const users = await db.query("SELECT count(*)::int AS n FROM users WHERE tenant_id = $1", [tenant.id]);
        expect(users.rows[0].n).toBe(1); // no new PO row was mirrored
        const tenants = await db.query("SELECT owner_email FROM tenants WHERE id = $1", [tenant.id]);
        expect(tenants.rows[0].owner_email).toBe(tenant.ownerEmail); // tenant row untouched
      });
    } finally {
      await teardownTenant(tenant.id);
    }
  });
});

describe("Admin Portal — POST /admin/tenants/:id/handover", () => {
  test.skip(`TC-ADMAPI-060 — handover: 200 + all DB effects in one transaction [blocked: ${SKIP_REASON}]`, async () => {
    // Arrange — disposable Setup tenant (as produced by TC-ADMAPI-010).
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant } = await createSetupTenant(client, adminToken);

    try {
      // Act — no body required.
      const response = await client.triggerHandover(tenant.id, adminToken);

      // Assert — §4.2 200 contract.
      assertResponseTime(response);
      expect(response.status).toBe(200);
      const body = TenantDetailEnvelopeSchema.parse(response.data);
      expect(body.data.status).toBe("active");
      expect(body.data.setupStatus).toBe("handed_over");
      expect(body.data.setupPassword ?? null).toBeNull();
      expect(body.data.setupCompletedAt).not.toBeNull();

      // DB: password wiped, status flipped, completion stamped within the last 60 s — one transaction.
      await withDbClient(async (db) => {
        const { rows } = await db.query(
          "SELECT setup_password_enc, status, setup_status, setup_completed_at FROM tenants WHERE id = $1",
          [tenant.id],
        );
        expect(rows[0].setup_password_enc).toBeNull();
        expect(rows[0]).toMatchObject({ status: "active", setup_status: "handed_over" });
        const completedAt = new Date(rows[0].setup_completed_at).getTime();
        expect(Math.abs(Date.now() - completedAt)).toBeLessThan(60_000);
      });
      // TODO(qa, TC-ADMAPI-060 step 3): PO account must now carry a TEMPORARY password
      // (Permanent: false ⇒ NEW_PASSWORD_REQUIRED on first auth) — needs a Cognito auth helper.
      // Email dispatch content is manual (TC-ADMMAIL-001).
    } finally {
      await teardownTenant(tenant.id);
    }
  });

  test.skip(`TC-ADMAPI-061 — handover on an already-handed-over tenant → 409 (terminal state), no state change [blocked: ${SKIP_REASON}]`, async () => {
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant } = await createHandedOverTenant(client, adminToken);

    try {
      const response = await client.triggerHandover(tenant.id, adminToken);

      assertResponseTime(response);
      expect(response.status).toBe(409);
      ErrorEnvelopeSchema.parse(response.data);
      assertErrorEnvelope(response, ERR_INVALID_STATE_TRANSITION);
      const err = response.data as ErrorEnvelope;
      expect(err.error.message).toBe(MSG_ALREADY_HANDED_OVER);
      expect(err.error.details).toMatchObject({ currentSetupStatus: "handed_over" });

      await withDbClient(async (db) => {
        const { rows } = await db.query("SELECT status, setup_status FROM tenants WHERE id = $1", [tenant.id]);
        expect(rows[0]).toMatchObject({ status: "active", setup_status: "handed_over" });
      });
    } finally {
      await teardownTenant(tenant.id);
    }
  });

  test.skip(`TC-ADMAPI-062 — handover 404 for unknown/soft-deleted tenant [blocked: ${SKIP_REASON}]`, async () => {
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();

    const response = await client.triggerHandover(randomUUID(), adminToken);

    assertResponseTime(response);
    expect(response.status).toBe(404);
    ErrorEnvelopeSchema.parse(response.data);
    assertErrorEnvelope(response, ERR_NOT_FOUND);
    expect((response.data as ErrorEnvelope).error.message).toBe(MSG_TENANT_NOT_FOUND);
  });

  test.skip(`TC-ADMAPI-063 — old setup password no longer authenticates after handover [blocked: ${SKIP_REASON}]`, async () => {
    // Arrange — capture the plaintext setup password before handover, then hand over.
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const fixture = await createHandedOverTenant(client, adminToken);
    expect(fixture.setupPasswordBeforeHandover).toBeTruthy();

    try {
      // API-observable half: the encrypted password is gone, so it can never be re-served.
      await withDbClient(async (db) => {
        const { rows } = await db.query("SELECT setup_password_enc FROM tenants WHERE id = $1", [fixture.tenant.id]);
        expect(rows[0].setup_password_enc).toBeNull();
      });
      // Cognito half — the actual rejection of the old setup password (temporary password overwrote
      // it via AdminSetUserPassword(Permanent: false) + AdminUserGlobalSignOut). Chains with TC-ADMAPI-060.
      throw new Error(
        "TC-ADMAPI-063 Cognito leg: tenant-pool auth attempt with the pre-handover setup password requires a Cognito auth helper (local-env/localCognitoMock or AWS SDK) — scaffolded, not yet implemented",
      );
    } finally {
      await teardownTenant(fixture.tenant.id);
    }
  });

  test.skip(`TC-ADMAPI-066 — handover invalidates any active PO session token (global sign-out) [blocked: ${SKIP_REASON}]`, async () => {
    // Arrange — needs an ACTIVE Cognito session as the PO (setup password) held by the test
    // before handover; assert on REFRESH-token rejection afterwards, not raw JWT expiry
    // (Cognito access tokens stay valid until natural expiry even after AdminUserGlobalSignOut).
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant } = await createSetupTenant(client, adminToken);

    try {
      // Step 1 (blocked): authenticate as the PO with the setup password and hold refresh/access tokens.
      // Step 2: execute handover. Step 3: refresh-token use must be REJECTED (revoked).
      throw new Error(
        "TC-ADMAPI-066: establishing and refreshing a PO Cognito session requires a tenant-pool auth helper (local-env/localCognitoMock or AWS SDK) — scaffolded, not yet implemented",
      );
    } finally {
      await teardownTenant(tenant.id);
    }
  });
});
