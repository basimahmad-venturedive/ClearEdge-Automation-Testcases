/**
 * TC-VENDOR-001..003 — vendor secure-link validated-session contract.
 * Spec: §7.2, §8.1, §9 (SR-007, SR-008, SR-009), §12. Blocked — see tests/auth.test.ts header.
 */
import { describe, test, expect } from "vitest";
import { createHash, randomBytes } from "crypto";
import { ControlPlaneClient, TODO_ENDPOINT_VENDOR_PORTAL } from "../src/clients/controlPlaneClient";
import type { ErrorEnvelope, SuccessEnvelope } from "../src/payloads/types";

const NO_ENV_REASON = "no environment exists yet — see TC-VENDOR-* in TC-CEIQ-FOUND-001.md §9";

function rawTokenAndHash(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: createHash("sha256").update(raw).digest("hex") };
}

describe("Vendor secure link", () => {
  test.skip(`TC-VENDOR-001 — valid unexpired token establishes session, no rights granted (SR-007) [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new ControlPlaneClient();
    const { raw } = rawTokenAndHash();
    // Arrange: insert an active, unexpired vendor_access_tokens row with this hash (fixture setup).
    const response = await client.get(TODO_ENDPOINT_VENDOR_PORTAL, raw);
    expect(response.status).toBe(200);
    expect((response.data as SuccessEnvelope<Record<string, unknown>>).data).not.toHaveProperty("rights");
  });

  test.skip(`TC-VENDOR-002 — vendor cannot escape its record scope (SR-008) [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new ControlPlaneClient();
    const { raw } = rawTokenAndHash(); // bound to RFP X / Vendor V by fixture
    const response = await client.get("/TODO/vendor-portal/rfp/some-other-rfp-id", raw);
    expect(response.status).toBe(403);
    expect((response.data as ErrorEnvelope).error.code).toBe("ERR_VENDOR_SCOPE_VIOLATION");
  });

  test.skip.each(["expired", "used", "revoked", "active_but_expires_at_past"])(
    `TC-VENDOR-003 — token state=%s rejected 401 (SR-009) [blocked: ${NO_ENV_REASON}] @smoke`,
    async () => {
      const client = new ControlPlaneClient();
      const { raw } = rawTokenAndHash(); // fixture seeds the row in the given state
      const response = await client.get(TODO_ENDPOINT_VENDOR_PORTAL, raw);
      expect(response.status).toBe(401);
      expect((response.data as ErrorEnvelope).error.code).toBe("ERR_VENDOR_LINK_INVALID");
    },
  );
});
