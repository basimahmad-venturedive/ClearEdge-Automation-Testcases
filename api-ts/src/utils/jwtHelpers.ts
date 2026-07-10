/**
 * JWT test-token minting for CEIQ-FOUND-001 (F1).
 *
 * Claim shapes below are taken verbatim from spec §7.2 (JWT Claim Contract):
 *   Tenant pool: sub, tenant_id, role_id, email
 *   Admin pool:  sub, email, admin
 *
 * 'local' mode (default) generates a disposable RSA keypair per test run and signs
 * tokens against it — this exercises the *shape* of JwtAuthGuard / AdminJwtAuthGuard's
 * claim handling without touching real Cognito. It does NOT prove signature
 * verification against the real Cognito JWKS endpoint — that requires 'cognito' mode
 * once an environment exists.
 */
import { generateKeyPair, SignJWT, type KeyLike } from "jose";
import { randomUUID } from "crypto";

export interface TenantTokenOptions {
  tenantId?: string;
  roleId?: string;
  email?: string;
  sub?: string;
  omitRoleId?: boolean;
  expiresInSeconds?: number;
  issuer?: string;
}

export interface AdminTokenOptions {
  email?: string;
  sub?: string;
  admin?: boolean;
  expiresInSeconds?: number;
  issuer?: string;
}

export class JwtFactory {
  private privateKey: KeyLike | null = null;

  private async keypair(): Promise<KeyLike> {
    if (!this.privateKey) {
      const { privateKey } = await generateKeyPair("RS256");
      this.privateKey = privateKey;
    }
    return this.privateKey;
  }

  async tenantToken(options: TenantTokenOptions = {}): Promise<string> {
    const {
      tenantId,
      roleId,
      email = "test.user@example.test",
      sub = randomUUID(),
      omitRoleId = false,
      expiresInSeconds = 3600,
      issuer = "https://test-tenant-pool.example.test",
    } = options;

    const key = await this.keypair();
    const expEpochSeconds = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return new SignJWT({
      email,
      ...(tenantId !== undefined ? { tenant_id: tenantId } : {}),
      ...(!omitRoleId && roleId !== undefined ? { role_id: roleId } : {}),
    })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(sub)
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime(expEpochSeconds)
      .sign(key);
  }

  async adminToken(options: AdminTokenOptions = {}): Promise<string> {
    const {
      email = "admin@venturedive.test",
      sub = randomUUID(),
      admin = true,
      expiresInSeconds = 3600,
      issuer = "https://test-admin-pool.example.test",
    } = options;

    const key = await this.keypair();
    return new SignJWT({ email, admin })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(sub)
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime(`${expiresInSeconds}s`)
      .sign(key);
  }

  async expiredTenantToken(options: TenantTokenOptions = {}): Promise<string> {
    return this.tenantToken({ ...options, expiresInSeconds: -3600 });
  }

  /** TC-AUTH-002 — flips the last signature character to invalidate it without touching claims. */
  tamperedToken(baseToken: string): string {
    const parts = baseToken.split(".");
    const sig = parts[2] ?? "";
    const lastChar = sig.at(-1);
    const flippedChar = lastChar !== "A" ? "A" : "B";
    const flipped = flippedChar + sig.slice(1);
    return `${parts[0]}.${parts[1]}.${flipped}`;
  }
}
